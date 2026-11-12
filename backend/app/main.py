from __future__ import annotations

import base64
import io
import os
import re
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import bcrypt
import fitz
import httpx
from bson import ObjectId
from fastapi import Depends, FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError, jwt
from motor.motor_asyncio import AsyncIOMotorClient, AsyncIOMotorGridFSBucket
from pydantic import BaseModel, EmailStr, Field
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
MAX_UPLOAD = int(os.getenv("MAX_UPLOAD_MB", "10")) * 1024 * 1024
app = FastAPI(title="MediMind API", version="1.0.0", description="Private, role-aware health report and care conversation API")
origins = [x.strip() for x in os.getenv("FRONTEND_ORIGIN", "http://localhost:5173").split(",") if x.strip()]
app.add_middleware(CORSMiddleware, allow_origins=origins, allow_credentials=True, allow_methods=["GET", "POST", "DELETE", "OPTIONS"], allow_headers=["Authorization", "Content-Type"])
security = HTTPBearer(auto_error=False)
client: AsyncIOMotorClient | None = None
db = None
fs: AsyncIOMotorGridFSBucket | None = None

@app.on_event("startup")
async def connect_db():
    global client, db, fs
    if MONGO_URI:
        client = AsyncIOMotorClient(MONGO_URI, serverSelectionTimeoutMS=5000)
        db = client[DB_NAME]
        fs = AsyncIOMotorGridFSBucket(db, bucket_name="report_files")

@app.on_event("shutdown")
async def close_db():
    if client:
        client.close()

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

class ChatIn(BaseModel):
    message: str = Field(min_length=1, max_length=3000)

class ResearchIn(BaseModel):
    report_id: str | None = None
    text: str | None = Field(default=None, max_length=5000)

class ResearchChatIn(BaseModel):
    question: str = Field(min_length=1, max_length=2000)
    context: str = Field(default="", max_length=5000)

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

async def gemini(prompt: str, media: tuple[str, bytes] | None = None, temperature: float = 0.2, json_mode: bool = False) -> str:
    if not GEMINI_API_KEY: raise HTTPException(503, "Gemini is not configured. Add GEMINI_API_KEY to the environment.")
    parts: list[dict[str, Any]] = [{"text": prompt}]
    if media:
        mime, content = media
        parts.append({"inline_data": {"mime_type": mime, "data": base64.b64encode(content).decode()}})
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{GEMINI_MODEL}:generateContent?key={GEMINI_API_KEY}"
    async with httpx.AsyncClient(timeout=95) as http:
        generation = {"temperature": temperature}
        if json_mode: generation["responseMimeType"] = "application/json"
        try:
            response = await http.post(url, json={"contents": [{"parts": parts}], "generationConfig": generation})
        except httpx.TimeoutException as exc:
            raise HTTPException(504, "Gemini took too long to respond. Please retry.") from exc
        except httpx.RequestError as exc:
            raise HTTPException(502, "Could not reach Gemini. Check the network connection and try again.") from exc
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

async def extract_report(filename: str, mime: str, content: bytes) -> str:
    ext = filename.lower().rsplit(".", 1)[-1]
    if ext == "pdf":
        doc = fitz.open(stream=content, filetype="pdf")
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
async def create_report(file: UploadFile = File(...), user=Depends(current_user)):
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
async def list_reports(user=Depends(current_user)):
    cursor = database().reports.find({"owner_id": user["_id"]}, {"extracted_text": 0, "explanation": 0}).sort("created_at", -1).limit(100)
    return [{"_id": str(r["_id"]), "filename": r["filename"], "file_type": r.get("file_type"), "created_at": r["created_at"]} async for r in cursor]

@app.get("/api/reports/{report_id}")
async def get_report(report_id: str, user=Depends(current_user)):
    report = await database().reports.find_one({"_id": oid(report_id), "owner_id": user["_id"]})
    if not report: raise HTTPException(404, "Report not found.")
    return report_out(report)

@app.get("/api/reports/{report_id}/file")
async def download_report(report_id: str, user=Depends(current_user)):
    report = await database().reports.find_one({"_id": oid(report_id), "owner_id": user["_id"]})
    if not report or fs is None: raise HTTPException(404, "Report not found.")
    from fastapi.responses import StreamingResponse
    from urllib.parse import quote
    gridout = await fs.open_download_stream(report["file_id"])
    headers = {"Content-Disposition": f"attachment; filename*=UTF-8''{quote(report['filename'])}"}
    return StreamingResponse(gridout, media_type=report.get("file_type", "application/octet-stream"), headers=headers)

