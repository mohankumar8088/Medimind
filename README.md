# MediMind

A React + FastAPI starter for a private patient health workspace. The project has three areas: report library and plain-language explanations, cautious PubMed research, and persistent doctor–patient conversations with text and voice notes.

## What is included

- Email/username sign-in, password minimum of eight characters, and patient/doctor roles. Passwords are hashed; API access uses signed, expiring bearer tokens.
- PDF, image, DOCX, TXT, and CSV report intake. PDF text is extracted locally; scanned PDFs and images use Gemini to read the text. Files are stored in MongoDB Atlas GridFS and each report is tied to its owner.
- Gemini explanations and report-specific Q&A, with plain-language prompts and reminders to review medical information with a clinician.
- PubMed E-utilities search, article links, and cautious AI summaries. The research area describes possible topics for clinician discussion; it never labels its output as a diagnosis.
- Persistent patient–doctor conversations. The API verifies the username belongs to a doctor and limits each conversation to its patient and doctor participants. Voice notes are transcribed by Gemini and stored alongside the conversation.
- A responsive, beginner-friendly React interface with sample report rows to preview the library before signing in.

## Before you begin

You will need Node.js 20 or newer, Python 3.11 or newer, a MongoDB Atlas database, and a Gemini API key. The currently documented stable model used by this project is `gemini-3.6-flash`; set `GEMINI_MODEL` if your Google AI account provides a different model. The model name and access can change, so check [Google’s current model list](https://ai.google.dev/gemini-api/docs/models) before deployment.

## Run it on your computer

1. Create a MongoDB Atlas cluster and database user. In Atlas Network Access, allow connections from your development machine. Copy the application connection string; replace its username, password, and cluster placeholders.
2. Copy `backend/.env.example` to `backend/.env`, then fill in `MONGODB_URI`, `JWT_SECRET`, and `GEMINI_API_KEY`. Make `JWT_SECRET` a long random value. Never put any of these secrets in the React app or commit the `.env` file.
3. In a terminal opened in this project folder, install the frontend and backend dependencies:

   ```powershell
   npm install
   py -m venv .venv
   .venv\Scripts\Activate.ps1
   pip install -r backend/requirements.txt
   ```

4. Start the API in one terminal:

   ```powershell
   .venv\Scripts\Activate.ps1
   uvicorn app.main:app --app-dir backend --reload --port 8000
   ```

5. Start the website in a second terminal:

   ```powershell
   npm run dev
   ```

6. Open the local Vite address shown in the terminal (usually `http://localhost:5173`). The page calls the API at `http://localhost:8000/api` by default.

To use a different API address locally, create a root `.env.local` with `VITE_API_URL=https://your-api.example.com/api` and restart Vite. Vite environment variables are public; only put the API URL there.

## Deploy (recommended beginner setup)

Use **Vercel for the React site** and a **Python web service for FastAPI**. Vercel can run FastAPI in Python Functions, but every function request has a 4.5 MB body limit. This project accepts report uploads up to 10 MB locally and voice notes up to 12 MB, so hosting the API as a conventional Python service avoids rejecting larger uploads. A long-lived service also makes audio and PDF processing less constrained.

1. Push the project to a Git repository.
2. Create a web service on Render from that repository. The included `Dockerfile` and `render.yaml` describe the API service. Set `MONGODB_URI`, `GEMINI_API_KEY`, and `FRONTEND_ORIGIN` in the service settings. `FRONTEND_ORIGIN` should be the deployed Vercel site URL. Render’s `JWT_SECRET` can be generated from the blueprint configuration.
3. In MongoDB Atlas Network Access, add the API host’s outbound IP range or use the provider’s supported network connection option. Do not expose Atlas credentials in Vercel.
4. Import the same Git repository into Vercel. Set the build command to `npm run build` and output directory to `dist` (Vercel usually detects Vite automatically). Add `VITE_API_URL=https://your-render-service.onrender.com/api` in Vercel’s project environment settings, then redeploy.
5. Open `/api/health` on the API service. It should return `status: ok` and `database_configured: true`. Then use the deployed Vercel URL to create a patient account and a separate doctor account for a conversation flow.

Vercel officially supports FastAPI as a Python Function, but Function execution is bounded and the request/response body limit is 4.5 MB. This app's report and voice-note limits exceed that cap, so the included deployment uses Vercel for React and Render for FastAPI. Vercel documents a 300-second maximum on Hobby and up to 800 seconds on Pro/Enterprise under Fluid Compute; plan and configuration affect the available duration. See [Python runtime](https://vercel.com/docs/functions/runtimes/python), [FastAPI on Vercel](https://vercel.com/docs/frameworks/backend/fastapi), and [Function limits](https://vercel.com/docs/functions/limitations).

## Environment variables

| Name | Required | Purpose |
| --- | --- | --- |
| `MONGODB_URI` | Yes | MongoDB Atlas connection string |
| `MONGODB_DB` | No | Database name; defaults to `medimind` |
| `JWT_SECRET` | Yes | Signs seven-day authentication tokens |
| `GEMINI_API_KEY` | Yes for AI | Gemini API key, server-side only |
| `GEMINI_MODEL` | No | Defaults to `gemini-3.6-flash` |
| `FRONTEND_ORIGIN` | Yes in production | Allowed website origin(s), comma-separated |
| `MAX_UPLOAD_MB` | No | Report upload limit; defaults to 10 MB |
| `VITE_API_URL` | Frontend deploy | Public base URL ending in `/api` |

## Project map

- `src/` — React interface and styling
- `backend/app/main.py` — FastAPI routes, authentication, extraction, Gemini/PubMed calls, MongoDB persistence
- `backend/.env.example` — local backend configuration template
- `Dockerfile`, `render.yaml` — conventional Python service deployment

The backend also exposes interactive API documentation at `/docs` when running locally.

## Important product and safety notes

This is a functional starter, not a clinical product or a compliance certification. The AI can misread reports or literature. A clinician should verify important interpretations. Avoid entering information about emergencies; contact local emergency services or a clinician instead. A user can choose the doctor role during self-registration; the starter checks that a matching username has that role, but it does not verify a medical license or the real-world identity of a doctor. Before handling real patient data, have qualified security, privacy, and healthcare-compliance reviewers assess retention, consent, access logging, encryption, abuse prevention, data deletion, backups, and the laws that apply in your region. MongoDB, Gemini, Render, and Vercel account configuration and contracts determine the protections available in production.

Uploaded files contain health information. Keep API keys server-side, restrict database network access, and never share a doctor account. This starter stores report files in GridFS and stores extracted report text and conversation messages in MongoDB. It does not yet include account recovery, multifactor authentication, consent workflows, an administrative audit console, or user-initiated record deletion.
