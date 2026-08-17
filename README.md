# NexaMind

Agentic AI-powered workspace for teams.

## Phase 1 — Foundation

- PostgreSQL/SQLite database schema for `users`, `workspaces`, and `workspace_members`
- Custom JWT + bcrypt authentication
- Personal workspace auto-created on registration
- Team workspace creation with join codes
- Workspace membership and access control

## Phase 2 — Documents

- `documents` table scoped by `workspace_id`
- Block-style JSON content (`content.blocks[]`)
- Full CRUD API with workspace membership enforcement
- Alembic migration and deployment config for Render

## Backend setup

```bash
cd backend
python -m venv .venv

# Windows
.venv\Scripts\activate

pip install -r requirements.txt
copy .env.example .env
```

### Database

For local development without PostgreSQL, the default SQLite URL in settings works out of the box.

For PostgreSQL, set in `.env`:

```env
DATABASE_URL=postgresql+asyncpg://postgres:postgres@localhost:5432/nexamind
```

Run migrations:

```bash
alembic upgrade head
```

### Run the API

```powershell
cd backend
$env:PYTHONPATH="."
uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

Open API docs at http://127.0.0.1:8000/docs

### Run tests

```bash
cd backend
pytest -v
```

## Deploy to Render

1. Push this repo to GitHub.
2. Create a new **Blueprint** on [Render](https://render.com) and point it at `render.yaml`.
3. Set `DATABASE_URL` to the managed Postgres connection string Render provides.
4. Render builds from `backend/Dockerfile`, runs migrations on startup, and exposes the API.

Health check: `GET /health`

## API endpoints

### Auth & Workspaces

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Health check |
| POST | `/auth/register` | Register user + personal workspace |
| POST | `/auth/login` | Login and receive JWT |
| GET | `/auth/me` | Current user profile |
| GET | `/workspaces` | List workspaces for current user |
| POST | `/workspaces` | Create team workspace |
| GET | `/workspaces/{id}` | Workspace detail with members |
| POST | `/workspaces/join` | Join team workspace via join code |

### Documents

| Method | Path | Description |
|--------|------|-------------|
| GET | `/workspaces/{workspace_id}/documents` | List documents in workspace |
| POST | `/workspaces/{workspace_id}/documents` | Create document |
| GET | `/workspaces/{workspace_id}/documents/{document_id}` | Get document with block content |
| PATCH | `/workspaces/{workspace_id}/documents/{document_id}` | Update title and/or content |
| DELETE | `/workspaces/{workspace_id}/documents/{document_id}` | Delete document |

### Example document content

```json
{
  "title": "Project Spec",
  "content": {
    "blocks": [
      {"id": "block-1", "type": "heading", "level": 1, "text": "Overview"},
      {"id": "block-2", "type": "paragraph", "text": "NexaMind requirements."},
      {"id": "block-3", "type": "bullet_list", "items": ["Auth", "Documents"]}
    ]
  }
}
```
