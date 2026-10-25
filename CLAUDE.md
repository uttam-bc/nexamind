# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

NexaMind is a Notion + Microsoft Teams style collaborative workspace with an AI copilot. Three clients share one API:

- `backend/` — FastAPI (Python 3.12), async SQLAlchemy 2.0, Alembic, Pydantic v2
- `frontend/` — React 19 + Vite + Tailwind 3 (plain JSX, no TypeScript, no router library; Vitest + Testing Library for tests, no linter)
- `mobile/` — Expo SDK 51 / React Native 0.74 (minimal: `App.js` + `src/api.js`)

## Commands

Backend (run from `backend/`; `pytest.ini` sets `pythonpath = .` so imports are `app.*`):

```bash
pip install -r requirements-dev.txt       # requirements.txt is runtime-only and pinned
cp .env.example .env                      # defaults to SQLite
alembic upgrade head
uvicorn app.main:app --reload --host 127.0.0.1 --port 8000   # Swagger at /docs (development only)
pytest -v                                 # all tests
pytest tests/test_security.py -v          # one file
pytest tests/test_security.py::test_name -v   # one test
```

A `nexamind.db` created before migrations were complete needs `alembic stamp 006_notion_teams_features` once before `alembic upgrade head`.

Frontend (from `frontend/`): `npm install`, `npm run dev` (port 5173), `npm run build`, `npm test` (Vitest, jsdom; tests are `src/**/*.test.{js,jsx}`).

CI (`.github/workflows/ci.yml`) runs backend tests, migrations on PostgreSQL, frontend tests/build, `npm audit --omit=dev` and `pip-audit`. Production configuration, backups and restore are in `docs/OPERATIONS.md`.
Mobile (from `mobile/`): `npm run start`.

`start_nexamind.bat` (Windows) runs migrations, then starts backend (venv Python if present) and frontend.

## Architecture

### Backend layering: routers → services → models

