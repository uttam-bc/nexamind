# NEXAMIND — COMPLETE WEBSITE QUALITY, SECURITY & FUNCTIONAL AUDIT REPORT

| | |
|---|---|
| **Target** | https://nexamind-web.onrender.com/ (frontend), https://nexamind-api-rh1j.onrender.com (API, discovered in the production bundle) |
| **Source revision** | `de82b2b` (`main`, 2026-10-22) |
| **Audit window** | 2026-10-22 05:32 – 05:52 UTC |
| **Type** | Audit only. No code, configuration, deployment, or production data was changed. |
| **Report location** | `audit/NEXAMIND_AUDIT_REPORT.md` |

---

## How this audit was performed (read first)

Three evidence sources were used. Every finding is labelled with the one it came from.

| Label | Source | What it covers |
|---|---|---|
| **[LIVE]** | The deployed site and API, using read-only requests and the browser | Public pages, headers, CORS, bundle contents, public API behaviour, performance |
| **[LOCAL]** | The same source revision run on the auditor's machine with a fresh, separate test database and two test accounts (`qa_auditor`, `qa_member`) | Everything that requires being signed in |
| **[SOURCE]** | Repository review, automated tests, dependency scanners | Root causes, configuration, dependencies |

**Why signed-in testing was done locally rather than on the live site.** The audit rules permit test accounts only where authorized. Production registration requires a one-time code e-mailed to a real inbox, and creating accounts on a production host was not authorized for this audit. So live registration and every signed-in workflow on the live site are recorded as **BLOCKED**. The same revision was exercised locally instead. Local results show how the code behaves; they do not prove the production database, environment variables, or SMTP setup behave the same way.

**What was not done.** No brute-force, fuzzing, load, or exploit attempts against production. No production form submissions (contact form, login, registration, OTP requests). No manual screen-reader testing. No monitoring, backup, or Render dashboard access.

---

## 1. Executive summary

**Overall condition.** The core platform is in reasonable shape. Authorization between users and workspaces is sound: all 22 access-control checks passed, and CORS, API security headers, and production error handling are configured correctly. The backend test suite passes (76/76) and no secrets were found in the production bundle.

The weaknesses are concentrated in four areas:
1. Recently added authentication features.
2. Screens that show **made-up data as if it were real**.
3. Accessibility.
4. Mobile navigation.

**Most serious risks**
1. **NX-SEC-001 (High): Google sign-in tokens are accepted without checking which app they were issued for.** Production reports no Google client ID, so the audience check is skipped (confirmed in source and in live config). A token minted for any other Google-Sign-In site could be replayed to log in as that user.
2. **NX-SEC-002 (Medium): Rate limits can be bypassed.** The API trusts the client-supplied `X-Forwarded-For` header, so a rotating fake IP gets a fresh limit on every request. This defeats brute-force protection on login, OTP and copilot endpoints. Source-confirmed, not exercised live.
3. **NX-SEC-005 (Medium): Unpinned third-party scripts and no Content-Security-Policy on the frontend,** while the session token sits in `localStorage`.
4. **NX-SEC-006 (Medium): Any team member can delete any other member's content.**

**Most important functional failures**
1. **NX-BUG-001 (High):** The Finance screen shows invented figures ($125,000 cash, $45,000 income, $18,500 expenses) whenever the summary is loading, missing or invalid.
2. **NX-BUG-002 (High):** The Calendar's "AI Detected Commitments" are two hardcoded fake items shown to every user.
3. **NX-BUG-003 (High):** Google Sign-In does not work in production. It shows end users a developer setup message and a demo-login button that production rejects.
4. **NX-BUG-004 (High):** The landing-page contact form tells users their message was received but sends it nowhere.
5. **NX-BUG-006 (Medium):** Tasks in `review` status disappear from the Kanban board.
6. **NX-BUG-007 (Medium):** On SQLite databases built with migrations, creating meeting sessions, generating reports, and ending video calls all fail with HTTP 500.

**Most important UX problems.** On phones there is no way to move between modules: the navigation rail is hidden with no replacement. Files and Reports cannot be reached from navigation even on desktop. Every form field lacks an accessible label, and keyboard focus is largely invisible.

**Readiness.** The core collaboration features work, so the application is **suitable for further controlled testing**. Release to real users is **blocked pending NX-SEC-001, NX-SEC-002, NX-BUG-001, NX-BUG-002, NX-BUG-003 and NX-BUG-004**, plus confirmation that production can actually send registration e-mails (NX-RISK-001).

**Major limitations.** Live signed-in workflows could not be tested. Production SMTP configuration, database health, backups and logs were not visible. Accessibility results are automated plus code review only; there was no screen-reader testing.

---

## 2. Application inventory

### 2.1 Frontend routes and screens

The landing site is a single page whose sections are reached by scrolling, not by URL. The signed-in application keeps the active screen in the URL hash.

| # | Route / location | Purpose | Access | Reachable from navigation? | Tested |
|---|---|---|---|---|---|
| R1 | `/` | Landing page (hero, product, AI memory, about, contact sections) | Public | Yes | LIVE + LOCAL |
| R2 | `/` → Sign In dialog | E-mail/username login, Google sign-in | Public | Yes | LIVE (opened, not submitted), LOCAL |
| R3 | `/` → Create Account dialog | Registration with e-mail one-time code | Public | Yes | LIVE (opened, not submitted), LOCAL |
| R4 | `#/dashboard` | Workspace overview, AI morning brief, runway card | Signed in | Yes | LOCAL |
| R5 | `#/documents` | Notion-style pages, hierarchy, templates, upload | Signed in | Yes | LOCAL |
| R6 | `#/projects` | Kanban task board | Signed in | Yes | LOCAL |
| R7 | `#/channels` | Team channels, threads, reactions, DMs | Signed in | Yes | LOCAL |
| R8 | `#/solo_chat` | One-to-one direct messages | Signed in | Yes (personal workspace) | LOCAL (render only) |
| R9 | `#/calendar` | Calendar, events, AI-detected commitments | Signed in | Yes | LOCAL |
| R10 | `#/meetings` | Video rooms, recordings, minutes | Signed in | Yes | LOCAL |
| R11 | `#/ai_agent` | AI copilot | Signed in | Yes | LOCAL (offline mode) |
| R12 | `#/finance` | Ledger, runway | Signed in | Yes | LOCAL |
| R13 | `#/code` | Code repositories, files, issues, commits | Signed in | Yes | LOCAL |
| R14 | `#/settings` | Workspace settings, members, AI key | Signed in | Yes | LOCAL (render only) |
| R15 | `#/files` | File manager | Signed in | **No** (URL only) — NX-BUG-016 | LOCAL (render only) |
| R16 | `#/reports` | Report synthesizer | Signed in | **No** (URL only) — NX-BUG-016 | LOCAL (render only) |
| R17 | Ctrl+K | Command palette / global search | Signed in | Keyboard / header | LOCAL |

Coverage: 17 of 17 discovered screens or dialogs inspected (13 signed-in screens plus 4 public views). 3 of 17 inspected on the live site; the 13 signed-in screens and the command palette were inspected only locally.

