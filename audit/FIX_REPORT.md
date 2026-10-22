# NexaMind — audit fix report

Branch `fix/audit-findings` (not committed or deployed). Date: 2026-10-22.

## A. Summary

Every actionable finding in `NEXAMIND_AUDIT_REPORT.md` was addressed. Each one was either fixed
and verified, or has a stated limit or blocker below. Three problems reported by the project
owner during the work were fixed first, and all three had real root causes:

1. **Repos disappeared from navigation.** This was my own regression: I had hidden Repos in
   personal workspaces and added a Reports item to the rail. Repos is restored everywhere and
   Reports is off the rail. The repository features were re-tested in the UI: create a repo, add a
   file, save, commit, open an issue, and reload. All of them persist.
2. **Documents not visible / no preview.** This was a pre-existing **data-loss bug**. The editor
   opened pages from the list endpoint, which carries no content, so pages appeared empty. Autosave
   then wrote that empty text back over the real document. The editor now loads the full document
   before showing it and saves only real edits. There is now a full-page **Preview** mode with
   tables, bold/italic, code and links. Word (.docx) and PDF files are imported as real formatted
   text instead of raw bytes.
3. **AI forgetting history and unable to read or edit documents.** There were four separate
   causes:
   - The chat screen called the history API with the wrong arguments, so history never loaded and
     deleting a chat also failed.
   - Documents the AI wrote stored their text twice, and the duplication grew with every edit.
   - Edits could only append or replace the whole page. Targeted find-and-replace and prepend
     edits are now supported, and ambiguous titles are refused instead of editing the wrong page.
   - Each reply first ran several blocking model calls. When Gemini was overloaded (503s were
     observed live), replies took minutes. Overloaded models are now skipped for 60 seconds.

   Live result: a document question and a follow-up edit ("that document") were each answered in
   about 12 seconds, and the conversation reloaded intact.

The same scan found two more breakages in Meetings, both now fixed. Uploading a recording called
an API function that doesn't exist, and "save minutes to Documents" never saved anything.

## B. Status per finding