- `app/routers/*.py` are thin HTTP/WebSocket handlers; logic and queries live in `app/services/*_service.py`. Pydantic schemas in `app/schemas/`, ORM models in `app/models/` (all re-exported from `app/models/__init__.py`, which `alembic/env.py` imports).
- Almost every resource is nested under `/workspaces/{workspace_id}/...`. Multi-tenancy is enforced in the service layer: each service has its own `_require_workspace_access(db, workspace_id, user_id)` — new service functions must call it (or go through a getter like `get_channel`/`get_document` that does).
- Channels have three visibility levels (`app/services/channel_service.py`): public (any workspace member), private (workspace member **and** a `channel_members` row), and direct (`is_direct`, only `channel_members`, regardless of workspace membership — DMs started from a personal workspace are listed in the other participant's personal workspace). Always use `channel.workspace_id` for messages, not the path's workspace id.
- Auth: PyJWT HS256 via `app/dependencies.get_current_user`. WebSockets accept the JWT as the first frame `{"type": "auth", "token": ...}` (the frontend's `openSocket()` in `src/api.js` does this); `?token=` still works for old clients. `AuthError` is the service-layer exception mapped to JSON in `main.py`.
- DB session: `app/database.get_db` commits automatically at the end of the request. Routes use `Depends(get_db, scope="function")` so the commit happens before the response is sent (otherwise a client can read stale data right after a write). Services `flush()`; agent tools `commit()` so broadcasts happen after data is durable. SQLite runs with `PRAGMA foreign_keys=ON`.
- Schema changes need an Alembic migration in `alembic/versions/` (`00N_*.py`, written idempotently with `_table_exists`/`_column_exists` like 007). `create_all` at startup only runs when `AUTO_CREATE_SCHEMA` is on (defaults to on in development) and never adds columns.
- `app/config.py`: `APP_ENV` other than development/test enforces a ≥32-char `JWT_SECRET_KEY`; `DEBUG` defaults off. `app/security.py` holds the in-process rate limiter (`limit_auth`, `limit_ai` dependencies), security-headers middleware, and Fernet encryption for stored user secrets.
- Real-time: `services/websocket_manager.ws_manager` keeps connections per process (channel, workspace and per-user scopes); with `REDIS_URL` set, broadcasts go through Redis pub/sub and `ws_manager.state` (presence) lives in Redis hashes. Live meeting rooms are in-process only (`meeting_hub`, see Meetings).
- Uploads: always go through `services/upload_utils.py` (streamed writes with size limits, sanitized names, `safe_content_type`), then `services/storage.persist_upload` (local disk, or an S3-compatible bucket with `STORAGE_BACKEND=s3`; stored paths are then `s3://bucket/key`). Use `storage.exists`, `storage.local_copy` and `storage.download_response` instead of touching paths directly. Downloads are forced attachments. API responses never include server file paths.
- Auth tokens carry a `ver` claim checked against `users.token_version`; logout, password change/reset and account deletion bump it (`auth_service.revoke_sessions`). Dev shortcuts (OTP codes in responses, `mock_google_:` credentials) need `ENABLE_DEV_AUTH=true` and are refused outside development/test.
- Destructive actions on shared content go through `workspace_service.require_author_or_manager` (author, or workspace owner/admin).
- Background work (`RUN_BACKGROUND_JOBS`, off in tests): recording transcription (`session_service.schedule_session_pipeline`, resumed on startup by `resume_interrupted_sessions`) and debounced memory re-extraction after document edits (`memory_engine.schedule_document_ingestion`).

### Meetings

- `models/meeting.py`: `Meeting` (scheduled/live/ended/cancelled, UTC start + IANA `timezone`, recurrence rows linked by `recurrence_parent_id`, unique `(organizer_id, client_request_id)`), `MeetingInvitee`, `TranscriptSegment`, `MeetingMessage`, `MeetingActionItem`, `Notification`. Each scheduled meeting has a linked `CalendarEvent` (`meeting_id`); calendar deletes of those are refused (cancel from Meetings so invitees are told).
- Creation needs an explicit request with a `client_request_id` (one per dialog/click): a retry returns the original (200) instead of a duplicate. Start times must carry an offset, not be in the past, and the zone must be IANA (`tzdata` is a dependency because Windows/slim images have no zone database). Nothing creates meetings or calendar entries by itself: suggestions must quote their source (`calendar_service`) and missing times stay empty.
- Host = organizer or workspace owner/admin (`meeting_service.is_host`). Invite-only meetings (with invitees) are hidden, with their minutes and sessions, from other members (`can_access`, `session_service._can_see`).
- Live rooms: `/ws/workspaces/{wid}/meetings/{mid}` → `meeting_hub`: one connection per person (a new join from the same user replaces the old one, closed with 4409; the client never shows the same user twice), silent sockets dropped after 90 s, `MAX_MEETING_PARTICIPANTS` enforced on join (4429), auth timeouts close with retryable 4408 (1008 only for bad tokens), the welcome is sent before others are told someone joined. Rooms the process hasn't seen since a restart count as empty from the process start, so a deploy never ends live meetings. Frames: targeted `signal`, `state`, one presenter at a time via `screen_share`, persisted `chat` de-duplicated by `client_message_id`, with `reply_to_id` replies (`meeting_service.store_chat_message`; a rate-limited message is reported back with its id so the UI offers Retry). The browser side is `src/lib/meetingClient.js`: existing participants offer to a newcomer, fixed audio/camera/screen transceivers (camera and screen changes are `replaceTrack`, never renegotiation), queued ICE candidates, ICE restart, socket reconnect rebuilding peers, frames handled strictly in order, and per-sender bitrate/resolution limits from `encodingPlan` (mesh: see docs/OPERATIONS.md §6a). Video elements keep the last frame when a track goes muted (a still shared slide sends no frames).
- End: `POST /meetings/{id}/end` with `scope` "me" (leave) or "all" (host only, idempotent) → `end_for_all` freezes the transcript into a `SessionRecord` (`meeting_id`) and the minutes are drafted after `MOM_UPLOAD_WAIT_SECONDS` (late chunks recorded before the end are accepted for 90 s).
- Transcription (`src/lib/meetingTranscriber.js` → `transcription_service`): every participant uploads their own mic in standalone MediaRecorder chunks cut at a pause, with a stable `client_segment_id` (retries never duplicate); 503 = retry later; chunks that keep failing become gaps that mark the minutes incomplete. Without a server provider the browser's speech recognition is used and restarted when it stops.
- Minutes (`mom_service`): only items whose `evidence` quote is in the transcript survive; owners are matched to members or flagged `needs_review`; a due date only when its words were said. Regenerating upserts action items by `dedupe_key`. `approve_mom` locks the minutes, creates one task per confirmed item (`source_meeting_id`) and notifies assignees. The legacy `/sessions` endpoints cannot edit or regenerate meeting minutes around this.
- Calls from a direct message are meetings with `channel_id` (migration 015): access and host rights come from the DM's `channel_members`, not workspace membership (`can_access`/`is_host`), so the other person can join from any workspace. `POST /channels/{id}/call` starts or returns the live call and rings via `ws_manager.send_to_user` frames `{type: "call", event: ring|answered|declined|ended}` on `/ws/notifications` (`NotificationBell` re-dispatches them as `nexamind:call`); `components/calls/CallManager.jsx` (mounted in App) rings with Accept/Decline and opens `PreJoin` + `MeetingRoom isCall`. Ending a call posts "📞 Video call · …" or "📞 Missed video call" in the DM; a call where nothing was said gets no minutes.
- Notifications: `notification_service.notify` (de-duplicated per user by `dedupe_key`, respects `users.notification_prefs` per category, skips the actor) pushes over `/ws/notifications`; `/notifications` REST lists and marks read. Timestamps of the new tables are UTC: serialize with `notification_service.iso_utc` (SQLite drops the zone). Periodic work is `services/jobs.py`. Notification links (`{tab, workspace_id, …ids}`) are opened through `lib/deepLink`: App switches workspace/tab and the feature component handles the rest with `onDeepLink(tab, handler)`.

### Repositories (real Git)

- History lives in bare repositories (`services/git_service.py`, git CLI via argument lists in a thread, sanitized env, no hooks except the push policy `git_pre_receive.py`); the DB never simulates commits. `CodeRepo` (+ `models/repository.py`: collaborators, access tokens, branch rules, pull requests, reviews, comments, events). Legacy `commits`/`repo_files` rows are unused; a pre-Git repo's files become its first commit when opened (`repo_service._convert_legacy`).
- Web edits never touch a working tree: `commit_changes` builds a tree in a temporary index and moves the branch with `update-ref new old` (409 when it moved). Paths go through `validate_path`, ref names through `validate_ref_name`; pass user values after `--end-of-options`/`--`.
- Access: every route calls `repo_service.get_repo_for` (roles read < reviewer < write < maintainer < admin < owner; workspace owners/admins are admin; private repos 404 for others), and services re-check with `require`. Protected branches block web commits and (via the pre-receive hook) pushes; PR merges need the approvals on the current head.
- Every ref change calls `after_ref_change` (activity, "Fixes #n" on the default branch, PRs merged by push, S3 bundle backup). Issues and PRs share `next_number`. Smart HTTP is `routers/git_http.py` (`/git`, Basic auth with `nxm_` tokens; in the Vite proxy). Folder imports/uploads stage under `REPO_DIR/.staging` (`/repo-uploads`) and refuse secret-looking files unless listed in `include_flagged`.
- Frontend: `components/CodeWorkspace.jsx` (list + hash router `#/code/<repo>/<view>…`) and `components/repos/*`. Tests: `tests/test_git_repositories.py`, and `tests/test_git_http.py` runs real `git clone/push` against a uvicorn subprocess.

### AI layer

- All LLM calls go through `services/llm_client.py` (Gemini first, Groq fallback; keys in headers; models from `GEMINI_MODELS`). Every function returns `None` when no provider works — callers must have an offline path. `resolve_gemini_key(user)` prefers the user's encrypted personal key over the server key.
- Copilot (`POST /workspaces/{wid}/ai/chat` → `services/agent_orchestrator.run_agent`): real function-calling loop over `agent_tools.AVAILABLE_TOOLS`, dispatched by `_dispatch`. Adding a tool = a `*_tool` function in `agent_tools.py`, a declaration in `AVAILABLE_TOOLS`, and a branch in `_dispatch`. Tools raise `ToolError` for user-facing failures; `execute_tool` turns them into `{"error": ...}` for the model.
- With no reachable model, `services/agent_planner.plan()` parses explicit commands into tool calls. It must never invent values: a command without a title/amount/date produces no call. Add a `_parse_*` function to `PARSERS` for new commands.
- Memory (`services/memory_engine.py`): sources are re-extracted wholesale per `source_id` (`replace_source_memories`); retrieval mixes Gemini embeddings with BM25. Private channel messages must never be ingested.

### Documents

Document bodies are `content.text` (Markdown) — the shape the editor saves; `blocks` is legacy. List/tree endpoints return no content, so the editor fetches the full document before showing it and autosaves only real edits. `POST /documents/import` turns .docx/.pdf/.md/.txt uploads into Markdown (`services/document_import.py`). Uploads of formats the app renders (PDF, PNG, JPEG, GIF, WebP, BMP) must match their signature (`upload_utils.verify_signature`) and get their MIME type from it. Docs is one library: uploading a .docx/.pdf/.md/.txt anywhere goes through `services/library_service.add_upload`, which keeps the original as a `FileRecord` and creates the editable page, linked by `files.document_id` (deleting either deletes both). The Files tab (`FileManager.buildLibrary`) shows every page once plus unlinked files. Pages render with `components/MarkdownDocument.jsx`; images are `![alt](file:<file id>)`. `GET /documents/{id}/export?format=docx|md` writes the current page (`services/docx_export.py`, images embedded). The UI has Pages (`Documents.jsx`) and Files (`FileManager.jsx`) tabs; uploaded files are previewed by `FilePreview.jsx` (`GET /files/{id}/preview` gives the kind and text; PDFs/images/media are shown from a Blob with an allow-listed type, never as HTML/SVG) and `POST /files/{id}/to-document` makes a page from a file. A page made from a PDF opens on the original PDF (`viewMode` "original", browser PDF viewer) — the Markdown is an extracted, editable copy and cannot keep layout.

### Frontend

- `src/App.jsx` holds global state and renders one lazily loaded feature component per tab; the tab is mirrored in the URL hash (`#/documents`). Tab ids live in `src/lib/navigation.js` (`SOLO_NAV` vs `GROUP_NAV`).
- All HTTP goes through `src/api.js` (`request()` adds the bearer token, dispatches `nexamind:unauthorized` on 401, and merges identical in-flight GETs).
- Dialogs: use `components/ui/Modal` or `lib/dialog.useDialog`; hand-built overlays mark their panel with `data-modal` and `lib/dialogManager` adds dialog semantics, focus trap and Escape. Use `notify()` / `confirmDialog()` from `context/ToastContext`, never `alert()`/`confirm()`. `API_BASE` comes from `VITE_API_URL` (empty in dev; Vite proxies `/auth`, `/workspaces`, `/ai`, `/ws`, `/health`). **A new top-level backend prefix must also be added to the Vite proxy** (`/notifications` is one).
- Chat attachments (channels, DMs, meeting chat): uploads are `FileRecord`s scoped by `channel_id`/`meeting_id` (hidden from Files; `attachment_service.library_only`), shared library files/pages are references (`MessageAttachment`), retries dedupe on `client_upload_id`/`client_message_id`; UI in `components/chat/*` + `lib/chatAttachments.js`.
- Channel and DM screens use `lib/channelSocket` (reconnecting socket, re-fetch after reconnect, `mergeMessages` de-duplicates and orders); below `md` they show the list or the conversation, not both.
- Gemini keys are managed by `components/GeminiKeySettings.jsx` against `/ai/config/*`; never store keys in localStorage.

### Tests

`backend/tests/conftest.py` sets test env vars before importing the app (no AI keys or SMTP, rate limits and background jobs off, `ENABLE_DEV_AUTH=true`, `REQUIRE_EMAIL_VERIFICATION=false`; tests that need production behaviour monkeypatch these back), swaps in in-memory SQLite, overrides `get_db`, and drives the app with `httpx.AsyncClient`. Use `auth_context` (user + personal workspace) and `auth_headers(token)`. LLM behaviour is tested by monkeypatching `llm_client.gemini_generate` (see `tests/test_agent_llm.py`); security regressions live in `tests/test_security.py`.

## Deployment

`render.yaml` deploys the backend from `backend/Dockerfile` (non-root, runs `alembic upgrade head`, uploads under `/data/uploads`) with managed Postgres and generated `JWT_SECRET_KEY`/`DATA_ENCRYPTION_KEY`. `backend/.dockerignore` keeps `.env`, databases, and uploads out of the image. The frontend deploys separately with `VITE_API_URL` set; add its origin to `CORS_ORIGINS`.