### 2.2 Backend API inventory [SOURCE]

95 HTTP operations plus 2 WebSocket endpoints, generated from the application's own OpenAPI definition:

| Area | Operations |
|---|---|
| Auth | `POST /auth/send-otp`, `POST /auth/verify-otp`, `POST /auth/register`, `POST /auth/login`, `POST /auth/google`, `GET /auth/google/config`, `GET /auth/me`, `GET /auth/users/search` |
| AI config | `GET /ai/config`, `PUT|DELETE /ai/config/gemini-key`, `POST /ai/config/test-gemini` |
| Workspaces | list/create/get/rename, join by code, members, regenerate code |
| Per-workspace modules | documents (7), tasks (5), channels and messages (9), calendar (6), finance (7), sessions (7), reports (4), repos/files/issues/commits (11), files (5), video rooms (4), AI chat/sessions/memory (8) |
| WebSockets | `/ws/workspaces/{id}/channels/{id}`, `/ws/workspaces/{id}/events`, plus `GET /ws/workspaces/{id}/presence` |
| Ops | `GET /health` |

All 82 API calls made by the frontend map to an existing backend route [SOURCE].

**Not implemented (feature gaps, NX-BUG-018):** password reset or change, profile editing, account deletion, leaving a workspace, removing members or changing roles, deleting a workspace, channel or message, editing messages, and pagination on list endpoints.

---

## 3. Feature-by-feature walkthrough

| Feature | Intended behaviour | What was tested | Worked | Failed / concerns | Not verified |
|---|---|---|---|---|---|
| **Landing page** [LIVE] | Explain the product, collect contact messages | Load, console, headings, buttons, mobile, contact handler | Loads in ~0.6 s; no layout overflow on mobile | Contact form discards messages (BUG-004); section nav uses buttons (A11Y-007); no mobile menu (BUG-015); Tailwind Play CDN in production (PERF-002) | Contact form not submitted live |
| **Registration** [LIVE+LOCAL] | Account with e-mail one-time code | Live: dialog only. Local: full flow | Local flow works; code checked, hashed, rate-limited, expires | Code written to server log without SMTP (SEC-004); account enumeration (SEC-007); production e-mail delivery unknown (RISK-001) | Live end-to-end BLOCKED |
| **Login / session** [LOCAL] | Login, keep session, expire | Reload persistence, invalid-token handling | Session and route survive reload; invalid token returns to landing | No forgot-password (BUG-018); token in `localStorage`, no server-side revocation (SEC-010) | Live login BLOCKED |
| **Google Sign-In** [LIVE] | One-tap Google login | Clicked "Continue with Google" (did not use the demo button) | — | Developer message and demo button shown to users; production rejects it (BUG-003); audience not checked (SEC-001) | — |
| **Dashboard** [LOCAL] | Overview of workspace activity | Load, counts, mobile | Counts match stored data (4 open tasks) | Runway card shows "0 Months" when finance data is corrupted (see BUG-010) | — |
| **Documents** [LOCAL] | Create, write, organise pages | Create, empty title, typing, autosave, Unicode, XSS payload, reload | Autosave persists; Unicode intact; HTML payload inert; reload keeps data | New pages start with literal placeholder text (BUG-012); preview looks editable but isn't (BUG-013); API accepts blank titles (BUG-009) | Templates, nesting UI, file import, export |
| **Tasks (Kanban)** [LOCAL] | Plan work across columns | Create, whitespace title, move, delete, review status, counts, mobile | Create and move persist; priority saved | `review` tasks invisible and counts wrong (BUG-006); no message on blank title (BUG-019); mobile search clipped (BUG-022) | Delete via UI BLOCKED (native confirm dialog auto-dismissed by test browser); drag-and-drop |
| **Channels / DMs** [LOCAL] | Team chat | Post, thread reply, reaction, 10,001-char limit, DM | All passed | API accepts blank channel names (BUG-009) | Real-time delivery to a second browser this audit (verified in earlier work) |
| **Calendar** [LOCAL] | Schedule events; AI suggests commitments | Create, update, delete, invalid date, suggestions | CRUD works | Fake "AI Detected Commitments" (BUG-002); invalid dates accepted (BUG-011); day cells not keyboard reachable (A11Y-004) | AI extraction with a live model |
| **Meetings / video** [LOCAL] | Rooms, recordings, minutes | Start and end room, create notes session, generate minutes | Room start works | Session create, end room and report fail on migrated SQLite (BUG-007); polls every second (PERF-004); no TURN server (REL-004) | Real camera/WebRTC between two browsers; audio upload |
| **Finance** [LOCAL] | Ledger and runway | Create, negative amount, huge amount, summary, UI | Create and negative-value rejection work | UI shows invented figures (BUG-001); unbounded amounts corrupt totals (BUG-010) | CSV export |
| **Reports** [LOCAL] | Generate executive reports | Generate | — | 500 on migrated SQLite (BUG-007); not in navigation (BUG-016) | Report content quality |
| **Code repos** [LOCAL] | Repos, files, issues, commits | Create each | All passed | — | Editor UI |
| **Files** [LOCAL] | Upload and download | Screen render | Renders | Not in navigation (BUG-016) | Upload/download not re-tested this audit |
| **AI copilot** [LOCAL] | Answer questions and act on workspace | Offline command | Offline command created the task | — | Live-model behaviour (no key on the audit instance) |
| **Settings / teams** [LOCAL] | Rename, members, join codes, roles | Create team, join, member rename/regenerate/delete attempts | Admin-only actions correctly blocked for members | Members can delete others' content (SEC-006); no member removal (BUG-018) | Settings UI interactions |
| **Command palette** [LOCAL] | Global search | Ctrl+K, search, Escape | Works; finds items across modules | — | — |
| **Header controls** [LOCAL] | Notifications, help, video | Notifications | — | Bell opens Calendar, not notifications (BUG-017) | Help, Start Video Meeting |

---

## 4. Bug register

Severity: **High** = core workflow broken or users misled about their own data; **Medium** = important defect with a workaround or limited scope; **Low** = minor or cosmetic.

### NX-BUG-001 — Finance screen displays invented figures
- **Severity:** High · **Area:** Finance (`#/finance`) · **Env:** [LOCAL], [SOURCE]
- **Reproduce:** Open Finance while the summary is loading or returns missing values (for example after NX-BUG-010).
- **Expected:** Real totals, a loading state, or an error.
- **Actual:** Cash balance **$125,000.00**, income **$45,000**, expenses **$18,500**, none of which exist in the data (observed: actual income $5,000).
- **Evidence:** `frontend/src/components/FinanceTracker.jsx:88-90` (`?? 125000`, `?? 45000`, `?? 18500`); screenshot taken 05:47 UTC.
- **Fix:** Remove numeric fallbacks; render "—" while loading and an error state on failure.
- **Regression test:** Component test with `financeSummary = null` and with null fields; assert no currency value is shown.