@app.post("/api/reports/{report_id}/chat")
async def report_chat(report_id: str, payload: ChatIn, user=Depends(current_user)):
    report = await database().reports.find_one({"_id": oid(report_id), "owner_id": user["_id"]})
    if not report: raise HTTPException(404, "Report not found.")
    answer = await gemini("Answer the patient's question using only the report context below. Use plain language, acknowledge uncertainty, do not diagnose or recommend treatment, and encourage clinician review when appropriate.\nREPORT:\n" + report.get("extracted_text", "")[:18000] + "\nQUESTION:\n" + payload.message)
    return {"answer": answer}

async def pubmed_search(query: str) -> list[dict[str, str]]:
    params = {"db":"pubmed", "term":query, "retmax":5, "sort":"relevance", "retmode":"json"}
    async with httpx.AsyncClient(timeout=20, headers={"User-Agent":"MediMind/1.0"}) as http:
        result = await http.get("https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi", params=params); result.raise_for_status()
        ids = result.json().get("esearchresult", {}).get("idlist", [])
        if not ids: return []
        summary = await http.get("https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi", params={"db":"pubmed", "id":",".join(ids), "retmode":"json"}); summary.raise_for_status()
        data = summary.json().get("result", {})
        articles = [{"pmid": pid, "title": data.get(pid, {}).get("title", "Untitled article"), "journal": data.get(pid, {}).get("fulljournalname", "PubMed"), "year": data.get(pid, {}).get("pubdate", "")[:4], "abstract": ""} for pid in ids]
        full = await http.get("https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi", params={"db":"pubmed", "id":",".join(ids), "retmode":"xml"}); full.raise_for_status()
        for node in ET.fromstring(full.text).findall(".//PubmedArticle"):
            pmid = node.findtext(".//PMID")
            abstract = " ".join("".join(part.itertext()) for part in node.findall(".//Abstract/AbstractText"))
            for article in articles:
                if article["pmid"] == pmid: article["abstract"] = abstract[:5000]
        return articles

@app.post("/api/research/rare-disease")
async def rare_research(payload: ResearchIn, user=Depends(current_user)):
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
    prompt = ("You are a cautious medical-literature explainer, not a diagnostic system. Review the provided report context and PubMed results. Return JSON only, with keys `summary` (plain-language overview including search limitations) and `possibilities` (array of at most 3 objects with `name`, `context`, `match_note`). Suggest only research topics genuinely named in the article titles and relevant to the provided findings. These are leads for discussion, never diagnoses or estimates of likelihood. If nonspecific findings or weak search results, use an empty array. Never suggest treatment.\nREPORT CONTEXT:\n" + source[:9000] + "\nPUBMED RESULTS:\n" + abstracts)
    raw = await gemini(prompt, json_mode=True)
    try:
        import json
        structured = json.loads(raw)
        summary = str(structured.get("summary", "The literature search returned related articles, but this information cannot identify a condition."))
        possibilities = structured.get("possibilities", [])
        if not isinstance(possibilities, list): possibilities = []
        possibilities = [{k: str(item.get(k, "")) for k in ("name", "context", "match_note")} for item in possibilities[:3] if isinstance(item, dict)]
    except (ValueError, TypeError):
        summary, possibilities = raw, []
    return {"query": query, "summary": summary, "possibilities": possibilities, "articles": articles, "disclaimer": "Research leads are not diagnosis."}

@app.post("/api/research/chat")
async def research_chat(payload: ResearchChatIn, user=Depends(current_user)):
    answer = await gemini("Explain this medical literature summary in plain language. Do not diagnose or overstate evidence.\nSUMMARY:\n" + payload.context + "\nQUESTION:\n" + payload.question)
    return {"answer": answer}

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
    msgs = [{**m, "sender_id": str(m["sender_id"]), "created_at": m["created_at"].isoformat(), **({"audio_url": f"/api/conversations/{convo_id}/audio/{m['audio_id']}"} if m.get("audio_id") else {})} for m in doc.get("messages", [])]
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

async def append_message(conversation_id: str, user: dict, content: str, audio_id: str | None = None):
    filt = conversation_filter(conversation_id, user)
    conv = await database().conversations.find_one(filt)
    if not conv: raise HTTPException(404, "Conversation not found or you are not a participant.")
    now = datetime.now(timezone.utc)
    message = {"sender_id": user["_id"], "sender_username": user["username"], "sender_role": user["role"], "content": content[:5000], "audio_id": audio_id, "created_at": now}
    await database().conversations.update_one(filt, {"$push": {"messages": message}, "$set": {"updated_at": now}})
    updated = await database().conversations.find_one(filt)
    result = conversation_out(updated)
    for item in result["messages"]:
        if item.get("audio_id"): item["audio_url"] = f"/api/conversations/{conversation_id}/audio/{item['audio_id']}"
    return result

@app.post("/api/conversations/{conversation_id}/messages")
async def send_message(conversation_id: str, payload: MessageIn, user=Depends(current_user)):
    return await append_message(conversation_id, user, payload.content.strip())

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
