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
| `GEMINI_API_KEY` / `GROQ_API_KEY` | Server-wide AI; meeting transcription (Groq Whisper first, Gemini audio as fallback) and drafting meeting minutes | Users can still add their own Gemini key; without any key the copilot runs explicit commands only, meetings fall back to the browser's speech recognition (Chrome/Edge), and minutes list only action items announced as "Action item: …". |
| `RUN_BACKGROUND_JOBS` (default on) | Meeting reminders (15 min before), task due-soon/overdue notices, ending meetings left empty for 10 minutes, drafting minutes after a meeting | None of those happen; minutes are drafted only when a host presses Regenerate. |

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

Live meeting rooms (`services/meeting_hub.py`: who is connected, signaling, the presenter slot)
are held in the API process and are **not** shared through Redis. With more than one instance,
route every connection for a meeting to the same instance (sticky sessions on the meeting id), or
participants on different instances will not see each other. Meetings, transcripts, chat and
notifications themselves are in the database and are unaffected. Background jobs should run on
one instance only (`RUN_BACKGROUND_JOBS=false` on the others); their notifications are
de-duplicated, so an overlap sends nothing twice.

## 6a. Meeting capacity

Meetings are **peer-to-peer WebRTC in a full mesh** (no SFU/MCU, no hosted video provider). The API
only relays signaling over WebSockets; media goes browser-to-browser (via TURN when configured).
Every participant encodes and uploads one copy of its camera (and screen, when presenting) per
other participant, so upload bandwidth and CPU grow linearly with the room size.

- **Enforced limit:** `MAX_MEETING_PARTICIPANTS` (default 8), checked on the server when a
  connection joins; the 9th person sees “This meeting is full”. A person rejoining (refresh, new
  device, network drop) replaces their old connection and is never counted twice.
- **Bandwidth budget per participant:** about 3 Mbit/s upload in total, split between viewers
  (`encodingPlan` in `frontend/src/lib/meetingClient.js`): with 8 people each camera gets roughly
  430 kbit/s; while someone presents, cameras drop to thumbnails and the screen gets ~70% of the
  presenter's budget (1080p at up to 15 fps, resolution kept for legibility).
- **Verified:** 5 participants at once (5 browser tabs on one machine) with video in every
  direction, a 6th refused by the limit (limit set to 5 for the test), screen sharing to 2 viewers
  at 1920×1080/~15 fps, and
  reconnects after refreshes, a second device, an 80–90 s network black hole and server restarts.
  Media quality for 8 real devices on real networks has **not** been measured: the test tabs shared
  one CPU and background tabs are throttled by the browser.
- **Beyond ~8:** a mesh does not scale (each of N people sends N−1 copies). Larger meetings need an
  SFU (for example LiveKit or mediasoup, self-hosted or managed): each participant then uploads one
  copy and the server forwards it. That is an infrastructure project (a media server with public
  UDP ports or a paid plan), not a setting.
- Live rooms are in the API process (see §6): run one API instance, or route a meeting's sockets to
  one instance.

## 7. Monitoring (NX-REL-006)

Set `SENTRY_DSN` to send unhandled errors to Sentry (or a compatible service). Authorization
headers, cookies, request bodies and user details are removed before sending. `GET`/`HEAD
/health` returns 200 for uptime monitors.
