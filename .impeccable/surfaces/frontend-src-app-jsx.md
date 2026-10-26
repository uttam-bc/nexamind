---
version: 1
slug: "frontend-src-app-jsx"
primary_target: "frontend/src/App.jsx"
related_targets: ["frontend/src/pages/LandingPage.jsx","frontend/src/components/Dashboard.jsx","frontend/src/components/Sidebar.jsx"]
---

# NexaMind app and site

Scope: the whole web app (Operate) and its public landing page (Persuade), one shared world.
Audience: small startup and dev teams, all-day use on laptops; phones for checking in.
Job: work across docs, chat, meetings, calendar, tasks and repos without switching apps; switch between Solo and Group often.
Constraints: keep every feature, route, handler and label; keep the N wordmark; WCAG AA; reduced motion.
User steer: "pleasant and good", not AI-looking; best possible Solo-to-Group transition; animations and real images.

## Direction contract

THESIS: A calm, typeset team home: a serif greeting that states today's one fact, quiet tonal panels, colour only where it means something. Refuses the generated dashboard (glow, gradients, KPI tiles with icon circles, purple-blue accents everywhere).
OWN-WORLD: White page, one-step-off-white panels at 22px radius, 1px hairlines, no shadow at rest. Instrument Sans for the interface, Instrument Serif only for greetings and landing headlines, tabular figures. Solo is deep teal (#1B6E66), Group is plum (#7B3F74); each also tints the panel ground. Status colours only for status. Near-black primary on the landing.
STORY: A visitor sees the real product in real screenshots, understands "everything in one place", and creates a workspace. A member opens NexaMind, reads the greeting's fact, and acts from the panel that answers it.
FIRST VIEWPORT: App: open-plane shell, a 240px labelled sidebar on the page ground with the workspace switcher and Solo/Group control at its top, no top bar; a centred 1100px column with the 48px serif greeting, four count tiles, then a 9+3 row and a 6+6 row. Landing: serif headline left, primary action beside it, a large real screenshot of the app below in a browser frame.
FORM: Editorial greeting (taste-skill app style, seed 545315956) after the user rejected both impeccable hands; position: chosen by the user's delegation. seed: 0d2f1d19c55e09ef
SIGNATURE: Switching Solo and Group: the new workspace's accent and ground spread from the switch as a circular reveal (View Transitions), and the greeting and counts settle in; the same reveal runs for light/dark.
FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
