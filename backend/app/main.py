from __future__ import annotations

import base64
import asyncio
import io
import json
import logging
import os
import re
import secrets
import hashlib
import time
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import bcrypt
import httpx
import pymupdf
from bson import ObjectId
from fastapi import Depends, FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError, jwt
from motor.motor_asyncio import AsyncIOMotorClient, AsyncIOMotorGridFSBucket
from pydantic import BaseModel, EmailStr, Field, field_validator
from docx import Document
from PIL import Image
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parents[1] / ".env")

MONGO_URI = os.getenv("MONGODB_URI", "")
DB_NAME = os.getenv("MONGODB_DB", "medimind")
JWT_SECRET = os.getenv("JWT_SECRET", "")
JWT_ALGORITHM = "HS256"
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")
GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-3.6-flash")
GEMINI_THINKING_LEVEL = os.getenv("GEMINI_THINKING_LEVEL", "LOW").upper()
if GEMINI_THINKING_LEVEL not in {"MINIMAL", "LOW", "MEDIUM", "HIGH"}:
    GEMINI_THINKING_LEVEL = "LOW"
MAX_UPLOAD = int(os.getenv("MAX_UPLOAD_MB", "10")) * 1024 * 1024
logger = logging.getLogger("medimind.ai")
app = FastAPI(title="MediMind API", version="1.0.0", description="Private, role-aware health report and care conversation API")
origins = [x.strip() for x in os.getenv("FRONTEND_ORIGIN", "http://localhost:5173").split(",") if x.strip()]
app.add_middleware(CORSMiddleware, allow_origins=origins, allow_credentials=True, allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"], allow_headers=["Authorization", "Content-Type"])
security = HTTPBearer(auto_error=False)
client: AsyncIOMotorClient | None = None
db = None
fs: AsyncIOMotorGridFSBucket | None = None
gemini_http: httpx.AsyncClient | None = None
pubmed_http: httpx.AsyncClient | None = None

@app.on_event("startup")
async def connect_db():
    global client, db, fs, gemini_http, pubmed_http
    gemini_http = httpx.AsyncClient(
        timeout=httpx.Timeout(connect=10, read=90, write=30, pool=10),
        limits=httpx.Limits(max_connections=40, max_keepalive_connections=20),
    )
    pubmed_http = httpx.AsyncClient(timeout=20, headers={"User-Agent": "MediMind/1.0"})
    if MONGO_URI:
        client = AsyncIOMotorClient(MONGO_URI, serverSelectionTimeoutMS=5000)
        db = client[DB_NAME]
        fs = AsyncIOMotorGridFSBucket(db, bucket_name="report_files")

@app.on_event("shutdown")
async def close_db():
    global gemini_http, pubmed_http
    if client:
        client.close()
    if gemini_http:
        await gemini_http.aclose()
        gemini_http = None
    if pubmed_http:
        await pubmed_http.aclose()
        pubmed_http = None

def database():
    if db is None:
        raise HTTPException(503, "Database is not configured. Add MONGODB_URI to the environment.")
    return db

def user_out(user: dict[str, Any]) -> dict[str, Any]:
    return {"id": str(user["_id"]), "email": user["email"], "username": user["username"], "role": user["role"]}

def make_token(user: dict[str, Any]) -> str:
    return jwt.encode({"sub": str(user["_id"]), "role": user["role"], "exp": datetime.now(timezone.utc) + timedelta(days=7)}, JWT_SECRET, algorithm=JWT_ALGORITHM)

async def current_user(creds: HTTPAuthorizationCredentials | None = Depends(security)):
    if not JWT_SECRET:
        raise HTTPException(503, "Authentication is not configured. Add JWT_SECRET to the environment.")
    if not creds:
        raise HTTPException(401, "Please sign in to continue.")
    try:
        payload = jwt.decode(creds.credentials, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        uid = payload.get("sub")
        if not uid: raise ValueError("missing user")
    except (JWTError, ValueError):
        raise HTTPException(401, "Your sign-in has expired. Please sign in again.")
    user = await database().users.find_one({"_id": ObjectId(uid)})
    if not user: raise HTTPException(401, "Account not found.")
    return user

async def patient_user(user=Depends(current_user)):
    if user.get("role") != "patient":
        raise HTTPException(403, "This feature is available to patient accounts only.")
    return user

def oid(value: str) -> ObjectId:
    if not ObjectId.is_valid(value): raise HTTPException(404, "Item not found.")
    return ObjectId(value)

class Signup(BaseModel):
    email: EmailStr
    username: str = Field(min_length=3, max_length=32, pattern=r"^[a-zA-Z0-9_.-]+$")
    password: str = Field(min_length=8, max_length=128)
    role: str = Field(pattern=r"^(patient|doctor)$")

class Signin(BaseModel):
    email: str
    password: str = Field(min_length=8, max_length=128)

class MessageIn(BaseModel):
    content: str = Field(min_length=1, max_length=5000)

class ConversationIn(BaseModel):
    doctor_username: str = Field(min_length=3, max_length=32)

class ConversationReportIn(BaseModel):
    report_id: str

class ChatIn(BaseModel):
    message: str = Field(min_length=1, max_length=3000)

class ResearchIn(BaseModel):
    report_id: str | None = None
    text: str | None = Field(default=None, max_length=5000)

class ResearchChatIn(BaseModel):
    question: str = Field(min_length=1, max_length=2000)
    context: str = Field(default="", max_length=5000)

class CompanionIn(BaseModel):
    message: str = Field(min_length=1, max_length=1200)
    current_page: str = Field(default="reports", pattern=r"^(reports|timeline|research|medications|emergency|care)$")
    mode: str = Field(default="ask", pattern=r"^(ask|guide)$")
    language: str = Field(default="en-IN", pattern=r"^(en-IN|hi-IN|kn-IN|te-IN|ta-IN)$")

class MedicationIn(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    dose: str = Field(default="", max_length=80)
    frequency: str = Field(default="", max_length=120)
    times: list[str] = Field(default_factory=list, max_length=8)
    instructions: str = Field(default="", max_length=500)

    @field_validator("times")
    @classmethod
    def validate_times(cls, values):
        if any(not re.fullmatch(r"(?:[01]\d|2[0-3]):[0-5]\d", value) for value in values):
            raise ValueError("Reminder times must use 24-hour HH:MM format.")
        return values

class EmergencyProfileIn(BaseModel):
    display_name: str = Field(default="", max_length=80)
    allergies: str = Field(default="", max_length=1000)
    conditions: str = Field(default="", max_length=1000)
    medications: str = Field(default="", max_length=1000)
    blood_group: str = Field(default="", pattern=r"^(|A\+|A-|B\+|B-|AB\+|AB-|O\+|O-)$")
    emergency_contact: str = Field(default="", max_length=120)
    share_fields: list[str] = Field(default_factory=list, max_length=6)

EMERGENCY_FIELDS = {"display_name", "allergies", "conditions", "medications", "blood_group", "emergency_contact"}

COMPANION_GUIDES = {
    "upload_report": "reports",
    "understand_report": "reports",
    "explore_research": "research",
    "health_timeline": "timeline",
    "medication_plan": "medications",
    "emergency_profile": "emergency",
    "care_conversation": "care",
    "doctor_care": "care",
}
COMPANION_FIELDS = {
    "report_upload": ("reports", "Upload a report file using the supported file picker."),
    "report_question": ("reports", "Ask a question about the selected report in plain language."),
    "research_report": ("research", "Optionally choose a saved report to use as research context."),
    "research_question": ("research", "Enter a general research question or finding. Do not enter names or identifiers."),
    "medication_upload": ("medications", "Upload a prescription to create an unverified draft for you to compare with the original."),
    "medication_name": ("medications", "Enter the medicine name exactly as it appears on the prescription."),
    "emergency_profile": ("emergency", "Enter only emergency details you are comfortable saving to your private account."),
    "emergency_share": ("emergency", "Select the exact details you want exposed through a temporary emergency link."),
    "doctor_username": ("care", "Enter the exact username of a registered doctor to start a private conversation."),
    "care_message": ("care", "Write a message for the doctor in your existing conversation."),
}

@app.get("/api/health")
async def health():
    return {"status": "ok", "model": GEMINI_MODEL, "database_configured": bool(MONGO_URI)}

@app.post("/api/auth/signup")
async def signup(payload: Signup):
    users = database().users
    email = payload.email.lower().strip(); username = payload.username.strip()
    if await users.find_one({"$or": [{"email": email}, {"username_lower": username.lower()}]}):
        raise HTTPException(409, "That email or username is already registered.")
    user = {"email": email, "username": username, "username_lower": username.lower(), "password_hash": bcrypt.hashpw(payload.password.encode(), bcrypt.gensalt()).decode(), "role": payload.role, "created_at": datetime.now(timezone.utc)}
    try:
        result = await users.insert_one(user)
    except Exception as exc:
        raise HTTPException(409, "That email or username is already registered.") from exc
    user["_id"] = result.inserted_id
    return {"access_token": make_token(user), "token_type": "bearer", "user": user_out(user)}

@app.post("/api/auth/signin")
async def signin(payload: Signin):
    login = payload.email.strip().lower()
    user = await database().users.find_one({"$or": [{"email": login}, {"username_lower": login}]})
    if not user or not bcrypt.checkpw(payload.password.encode(), user["password_hash"].encode()):
        raise HTTPException(401, "Email/username or password is incorrect.")
    return {"access_token": make_token(user), "token_type": "bearer", "user": user_out(user)}

async def gemini(prompt: str, media: tuple[str, bytes] | None = None, temperature: float = 0.2, json_mode: bool = False, thinking_level: str | None = None) -> str:
    if not GEMINI_API_KEY: raise HTTPException(503, "Gemini is not configured. Add GEMINI_API_KEY to the environment.")
    if gemini_http is None:
        raise HTTPException(503, "AI service is starting. Please retry in a moment.")
    parts: list[dict[str, Any]] = [{"text": prompt}]
    if media:
        mime, content = media
        parts.append({"inline_data": {"mime_type": mime, "data": base64.b64encode(content).decode()}})
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{GEMINI_MODEL}:generateContent"
    generation = {"temperature": temperature}
    if GEMINI_MODEL.startswith("gemini-3"):
        generation["thinkingConfig"] = {"thinkingLevel": thinking_level or GEMINI_THINKING_LEVEL}
    if json_mode: generation["responseMimeType"] = "application/json"
    started_at = time.perf_counter()
    try:
        response = await gemini_http.post(
            url,
            headers={"x-goog-api-key": GEMINI_API_KEY},
            json={"contents": [{"parts": parts}], "generationConfig": generation},
        )
    except httpx.TimeoutException as exc:
        logger.warning("Gemini timeout after %.2fs (model=%s)", time.perf_counter() - started_at, GEMINI_MODEL)
        raise HTTPException(504, "Gemini took too long to respond. Please retry.") from exc
    except httpx.RequestError as exc:
        logger.warning("Gemini connection failed after %.2fs (model=%s)", time.perf_counter() - started_at, GEMINI_MODEL)
        raise HTTPException(502, "Could not reach Gemini. Check the network connection and try again.") from exc
    logger.info("Gemini response in %.2fs (model=%s status=%s)", time.perf_counter() - started_at, GEMINI_MODEL, response.status_code)
    if response.status_code >= 400:
        if response.status_code in (400, 404):
            detail = f"Gemini rejected the request ({response.status_code}). Check that GEMINI_MODEL is available to your API key."
        elif response.status_code in (401, 403):
            detail = "Gemini rejected the API key or project access. Check GEMINI_API_KEY and Gemini API access."
        elif response.status_code == 429:
            detail = "Gemini quota or rate limit reached. Check your Google AI quota and try again later."
        else:
            detail = f"Gemini request failed ({response.status_code}). Check API access and try again."
        raise HTTPException(502, detail)
    data = response.json()
    try: return data["candidates"][0]["content"]["parts"][0]["text"].strip()
    except (KeyError, IndexError): raise HTTPException(502, "Gemini returned no readable response.")

COMPANION_MODULES = (
    ("reports", re.compile(r"\b(?:my reports?|uploaded reports?|report (?:library|dashboard|page)|medical reports?|lab reports?|upload (?:a )?(?:medical )?report)\b", re.I), "My reports"),
    ("timeline", re.compile(r"\b(?:health timeline|health history|report trends|timeline)\b", re.I), "Health timeline"),
    ("research", re.compile(r"\b(?:rare[ -](?:diseases?|conditions?)|pubmed(?: research)?|research page|research module)\b", re.I), "Rare disease research"),
    ("medications", re.compile(r"\b(?:medications?|medicines?|meds?|prescriptions?)\b|\b(?:medication module|medication page|medicine page|pills page)\b", re.I), "Medication plan"),
    ("emergency", re.compile(r"\b(?:emergency profile|emergency information|emergency details|emergency qr|emergency contact profile)\b", re.I), "Emergency profile"),
    ("care", re.compile(r"\b(?:care conversations?|doctor conversations?|patient conversations?|doctor chat|chat with (?:my )?doctor|messages? (?:to|with) (?:my )?doctor)\b", re.I), "Care conversations"),
)

def companion_navigation_intent(message: str, role: str, mode: str) -> dict[str, Any] | None:
    """Handle common feature navigation deterministically before calling the LLM."""
    for section, pattern, label in COMPANION_MODULES:
        if not pattern.search(message):
            continue
        lower = message.lower()
        explicit_navigation = bool(re.search(r"\b(?:open|go|navigate|take me|bring me|show me|switch to|visit|access)\b", lower))
        workflow_request = bool(re.search(r"\b(?:how|help|guide|where|set(?:ting)? up|setup|create|start|add|upload|manage|use|review|understand|explain|want|need)\b", lower))
        short_feature_request = len(message.split()) <= 4
        if not explicit_navigation and not workflow_request and not (mode == "guide" and short_feature_request) and not short_feature_request:
            continue
        if role == "doctor" and section != "care":
            return {"message": "Doctor accounts can access Care conversations only. I can help you open a patient conversation or use its message box.", "action": "ANSWER", "section": None, "guide_id": None, "field_id": None}
        should_guide = mode == "guide" or workflow_request
        guide_id = ("doctor_care" if role == "doctor" else "care_conversation") if section == "care" else {
            "reports": "understand_report" if re.search(r"\b(?:understand|explain|review)\b", lower) else "upload_report", "timeline": "health_timeline", "research": "explore_research",
            "medications": "medication_plan", "emergency": "emergency_profile",
        }[section]
        if should_guide:
            return {"message": f"Sure — I’ll take you to {label} and walk you through it step by step.", "action": "GUIDE", "section": section, "guide_id": guide_id, "field_id": None}
        return {"message": f"Opening {label}.", "action": "NAVIGATE", "section": section, "guide_id": None, "field_id": None}
    return None

@app.post("/api/companion/chat")
async def companion_chat(payload: CompanionIn, user=Depends(current_user)):
    doctor_scope = user.get("role") == "doctor"
    allowed_sections = {"care"} if doctor_scope else {"reports", "timeline", "research", "medications", "emergency", "care"}
    allowed_guides = {key for key, section in COMPANION_GUIDES.items() if section in allowed_sections and not (doctor_scope and key == "care_conversation")}
    allowed_fields = {key for key, (section, _) in COMPANION_FIELDS.items() if section in allowed_sections and not (doctor_scope and key == "doctor_username")}
    intent = companion_navigation_intent(payload.message, user.get("role", "patient"), payload.mode)
    if intent:
        return intent
    medical_advice_patterns = (
        r"\bdiagnos\w*\b", r"\b(?:treat|treatment|medication|medicine|dosage|dose|cure)\b",
        r"\bwhat (?:disease|condition) do i have\b",
        r"\b(?:interpret|explain)\b.{0,45}\b(?:blood|lab|test) results?\b",
        r"\b(?:abnormal|high|low)\b.{0,35}\b(?:result|level|value|test)\b",
    )
    if any(re.search(pattern, payload.message, re.IGNORECASE) for pattern in medical_advice_patterns):
        return {
            "message": "I can help with MediMind navigation, but I can’t interpret medical results or recommend care. Please use qualified clinical judgment for patient-specific questions.",
            "action": "ANSWER", "section": None, "guide_id": None, "field_id": None,
        }
    language_name = {"en-IN": "English", "hi-IN": "Hindi", "kn-IN": "Kannada", "te-IN": "Telugu", "ta-IN": "Tamil"}[payload.language]
    role_scope = "This doctor account can use only Care Conversations. Do not direct it to patient report, research, medication, timeline, or emergency modules." if doctor_scope else "Help the patient use their available MediMind modules."
    prompt = f"""You are MediMind Companion, a friendly guide to using the MediMind website. Reply in {language_name}. {role_scope}
Answer questions about website navigation and form fields only. Do not interpret medical reports, diagnose, estimate disease likelihood, or recommend treatment. If asked for medical advice, explain that this assistant only guides website use and point the user to their report explanation or a qualified clinician.
The user is on page: {payload.current_page}. Mode: {payload.mode}. User request: {payload.message}
Return a JSON object only with keys: message, action, section, guide_id, field_id.
action must be one of ANSWER, NAVIGATE, GUIDE, FIELD_HELP. Choose a section only from this allowed set: {', '.join(sorted(allowed_sections))}.
Allowed guide_id values: {', '.join(sorted(allowed_guides))}.
Allowed field_id values: {', '.join(sorted(allowed_fields))}.
Use NAVIGATE when the user asks to open a module. Use GUIDE when the user wants a step-by-step tour; choose only a guide_id that matches an existing module. Use FIELD_HELP when they ask what to enter in a known field; your message should explain the expected input and give a non-medical example if useful. Otherwise use ANSWER.
When mode is guide, prefer GUIDE for a workflow request. Never claim to have uploaded, submitted, shared, deleted, or changed any data. Never generate code or arbitrary browser actions. Keep message under 600 characters.
Available field descriptions: {json.dumps({key: value[1] for key, value in COMPANION_FIELDS.items() if key in allowed_fields})}
Return only JSON."""
    raw = await gemini(prompt, temperature=0.2, json_mode=True)
    try:
        data = json.loads(raw)
    except (json.JSONDecodeError, TypeError):
        return {"message": raw[:600] or "I can help you navigate MediMind. What would you like to do?", "action": "ANSWER", "section": None, "guide_id": None, "field_id": None}
    if not isinstance(data, dict):
        data = {}
    message = str(data.get("message", "I can help you navigate MediMind. What would you like to do?"))[:600]
    action = data.get("action")
    section_value = data.get("section")
    guide_value = data.get("guide_id")
    field_value = data.get("field_id")
    section = section_value if isinstance(section_value, str) and section_value in allowed_sections else None
    guide_id = guide_value if isinstance(guide_value, str) and guide_value in allowed_guides else None
    field_id = field_value if isinstance(field_value, str) and field_value in allowed_fields else None
    if action == "GUIDE" and guide_id:
        section = COMPANION_GUIDES[guide_id]
        field_id = None
    elif action == "FIELD_HELP" and field_id:
        section = COMPANION_FIELDS[field_id][0]
        guide_id = None
    elif action == "NAVIGATE" and section:
        guide_id = None
        field_id = None
    else:
        action, section, guide_id, field_id = "ANSWER", None, None, None
    return {"message": message, "action": action, "section": section, "guide_id": guide_id, "field_id": field_id}

async def extract_report(filename: str, mime: str, content: bytes) -> str:
    ext = filename.lower().rsplit(".", 1)[-1]
    if ext == "pdf":
        doc = pymupdf.open(stream=content, filetype="pdf")
        text = "\n".join(page.get_text() for page in doc).strip()
        if text: return text[:45000]
        return await gemini("Transcribe all readable text in this medical report. Preserve test names, values, units, reference ranges and dates. Do not interpret it.", ("application/pdf", content))
    if ext == "docx":
        doc = Document(io.BytesIO(content)); return "\n".join(p.text for p in doc.paragraphs).strip()[:45000]
    if ext in {"txt", "csv"}: return content.decode("utf-8-sig", errors="replace")[:45000]
    if ext in {"png", "jpg", "jpeg", "webp"}:
        return await gemini("Transcribe all readable text in this medical report image. Preserve test names, values, units, reference ranges and dates. Do not interpret it.", (mime, content))
    raise HTTPException(415, "Supported formats: PDF, PNG, JPG, WEBP, DOCX, TXT and CSV.")

async def explain_report(extracted: str) -> str:
    return await gemini("You help patients understand their own medical paperwork. Explain the report in plain, calm, non-alarming language. Organize with short headings: What this report is; Key results (distinguish in-range/out-of-range only when reference ranges are shown); What it may mean; Helpful questions for a clinician. Define jargon. Do not diagnose, infer missing context, recommend treatment, or imply certainty. If data is unclear, say so. Include a brief reminder to review with a healthcare professional.\n\nREPORT TEXT:\n" + extracted[:30000])

@app.post("/api/reports")
async def create_report(file: UploadFile = File(...), user=Depends(patient_user)):
    content = await file.read(MAX_UPLOAD + 1)
    if len(content) > MAX_UPLOAD: raise HTTPException(413, f"Files must be {MAX_UPLOAD // 1024 // 1024} MB or smaller.")
    mime = file.content_type or "application/octet-stream"
    extracted = await extract_report(file.filename or "report", mime, content)
    if not extracted.strip(): raise HTTPException(422, "No readable text was found in this file.")
    explanation = await explain_report(extracted)
    if fs is None: raise HTTPException(503, "File storage is not configured.")
    file_id = await fs.upload_from_stream(file.filename or "report", content, metadata={"owner_id": user["_id"], "content_type": mime})
    doc = {"owner_id": user["_id"], "filename": (file.filename or "report")[:180], "file_id": file_id, "file_type": mime, "extracted_text": extracted, "explanation": explanation, "created_at": datetime.now(timezone.utc)}
    inserted = await database().reports.insert_one(doc); doc["_id"] = inserted.inserted_id
    return report_out(doc)

def report_out(doc):
    return {"_id": str(doc["_id"]), "filename": doc["filename"], "file_type": doc.get("file_type"), "created_at": doc["created_at"], "extracted_text": doc.get("extracted_text", ""), "explanation": doc.get("explanation", "")}

@app.get("/api/reports")
async def list_reports(user=Depends(patient_user)):
    cursor = database().reports.find({"owner_id": user["_id"]}, {"extracted_text": 0, "explanation": 0}).sort("created_at", -1).limit(100)
    return [{"_id": str(r["_id"]), "filename": r["filename"], "file_type": r.get("file_type"), "created_at": r["created_at"]} async for r in cursor]

@app.get("/api/reports/{report_id}")
async def get_report(report_id: str, user=Depends(patient_user)):
    report = await database().reports.find_one({"_id": oid(report_id), "owner_id": user["_id"]})
    if not report: raise HTTPException(404, "Report not found.")
    return report_out(report)

@app.get("/api/reports/{report_id}/file")
async def download_report(report_id: str, user=Depends(patient_user)):
    report = await database().reports.find_one({"_id": oid(report_id), "owner_id": user["_id"]})
    if not report or fs is None: raise HTTPException(404, "Report not found.")
    from fastapi.responses import StreamingResponse
    from urllib.parse import quote
    gridout = await fs.open_download_stream(report["file_id"])
    headers = {"Content-Disposition": f"attachment; filename*=UTF-8''{quote(report['filename'])}"}
    return StreamingResponse(gridout, media_type=report.get("file_type", "application/octet-stream"), headers=headers)

@app.post("/api/reports/{report_id}/chat")
async def report_chat(report_id: str, payload: ChatIn, user=Depends(patient_user)):
    report = await database().reports.find_one({"_id": oid(report_id), "owner_id": user["_id"]})
    if not report: raise HTTPException(404, "Report not found.")
    answer = await gemini("Answer the patient's question using only the report context below. Use plain language, acknowledge uncertainty, do not diagnose or recommend treatment, and encourage clinician review when appropriate.\nREPORT:\n" + report.get("extracted_text", "")[:18000] + "\nQUESTION:\n" + payload.message)
    return {"answer": answer}

async def pubmed_search(query: str) -> list[dict[str, str]]:
    if pubmed_http is None:
        raise HTTPException(503, "Research service is starting. Please retry in a moment.")
    params = {"db":"pubmed", "term":query, "retmax":5, "sort":"relevance", "retmode":"json"}
    result = await pubmed_http.get("https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi", params=params)
    result.raise_for_status()
    ids = result.json().get("esearchresult", {}).get("idlist", [])
    if not ids: return []
    ids_param = ",".join(ids)
    summary, full = await asyncio.gather(
        pubmed_http.get("https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi", params={"db":"pubmed", "id":ids_param, "retmode":"json"}),
        pubmed_http.get("https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi", params={"db":"pubmed", "id":ids_param, "retmode":"xml"}),
    )
    summary.raise_for_status(); full.raise_for_status()
    data = summary.json().get("result", {})
    articles = [{"pmid": pid, "title": data.get(pid, {}).get("title", "Untitled article"), "journal": data.get(pid, {}).get("fulljournalname", "PubMed"), "year": data.get(pid, {}).get("pubdate", "")[:4], "abstract": ""} for pid in ids]
    for node in ET.fromstring(full.text).findall(".//PubmedArticle"):
        pmid = node.findtext(".//PMID")
        abstract = " ".join("".join(part.itertext()) for part in node.findall(".//Abstract/AbstractText"))
        for article in articles:
            if article["pmid"] == pmid: article["abstract"] = abstract[:5000]
    return articles

@app.post("/api/research/rare-disease")
async def rare_research(payload: ResearchIn, user=Depends(patient_user)):
    if payload.report_id:
        report = await database().reports.find_one({"_id": oid(payload.report_id), "owner_id": user["_id"]})
        if not report: raise HTTPException(404, "Report not found.")
        source = report.get("extracted_text", "")[:10000]
    else: source = (payload.text or "").strip()
    if len(source) < 8: raise HTTPException(422, "Choose a saved report or enter some findings first.")
    keywords = await gemini("Extract 3 to 5 concise medical concepts for a PubMed search from this report. Return only a single search query, no explanation. Do not invent symptoms.\n" + source[:7000])
    query = re.sub(r"[^\w\s():\[\]*\-]", " ", keywords)[:240]
    try: articles = await pubmed_search(query)
    except httpx.HTTPError: raise HTTPException(502, "PubMed could not be reached. Please try again shortly.")
    abstracts = "\n".join(f"PMID {a['pmid']} | {a['title']} | {a['journal']} {a['year']}\nAbstract: {a['abstract']}" for a in articles)
    prompt = ("You are a cautious medical-literature explainer, not a diagnostic system. Review the report context and PubMed abstracts. Return JSON only: `summary` (plain-language overview and search limits), and `possibilities` (up to 3 objects with `name`, `context`, `match_note`, `evidence_for`, `evidence_against`, `missing_information`, `article_pmids`). Explain which reported findings and cited abstracts support or do not support further research; identify missing clinical details instead of guessing. Every evidence statement must be grounded in the supplied report or abstracts. Suggest only conditions genuinely named in the article titles and relevant to the findings. These are research leads, never diagnoses or estimates of likelihood. If evidence is weak or nonspecific, return an empty array. Never suggest treatment.\nREPORT CONTEXT:\n" + source[:9000] + "\nPUBMED RESULTS:\n" + abstracts)
    raw = await gemini(prompt, json_mode=True, thinking_level="MEDIUM")
    try:
        import json
        structured = json.loads(raw)
        summary = str(structured.get("summary", "The literature search returned related articles, but this information cannot identify a condition."))
        possibilities = structured.get("possibilities", [])
        if not isinstance(possibilities, list): possibilities = []
        keys = ("name", "context", "match_note", "evidence_for", "evidence_against", "missing_information")
        possibilities = [{**{k: str(item.get(k, ""))[:900] for k in keys}, "article_pmids": [str(p) for p in item.get("article_pmids", []) if str(p) in {a["pmid"] for a in articles}]} for item in possibilities[:3] if isinstance(item, dict)]
    except (ValueError, TypeError):
        summary, possibilities = raw, []
    return {"query": query, "summary": summary, "possibilities": possibilities, "articles": articles, "disclaimer": "Research leads are not diagnosis."}

@app.post("/api/research/chat")
async def research_chat(payload: ResearchChatIn, user=Depends(patient_user)):
    answer = await gemini("Explain this medical literature summary in plain language. Do not diagnose or overstate evidence.\nSUMMARY:\n" + payload.context + "\nQUESTION:\n" + payload.question)
    return {"answer": answer}

@app.post("/api/health/twin")
async def build_health_twin(user=Depends(patient_user)):
    cursor = database().reports.find({"owner_id": user["_id"]}).sort("created_at", -1).limit(20)
    reports = [r async for r in cursor]
    if not reports: raise HTTPException(422, "Upload a report first to build your health timeline.")
    timeline = [{"filename": r["filename"], "date": r["created_at"].isoformat(), "report_id": str(r["_id"])} for r in reports]
    context = "\n\n".join(f"FILE: {r['filename']} | DATE: {r['created_at'].date()}\n{r.get('extracted_text', '')[:5000]}" for r in reports)
    prompt = ("Create a cautious longitudinal health-record summary from these reports. Do not diagnose, recommend treatment, invent numeric values or claim a trend unless the same measure is explicitly reported with comparable values/dates. Return JSON only with `summary` and `observations` (up to 6 objects with `label`, `note`, `evidence_files`, `kind`, where kind is trend, repeated, or context). Each evidence_files value must be an exact filename from the supplied records. If no comparable measurements exist, say so. Encourage clinician review.\nRECORDS:\n" + context[:24000])
    raw = await gemini(prompt, json_mode=True)
    try:
        parsed = json.loads(raw)
        summary = str(parsed.get("summary", "These records are gathered into one timeline for review.") )[:1800]
        observations = []
        known_files = {r["filename"] for r in reports}
        for item in parsed.get("observations", [])[:6]:
            if not isinstance(item, dict): continue
            evidence = [str(x) for x in item.get("evidence_files", []) if str(x) in known_files]
            observations.append({"label": str(item.get("label", "Record note"))[:100], "note": str(item.get("note", ""))[:800], "evidence_files": evidence, "kind": item.get("kind") if item.get("kind") in {"trend", "repeated", "context"} else "context"})
    except (ValueError, TypeError, AttributeError):
        summary, observations = "Your reports are gathered into one timeline. The AI summary could not be structured, so no trend was inferred.", []
    return {"summary": summary, "timeline": timeline, "observations": observations, "disclaimer": "This timeline organizes records; it does not diagnose or recommend care."}

@app.get("/api/medications")
async def list_medications(user=Depends(patient_user)):
    cursor = database().medications.find({"owner_id": user["_id"]}).sort("created_at", -1).limit(100)
    return [{"_id": str(m["_id"]), "name": m["name"], "dose": m.get("dose", ""), "frequency": m.get("frequency", ""), "times": m.get("times", []), "instructions": m.get("instructions", ""), "created_at": m["created_at"].isoformat()} async for m in cursor]

@app.post("/api/medications")
async def add_medication(payload: MedicationIn, user=Depends(patient_user)):
    doc = {"owner_id": user["_id"], **payload.model_dump(), "created_at": datetime.now(timezone.utc)}
    result = await database().medications.insert_one(doc)
    return {"_id": str(result.inserted_id), **payload.model_dump(), "created_at": doc["created_at"].isoformat()}

@app.delete("/api/medications/{medication_id}")
async def delete_medication(medication_id: str, user=Depends(patient_user)):
    result = await database().medications.delete_one({"_id": oid(medication_id), "owner_id": user["_id"]})
    if not result.deleted_count: raise HTTPException(404, "Medication not found.")
    return {"deleted": True}

@app.post("/api/medications/scan")
async def scan_prescription(file: UploadFile = File(...), user=Depends(patient_user)):
    del user
    content = await file.read(MAX_UPLOAD + 1)
    if len(content) > MAX_UPLOAD: raise HTTPException(413, f"Files must be {MAX_UPLOAD // 1024 // 1024} MB or smaller.")
    extracted = await extract_report(file.filename or "prescription", file.content_type or "application/octet-stream", content)
    prompt = ("Extract only clearly written medication details from this prescription. Return JSON only with `medications`: array of objects containing `name`, `dose`, `frequency`, `times` (array), `instructions`. Do not infer missing instructions or recommend any change. Use empty strings/lists for unreadable fields; keep at most 12. This is an unverified draft for the patient to review with a pharmacist/clinician.\nPRESCRIPTION TEXT:\n" + extracted[:12000])
    try:
        data = json.loads(await gemini(prompt, json_mode=True))
        candidates = [{"name": str(m.get("name", ""))[:120], "dose": str(m.get("dose", ""))[:80], "frequency": str(m.get("frequency", ""))[:120], "times": [str(t)[:20] for t in m.get("times", [])[:8]], "instructions": str(m.get("instructions", ""))[:500]} for m in data.get("medications", [])[:12] if isinstance(m, dict) and str(m.get("name", "")).strip()]
    except (ValueError, TypeError, AttributeError):
        candidates = []
    return {"medications": candidates, "notice": "Review every extracted detail against the original prescription before saving. MediMind does not recommend medication or dosage changes."}

@app.get("/api/emergency/profile")
async def get_emergency_profile(user=Depends(patient_user)):
    profile = await database().emergency_profiles.find_one({"owner_id": user["_id"]})
    if not profile: return {"display_name": "", "allergies": "", "conditions": "", "medications": "", "blood_group": "", "emergency_contact": "", "share_fields": [], "share_active": False}
    data = {k: profile.get(k, "") for k in ("display_name", "allergies", "conditions", "medications", "blood_group", "emergency_contact")}
    data["share_fields"] = profile.get("share_fields", [])
    share = profile.get("public_share") or {}
    expiry = share.get("expires_at")
    data["share_active"] = bool(expiry and expiry.replace(tzinfo=timezone.utc) > datetime.now(timezone.utc))
    return data

@app.put("/api/emergency/profile")
async def save_emergency_profile(payload: EmergencyProfileIn, user=Depends(patient_user)):
    if any(field not in EMERGENCY_FIELDS for field in payload.share_fields): raise HTTPException(422, "Unknown emergency sharing field.")
    values = payload.model_dump()
    await database().emergency_profiles.update_one({"owner_id": user["_id"]}, {"$set": {**values, "owner_id": user["_id"], "updated_at": datetime.now(timezone.utc)}, "$unset": {"public_share": ""}}, upsert=True)
    return {"saved": True}

@app.post("/api/emergency/share")
async def create_emergency_share(user=Depends(patient_user)):
    profile = await database().emergency_profiles.find_one({"owner_id": user["_id"]})
    if not profile or not profile.get("share_fields"): raise HTTPException(422, "Choose at least one emergency detail to share and save your profile first.")
    token = secrets.token_urlsafe(32)
    expires = datetime.now(timezone.utc) + timedelta(hours=24)
    await database().emergency_profiles.update_one({"owner_id": user["_id"]}, {"$set": {"public_share": {"token_hash": hashlib.sha256(token.encode()).hexdigest(), "expires_at": expires, "fields": profile["share_fields"]}}})
    frontend = (origins[0] if origins else "http://localhost:5173").rstrip("/")
    public_url = f"{frontend}/?emergency={token}"
    try:
        import qrcode
        qr = qrcode.make(public_url)
        output = io.BytesIO(); qr.save(output, format="PNG")
        qr_image = "data:image/png;base64," + base64.b64encode(output.getvalue()).decode()
    except ImportError:
        raise HTTPException(503, "QR creation is unavailable. Install backend dependencies, including qrcode[pil], and retry.")
    return {"qr_image": qr_image, "expires_at": expires.isoformat(), "public_url": public_url}

@app.post("/api/emergency/share/revoke")
async def revoke_emergency_share(user=Depends(patient_user)):
    await database().emergency_profiles.update_one({"owner_id": user["_id"]}, {"$unset": {"public_share": ""}})
    return {"revoked": True}

@app.get("/api/public/emergency/{token}")
async def public_emergency_profile(token: str):
    token_hash = hashlib.sha256(token.encode()).hexdigest()
    profile = await database().emergency_profiles.find_one({"public_share.token_hash": token_hash, "public_share.expires_at": {"$gt": datetime.now(timezone.utc)}})
    if not profile: raise HTTPException(404, "This emergency link has expired or was revoked.")
    fields = profile["public_share"].get("fields", [])
    allowed = EMERGENCY_FIELDS.intersection(fields)
    return {key: profile.get(key, "") for key in allowed}

@app.post("/api/conversations")
async def create_conversation(payload: ConversationIn, user=Depends(current_user)):
    if user["role"] != "patient": raise HTTPException(403, "Only patient accounts can start a doctor conversation.")
    doctor = await database().users.find_one({"username_lower": payload.doctor_username.lower().strip(), "role":"doctor"})
    if not doctor: raise HTTPException(404, "We couldn’t find a registered doctor with that username.")
    now = datetime.now(timezone.utc)
    existing = await database().conversations.find_one({"patient_id": user["_id"], "doctor_id": doctor["_id"]})
    if existing:
        existing["_id"] = str(existing["_id"]); existing["messages"] = existing.get("messages", [])
        return conversation_out(existing)
    doc = {"patient_id": user["_id"], "patient_username": user["username"], "doctor_id": doctor["_id"], "doctor_username": doctor["username"], "messages": [], "created_at": now, "updated_at": now}
    inserted = await database().conversations.insert_one(doc); doc["_id"] = inserted.inserted_id
    return conversation_out(doc)

def conversation_out(doc):
    convo_id = str(doc["_id"])
    msgs = [{**m, "sender_id": str(m["sender_id"]), "created_at": m["created_at"].isoformat(), **({"audio_url": f"/api/conversations/{convo_id}/audio/{m['audio_id']}"} if m.get("audio_id") else {}), **({"report_url": f"/api/conversations/{convo_id}/reports/{m['report_id']}/file"} if m.get("report_id") else {})} for m in doc.get("messages", [])]
    return {"_id": str(doc["_id"]), "patient_username": doc.get("patient_username"), "doctor_username": doc.get("doctor_username"), "messages": msgs, "created_at": doc["created_at"], "updated_at": doc["updated_at"], "last_message": doc.get("messages", [])[-1].get("content", "")[:70] if doc.get("messages") else "Conversation started"}

def conversation_filter(doc_id: str, user: dict):
    participant = {"patient_id": user["_id"]} if user["role"] == "patient" else {"doctor_id": user["_id"]}
    return {"_id": oid(doc_id), **participant}

@app.get("/api/conversations")
async def list_conversations(user=Depends(current_user)):
    key = "patient_id" if user["role"] == "patient" else "doctor_id"
    cursor = database().conversations.find({key: user["_id"]}).sort("updated_at", -1).limit(100)
    result=[]
    async for c in cursor: result.append(conversation_out(c))
    return result

@app.get("/api/conversations/{conversation_id}")
async def get_conversation(conversation_id: str, user=Depends(current_user)):
    doc = await database().conversations.find_one(conversation_filter(conversation_id, user))
    if not doc: raise HTTPException(404, "Conversation not found.")
    return conversation_out(doc)

async def append_message(conversation_id: str, user: dict, content: str, audio_id: str | None = None, report_id: str | None = None, report_filename: str | None = None):
    filt = conversation_filter(conversation_id, user)
    conv = await database().conversations.find_one(filt)
    if not conv: raise HTTPException(404, "Conversation not found or you are not a participant.")
    now = datetime.now(timezone.utc)
    message = {"sender_id": user["_id"], "sender_username": user["username"], "sender_role": user["role"], "content": content[:5000], "audio_id": audio_id, "created_at": now}
    if report_id:
        message["report_id"] = report_id
        message["report_filename"] = report_filename
    await database().conversations.update_one(filt, {"$push": {"messages": message}, "$set": {"updated_at": now}})
    updated = await database().conversations.find_one(filt)
    result = conversation_out(updated)
    for item in result["messages"]:
        if item.get("audio_id"): item["audio_url"] = f"/api/conversations/{conversation_id}/audio/{item['audio_id']}"
    return result

@app.post("/api/conversations/{conversation_id}/messages")
async def send_message(conversation_id: str, payload: MessageIn, user=Depends(current_user)):
    return await append_message(conversation_id, user, payload.content.strip())

@app.post("/api/conversations/{conversation_id}/reports")
async def send_report(conversation_id: str, payload: ConversationReportIn, user=Depends(current_user)):
    report = await database().reports.find_one({"_id": oid(payload.report_id), "owner_id": user["_id"]})
    if not report: raise HTTPException(404, "Report not found.")
    return await append_message(conversation_id, user, f"Shared a report: {report['filename']}", report_id=str(report["_id"]), report_filename=report["filename"])

@app.get("/api/conversations/{conversation_id}/reports/{report_id}/file")
async def get_conversation_report(conversation_id: str, report_id: str, user=Depends(current_user)):
    report_oid = oid(report_id)
    filt = conversation_filter(conversation_id, user)
    shared = await database().conversations.find_one({**filt, "messages.report_id": report_id})
    if not shared: raise HTTPException(404, "Report not found.")
    if fs is None: raise HTTPException(503, "File storage is not configured.")
    report = await database().reports.find_one({"_id": report_oid})
    if not report: raise HTTPException(404, "Report not found.")
    from fastapi.responses import StreamingResponse
    from urllib.parse import quote
    gridout = await fs.open_download_stream(report["file_id"])
    headers = {"Content-Disposition": f"attachment; filename*=UTF-8''{quote(report['filename'])}"}
    return StreamingResponse(gridout, media_type=report.get("file_type", "application/octet-stream"), headers=headers)

@app.post("/api/conversations/{conversation_id}/audio")
async def send_audio(conversation_id: str, file: UploadFile = File(...), transcript: str = Form(""), user=Depends(current_user)):
    content = await file.read(12 * 1024 * 1024 + 1)
    if len(content) > 12 * 1024 * 1024: raise HTTPException(413, "Voice notes must be 12 MB or smaller.")
    filt = conversation_filter(conversation_id, user)
    if not await database().conversations.find_one(filt): raise HTTPException(404, "Conversation not found or you are not a participant.")
    if fs is None: raise HTTPException(503, "File storage is not configured.")
    file_id = await fs.upload_from_stream(file.filename or "voice-note.webm", content, metadata={"owner_id": user["_id"], "content_type": file.content_type or "audio/webm"})
    text = transcript.strip()
    if not text:
        text = await gemini("Transcribe this patient-doctor voice note verbatim. Return only the spoken words. If unclear, mark the unclear part.", (file.content_type or "audio/webm", content))
    result = await append_message(conversation_id, user, text, str(file_id))
    for item in result["messages"]:
        if item.get("audio_id"): item["audio_url"] = f"/api/conversations/{conversation_id}/audio/{item['audio_id']}"
    return result

@app.get("/api/conversations/{conversation_id}/audio/{file_id}")
async def get_audio(conversation_id: str, file_id: str, user=Depends(current_user)):
    filt = conversation_filter(conversation_id, user)
    conv = await database().conversations.find_one({**filt, "messages.audio_id": file_id})
    if not conv or fs is None: raise HTTPException(404, "Audio not found.")
    from fastapi.responses import StreamingResponse
    gridout = await fs.open_download_stream(oid(file_id))
    return StreamingResponse(gridout, media_type=gridout.metadata.get("content_type", "audio/webm"))