### NX-BUG-002 — "AI Detected Commitments" are hardcoded fake items
- **Severity:** High · **Area:** Calendar · **Env:** [LOCAL], [SOURCE]
- **Reproduce:** New workspace with no meetings or channels → open Calendar.
- **Expected:** Suggestions from `POST /calendar/detect-reminders` (returned `[]` here), or an empty state.
- **Actual:** Two items, "From #general Channel: Team sync on system architecture…" and "From PR Review: Security patch & authorization token audit", shown to every user.
- **Evidence:** `CalendarView.jsx:37-62` initial state.
- **Fix:** Initialise the list empty and populate it from the API response.
- **Regression test:** Mock an empty API response; assert the panel shows its empty state.

### NX-BUG-003 — Google Sign-In unusable in production
- **Severity:** High · **Area:** Sign In / Create Account · **Env:** [LIVE]
- **Reproduce:** https://nexamind-web.onrender.com → Sign In → "Continue with Google".
- **Actual:** A panel tells end users to "Set GOOGLE_CLIENT_ID in your backend .env" and offers "Sign in with Demo Google Account". `GET /auth/google/config` returns `{"client_id": null}`, and production rejects the demo token by design.
- **Evidence:** Live screenshot 05:38 UTC; `LandingPage.jsx` lines ~905–935; `auth_service.authenticate_google_user`.
- **Fix:** Configure `GOOGLE_CLIENT_ID` in production, or hide the Google button when it isn't configured. Never ship the demo-account button in production builds.
- **Regression test:** E2E with no client ID → button hidden; with client ID → One Tap initialises.

### NX-BUG-004 — Contact form silently discards messages
- **Severity:** High · **Area:** Landing → Contact · **Env:** [SOURCE] (not submitted live)
- **Actual:** `handleContactSubmit` shows "Thank you for reaching out. Our team will review your message and reply promptly", clears the form after 4 s, and sends nothing.
- **Evidence:** `LandingPage.jsx:302-310`.
- **Fix:** Add a backend endpoint (with rate limiting) that e-mails or stores messages, or replace the form with a `mailto:` link.
- **Regression test:** Submitting creates a stored record or sends an e-mail; failure shows an error.

### NX-BUG-005 — (merged into NX-RISK-001)

### NX-BUG-006 — Tasks in `review` status vanish from the board
- **Severity:** Medium · **Area:** Kanban · **Env:** [LOCAL]
- **Reproduce:** Create a task with `status: "review"` (the API, the AI copilot tool, and the data model all allow it) → open the board.
- **Actual:** The task appears in no column. The "All Columns" count shows 2 while the workspace holds 3 tasks. The command palette still finds it.
- **Fix:** Add a Review column, or map `review` into an existing column.
- **Regression test:** Render the board with one task per status; assert every task is visible and counts match.

### NX-BUG-007 — Meeting sessions, reports and video-meeting endings fail on migrated SQLite databases
- **Severity:** Medium (affects local development and any SQLite deployment; production uses PostgreSQL, not verified) · **Env:** [LOCAL]
- **Reproduce:** `alembic upgrade head` on a new SQLite file (as the README instructs) → create a meeting notes session, generate a report, or end a video room.
- **Actual:** HTTP 500, `sqlite3.OperationalError: unknown function: now()`.
- **Root cause:** Migrations 001–006 declare `server_default=sa.text("now()")`, which SQLite lacks. `SessionRecord` and `ReportRecord` depend on that default; other models supply timestamps in Python.
- **Why tests missed it:** The test suite builds tables with `create_all`, not from migrations.
- **Fix:** Use `sa.func.now()` / `CURRENT_TIMESTAMP` in a new migration, or give these models Python-side defaults. Add a CI job that runs the suite against a migrated database.

### NX-BUG-008 — Local server fails after pulling new migrations
- **Severity:** Low (developer experience) · **Env:** [LOCAL]
- **Actual:** The local database was at revision 007 while the code expects 008. Login returned HTTP 500 (`no such column users.is_email_verified`), and with local `DEBUG=true` the raw SQL appeared in the response.
- **Fix:** Document "run `alembic upgrade head` after pulling"; make the dev launcher run migrations (as `start_nexamind.bat` already does).

### NX-BUG-009 — API stores blank names from whitespace input
- **Severity:** Medium · **Env:** [LOCAL]
- **Reproduce:** POST `"   "` as a task title, document title, channel name, workspace name, or transaction category.
- **Actual:** HTTP 201 with an empty string stored for all five. Length is validated before trimming.
- **Fix:** Trim in schema validators (`str_strip_whitespace=True`) before `min_length`.
- **Regression test:** Parametrised API test expecting 422 for whitespace-only values.

### NX-BUG-010 — Unbounded amounts corrupt finance totals
- **Severity:** Medium · **Env:** [LOCAL]
- **Reproduce:** Record two expenses of `1e308` → `GET /finance/summary`.
- **Actual:** `total_expenses`, `net_burn_rate` and `cash_balance` become `null` (float overflow), which then triggers NX-BUG-001's invented figures. Any member can do this.
- **Fix:** Cap amounts (for example ≤ 1e12) and store money as `Decimal`/integer cents.

### NX-BUG-011 — Calendar accepts invalid dates
- **Severity:** Low · **Env:** [LOCAL]
- **Actual:** `event_date: "not-a-date"` accepted (201) and returned in listings.
- **Fix:** Type the field as `date` or validate ISO format.

### NX-BUG-012 — New documents start with placeholder text saved as real content
- **Severity:** Medium · **Env:** [LOCAL]
- **Actual:** Body contains `# <title>` followed by "Start writing directly here...". It is saved, counted ("5 words"), and indexed into AI memory.
- **Evidence:** `Documents.jsx:348`.
- **Fix:** Create with an empty body and use the textarea `placeholder` attribute.

### NX-BUG-013 — Document editor shows a read-only preview where users expect to type
- **Severity:** Medium (UX) · **Env:** [LOCAL]
- **Actual:** The first visible area ("Live formatted preview") looks editable but ignores input. The real textarea sits below the fold, so typing after clicking the visible area is lost.
- **Fix:** Put the editable area first or make the preview editable; label the preview clearly.

### NX-BUG-014 — No module navigation on phones (signed-in app)
- **Severity:** Medium · **Env:** [LOCAL] at 375×812
- **Actual:** The activity rail and sidebar are hidden (0 px wide) and no menu replaces them. Users can't move between Docs, Tasks, Chat, Calendar and the rest except by editing the URL.
- **Fix:** Add a bottom tab bar or hamburger drawer below the `md` breakpoint.

### NX-BUG-015 — No section menu on phones (landing page)
- **Severity:** Low · **Env:** [LIVE] at 375×812
- **Actual:** Product, AI Memory, About and Contact links are hidden with no replacement.

### NX-BUG-016 — Files and Reports not reachable from navigation
- **Severity:** Medium · **Env:** [LOCAL]
- **Actual:** The rail shows Activity, Docs, Chat, Tasks, Calendar, Meet, Copilot, Repos, Finance, Settings. `#/files` and `#/reports` render only when typed into the URL.
- **Fix:** Add rail entries (both already exist in `lib/navigation.js`).

