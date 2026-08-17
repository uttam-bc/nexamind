# NexaMind

Agentic AI-powered workspace for teams.

## Phase 1 — Foundation

This phase implements:

- PostgreSQL/SQLite database schema for `users`, `workspaces`, and `workspace_members`
- Custom JWT + bcrypt authentication
- Personal workspace auto-created on registration
- Team workspace creation with join codes
- Workspace membership and access control

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

```bash
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

Open API docs at http://localhost:8000/docs

### Run tests

```bash
pytest -v
```

## Phase 1 API endpoints

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
