# NexaMind

**NexaMind** is an Agentic AI-powered collaborative workspace operating system that fuses the structured knowledge & document workflows of **Notion** with the communication & collaboration workflows of **Microsoft Teams**.

Built for modern teams and individual creators, NexaMind delivers real-time messaging, hierarchical block-based knowledge bases, agile Kanban tracking, live video/meeting recordings with automated AI transcription and summarization, finance tracking, file management, and an omnipresent AI Copilot.

---

## 🌟 Key Features

### 📝 Notion-Grade Structured Knowledge (Documents)
- **Polymorphic Block Editor**: Rich typed blocks including headings, paragraphs, bullet/numbered lists, callouts, code blocks with syntax highlighting, dividers, toggle lists, checklists, and quotes.
- **Hierarchical Nested Pages**: Unlimited parent-child page nesting with breadcrumb navigation and recursive sidebar tree views.
- **Quick Search & Command Palette**: Instant fuzzy search across titles and block content (`Cmd+K` / `Ctrl+K`).
- **Document Templates**: Pre-configured templates for Meeting Notes, Product Specs (PRD), Sprint Planning, and Architecture RFCs.

### 💬 Microsoft Teams-Style Collaboration (Channels & Chat)
- **Dual-Tier Navigation**: Persistent 48px Activity Rail (Activity, Chat, Channels, Documents, Tasks, Calendar, Meetings, Finance, Code, Files, AI) paired with contextual sidebars.
- **Team Channels & Direct Messaging**: Real-time messaging with WebSocket delivery, threaded replies, and typing indicators.
- **Presence & Interactions**: Live user status indicators (Online, Away, Busy, Offline), emoji reactions, and inline `@mentions`.
- **Channel Tabs**: Persistent pinned resources per channel (Chat, Channel Documents, Task Boards, and Whiteboards).

### 🤖 Agentic AI Copilot & Omni-Agent
- **Real tool use**: Gemini (or Groq as fallback) decides which workspace tools to call — create tasks, edit documents, log transactions, schedule events, post to channels — and can chain several steps per request.
- **Workspace-aware memory**: Documents, meetings, tasks, and public channel messages are distilled into long-term memory and retrieved with semantic embeddings (BM25 keyword ranking when offline). Private channels and DMs are never added to shared memory.
- **Works offline**: Without an AI key the copilot still runs explicit commands (“create a task 'Fix login'”, “log an expense of $40 for Hosting”) and never invents titles or values.
- **Personal keys**: Each user can save their own Gemini key in Settings; it is verified and stored encrypted on the server.

### 📋 Agile Projects & Task Management
- **Kanban Board**: Drag-and-drop workflow statuses (`todo`, `in_progress`, `review`, `done`) with priority tagging and assignee tracking.
- **Two-Way Sync**: Action items from meeting transcriptions and AI debriefs can be promoted directly into active tasks.

### 🎙️ Meetings, Sessions & Audio/Video
- **Meeting Recording & Processing**: Upload audio/video or process recorded sessions with asynchronous background processing pipelines.
- **Transcription & Summarization**: Speech-to-text transcription paired with automated AI minutes-of-meeting (MoM), decisions, and action item extraction.
- **Live Video Rooms**: WebRTC / signalling room coordination for team syncs.

### 💼 Operations, Finance & Code Workspaces
- **Finance Runway & Cash Flow**: Track expenses, revenue, burn rates, and projected runway calculations.
- **Lightweight Code Workspaces**: Track connected repositories, branch commits, and issue boards directly alongside project docs.
- **Centralized File Management**: Authorized storage with secure upload/download handling, MIME validation, and preview support.
- **Automated Report Synthesizer**: Generate executive summaries and operational retrospectives synthesizing cross-workspace records.

---

## 🏗️ Architecture & Tech Stack

```text
Web Client (React 19 + Vite)          Mobile Client (Expo / React Native)
             \                                    /
              \---- HTTPS REST + WebSockets -----/
                               |
                        FastAPI Backend
                  routers → services → models
                               |
                  PostgreSQL (SQLite for local dev)
                               |
               External AI & Media Providers (Groq / Gemini)
```

- **Backend**: Python 3.12, FastAPI, SQLAlchemy 2.0 (Asyncpg / aiosqlite), Alembic migrations, Pydantic v2.
- **Frontend**: React 19, Vite, TailwindCSS, Lucide Icons.
- **Mobile**: React Native 0.74.5, Expo SDK 51.
- **Database**: PostgreSQL (Production) / SQLite with async drivers (Local development).
- **Real-Time**: FastAPI WebSockets with live event broadcasting and presence tracking.
- **Security**: Custom JWT (HS256) bearer authentication, bcrypt password hashing, strict multi-tenant workspace isolation.

---

## 🚀 Quick Start (Local Development)

### 1. One-Click Launch (Windows)
If you are on Windows, launch both frontend and backend dev servers with:
```cmd
start_nexamind.bat
```

---

### 2. Manual Backend Setup

```bash
cd backend

# Create and activate virtual environment
python -m venv .venv

# Windows:
.venv\Scripts\activate
# macOS/Linux:
# source .venv/bin/activate

# Install dependencies (requirements-dev.txt adds the test tools)
pip install -r requirements-dev.txt

# Configure environment variables
copy .env.example .env     # On Windows
# cp .env.example .env     # On macOS/Linux
```

Set `JWT_SECRET_KEY` in `.env` (`python -c "import secrets; print(secrets.token_urlsafe(48))"`). The app refuses to start with a missing or weak secret when `APP_ENV` is not `development`.

#### Database Configuration
By default, the backend uses an asynchronous SQLite database for instant out-of-the-box local development.

To use PostgreSQL, set your connection string in `backend/.env`:
```env
DATABASE_URL=postgresql+asyncpg://postgres:postgres@localhost:5432/nexamind
```