| ID | Status | Notes |
|---|---|---|
| SEC-001 Google audience | FIXED AND TESTED | Google's library verifies the signature, audience, issuer and expiry. The endpoint returns 503 when no client ID is configured. Accounts are linked only when the email is verified, and an unverified password account is never taken over. |
| SEC-002 forged X-Forwarded-For | FIXED AND TESTED | The rate limiter uses the trusted `CLIENT_IP_HEADER` or a set number of proxy hops. The Dockerfile no longer trusts every proxy. Per-account limits apply to login, OTP, registration, password change and contact. |
| SEC-003 dev auth shortcuts | FIXED AND TESTED | Requires `ENABLE_DEV_AUTH`, which is refused outside development and test. The demo Google buttons were removed, including in the unused `AuthPage.jsx`, which was deleted. |
| SEC-004 OTP in logs | FIXED AND TESTED | Subjects and bodies are never logged. Without SMTP the request fails with 503, and a failed send leaves no pending code behind. |
| SEC-005 CDN scripts / CSP | FIXED, TEST BLOCKED | Tailwind is now compiled at build time, so both CDNs are gone. Strict CSP, HSTS and frame-ancestors headers are set in `render.yaml`. The headers can only be checked after a deploy. |
| SEC-006 destructive actions | FIXED AND TESTED | Only the author or a workspace owner/admin can delete documents, tasks, transactions, events, files, sessions, reports or repo files. |
| SEC-007 enumeration | FIXED AND TESTED | `send-otp` gives the same response for every address, and existing accounts get an "account exists" email instead. `register` reveals a duplicate only after the code is verified. |
| SEC-008 PyJWT | FIXED AND TESTED | PyJWT 2.15.1. `pip-audit` finds no known vulnerabilities in the backend requirements. |
| SEC-009 token revocation | FIXED AND TESTED | A `ver` claim is checked on every request and WebSocket. Logout, password change/reset and account deletion revoke tokens. A request-scoped commit fix makes revocation take effect immediately. |
| SEC-010 hardening | FIXED AND TESTED | `HEAD /health` works and `--no-server-header` is set. `x-render-origin-server` is added by Render and can't be removed from the app. |
| BUG-001 invented finance figures | FIXED AND TESTED | Missing figures show "—" (component test). |
| BUG-002 fake commitments | FIXED AND TESTED | Only API results are shown, with loading, empty and error states. |
| BUG-003 Google unusable | FIXED, TEST BLOCKED | The button appears only when the server has a client ID. Going live needs `GOOGLE_CLIENT_ID`. |
| BUG-004 contact form | FIXED AND TESTED | `POST /contact` stores the message, emails it when configured, rate-limits by IP and sender, and has a honeypot. |
| BUG-006 review column | FIXED AND TESTED | Review column, filter and move actions added. |
| BUG-007 SQLite `now()` | FIXED AND TESTED | Python defaults plus `CURRENT_TIMESTAMP`. Sessions, reports and video tested on an Alembic-built database. |
| BUG-008 stale local DB | FIXED AND TESTED | Startup logs an error naming the current and expected revision. |
| BUG-009 blank names | FIXED AND TESTED | Input schemas strip whitespace before validation (422 on blank). |
| BUG-010 unbounded amounts | FIXED AND TESTED | Amounts must be finite and at most 1e12, in the API and the copilot. Existing overflowed rows aren't rewritten, and money is still stored as float. |
| BUG-011 invalid dates | FIXED AND TESTED | Real ISO dates and HH:MM / h:mm AM-PM times required. |
| BUG-012 placeholder content | FIXED AND TESTED | New pages are empty; the prompt is a placeholder. |
| BUG-013 editor layout | FIXED AND TESTED | Editor first, labelled read-only preview below, plus a Preview mode. |
| BUG-014 phone navigation | FIXED AND TESTED | Bottom tab bar and a "More" sheet (verified at 375 px). |
| BUG-015 landing phone menu | FIXED AND TESTED | Menu button with section links. |
| BUG-016 Files/Reports in rail | FIXED AND TESTED | At the owner's request, Files and Docs are one section: Docs has Pages and Files tabs, and `#/files` opens the Files tab. Files gets a real in-app viewer (PDF, images, audio/video, Word and Markdown formatted, code/text) and "Save as editable page". Reports is off the rail and reachable from search. |
| BUG-017 Notifications button | FIXED AND TESTED | Renamed "Calendar & reminders" and the fake unread dot removed. |
| BUG-018 lifecycle | FIXED AND TESTED | Password reset and change, profile edit, account deletion, leave workspace, remove member, change role (last owner protected), delete workspace/channel/message, edit message, pagination. |
| BUG-019 blank task feedback | FIXED AND TESTED | Inline error message. |
| BUG-020 duplicate requests | FIXED | Identical in-flight GETs are merged. Not re-measured on a production build. |
| BUG-021 native dialogs | FIXED AND TESTED | All 52 `alert()`/`confirm()` calls were replaced with accessible toasts and a confirm dialog. |
| BUG-022 Kanban search clipped | FIXED AND TESTED | Header controls wrap. |
| BUG-023 marketing copy | FIXED | Model-neutral copy. |
| A11Y-001 labels | FIXED AND TESTED | A runtime scan of all 12 screens found 0 unlabeled fields. |
| A11Y-002 focus | FIXED | Global `:focus-visible` ring. Checked in CSS only. |
| A11Y-003 dialogs | FIXED AND TESTED | Role, name, focus trap, Escape and focus return (unit and browser tests). |
| A11Y-004 calendar keyboard | FIXED | Tab, Enter/Space and arrow keys. Not covered by a test. |
| A11Y-005 icon buttons | FIXED AND TESTED | Runtime scan: 0 unnamed buttons. |
| A11Y-006 headings | FIXED AND TESTED | Exactly one `<h1>` on each scanned screen. |
| A11Y-007 landing links | FIXED AND TESTED | Real `#section` links. |
| A11Y-008 small text | FIXED AND TESTED | 0 text elements under 12 px. Contrast was **not** measured. |
| A11Y-009 ARIA | PARTIALLY FIXED | Broad improvements. A manual screen-reader pass is still needed; this is not a WCAG conformance claim. |
| UX-001 logout | FIXED AND TESTED | Account menu in the header with sign-out. |
| UX-002 mobile nav | FIXED AND TESTED | See BUG-014/015. |
| PERF-001/002/003 Tailwind | FIXED AND TESTED | One compiled stylesheet (about 100 KB raw). |
| PERF-004 1 s polling | FIXED | 5 s during a call, 15 s otherwise, paused when the tab is hidden. |
| PERF-005 reminder detection | FIXED AND TESTED | Shared 10-minute cache; checks only while the tab is visible. |
| PERF-006 pagination | FIXED AND TESTED | `limit`/`offset` on lists and a `before` cursor for messages. |
| PERF-007 latency | NOT APPLICABLE | Informational. The copilot no longer runs memory extraction before every reply. |
| REL-001 free DB expiry | FIXED, TEST BLOCKED | Documented in `docs/OPERATIONS.md`. Upgrading the database plan needs the owner's authorisation. |
| REL-002 ephemeral uploads | FIXED, TEST BLOCKED | S3-compatible storage implemented and tested with a fake client. Needs bucket credentials, or a paid disk. |
| REL-003 backups | FIXED, TEST BLOCKED | Backup script and restore procedure written. A restore was not run, because no authorised database was available. |
| REL-004 TURN | FIXED AND TESTED | ICE servers come from the API. A TURN service and credentials still need to be configured. |
| REL-005 migrated-schema tests | FIXED AND TESTED | Migrated-SQLite test passes locally. The CI PostgreSQL job has not run yet. |
| REL-006 monitoring | FIXED AND TESTED | Optional Sentry with scrubbing. Needs `SENTRY_DSN`. |
| REL-007 per-process state | PARTIALLY FIXED | Documented. The rate limiter is still per instance; real-time state uses Redis when `REDIS_URL` is set. |
| REL-008 large components / no frontend tests | PARTIALLY FIXED | Vitest suite added (9 tests). The large components were not split up. |
| RISK-001 SMTP missing | FIXED AND TESTED | Fails with a clear 503 instead of silently. Needs SMTP configured in Render. |
| RISK-002 Postgres `now()` | NOT APPLICABLE | `now()` is valid on PostgreSQL. Confirm on staging after deploy. |

