# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Small startup and software teams of roughly 2 to 20 people who plan sprints, meet, write specs and
ship code together. Each person also has a personal Solo workspace for their own pages, tasks and
direct messages; the team works in a Group workspace joined with an invite code. They use NexaMind
through the working day on laptops, with phones for checking messages, notifications and calls.

## Product Purpose

NexaMind puts the tools a small team switches between all day into one workspace: written pages and
files, channels and direct messages, video meetings, a calendar, a task and sprint board, and real Git
repositories, with an AI Copilot that works across all of them. Success is a team that stops juggling
separate apps for docs, chat, meetings, tickets and code.

## Positioning

Everything in one place, and genuinely connected: a decision made in a meeting becomes approved
minutes and then tasks, a page can be found again from chat, and the Copilot acts with the workspace's
own tools on what the team already wrote, said and decided. Repositories are real Git (clone and push
over HTTPS), not a simulation.

## Operating Context

- Two workspace kinds: Solo (personal) and Group (team, invite code, owner/admin/member roles).
  Switching between them is a frequent action in the top bar.
- Daily rituals: channel chat, standups and meetings on video with screen sharing, minutes approval,
  sprint board updates, pull request reviews, calendar checks.
- The hosted backend can sleep and take up to about a minute to wake; the UI must show progress, not
  a blank screen.

## Capabilities and Constraints

- Docs: Markdown pages with images; import .docx/.pdf/.md/.txt; export to Word or Markdown; one
  library for uploaded files with previews.
- Channels: public, private and direct messages, reactions, attachments, live over WebSockets.
- Meetings: WebRTC video (mesh), screen share, chat, per-speaker transcription, minutes that keep only
  items quoted from the transcript, approval turning action items into tasks; video calls from DMs.
- Calendar with events, scheduled meetings and date suggestions quoted from minutes and documents.
- Tasks/sprint board; Finance tracker; Report synthesizer; notifications with read/dismiss.
- Git repositories: branches, protected branches, pull requests with reviews, issues, access tokens.
- AI Copilot: function-calling over the app's own actions (Gemini first, Groq fallback, optional
  personal Gemini key stored encrypted); with no model it parses explicit commands and never invents
  values.
- Frontend: React 19, Vite, Tailwind 3, plain JSX, no router library (hash tabs). Backend: FastAPI.
- Light and dark themes; reduced motion respected.

## Brand Commitments

- The NexaMind name and the black "N" wordmark logo (`frontend/public/logo.png`, white variant
  `logo-white.png`) stay as they are. Colours, typography and everything else may change.
- The AI assistant is called Copilot.

## Evidence on Hand

- The working product itself: every screen can be shown with real UI (screenshots of the running app
  with demonstration data, labelled as such where it could be mistaken for a customer).
- Contact address used on the site: support@nexamind.app.
- No customers, testimonials, logos, usage numbers, benchmarks or pricing exist. Do not invent them.

## Product Principles

1. One workspace, connected: every surface should make the links between docs, chat, meetings, tasks
   and code visible rather than presenting separate apps side by side.
2. Grounded, never invented: AI output and marketing copy only state what the workspace or product
   actually contains.
3. Solo and Group are two modes of one product: always clear which one you are in, never confusing
   data between them.
4. Built for the working day: fast, calm, keyboard-friendly, nothing that slows typing, calls or
   reviews.

## Accessibility & Inclusion

WCAG 2.1 AA: text contrast, visible keyboard focus, labelled controls, reduced motion, and workspace or
status never shown by colour alone.