### NX-BUG-017 — "Notifications" button opens the Calendar
- **Severity:** Low · **Env:** [LOCAL] · **Fix:** Rename it, or build a notification panel.

### NX-BUG-018 — Missing account and team lifecycle features
- **Severity:** Low individually; together they block real-world use · **Env:** [SOURCE]
- **Missing:** password reset (no "Forgot password"), password change, profile edit, account deletion, leave workspace, remove member, change role, delete workspace/channel/message, edit message, list pagination.

### NX-BUG-019 — Blank task title rejected without feedback
- **Severity:** Low · **Env:** [LOCAL] · **Actual:** Dialog stays open with no message. **Fix:** Inline validation message.

### NX-BUG-020 — Duplicate requests on load
- **Severity:** Low · **Env:** [LOCAL] (dev build) · **Actual:** `GET /auth/google/config` and `GET /workspaces` each fire twice per load. Partly explained by React development double-mounting; confirm in a production build.

### NX-BUG-021 — Inconsistent confirmation dialogs
- **Severity:** Low · **Env:** [SOURCE] · **Actual:** 51 native `alert()`/`confirm()` calls alongside a custom styled dialog in other places. Native dialogs block the page, ignore the theme, and cannot be automated in tests.

### NX-BUG-022 — Kanban search box clipped on phones
- **Severity:** Low · **Env:** [LOCAL] at 375 px.

### NX-BUG-023 — Outdated marketing claims
- **Severity:** Informational · **Env:** [LIVE] · Landing advertises "Gemini 2.0"; the code uses `gemini-flash-latest` family models.

---

## 5. Security findings

CVSS v3.1 base scores are estimates from source and configuration evidence. **None of these was exploited against production.**

### NX-SEC-001 — Google ID-token audience not verified in production
- **Severity:** High · CVSS 3.1 ≈ 7.5 (AV:N/AC:H/PR:N/UI:R/S:U/C:H/I:H/A:N; assumes the attacker runs another Google-Sign-In site the victim uses)
- **Component:** `POST /auth/google` → `auth_service.authenticate_google_user`
- **Evidence:** [LIVE] `GET /auth/google/config` → `{"client_id": null}`. [SOURCE] The `aud` check runs only `if google_client_id`.
- **Impact:** Google ID tokens are bearer tokens scoped to the app they were issued for. Without the audience check, a token issued to *any* other app is accepted here, and the user is matched by e-mail. A malicious or compromised third-party site could sign in as its visitors' NexaMind accounts.
- **Remediation:** Make the audience check mandatory: reject when the client ID isn't configured, verify `aud`, `iss`, and `exp` locally with Google's public keys, and disable the endpoint entirely until configured.
- **Verify:** Token with a foreign `aud` → 401; endpoint returns 503 when not configured.