## C. Test results

- Backend: **151 passed** (`pytest -q`). 76 tests existed at the start; 75 new tests are in 8 new test files.
- Frontend: **9 passed** (`npm test`); `npm run build` succeeds.
- `pip-audit -r requirements.txt`: no known vulnerabilities.
- `npm audit --omit=dev`: 0 vulnerabilities. The dev/build tools still have 7 advisories, all in Tailwind 3's dependency chain; fixing them requires Tailwind 4.
- Browser checks against a local scratch database:
  - repo flow; Word import and preview; switching documents without changing content;
  - live Gemini document read and edit, and history after reload;
  - logout revocation, contact form, `HEAD /health`;
  - dialog focus and Escape; accessibility scan of 12 screens; 375 px layout.

## D. Files changed

The working tree has 94 modified files and 30 new ones (`git status`). New modules:

- Backend: `storage.py`, `document_import.py`, `monitoring.py`, `routers/contact.py`, migration `009`.
- Frontend: `lib/dialog.js`, `lib/dialogManager.js`, `lib/format.js`, `lib/reminders.js`, `MobileNav.jsx`, `AccountSettings.jsx`.
- Other: `.github/workflows/ci.yml`, `docs/OPERATIONS.md`, `backend/scripts/backup_postgres.sh`.

## E. Deployment requirements (values not included)

- **Render environment:** set `SMTP_*`, `GOOGLE_CLIENT_ID`, `CONTACT_INBOX_EMAIL`, `WEBRTC_TURN_*`, the storage settings (`STORAGE_BACKEND=s3` + `S3_*`) and `SENTRY_DSN`.
- **Before real users:** upgrade the database plan and schedule backups.
- **API origin:** the frontend CSP hard-codes `nexamind-api.onrender.com`; update it if the API service is renamed.
- **Migration 009 is additive:** it adds `users.token_version`, `users.deactivated_at`, `messages.edited_at` and the `contact_messages` table. Users are signed out once after deploy only if their token predates version tracking. Such tokens default to version 0 and stay valid until they expire.
- **New Python dependencies:** google-auth, requests, pypdf, boto3, sentry-sdk.

## F. Remaining risks

- **Possible past data loss:** documents opened in the editor before this fix may already have been emptied. There is no version history, so they can't be recovered from the app; restore from a database backup if one exists.
- **Gemini overload:** the copilot depends on Gemini or Groq availability. Overload is now handled faster, but the copilot can't be faster than the provider.
- **Not verified live:** SMTP, Google sign-in, S3 against a real provider, TURN, CSP headers on Render, and the CI workflow (it hasn't run on GitHub yet).
- **Money storage:** amounts are still stored as float, not decimal.
- **Scaling:** the rate limiter is per instance.
- **Component size:** the very large components remain.
- **Accessibility:** contrast and screen-reader testing are not done.
- **Tokens in localStorage:** the bearer token is still stored there. Moving to HttpOnly cookies was deliberately not done because the frontend and API are on different sites; the CSP and token revocation reduce the risk.
- **Contact details:** the landing page lists `support@nexamind.app` and `github.com/nexamind/nexamind`. Confirm these are real.

## G. Release assessment

**READY FOR CONTROLLED STAGING TESTING.** This is not production-ready on local tests alone. Before
real users: configure the variables in E, verify the items in F on staging, upgrade the database
plan, and complete a backup restore test.

## Addendum (2026-10-23): one Docs library

At the owner's request, Pages and Files now hold the same items.
- A Word, PDF, Markdown or text upload (from either tab) keeps the original and becomes an editable page; the two are linked by migration `010`.
- The migration also links existing uploads to pages made from them, but only unambiguous pairs.
- Deleting from either tab removes both.
- Pages has an Image button. Pictures inside imported Word files are kept.
- Previews in both tabs always load the latest saved version, and the Word (.docx) download is generated from the current page with its images.
- The copilot can list files and place images, and its edits show in every preview and download.
- Tests: 165 backend and 13 frontend tests pass.
- Live checks:
  - in the browser: upload, edit, image, previews, export, copilot edit;
  - in Microsoft Word: the export opened without repair (lists, table, image and link intact).

