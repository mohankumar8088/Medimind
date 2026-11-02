# MediMind AI

A beginner-friendly healthcare report assistant built with React, FastAPI, MongoDB Atlas, and optional Google Gemini. It uses synthetic data and is intended for education and clinician review. It is not a medical device and must not be used to diagnose, prescribe, or make urgent-care decisions.

## What works in this starter

- Email/password sign-up and sign-in. Passwords are Argon2 hashed; the browser receives an HTTP-only session cookie.
- Upload PDF, PNG, or JPEG reports (maximum 4 MB, leaving room under Vercel's function request limit). Text PDFs are extracted; image OCR is attempted if Tesseract is installed. Extracted report text and generated content are saved to the signed-in user's MongoDB Atlas account; raw file bytes are not saved.
- Review a report explanation at patient, student, and clinician levels. With `GEMINI_API_KEY`, Gemini drafts the explanation; without it, a clearly labeled safe demo explanation is returned.
- Ask questions against the extracted text and compare two reports. Reports, explanations, Q&A history, comparisons, research searches, and saved consultation drafts are stored under the signed-in account.
- Search PubMed for literature matching a research question and return source links. This is literature discovery, not a diagnosis or probability-ranked differential.
- Generate doctor and patient summary drafts from pasted consultation text, review them, then save to the library. Audio transcription is an explicitly staged integration: this starter does not record or transcribe audio.
- View and delete saved items, or delete the account and all its saved records.
- Synthetic report data and an example consultation transcript for trying the interface.

## Project structure

```text
medimind-ai/
├── backend/
│   ├── app/main.py          # API routes, upload validation, extraction
│   ├── requirements.txt
│   └── .env.example
├── api/
│   └── index.py             # Vercel FastAPI entrypoint
├── requirements.txt         # Vercel Python dependencies
├── vercel.json              # Builds frontend assets for Vercel
├── frontend/
│   ├── src/App.jsx          # Dashboard and module screens
│   ├── src/main.jsx
│   ├── src/styles.css
│   ├── index.html
│   └── package.json
├── sample-data/
│   ├── synthetic-report.txt
│   └── synthetic-consultation.txt
└── README.md
```

## Run locally

Requirements: Python 3.12+ and Node.js 20+.

### 1. Start the API

In PowerShell, open a terminal in `outputs/medimind-ai`:

```powershell
cd backend
py -m venv .venv
.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
Copy-Item .env.example .env
```

Edit `backend/.env` and set `MONGODB_URI`, `MONGODB_DATABASE`, and `JWT_SECRET_KEY` before starting the API. Generate a session secret in PowerShell with:

```powershell
py -c "import secrets; print(secrets.token_urlsafe(48))"
```

Use a MongoDB Atlas database user restricted to the MediMind database and its required permissions. In Atlas Network Access, allow the deployment's outbound addresses using an available Vercel static egress option. Avoid opening the database to every IP address. The Atlas URI contains credentials; keep it only in environment settings or the ignored `backend/.env` file.

```powershell
uvicorn app.main:app --reload
```

Optional image OCR requires the Tesseract program installed and available on PATH. The API health page is at http://127.0.0.1:8000/health and interactive API docs at http://127.0.0.1:8000/docs.

### 2. Start the website

In a second terminal:

```powershell
cd frontend
npm install
npm run dev
```

Open the local URL Vite prints (usually http://localhost:5173). The Vite development server proxies `/api` requests to FastAPI.

### 3. Enable Gemini (optional)

Add `GEMINI_API_KEY=your_key` and optionally `GEMINI_MODEL=gemini-2.5-flash` to `backend/.env`, then restart FastAPI. Never put provider keys in frontend code or commit `.env`. Without a key, report explanations and consultation summaries use labeled demo drafts; report Q&A asks users to configure Gemini. Do not send identifiable patient information to a third-party model without appropriate consent, legal basis, and an approved privacy arrangement.

## Deploy on Vercel

This repository is prepared for one Vercel project: the React build is emitted into `public/`, while `api/index.py` exposes FastAPI routes on the same origin. This keeps the session cookie same-origin.

1. Put the `medimind-ai` folder in a Git repository and push it to GitHub, GitLab, or Bitbucket.
2. In Vercel, import that repository. Set the project root to `medimind-ai` if the folder is inside a larger repository. The included `vercel.json` runs the frontend build; the Python runtime loads `api/index.py`.
3. In Vercel Project Settings → Environment Variables, add `MONGODB_URI`, `MONGODB_DATABASE` (for example, `medimind`), and a fresh random `JWT_SECRET_KEY`. Add `GEMINI_API_KEY` and `GEMINI_MODEL` if Gemini is enabled. Add them to Preview and Production only as appropriate.
4. Confirm Atlas network access allows Vercel's outbound connection and deploy. Check `/health` on the deployed domain; it reports whether the database and Gemini settings are present, without exposing secret values.
5. Open the deployed site and create an account. Confirm uploads, the saved library, and deletion work with synthetic data before considering any sensitive content.

Local development and Vercel deployment use the same FastAPI routes. In local development, Vite proxies `/api` to `http://127.0.0.1:8000`; set `COOKIE_SECURE=false` in `backend/.env` for localhost if needed. In Vercel, the session cookie is automatically marked Secure.

## Build stages

1. **Foundation in this starter:** sign-in/sign-up, per-account MongoDB records, password hashing, HTTP-only sessions, account and item deletion, dashboard, report upload/text extraction, three-level drafts, report comparison/Q&A, PubMed article lookup, and consultation text summary drafts.
2. **Next:** password reset and email verification, rate limiting, audit logging, stronger access controls, backup/retention settings, and a security review.
3. **Then:** verified OCR pipeline for scanned PDFs, structured extraction with reference ranges/units and provenance, stronger evaluation and clinician feedback.
4. **Then:** consented audio capture and transcription, language selection, medication/follow-up extraction with human review, and production-grade literature retrieval.

This starter does not include password reset, email verification, rate limiting, audio recording/transcription, diagnosis prediction, prescribing, client-side encryption, or production security certification. Atlas stores extracted medical text and summaries, so use synthetic data until the deployment's privacy, consent, retention, access-control, regulatory, and vendor requirements have been reviewed. Do not treat this code as proof of HIPAA or other healthcare-regulatory compliance.