### NX-SEC-002 — Rate limits bypassable with a forged `X-Forwarded-For` header
- **Severity:** Medium · CVSS 3.1 ≈ 6.5 (AV:N/AC:L/PR:N/UI:N/S:U/C:L/I:L/A:N)
- **Component:** `backend/Dockerfile` CMD uses `--proxy-headers --forwarded-allow-ips='*'`. With `*`, uvicorn takes the **leftmost** `X-Forwarded-For` entry, which the client controls (`uvicorn/middleware/proxy_headers.py`, `always_trust` branch).
- **Impact:** Each request can claim a new IP, giving it a fresh bucket in `app/security.py`'s limiter. Login and OTP-verification brute-force limits (10/min) and copilot cost limits (20/min) stop working. OTP e-mails can be sent to arbitrary addresses at volume (within the 5-per-address cap).
- **Note:** This configuration was introduced during the earlier hardening pass (auditor's own change).
- **Remediation:** Trust only Render's proxy range in `--forwarded-allow-ips`, or have the rate limiter read the rightmost untrusted hop. Add per-account limits on login and OTP in addition to per-IP limits.
- **Verify:** Two requests with different forged `X-Forwarded-For` values count against the same limit.

### NX-SEC-003 — Development-only authentication shortcuts guarded by a single environment variable
- **Severity:** Medium (latent) · **Component:** `auth_service.create_and_send_otp`, `authenticate_google_user`, `LandingPage.jsx`
- **Evidence:** [SOURCE] In development mode the OTP is returned in the API response (`dev_code`), and credentials starting `mock_google_:` log in as any e-mail address. [LIVE] Production appears correctly configured (`APP_ENV=production` in `render.yaml`; `/docs` returns 404, which only happens outside development).
- **Impact if misconfigured:** Complete account takeover and verification bypass. The frontend also ships the demo-login button to production users (NX-BUG-003).
- **Remediation:** Gate both shortcuts on an explicit `ENABLE_DEV_AUTH=true` flag, refuse that flag when `APP_ENV=production`, and strip the demo button from production builds.

### NX-SEC-004 — OTP codes written to server logs when SMTP is not configured
- **Severity:** Medium · **Evidence:** [LOCAL] The code appeared twice in the server log, including in the logged e-mail subject (`email_service.send_email`).
- **Impact:** Anyone with log access can verify any e-mail address. In production this applies if SMTP is unset (see NX-RISK-001).
- **Remediation:** Never log codes; in production, fail the request when e-mail can't be sent.

### NX-SEC-005 — Third-party scripts without integrity checks, and no CSP or clickjacking protection on the frontend
- **Severity:** Medium · **Evidence:** [LIVE] `index.html` loads `https://cdn.tailwindcss.com` and `https://accounts.google.com/gsi/client`; `index.css` imports Tailwind from jsDelivr. There is no `integrity` attribute and the frontend response has no `Content-Security-Policy` or `X-Frame-Options` (the API does have them).
- **Impact:** The bearer token lives in `localStorage`. A compromise of either CDN, or any XSS, gives full account access. The app can also be framed for clickjacking.
- **Remediation:** Build Tailwind at compile time (removing two of the three CDN dependencies). Add a CSP plus `frame-ancestors 'none'` via Render static-site headers. Consider moving the token to an `HttpOnly` cookie.

### NX-SEC-006 — No ownership or role checks on destructive actions inside a team
- **Severity:** Medium · **Evidence:** [LOCAL] A member account deleted the owner's document (`DELETE …/documents/{id}` → 204). Renaming the workspace and regenerating codes were correctly limited to admins (403).
- **Impact:** Any member, including one who joined with a shared code, can delete documents and (per the same service pattern [SOURCE]) tasks, files, transactions, sessions, reports and events created by others.
- **Remediation:** Allow delete for the author or an admin/owner only; add an audit log and soft-delete.

### NX-SEC-007 — Account enumeration
- **Severity:** Low · **Evidence:** [SOURCE] `/auth/send-otp` and `/auth/register` return 409 "An account with this email already exists". Not tested live.
- **Remediation:** Return a neutral response and send an "already registered" e-mail instead.

### NX-SEC-008 — PyJWT version has published advisories
- **Severity:** Low (individual advisory severities not assessed) · **Evidence:** [SOURCE] `pip-audit`: 16 advisories against `pyjwt==2.10.1`; fixed by **2.15.0**. The other 37 Python packages: none. `npm audit --omit=dev`: 0 vulnerabilities.
- **Remediation:** Upgrade PyJWT; run `pip-audit` and `npm audit` in CI.

### NX-SEC-009 — Tokens cannot be revoked
- **Severity:** Low · **Evidence:** [SOURCE] Stateless 60-minute JWTs in `localStorage`; logout only deletes the local copy.
- **Remediation:** Short-lived access tokens with refresh rotation, or a server-side deny-list on logout and password change.

### NX-SEC-010 — Minor hardening (Informational)
- `HEAD /health` returns 405, which breaks some uptime monitors.
- The API discloses `x-render-origin-server: uvicorn`.
- Local `DEBUG=true` returns raw SQL in 500 responses (production `DEBUG=false`).

### Security checks that passed

| Check | Result | Env |
|---|---|---|
| CORS | Only `https://nexamind-web.onrender.com` allowed; foreign and `null` origins rejected (400) | LIVE |
| API security headers | CSP, `X-Frame-Options: DENY`, `nosniff`, Referrer-Policy, HSTS | LIVE |
| Frontend HSTS | `max-age=315360000; includeSubdomains; preload` | LIVE |
| API docs | `/docs`, `/redoc`, `/openapi.json` → 404 | LIVE |
| Unauthenticated access | `/auth/me`, `/workspaces`, `/ai/config`, workspace documents → 401 | LIVE |
| Error disclosure | 404/401 bodies contain no stack traces | LIVE |
| Secrets in bundle | No API keys or tokens in the 314 KB main bundle; no source maps | LIVE |
| Cross-user isolation | 22/22 checks: outsiders, DM recipients, non-members of private channels, forged/missing tokens all refused; no planted data leaked | LOCAL harness |
| Stored XSS (documents) | `<img src=x onerror=…>` stored as text, not rendered as an element | LOCAL |
| Input size | Channel message over 10,000 chars → 422 | LOCAL |
| Session handling | Invalid token → session cleared, user returned to sign-in | LOCAL |
| Backend tests | 76/76 pass | SOURCE |

### Security checks not completed

Live authenticated testing (BLOCKED). Live rate-limit verification (not attempted on production by policy). SSRF, path traversal, and file-upload abuse against production (not attempted). Production log, SMTP and secret configuration (no access). Manual review of each PyJWT advisory.

---

## 6. UI/UX and accessibility findings (target: WCAG 2.2 AA)

Automated scan of 13 signed-in screens [LOCAL] and the landing page [LIVE], plus source review. **No manual screen-reader or assistive-technology testing was done.**

| ID | Finding | Evidence | Impact | Recommendation |
|---|---|---|---|---|
| NX-A11Y-001 | No form field has a programmatic label | 35/35 signed-in fields; 6/6 landing fields (placeholders only) | Screen readers announce unlabeled edits (WCAG 1.3.1, 4.1.2, 3.3.2) | Add `<label htmlFor>` or `aria-label` |
| NX-A11Y-002 | Keyboard focus mostly invisible | `outline-none` ×64 vs focus styles ×5 [SOURCE] | Keyboard users lose their place (2.4.7, 2.4.11) | Global `:focus-visible` ring |
| NX-A11Y-003 | Dialogs not announced or trapped | Sign-in: no `role="dialog"`/`aria-modal`, focus stays behind, **Escape doesn't close** [LIVE] | 2.1.2, 2.4.3, 4.1.2 | Shared accessible Modal component |
| NX-A11Y-004 | Calendar days not keyboard operable | 34 clickable non-focusable cells | Keyboard users can't pick dates (2.1.1) | Use buttons or a grid with roving tabindex |
| NX-A11Y-005 | Icon-only buttons without names | 8 across Calendar (4), Channels (2), Copilot (1), Solo Chat (1) | 4.1.2 | Add `aria-label` |
| NX-A11Y-006 | Heading structure | No `<h1>` on Dashboard, Channels, Files, Reports; two on Calendar | Navigation by headings (1.3.1) | One `<h1>` per screen |
| NX-A11Y-007 | Landing navigation uses buttons, no links | 15 buttons, 0 `<a>` elements | No shareable URLs, no open-in-new-tab, weaker SEO | Use anchors with `#section` hrefs |
| NX-A11Y-008 | Very small text | 9–22 text elements under 11 px per screen | Readability (1.4.4); contrast not measured | Minimum 12 px; measure contrast with a tool |
| NX-A11Y-009 | ARIA almost absent | Whole frontend: 4 `aria-*` attributes, 3 `role` attributes [SOURCE] | Widespread semantic gaps | Adopt accessible primitives |
| NX-UX-001 | Logout hidden in bottom-left avatar menu | LOCAL | Discoverability | Add it to the header avatar too |
| NX-UX-002 | Mobile navigation missing | NX-BUG-014/015 | — | — |

Positive: no horizontal overflow on any screen at desktop width or on the landing page at 375 px; images have `alt` text; `lang="en"` is set.

---

## 7. Performance report

**Conditions:** Desktop viewport in an embedded Chromium browser pane on a Windows 11 laptop, residential broadband, warm Cloudflare cache, 05:40 UTC. LCP couldn't be captured because the pane ran in the background, so treat that figure as not measured.

| Metric (live landing) | Result |
|---|---|
| Time to first byte | 354 ms |
| DOMContentLoaded | 587 ms |
| Load event | 603 ms |
| Cumulative Layout Shift | 0 |
| Long tasks | none recorded |
| Requests | 9 |
| Main JS bundle | 307 KB decoded / 88.6 KB gzip |
| Largest lazy chunk | `FormattedChatMessage` 104 KB gzip (KaTeX) |
| Live API `/health` | 0.32–0.34 s |

| ID | Finding | Evidence | Recommendation |
|---|---|---|---|
| NX-PERF-001 | **Full Tailwind 2.2.19 stylesheet imported from jsDelivr**: 2,865 KB decoded, render-blocking, loaded *after* the app CSS (a chained `@import`) | `src/index.css:1`; resource timing | Delete the import; Tailwind 3 is already compiled in |
| NX-PERF-002 | **Tailwind Play CDN script in production**, compiling CSS in the browser at runtime (console warning confirms) | `index.html`; live console | Remove; move the custom colours into `tailwind.config.js` |
| NX-PERF-003 | Three Tailwind systems on one page (v2 CDN CSS, Play CDN, compiled v3) | as above | Keep only the compiled build; also avoids style conflicts |
| NX-PERF-004 | Meetings screen polls `GET /video/rooms` **every 1 s** while open | `Meetings.jsx:149` | Use the existing WebSocket events, or poll every 10–15 s |
| NX-PERF-005 | Reminder detection runs every 60 s in every open tab; with an AI key that's one model call per user per minute | `AiReminderToast.jsx:73` | Run server-side on content changes; cache results |
| NX-PERF-006 | List endpoints have no pagination | API inventory | Add `limit`/`cursor` before workspaces grow |
| NX-PERF-007 | Backend latency healthy at small scale [LOCAL, in-process] | Medians: list documents 13.6 ms, create task 14.4 ms, post message 17.9 ms, offline copilot 36.9 ms (200 runs each) | — |

Not measured: production backend under load, cold-start time on Render's free tier, memory growth over long sessions.

---

## 8. Backend, architecture and operations findings

**Directly verified defects:** NX-BUG-007 (migration defaults), NX-BUG-009/010/011 (validation), NX-SEC-001–004 and 006.

**Evidence-supported concerns:**

| ID | Concern | Evidence | Recommendation |
|---|---|---|---|
| NX-REL-001 | **Free Render PostgreSQL expires after 30 days** | `render.yaml` comment: "Free Postgres: 1 GB, expires after 30 days" | Upgrade before real users arrive, or schedule exports; this is a data-loss risk |
| NX-REL-002 | Uploaded files live on ephemeral disk, lost on every deploy | `render.yaml` (persistent disk commented out) | Persistent disk or object storage (S3/R2) |
| NX-REL-003 | No documented backups or restore procedure | No evidence found | Automated daily dumps plus a tested restore |
| NX-REL-004 | WebRTC uses STUN only, no TURN relay | `Meetings.jsx:42-44` | Video calls will fail for many corporate and mobile networks; add TURN |
| NX-REL-005 | Tests don't run against migrated schemas | Explains NX-BUG-007 | CI job: `alembic upgrade head` on SQLite and PostgreSQL, then run the tests |
| NX-REL-006 | No error monitoring | No Sentry or similar found | Add error reporting for frontend and backend |
| NX-REL-007 | Rate limiter and real-time state are per process | `app/security.py`, `websocket_manager` | Fine on one instance; set `REDIS_URL` and a shared limiter before scaling |
| NX-REL-008 | Very large components | `Meetings.jsx` ~1,760 lines, `Documents.jsx` ~1,500, `LandingPage.jsx` grew 555 lines in recent commits | Split before adding features; add frontend tests (none exist) |

**Needs verification (risks):**

| ID | Risk | What would confirm it |
|---|---|---|
| NX-RISK-001 | **Production may be unable to send registration e-mails.** `render.yaml` defines no SMTP variables and `REQUIRE_EMAIL_VERIFICATION` defaults to true. If SMTP isn't set in the Render dashboard, no new user can register by e-mail, and Google sign-in is also unavailable (NX-BUG-003). | Check Render environment variables, or attempt one registration with an inbox you control |
| NX-RISK-002 | Production PostgreSQL unaffected by NX-BUG-007 | `now()` is valid in PostgreSQL; confirm by creating a meeting session in production |

---

## 9. Test execution summary

See the full matrix in Appendix A. Counts are computed from that table.

| Status | Count |
|---|---|
| PASS | **45** |
| FAIL | **38** |
| BLOCKED | **4** |
| NOT TESTED | **5** |
| **Total test cases** | **92** |

| Coverage measure | Result |
|---|---|
| Discovered screens/dialogs inspected | 17 / 17 (live: 3 / 17) |
| Backend HTTP operations exercised by the audit harnesses or scripts | ~50 (counted from audit scripts and request logs) / 95 |
| Major workflows tested end-to-end (registration, documents, tasks, channels, calendar, finance, meetings, reports, repos, copilot, teams, session expiry) | 12 / 15 (not done: file upload/download, live-model copilot, real-time delivery between two browsers) |
| Security categories completed (of the 6 in the brief: authentication, authorization, common web vulnerabilities, sensitive data exposure, API security, dependencies) | 6 / 6 partially; live authenticated portions BLOCKED |

BLOCKED and NOT TESTED cases are not counted as passes.

---

## 10. Prioritized remediation roadmap

| Priority | Items | Dependencies | Verification | Rationale |
|---|---|---|---|---|
| **P0 — Immediate** | NX-SEC-001 (Google audience), NX-SEC-002 (forwarded-IP trust) | None | Foreign-`aud` token → 401; forged XFF shares one bucket | Account takeover path; brute-force protection currently ineffective |
| **P0** | NX-RISK-001: confirm production SMTP | Render dashboard access | One real registration completes | If unset, nobody can sign up |
| **P1 — High** | NX-BUG-001, NX-BUG-002 (invented data), NX-BUG-003 (Google UI), NX-BUG-004 (contact form), NX-SEC-004 (codes in logs), NX-SEC-003 (dev shortcuts flag), NX-REL-001 (DB expiry), NX-REL-002 (file storage) | BUG-003 depends on SEC-001 | Component tests showing no fallback values; a stored contact message; log scan finds no 6-digit codes | Users currently see false information or lose data |
| **P2 — Medium** | NX-SEC-005 (CSP/SRI, remove CDNs; also fixes PERF-001–003), NX-SEC-006 (role checks), NX-BUG-006, 007, 009, 010, 012, 013, 014, 016, NX-A11Y-001–004, NX-REL-004, 005 | BUG-007 fix plus REL-005 CI job together | Migrated-DB CI green; a11y re-scan shows 0 unlabeled fields | Integrity, accessibility barriers, reliability |
| **P3 — Low** | NX-BUG-011, 015, 017, 019, 020, 021, 022, NX-SEC-007, 008, 009, 010, NX-A11Y-005–009, NX-PERF-004, 005 | — | Targeted tests per item | Polish and defence-in-depth |
| **P4 — Future** | NX-BUG-018 (account/team lifecycle), NX-PERF-006 (pagination), NX-REL-006–008 (monitoring, scaling, refactor), Redis for multi-instance, TURN server | — | — | Product completeness and scale |

No effort estimates are given; the evidence doesn't support reliable ones.

---

## 11. Final readiness assessment

| Dimension | Status |
|---|---|
| **Functional readiness** | Core collaboration features work locally. Several screens show invented data, and Google sign-in and the contact form don't work. **Not ready.** |
| **Security assessment** | Strong isolation between users and workspaces. Two serious authentication issues (SEC-001, SEC-002) need fixing first. Live authenticated testing was blocked. **Partially assessed; release-blocking issues found.** |
| **Accessibility assessment** | Automated plus source review only. Systemic gaps (labels, focus, dialogs, keyboard). **Not WCAG 2.2 AA conformant within the tested scope.** |
| **Performance assessment** | Fast at current scale; easy wins in CSS delivery. Production load and cold starts not measured. **Acceptable for testing.** |
| **Reliability assessment** | Database expiry, ephemeral uploads, no backups or monitoring. **Not ready for real user data.** |
| **Overall recommendation** | **Release blocked pending specified high-risk fixes** (P0 and P1 above). Suitable for further controlled testing once P0 is resolved. |

---

## 12. Evidence appendix

### Appendix A — Test matrix

| ID | Module | Test | Env | Expected | Actual | Status | Sev | Ref |
|---|---|---|---|---|---|---|---|---|
| T-001 | Landing | Page loads | LIVE | 200, content renders | 200 in 0.73 s; content renders | PASS | | |
| T-002 | Landing | No production console warnings | LIVE | Clean console | Tailwind "should not be used in production" warning | FAIL | Low | PERF-002 |
| T-003 | Landing | Section nav scrolls to sections | LIVE | Each button scrolls | Not clicked; source handler reviewed only | NOT TESTED | | |
| T-004 | Landing | Contact form delivers message | SOURCE | Message stored or sent | Discarded; success shown | FAIL | High | BUG-004 |
| T-005 | Auth | Sign-in dialog opens | LIVE | Dialog shown | Shown | PASS | | |
| T-006 | Auth | Escape closes dialog | LIVE | Closes | Stays open | FAIL | Med | A11Y-003 |
| T-007 | Auth | Dialog semantics and focus | LIVE | role=dialog, focus moved | Neither | FAIL | Med | A11Y-003 |
| T-008 | Auth | Forgot-password available | LIVE | Link present | Absent | FAIL | Low | BUG-018 |
| T-009 | Auth | Registration view renders | LIVE | Form shown | Shown, with code step | PASS | | |
| T-010 | Auth | Live registration end-to-end | LIVE | Account created | Not attempted: production account creation not authorized; requires real inbox | BLOCKED | | |
| T-011 | Auth | Live login | LIVE | Signed in | No authorized live account | BLOCKED | | |
| T-012 | Auth | Google sign-in in production | LIVE | Google prompt | Developer message + demo button | FAIL | High | BUG-003 |
| T-013 | Landing | Mobile layout, no horizontal scroll | LIVE | Fits 375 px | Fits | PASS | | |
| T-014 | Landing | Mobile navigation menu | LIVE | Menu available | None | FAIL | Low | BUG-015 |
| T-015 | API | `/health` | LIVE | 200 | 200 | PASS | | |
| T-016 | API | Docs disabled in production | LIVE | 404 | 404 ×3 | PASS | | |
| T-017 | API | Protected endpoints require auth | LIVE | 401 | 401 ×4 | PASS | | |
| T-018 | API | Errors hide internals | LIVE | Generic body | Generic | PASS | | |
| T-019 | API | CORS allows frontend origin | LIVE | Allowed | Allowed | PASS | | |
| T-020 | API | CORS rejects foreign/null origins | LIVE | Rejected | 400, no allow-origin | PASS | | |
| T-021 | API | Security headers | LIVE | Present | CSP, XFO, nosniff, HSTS, Referrer-Policy | PASS | | |
| T-022 | Frontend | CSP / X-Frame-Options | LIVE | Present | Absent | FAIL | Med | SEC-005 |
| T-023 | Frontend | HSTS | LIVE | Present | Present | PASS | | |
| T-024 | Frontend | No secrets in bundle | LIVE | None | None found | PASS | | |
| T-025 | Frontend | No source maps | LIVE | None | None | PASS | | |
| T-026 | API | `HEAD /health` | LIVE | 200 | 405 | FAIL | Low | SEC-010 |
| T-027 | Frontend | No render-blocking third-party CSS | LIVE | None | 2.9 MB Tailwind v2 import | FAIL | Med | PERF-001 |
| T-028 | Backend | Test suite | SOURCE | All pass | 76/76 | PASS | | |
| T-029 | Backend | Access-control harness | LOCAL | All refused | 22/22 | PASS | | |
| T-030 | Deps | npm audit (runtime) | SOURCE | 0 | 0 | PASS | | |
| T-031 | Deps | pip-audit | SOURCE | 0 | PyJWT: 16 advisories | FAIL | Low | SEC-008 |
| T-032 | Security | Rate limiter uses trusted client IP | SOURCE | Proxy-verified IP | Client-controlled leftmost XFF | FAIL | Med | SEC-002 |
| T-033 | Security | Google `aud` verified | LIVE+SOURCE | Verified | Skipped (client_id null) | FAIL | High | SEC-001 |
| T-034 | Security | Dev auth shortcuts off in production | LIVE+SOURCE | Off | Off (APP_ENV=production) — latent risk noted | PASS | | SEC-003 |
| T-035 | Security | OTP not logged | LOCAL | Absent from logs | Present ×2 | FAIL | Med | SEC-004 |
| T-036 | Security | No account enumeration | SOURCE | Neutral responses | 409 "already exists" | FAIL | Low | SEC-007 |
| T-037 | Frontend | API calls match backend routes | SOURCE | All match | 82/82 | PASS | | |
| T-038 | Dev env | Login on un-migrated local DB | LOCAL | Works or clear error | 500 with raw SQL | FAIL | Low | BUG-008 |
| T-039 | Auth | Registration with code (dev) | LOCAL | Account created | Created, signed in | PASS | | |
| T-040 | Dashboard | Loads after sign-up | LOCAL | Renders | Renders | PASS | | |
| T-041 | Documents | Create with empty title | LOCAL | Created as Untitled | Created | PASS | | |
| T-042 | Documents | New page body empty | LOCAL | Empty | Placeholder text saved | FAIL | Med | BUG-012 |
| T-043 | Documents | Visible editing area accepts input | LOCAL | Typing works | Preview ignores input | FAIL | Med | BUG-013 |
| T-044 | Documents | Autosave persists | LOCAL | Saved | Saved | PASS | | |
| T-045 | Documents | Unicode preserved | LOCAL | Intact | Intact | PASS | | |
| T-046 | Documents | HTML payload inert | LOCAL | Not executed | Not rendered as element | PASS | | |
| T-047 | App | Reload keeps data, session, route | LOCAL | All kept | All kept | PASS | | |
| T-048 | Tasks | Create task via UI | LOCAL | Appears | Appears | PASS | | |
| T-049 | Tasks | Blank title shows error | LOCAL | Message | Silent | FAIL | Low | BUG-019 |
| T-050 | API | Whitespace names rejected (5 entities) | LOCAL | 422 | 201, empty stored | FAIL | Med | BUG-009 |
| T-051 | Tasks | Status change persists | LOCAL | Persisted | Persisted | PASS | | |
| T-052 | Tasks | `review` task visible | LOCAL | Visible | Invisible | FAIL | Med | BUG-006 |
| T-053 | Tasks | Board counts match data | LOCAL | 3 | 2 | FAIL | Med | BUG-006 |
| T-054 | Tasks | Delete via UI | LOCAL | Deleted | Native confirm auto-dismissed by test browser | BLOCKED | | BUG-021 |
| T-055 | Teams | Create team, join by code | LOCAL | Works | Works | PASS | | |
| T-056 | Teams | Member can't delete owner's doc | LOCAL | 403 | 204 | FAIL | Med | SEC-006 |
| T-057 | Teams | Member can't rename workspace | LOCAL | 403 | 403 | PASS | | |
| T-058 | Teams | Member can't regenerate code | LOCAL | 403 | 403 | PASS | | |
| T-059 | Channels | Post, thread reply, react | LOCAL | Work | Work | PASS | | |
| T-060 | Channels | Over-length message rejected | LOCAL | 422 | 422 | PASS | | |
| T-061 | Channels | Create DM | LOCAL | Works | Works | PASS | | |
| T-062 | Calendar | Create, update, delete event | LOCAL | Work | Work | PASS | | |
| T-063 | Calendar | Invalid date rejected | LOCAL | 422 | 201 | FAIL | Low | BUG-011 |
| T-064 | Calendar | AI suggestions reflect data | LOCAL | Empty (API `[]`) | 2 hardcoded items | FAIL | High | BUG-002 |
| T-065 | Finance | Create transaction | LOCAL | 201 | 201 | PASS | | |
| T-066 | Finance | Negative amount rejected | LOCAL | 422 | 422 | PASS | | |
| T-067 | Finance | Huge amount rejected | LOCAL | 422 | 201; totals → null | FAIL | Med | BUG-010 |
| T-068 | Finance | UI shows true values | LOCAL | Real or "—" | $125,000 invented | FAIL | High | BUG-001 |
| T-069 | Meetings | Create notes session (migrated SQLite) | LOCAL | 201 | 500 | FAIL | Med | BUG-007 |
| T-070 | Meetings | Generate minutes | LOCAL | Minutes | Depends on T-069 | BLOCKED | | |
| T-071 | Reports | Generate report (migrated SQLite) | LOCAL | 201 | 500 | FAIL | Med | BUG-007 |
| T-072 | Repos | Repo, file, issue, commit | LOCAL | 201 ×4 | 201 ×4 | PASS | | |
| T-073 | Copilot | Offline command creates task | LOCAL | Task created | Created | PASS | | |
| T-074 | Search | Document search | LOCAL | Results | Results | PASS | | |
| T-075 | Privacy | User search hides strangers | SOURCE | Hidden | Covered by `test_security.py` (passing) | PASS | | |
| T-076 | Video | Start room | LOCAL | 201 | 201 | PASS | | |
| T-077 | Video | End room (migrated SQLite) | LOCAL | Session saved | 500 | FAIL | Med | BUG-007 |
| T-078 | App | All 13 signed-in screens render | LOCAL | Render | Render | PASS | | |
| T-079 | Nav | Files & Reports in navigation | LOCAL | Present | Absent | FAIL | Med | BUG-016 |
| T-080 | Header | Notifications button | LOCAL | Notification list | Opens Calendar | FAIL | Low | BUG-017 |
| T-081 | Auth | Logout clears session | LOCAL | Signed out | Control located; not clicked | NOT TESTED | | |
| T-082 | Auth | Invalid session handled | LOCAL | Returned to sign-in | Returned; token cleared | PASS | | |
| T-083 | Search | Command palette | LOCAL | Opens, searches, Esc closes | All work | PASS | | |
| T-084 | Mobile | Signed-in module navigation | LOCAL | Available | None | FAIL | Med | BUG-014 |
| T-085 | Mobile | Kanban layout | LOCAL | Fits | Search clipped | FAIL | Low | BUG-022 |
| T-086 | A11y | Form fields labelled | LOCAL | All | 0 / 35 | FAIL | Med | A11Y-001 |
| T-087 | A11y | Visible focus | SOURCE | Present | Mostly removed | FAIL | Med | A11Y-002 |
| T-088 | A11y | Calendar keyboard operable | LOCAL | Yes | No | FAIL | Med | A11Y-004 |
| T-089 | Files | Upload & download | LOCAL | Work | Not re-tested in this audit | NOT TESTED | | |
| T-090 | Real-time | Message delivered to second browser | LOCAL | Delivered | Not tested in this audit | NOT TESTED | | |
| T-091 | Copilot | Live-model behaviour | LOCAL | Acts correctly | No AI key on audit instance | NOT TESTED | | |
| T-092 | Account | Profile edit / account deletion | SOURCE | Available | Not implemented | FAIL | Low | BUG-018 |

### Appendix B — Evidence log (UTC, 2026-10-22)

| Time | Evidence |
|---|---|
| 05:32:56 | Audit start; repo at `de82b2b`; live frontend `200` in 0.73 s; frontend headers lack CSP/XFO |
| 05:33 | `index.html` loads `cdn.tailwindcss.com` and `accounts.google.com/gsi/client` without `integrity` |
| 05:34 | Main bundle `index-C0NrupYR.js` (314,021 bytes): API host `nexamind-api-rh1j.onrender.com`; 0 key patterns; 0 `sourceMappingURL`; 25 lazy chunks |
| 05:35 | API probes: `/health` 200; `/docs`, `/redoc`, `/openapi.json`, `/admin`, `/.env` 404; protected endpoints 401; `HEAD /health` 405 |
| 05:36 | CORS: allowed origin echoed; `evil.example.com` and `null` → 400 without `access-control-allow-origin` |
| 05:37 | Landing DOM: 15 buttons, 0 links, 6 unlabeled inputs; sign-in dialog lacks `role="dialog"`; Escape does not close |
| 05:38 | `GET /auth/google/config` → `{"client_id": null}`; Google panel shows developer instructions |
| 05:40 | Resource timing: `tailwind.min.css` v2.2.19 from jsDelivr, 2,865 KB decoded; TTFB 354 ms; DCL 587 ms; CLS 0 |
| 05:41 | Mobile 375×812: no overflow; section navigation hidden with no menu |
| 05:42 | `pytest`: 76 passed. Access harness: 22/22. `npm audit --omit=dev`: 0. `pip-audit`: PyJWT 2.10.1 (16 advisories, fix 2.15.0) |
| 05:43 | `uvicorn/middleware/proxy_headers.py`: with `forwarded_allow_ips="*"`, client = `x_forwarded_for_hosts[0]` |
| 05:44 | Local DB at 007 vs code 008 → login 500 (`users.is_email_verified` missing) |
| 05:45 | Fresh scratch DB migrated to 008; dev OTP flow returns code; code present ×2 in server log (subject line) |
| 05:46 | Documents: placeholder body saved; autosave, Unicode, inert XSS confirmed; reload persistence confirmed |
| 05:47 | Kanban: `review` task invisible, count 2 vs 3; whitespace names stored for 5 entities |
| 05:48 | Scripted pass (34 checks): member deletes owner doc 204; invalid date 201; 1e308 amount 201; sessions/report/video-end 500 (`unknown function: now()`) |
| 05:49 | Finance UI shows $125,000 / −$18,500 with null summary; Calendar shows 2 hardcoded "AI" items with API `[]` |
| 05:50 | Accessibility scan of 13 screens; mobile signed-in screenshots; Notifications → Calendar |
| 05:51 | Invalid token → returned to landing, token cleared; command palette works |
| 05:52:38 | Audit end; local audit servers stopped |

### Appendix C — Test data created

All in a separate scratch database outside the repository; nothing was written to production or to the developer's own local database. Accounts: `qa_auditor`, `qa_member` (local only). Records: one team workspace, documents, tasks, channel messages, calendar events, transactions, a repository with a file, issue and commit, and one video room. Earlier sessions also left local test accounts `qa_alice`, `qa_bob` and `qa_carol` in the developer's own `backend/nexamind.db`.

### Appendix D — Redaction note

No credentials, tokens, OTP codes, or private user data are reproduced in this report. The one OTP value observed in a log is shown only as "[6-digit code redacted]".
