# NexaMind
An agentic AI-powered workspace for teams  
Project Report & Architecture Guide  
Final Year Project · Team of 3 · 2026

## 1. What is NexaMind

NexaMind is an all-in-one AI-powered workspace that combines the note-taking of Notion, the team communication of Microsoft Teams, and an agentic AI layer that has real memory of everything that happens inside the workspace — documents, chats, tasks, and meetings.

Rather than being a chatbot bolted onto a productivity app, NexaMind's AI is built as an agent: it can retrieve information across the workspace and take real actions (creating tasks, generating reports) on the user's behalf, in the same spirit as agentic coding tools like Cursor.

### Core modules

- **Workspace** — personal (private) spaces and team spaces joined via a code
- **Documents** — a block-style editor for notes and specs
- **Projects** — a Kanban board for task tracking
- **Code** — a lightweight code editor with commit history and an issue/PR log
- **Meetings** — live video conferencing or uploaded recordings, transcribed and summarized automatically
- **Channels** — real-time team chat
- **Files** — general file storage with inline preview for images and PDFs
- **Finance** — income/expense tracking with a runway calculator
- **AI Assistant** — an agent with tool access to the whole workspace
- **Create Report** — generates written reports synthesized from past meetings, documents, and data

### Availability

NexaMind is deployed as a live backend service, reachable from both a web application and a mobile app, with real-time synchronization so changes made on one client appear instantly on the other.

## 2. System Architecture

The system follows a client-server architecture: two independent front-ends (web and mobile) talk to a single deployed backend, which is the only thing that touches the database and the AI provider. This is what makes real-time cross-platform sync possible — both clients are simply views onto the same live backend process.

## 3. Technology Stack

| Layer | Choice | Why |
|-------|--------|-----|
| Web frontend | React + Vite | Fast dev loop, component-based UI |
| Mobile frontend | React Native (Expo) | Shares logic/patterns with the web client |
| Backend | Python — FastAPI | Async by default, native WebSocket support, auto API docs |
| Real-time | FastAPI WebSockets / python-socketio | Live sync for chat, tasks, and session status |
| Database | PostgreSQL | Data is relational — everything chains through workspace_id |
| DB hosting | Neon / Railway (managed Postgres) | Free tier, no server maintenance |
| Backend hosting | Railway / Render | Supports persistent WebSocket connections |
| AI | Google Gemini API | Function calling (tool use) + generous free tier |
| Transcription | Google Speech-to-Text | Same ecosystem as Gemini, one vendor to manage |
| Auth | Custom JWT + bcrypt | Own implementation, no third-party auth SDK |

## 4. Database Schema (PostgreSQL)

Every table is scoped by `workspace_id` — this single foreign key is what makes the personal-vs-team workspace model work consistently across every module.

| Table | Key columns |
|-------|-------------|
| users | id, email, password_hash, name |
| workspaces | id, name, type (personal/team), owner_id, join_code |
| workspace_members | id, workspace_id, user_id, role |
| documents | id, workspace_id, title, content (jsonb), created_by |
| tasks | id, workspace_id, title, status, position, assignee_id |
| code_repos / commits / issues | id, workspace_id, name, content, message, status |
| messages | id, workspace_id, channel, sender_id, content, created_at |
| files | id, workspace_id, filename, file_path, uploaded_by |
| finance_transactions | id, workspace_id, type, amount, category, date |
| sessions | id, workspace_id, source, transcript, ai_summary, action_items, status |
| reports | id, workspace_id, report_type, content, source_session_ids, source_document_ids |

## 5. Meetings & Sessions Pipeline

The Meetings module supports two entry points that converge into a single processing pipeline:

- **Live video conferencing** — in-app calls (built via an SDK such as Daily.co or 100ms rather than hand-rolled WebRTC), recorded during the call
- **Uploaded recordings** — a video or audio file uploaded after the fact from any source

Both paths feed the same pipeline:

1. Audio is extracted from video (via ffmpeg, if needed)
2. The audio is transcribed to text using Google Speech-to-Text
3. The transcript is sent to Gemini, which returns a summary and action items
4. Everything is saved as a Session record: transcript, summary, action items, status
5. The session becomes part of the AI agent's searchable memory going forward

Because transcription and summarization can take time, this runs as a background task — the user sees a processing status (uploading → transcribing → summarizing → done) rather than a blocking wait.

## 6. Agentic AI Layer

NexaMind's AI is built as an agent with tools, not a plain chatbot. The distinction: a chatbot reads context and replies with text; an agent can decide which tool to call, execute it, observe the result, and chain further steps toward a goal — including taking real actions inside the app.

### Example tools exposed to the agent

| Tool | What it does |
|------|--------------|
| search_documents(query) | Full-text search across workspace documents |
| search_sessions(query, date_range) | Full-text search across meeting transcripts/summaries |
| create_task(title, status, assignee) | Creates a new task on the Kanban board |
| update_task_status(task_id, status) | Moves a task between columns |
| search_finance(category, date_range) | Queries income/expense records |
| create_report(scope, type) | Triggers the report-generation pipeline |