Apply database migrations:
```bash
alembic upgrade head
```

If you have a local `nexamind.db` created by an older version (before migrations were complete), register it once and then upgrade:
```bash
alembic stamp 006_notion_teams_features
alembic upgrade head
```

#### Run the API Server
```powershell
# From the backend directory
uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```
- Interactive API Swagger Docs (development only): [http://127.0.0.1:8000/docs](http://127.0.0.1:8000/docs)
- OpenAPI JSON Spec (development only): [http://127.0.0.1:8000/openapi.json](http://127.0.0.1:8000/openapi.json)

#### Run Backend Tests
```bash
cd backend
pytest -v
```
Tests run against an in-memory database and never call real AI providers.

---

### 3. Frontend Web Setup

```bash
cd frontend

# Install dependencies
npm install

# Start Vite development server
npm run dev
```
- Web Application: [http://localhost:5173](http://localhost:5173)

---

### 4. Mobile App Setup (Expo)

```bash
cd mobile

# Install dependencies
npm install

# Start Expo bundler
npm run start
```

---

## 📡 Core API Overview

| Route Domain | Path Prefix | Key Endpoints | Description |
|---|---|---|---|
| **System** | `/health` | `GET /health` | Health & service readiness probe |
| **Auth** | `/auth` | `POST /auth/register`<br>`POST /auth/login`<br>`GET /auth/me` | User registration, authentication, JWT issuance, profile |
| **Workspaces** | `/workspaces` | `GET /workspaces`<br>`POST /workspaces`<br>`GET /workspaces/{id}`<br>`POST /workspaces/join` | Personal & team workspaces, join codes, member roles |
| **Documents** | `/workspaces/{wid}/documents` | `GET/POST /workspaces/{wid}/documents`<br>`GET/PATCH/DELETE .../{doc_id}` | Hierarchical block-based rich knowledge pages |
| **Projects & Tasks** | `/workspaces/{wid}/projects` | `GET/POST .../tasks`<br>`PATCH/DELETE .../tasks/{id}` | Kanban boards, task tracking, assignee workflows |
| **Channels & Chat** | `/workspaces/{wid}/channels` | `GET/POST .../channels`<br>`GET/POST .../messages` | Real-time channels, threads, message persistence |
| **AI Copilot** | `/workspaces/{wid}/ai` | `POST /workspaces/{wid}/ai/chat` | Omnipresent workspace-grounded AI agent |
| **Meetings** | `/workspaces/{wid}/sessions` | `GET/POST .../sessions`<br>`POST .../sessions/{id}/upload` | Session recordings, transcripts, AI MoM generation |
| **Calendar** | `/workspaces/{wid}/calendar` | `GET/POST .../events` | Calendar management & AI action item follow-ups |
| **Finance** | `/workspaces/{wid}/finance` | `GET/POST .../transactions`<br>`GET .../runway` | Revenue, expenses, cash flow & runway analysis |
| **Files** | `/workspaces/{wid}/files` | `GET/POST .../files`<br>`GET .../files/{id}/download` | Secure multi-tenant file attachments |
| **Reports** | `/workspaces/{wid}/reports` | `GET/POST .../reports` | Automated executive & sprint report generation |
| **Video** | `/workspaces/{wid}/video` | `POST .../rooms/join` | WebRTC video room coordination |
| **WebSockets** | `/ws` | `GET /ws/channels/{channel_id}`<br>`GET /ws/workspaces/{workspace_id}` | Real-time message streaming, typing & presence |

---

## ☁️ Deployment

### Render Deployment (Backend + Database)
1. Push this repository to GitHub.
2. Create a new **Blueprint** on [Render](https://render.com) and point it to [`render.yaml`](render.yaml).
3. Render automatically provisions:
   - A managed PostgreSQL instance (`nexamind-db`).
   - A web service (`nexamind-api`) running from `backend/Dockerfile` with health checks on `/health` and migrations run automatically on boot. `JWT_SECRET_KEY` and `DATA_ENCRYPTION_KEY` are generated for you.
4. Set `CORS_ORIGINS` to your frontend URL, and optionally `GEMINI_API_KEY` / `GROQ_API_KEY`.
5. Uploads are stored on local disk at `/data/uploads`; attach a persistent disk there (paid plans) so they survive deploys. Running more than one instance? Set `REDIS_URL` so real-time events and presence are shared.

### Vercel / Netlify Deployment (Frontend)
1. Point your Vercel/Netlify project to the `frontend/` directory.
2. Build command: `npm run build`
3. Output directory: `dist`
4. Set environment variable: `VITE_API_URL=https://<your-render-backend-url>` (and add the frontend URL to the backend's `CORS_ORIGINS`)

---

## 🔒 Security & Data Tenancy

- **Tenant scoping**: Every workspace resource is checked against workspace membership on the server.
- **Private conversations**: Private channels and DMs are visible only to their members. Starting a DM never grants access to anyone's workspace.
- **Authentication**: Short-lived HS256 JWTs (PyJWT), bcrypt password hashing, password strength rules, and rate limits on login, registration, and AI endpoints.
- **WebSockets**: The token is sent in the first message, not in the URL, so it never lands in access logs. Access is re-checked on every message.
- **Uploads**: Size limits, sanitized filenames, and downloads always served as attachments with `nosniff`, so uploaded HTML/SVG cannot run in the app's origin.
- **Secrets**: Server secrets come from environment variables; users' personal Gemini keys are encrypted at rest and never returned to the browser. AI provider keys are sent in headers, never in URLs.
- **Hardening**: Security headers on every response, API docs disabled outside development, generic error messages unless `DEBUG=true`.

---

## 📄 License

This project is licensed under the MIT License.
