# NexaMind operations guide

How to run NexaMind in production without losing data, and what must be configured outside the
code. Nothing here has been run against the live deployment; treat each step as a checklist to
verify on a staging copy first.

## 1. Required configuration (Render dashboard → nexamind-api → Environment)

| Variable | Needed for | If missing |
|---|---|---|
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM_EMAIL` | Sign-up codes, password reset | Sign-up and "Forgot password" return a clear 503 ("Email delivery is not configured"). Existing users can still sign in. |
| `GOOGLE_CLIENT_ID` | "Continue with Google" | The Google button is hidden and `/auth/google` returns 503. |
| `CLIENT_IP_HEADER=cf-connecting-ip` | Accurate per-IP rate limits | Limits fall back to the proxy's address (all users share one bucket). Already set in `render.yaml`; confirm on staging that the header reaches the API. |
| `CONTACT_INBOX_EMAIL` | Forwarding contact-form messages | Messages are still stored in the `contact_messages` table. |
| `WEBRTC_TURN_URLS`, `WEBRTC_TURN_USERNAME`, `WEBRTC_TURN_CREDENTIAL` | Video calls on corporate/mobile networks | STUN only: calls fail behind many NATs and firewalls. Use a managed TURN service. |
| `STORAGE_BACKEND=s3` + `S3_BUCKET`, `S3_ENDPOINT_URL`, `S3_REGION`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | Uploads that survive deploys | Uploads live on the container disk and are **lost on every deploy** (see §4). |
| `SENTRY_DSN` | Error reports | Errors only appear in Render's logs. |
| `GEMINI_API_KEY` / `GROQ_API_KEY` | Server-wide AI | Users can still add their own Gemini key; without any key the copilot runs explicit commands only. |

Never commit these values. `ENABLE_DEV_AUTH` and `DEBUG` are refused at startup outside
development/test.

## 2. Database lifecycle (NX-REL-001)

`render.yaml` uses Render's **free** PostgreSQL plan. Free databases have no backups and Render
deletes them after the free period (check the current limit in Render's docs and the expiry date
shown on the database's page). Before real users rely on NexaMind:

1. Upgrade the database to a paid plan (point-in-time recovery and daily backups), **or**
2. Run the backup script below on a schedule and store dumps outside Render.

Do not change the plan or recreate the database without the owner's authorisation; a new free
database is empty.

## 3. Backups and restore (NX-REL-003)

Backup (any machine with `pg_dump` 16+ that can reach the database; use Render's *external*
connection string):

```sh
DATABASE_URL='postgresql://…' backend/scripts/backup_postgres.sh ./backups 14
```

The script writes `nexamind-<UTC timestamp>.dump`, checks it with `pg_restore --list`, and deletes
dumps older than 14 days. Schedule it daily (cron, a GitHub Actions schedule with the URL as a
secret, or a Render cron job) and copy dumps to separate storage.

Restore — **only into a new, empty database** (a staging copy first), never over production:

```sh
createdb nexamind_restore_test
pg_restore --no-owner --no-privileges --dbname=postgresql://…/nexamind_restore_test nexamind-<stamp>.dump
DATABASE_URL=postgresql://…/nexamind_restore_test alembic upgrade head   # brings an older dump up to date
```

Then point a staging API at it and check sign-in, documents and files. Record the date of each
successful restore test; a backup that has never been restored is not known to work.

## 4. Uploaded files (NX-REL-002)

With the default `STORAGE_BACKEND=local`, files and meeting recordings are written to
`UPLOAD_DIR` (`/data/uploads` in Docker). On Render's free plan that disk is wiped on every
deploy. Choose one:

- **Object storage (recommended):** create a bucket (Cloudflare R2, AWS S3, Backblaze B2…), set
  `STORAGE_BACKEND=s3` and the `S3_*` variables. New uploads go to the bucket; downloads stream
  from it and are always served as attachments. Files uploaded earlier stay where they were.
- **Persistent disk:** on a paid instance, attach a Render disk at `/data` (see the commented
  block in `render.yaml`).

The S3 path is covered by tests against an in-memory fake; verify it against the real provider on
staging (upload, download, delete, and a recording's transcription).

## 5. Migrations (NX-BUG-007, NX-BUG-008, NX-REL-005)

- The Docker image runs `alembic upgrade head` before starting. Locally, run it after every pull
  (`start_nexamind.bat` does). The API logs an error at startup if the database is behind.
- Migrations are additive and idempotent. CI runs them on PostgreSQL (upgrade, downgrade one step,
  upgrade again) and the test suite includes a run against an Alembic-built SQLite schema.
- Production uses PostgreSQL, where the old `now()` defaults worked (NX-RISK-002); confirm by
  creating a meeting session and a report on staging after deploying.

## 6. Scaling beyond one instance (NX-REL-007)

Rate limits and real-time state are per process. Before running more than one API instance, set
`REDIS_URL` (real-time fan-out and presence move to Redis) and put rate limiting in front of the
API (Cloudflare rules or a shared limiter), because the built-in limiter does not share counts.

## 7. Monitoring (NX-REL-006)

Set `SENTRY_DSN` to send unhandled errors to Sentry (or a compatible service). Authorization
headers, cookies, request bodies and user details are removed before sending. `GET`/`HEAD
/health` returns 200 for uptime monitors.