**Example flow** — user: "Create tasks for all the action items from yesterday's meeting." The agent calls `search_sessions` to find the meeting, reads its action items, then calls `create_task` once per item, and finally replies confirming what was created.

## 7. Create a Report

This feature lets a user generate a written report by pointing the AI at a mix of past sessions, documents, and workspace data. It reuses the same retrieval mechanism as the AI Assistant: relevant material is retrieved first (via date range, tags, or full-text search), then assembled into a prompt and sent to Gemini to synthesize into a structured report.

1. User selects a scope (date range, or specific sessions/documents) and a report type
2. Backend retrieves only the relevant transcripts and document content — not the entire workspace history
3. Gemini synthesizes the retrieved material into a structured report
4. The report is saved with references to its exact sources, so it stays traceable

## 8. Homepage — Visual Guide

The logged-in homepage is dashboard-first: a sidebar for workspace switching and module navigation, summary metric cards for a quick pulse on the workspace, a recent-activity feed pulling from across modules, and an AI panel placed front and center rather than tucked away.

## 9. Recommended Build Order

1. **Foundation** — schema, auth (JWT + bcrypt), workspace + join-code logic
2. **First vertical slice** — Documents module end-to-end, deploy backend early
3. **Replicate the pattern** — Projects, Files, Finance, Channels
4. **Real-time layer** — WebSockets for Channels, tested across two clients
5. **Sessions pipeline (upload path first)** — transcription → summary → session storage
6. **AI Assistant** — tool functions first, then agent orchestration wired to Gemini
7. **Create Report** — reuses retrieval + Gemini from the Assistant
8. **Mobile app** — Expo client wired to the same deployed backend, 3–4 modules scoped
9. **Live video conferencing** — added on top of the working upload pipeline

# NexaMind — Build Instructions

Read the attached `NexaMind_Project_Report.md` completely before doing anything.

The Markdown file is the **source of truth for the project's requirements, architecture, technology stack, database schema, modules, AI architecture, meeting pipeline, and build order.**

Your job is to implement the project described in that document.

## Critical Rules

### 1. Build in phases

Follow the **Recommended Build Order** in the Markdown document.

Do NOT implement the entire project in one go.

Start with the first phase only.

After completing a phase:

* run the application
* run relevant tests
* verify the implementation
* fix errors
* summarize what was implemented
* list files changed/created
* explain how I can test it

Then **STOP**.

Do not continue automatically.

I will tell you:

`NEXT PHASE`

when I want you to continue.

---

### 2. The Markdown is the source of truth

Do not unnecessarily repeat or redefine requirements that already exist in the Markdown.

Before implementing anything, inspect the relevant section of the document.

If something is ambiguous or you think the architecture needs to change, **ask me before making a major architectural decision.**

Do not silently replace technologies or architectural decisions from the document.

---

### 3. FRONTEND DESIGN IS NOT PART OF THIS PHASE

**Do NOT work on frontend design yet.**

This is extremely important.

Do not spend time on:

* visual design
* polished UI
* dashboard design
* animations
* design systems
* responsive styling
* mobile UI
* visual components
* frontend UX

The frontend design will be handled later with a separate prompt.

If a minimal frontend/stub is necessary to test backend functionality, create only what is technically required.

Otherwise, focus on the backend and system functionality.

---

### 4. Build production-quality foundations

Even though this is being developed phase-by-phase, don't write throwaway code.

Use:

* modular architecture
* clean separation of concerns
* proper error handling
* environment variables
* database migrations
* validation
* authentication/authorization
* logging
* tests
* meaningful naming
* reusable services
* secure handling of secrets

Do not hardcode credentials or API keys.

Create/update `.env.example` where necessary.

---

### 5. Don't jump ahead

While implementing the current phase, you may create **small supporting pieces** required by the current phase.

However, do not prematurely implement future modules.

For example, while building authentication, don't start building the AI agent, meetings pipeline, finance module, or report generation unless the current phase explicitly requires it.

Keep the architecture ready for future phases without implementing them prematurely.

---

### 6. Verify everything

Do not tell me a phase is complete simply because the code was generated.

Actually:

1. Start the application.
2. Run tests.
3. Verify database connectivity.
4. Test important APIs.
5. Fix errors you encounter.
6. Re-run the tests.

If something cannot be tested because an external service/API is unavailable, clearly tell me what was mocked and what remains unverified.

---

## First Action

Before writing code:

1. Read the entire attached Markdown file.
2. Inspect the existing repository.
3. Determine the current state of the project.
4. Compare the repository against the architecture and build order in the Markdown.
5. Tell me briefly:

   * what you found
   * what already exists
   * what Phase 1 requires
   * what files/modules you intend to create

Then begin **Phase 1 only**.

Do not start frontend design.

Do not proceed to Phase 2 automatically.

### phases
2 Documents module end-to-end + deploy backend
3 Projects, Files, Finance, Channels
4 Real-time layer (WebSockets)
5 Sessions pipeline (upload → transcribe → summarize)
6 AI Assistant (tools + Gemini agent)
7 Create Report
8 Mobile app (Expo, 3–4 modules)
9 Live video conferencing