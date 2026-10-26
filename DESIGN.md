---
name: NexaMind
description: A calm, typeset team home for docs, chat, meetings, calendar, tasks and real Git, in a Solo room and a Group room.
colors:
  solo-teal: "#1B6E66"
  solo-teal-deep: "#165A54"
  solo-teal-wash: "#EEF6F5"
  group-plum: "#7B3F74"
  group-plum-deep: "#66345F"
  group-plum-wash: "#F7F0F6"
  ink: "#1F201D"
  page-white: "#FFFFFF"
  panel-grey: "#F9F9F8"
  panel-grey-hover: "#F2F2F0"
  panel-grey-solo: "#F0F4F2"
  panel-grey-group: "#F4F1F3"
  hairline: "#EAEAE8"
  control-edge: "#8B8B87"
  quiet-grey: "#D9D9D6"
  muted-text: "#636361"
  secondary-text: "#4E4E4B"
  dark-page: "#141513"
  dark-panel: "#1A1B19"
  dark-card: "#21221F"
  dark-hairline: "#30312E"
  dark-control-edge: "#6E6F6A"
  dark-ink: "#EDEDEA"
  dark-muted-text: "#A3A39E"
  dark-solo-accent: "#4C9A91"
  dark-group-accent: "#B57BAC"
  status-danger: "#BE123C"
  status-danger-wash: "#FFF1F2"
  status-warning: "#92400E"
  status-warning-wash: "#FFFBEB"
  status-success: "#047857"
  code-block: "#0F1115"
typography:
  display:
    fontFamily: "Instrument Serif, Georgia, serif"
    fontSize: "clamp(3.25rem, 7vw, 5.5rem)"
    fontWeight: 400
    lineHeight: 0.98
    letterSpacing: "-0.02em"
  greeting:
    fontFamily: "Instrument Serif, Georgia, serif"
    fontSize: "2.5rem"
    fontWeight: 400
    lineHeight: 1.05
    letterSpacing: "-0.01em"
  headline:
    fontFamily: "Instrument Serif, Georgia, serif"
    fontSize: "clamp(2.25rem, 5vw, 3.75rem)"
    fontWeight: 400
    lineHeight: 1.05
    letterSpacing: "-0.01em"
  title:
    fontFamily: "Instrument Sans, system-ui, sans-serif"
    fontSize: "1.5rem"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "-0.01em"
  panel-title:
    fontFamily: "Instrument Sans, system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 600
    lineHeight: 1.25
  figure:
    fontFamily: "Instrument Sans, system-ui, sans-serif"
    fontSize: "2rem"
    fontWeight: 400
    lineHeight: 1
    fontFeature: "tnum"
  body:
    fontFamily: "Instrument Sans, system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.5
  body-long:
    fontFamily: "Instrument Sans, system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.625
  label:
    fontFamily: "Instrument Sans, system-ui, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 400
    lineHeight: 1.33
  code:
    fontFamily: "JetBrains Mono, monospace"
    fontSize: "0.8rem"
    fontWeight: 400
    lineHeight: 1.5
rounded:
  chip: "6px"
  sm: "8px"
  md: "12px"
  panel: "22px"
  hero: "28px"
  pill: "9999px"
spacing:
  hairline-gap: "2px"
  xs: "8px"
  sm: "12px"
  md: "16px"
  panel: "20px"
  lg: "24px"
  xl: "32px"
  section: "40px"
  landing-section: "128px"
components:
  button-primary:
    backgroundColor: "{colors.solo-teal}"
    textColor: "{colors.page-white}"
    typography: "{typography.panel-title}"
    rounded: "{rounded.pill}"
    padding: "8px 16px"
  button-primary-hover:
    backgroundColor: "{colors.solo-teal-deep}"
  button-primary-group:
    backgroundColor: "{colors.group-plum}"
    textColor: "{colors.page-white}"
    rounded: "{rounded.pill}"
    padding: "8px 16px"
  button-secondary:
    backgroundColor: "{colors.page-white}"
    textColor: "{colors.ink}"
    typography: "{typography.panel-title}"
    rounded: "{rounded.pill}"
    padding: "8px 16px"
  button-secondary-hover:
    backgroundColor: "{colors.panel-grey-hover}"
  button-landing-primary:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.page-white}"
    rounded: "{rounded.pill}"
    padding: "12px 24px"
  input:
    backgroundColor: "{colors.page-white}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    padding: "10px 12px"
  panel:
    backgroundColor: "{colors.panel-grey}"
    textColor: "{colors.ink}"
    rounded: "{rounded.panel}"
    padding: "20px"
  count-tile:
    backgroundColor: "{colors.panel-grey}"
    textColor: "{colors.ink}"
    typography: "{typography.figure}"
    rounded: "{rounded.panel}"
    padding: "16px"
    height: "128px"
  count-tile-hover:
    backgroundColor: "{colors.panel-grey-hover}"
  nav-item:
    textColor: "{colors.secondary-text}"
    typography: "{typography.body}"
    rounded: "{rounded.sm}"
    padding: "0 10px"
    height: "32px"
  nav-item-active:
    backgroundColor: "{colors.panel-grey-hover}"
    textColor: "{colors.ink}"
  chip-status-danger:
    backgroundColor: "{colors.status-danger-wash}"
    textColor: "{colors.status-danger}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    padding: "2px 8px"
  chip-workspace:
    backgroundColor: "{colors.solo-teal-wash}"
    textColor: "{colors.solo-teal-deep}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    padding: "2px 8px"
  workspace-switch:
    backgroundColor: "{colors.panel-grey-hover}"
    rounded: "{rounded.pill}"
    padding: "4px"
  dialog:
    backgroundColor: "{colors.page-white}"
    rounded: "{rounded.panel}"
    padding: "20px 24px"
---

# Design System: NexaMind

## Overview

**Creative North Star: "The Typeset Team Home"**

NexaMind reads like a well-set page rather than a control panel. The ground is plain white, the working surfaces are panels one step off white at a generous 22px radius, rows are separated by 1px hairlines, and nothing casts a shadow while it sits still. A serif greeting opens the home screen and states the day's one fact; everything below it is set in a quiet grotesque with tabular figures. The system is dense enough for all-day use on a laptop (14px body, 32px navigation rows) but never crowded: whitespace and tone separate things, not boxes and borders.

Colour is held back until it means something. Each workspace is a room with its own hue: Solo is deep teal, Group is plum. The current room's hue colours the active icon, primary buttons, links and selection, and also tints the panel greys by a few percent, so switching rooms changes the whole space, not just the buttons. Status colours (rose, amber, emerald) appear only for status. The public landing page uses the same world with a near-black primary and real product screenshots in place of illustration.

Motion is short and purposeful. Screens settle in over 280ms, menus scale in from their trigger, and the one signature moment, switching Solo and Group or light and dark, reveals the new room as a circle spreading from the pointer. Keyboard presses and reduced-motion users get the change instantly.

**Key Characteristics:**
- White page, off-white tonal panels (22px), 1px hairlines, flat at rest.
- Instrument Sans for the interface; Instrument Serif only for greetings and landing headlines; tabular figures for numbers.
- Two rooms: Solo deep teal and Group plum, each tinting accent and ground.
- Pills for controls, 22px for panels, 8 to 12px for rows and fields.
- Circular room reveal for workspace and theme changes; otherwise short settle and fade.
- Light and dark themes from one generated palette with separate background and text scales.

## Colors

A warm, slightly yellowed neutral grey family carries almost everything; one room hue at a time does the pointing.

### Primary
- **Solo Deep Teal** (solo-teal): the accent of the Solo workspace. Primary buttons, the active navigation icon, the workspace badge, links, focus ring and text selection. Hover deepens to Solo Teal Deep; tinted chips use Solo Teal Wash with the deep teal as text. In dark mode accent text lifts to Dark Solo Accent.

### Secondary
- **Group Plum** (group-plum): the accent of the Group workspace, in exactly the same roles as Solo Deep Teal. Hover deepens to Group Plum Deep; chips use Group Plum Wash. In dark mode accent text lifts to Dark Group Accent.

Components never pick teal or plum directly for accent roles: they use the workspace accent (the `indigo`/`accent` colour classes), which resolves to the current room. Fixed `solo`/`group` colours are used only where both rooms are shown side by side (the workspace switch thumb, the workspace list in the switcher menu).

### Neutral
- **Ink** (ink): primary text, headings, figures; also the primary button colour on the landing page (inverted to Dark Ink in dark mode).
- **Page White** (page-white): the page ground, the sidebar, cards, dialogs and menus in light mode.
- **Panel Grey** (panel-grey): the tonal panel and count-tile ground. In a room it carries a whisper of the room hue (Panel Grey Solo, Panel Grey Group). Hover steps to Panel Grey Hover, which is also the active navigation fill and the workspace-switch track.
- **Hairline** (hairline): row dividers, sidebar edge, card and dialog borders, header rules.
- **Control Edge** (control-edge): borders of inputs and other controls, chosen to reach 3:1 against white.
- **Quiet Grey** (quiet-grey): dashed borders of empty states, scrollbar thumbs.
- **Muted Text** (muted-text) and **Secondary Text** (secondary-text): captions, timestamps, inactive navigation, panel counts.
- **Dark theme**: Dark Page ground, Dark Panel for tonal panels (tinted by the room like the light greys), Dark Card for cards, menus and dialogs, Dark Hairline dividers, Dark Control Edge for inputs, Dark Ink text, Dark Muted Text captions.

### Status
- **Danger** (status-danger on status-danger-wash): deadlines, urgent priority, errors, destructive menu items.
- **Warning** (status-warning on status-warning-wash): high priority, development notices.
- **Success** (status-success): sent and saved confirmations, online presence.
- **Code Block** (code-block): fenced code in chat and documents stays dark in both themes.

### Named Rules
**The Room Rule.** The current workspace owns the accent. Teal and plum never appear together except on the controls that choose between them.

**The Meaning-Only Rule.** Colour marks the active, the actionable or a status. Decoration is done with tone and space, never with hue.

**The Two-Scale Rule.** Every hue has a background scale and a separate text scale (light and dark), so a tinted chip and its text both stay legible. New colours go through `frontend/scripts/build-palette.cjs`, never as hard-coded hex in components.

## Typography

**Display Font:** Instrument Serif (with Georgia, serif)
**Body Font:** Instrument Sans (with system-ui, Segoe UI, sans-serif)
**Label/Mono Font:** JetBrains Mono, for code only

**Character:** A narrow, literary serif used sparingly against a neutral, slightly condensed grotesque. The serif speaks (greetings, landing headlines); the sans works.

### Hierarchy
- **Display** (Instrument Serif 400, 52px to 88px, line-height 0.98, -0.02em): the landing hero headline only, with its second sentence in muted grey.
- **Greeting** (Instrument Serif 400, 40px rising to 48px, line-height 1.05): the home greeting, "Afternoon, Sam." followed by today's one fact in muted grey.
- **Headline** (Instrument Serif 400, 36px to 60px, line-height 1.05): landing section headings.
- **Title** (Instrument Sans 600, 20px to 24px, -0.01em): feature screen titles in the feature header; landing feature titles.
- **Panel Title** (Instrument Sans 600, 14px): panel headings, dialog titles, menu headings.
- **Figure** (Instrument Sans 400, 32px, line-height 1, tabular): count tiles.
- **Body** (Instrument Sans 400, 14px, line-height 1.5): rows, messages, form text. Long landing copy runs 16 to 18px at 1.625, capped near 36rem.
- **Label** (Instrument Sans 400 to 500, 12 to 13px, sentence case): captions, tile labels, chips, group headings in the sidebar ("Workspace").
- **Code** (JetBrains Mono 400, about 13px): inline code, code blocks, repository content.

### Named Rules
**The Serif Speaks Once Rule.** Instrument Serif is for greetings and landing headlines. It never appears in buttons, navigation, tables or feature screen titles.

**The Tabular Figures Rule.** Counts, times, money and table cells use tabular figures so updating numbers do not shift.

**The Sentence Case Rule.** Labels and headings are sentence case at normal tracking. Section headings in the sidebar are plain 12px muted text, not small caps.

## Layout

The app is an open plane. On desktop a 240px sidebar sits on the page ground with a single hairline on its right; it holds the wordmark, the workspace switcher, the Solo/Group switch, search (Ctrl K), labelled navigation on a 34px pitch (32px rows, 2px gaps) and, at the bottom, notifications, theme toggle and the account. There is no top bar on desktop. Below 768px the sidebar is replaced by a 56px translucent top bar (wordmark, compact switch, search, notifications) and a bottom navigation.

Content scrolls in the main column with 16px padding on phones, 24px from 640px and 32px from 768px. The home screen is a centred 1100px column: the greeting, 40px of space, then a 12-column grid with 16px gaps holding four count tiles (3 columns each, 6 on phones), a 9+3 row (Today and Copilot) and a 6+6 row pair (tasks, docs, chats, meetings). Panels pad 20px, tiles 16px, rows are at least 52px tall.

The landing page uses a 1200px container with 16 to 24px gutters, a 12-column grid (8+4 hero, 4+8 alternating feature rows), and sections spaced 96px to 128px apart.

Breakpoints are Tailwind's defaults (640, 768, 1024, 1280px); 768px is the shell switch, 1024px the home grid switch.

**Coverage.** The shell (sidebar, mobile bar, workspace switch), the home screen, the feature header, dialogs, toasts, the command palette, notifications, the calendar and the landing page are built in this system. Older feature screens (Documents, Files, Channels, Solo chat, Kanban board, Meetings and the meeting room, Repositories, Workspace settings, Copilot) inherit the palette, fonts, focus ring and flat shadows through the shared tokens, so they change room and theme correctly, but they keep their earlier layouts and some earlier devices listed under Do's and Don'ts. Treat those screens as legacy layouts, not as precedent.

## Elevation & Depth

The system is flat at rest and conveys depth by tone: page white, then panel grey, then a white chip or hover fill on the panel. Tailwind's small shadows (`shadow-sm`, `shadow`, `shadow-xs`) are deliberately mapped to nothing. Shadow is reserved for layers that float above the page: menus, popovers, dialogs, toasts, and the landing page's screenshot frames.

### Shadow Vocabulary
- **Floating panel** (`box-shadow: 0 1px 2px rgb(31 32 29 / 0.06), 0 16px 40px -12px rgb(31 32 29 / 0.22)`; dark: `0 1px 2px rgb(0 0 0 / 0.4), 0 18px 48px -12px rgb(0 0 0 / 0.7)`): menus, command palette, confirm dialogs, toasts, landing screenshots.
- **Scrim** (Ink-black at 40 to 50% opacity): behind dialogs and the command palette.

### Named Rules
**The Flat-At-Rest Rule.** A surface that is not floating has no shadow. Separation comes from a tone step or a 1px hairline, never both stacked around the same box.

## Shapes

Two corner families. Containers are softly rounded at 22px (panels, tiles, cards, dialogs, landing screenshot frames; 28px for the landing closing band and auth dialog). Controls are pills (buttons, the workspace switch, chips, counts, the theme toggle). Rows, menu items and navigation items use 8px; fields, menus and empty states use 12px; tiny badges inside rows use 6px.

Borders are 1px hairlines. Empty states use a 1px dashed Quiet Grey border at 12px. Avatars and presence dots are circles; workspace initials sit in an 8px-rounded square filled with the room accent.

## Components

### Buttons
Quiet, rounded and decisive: one filled button per area, the rest outlined or plain.
- **Shape:** full pill (9999px).
- **Primary:** room accent fill, white 14px semibold text, 8px by 16px. Hover deepens one step (accent 700) over 150ms.
- **Secondary:** white with a 1px Hairline border and Ink text; hover fills Panel Grey Hover. Used for empty-state actions at 12px.
- **Ghost:** no fill, muted text; hover fills Panel Grey Hover and darkens text. Icon buttons are 36px pills.
- **Landing primary:** Ink fill with white text (inverted in dark mode), 12px by 24px, with an arrow icon; hover lightens to the 700 grey.
- **Pressed:** opted-in buttons scale to 0.97 on press over 160ms.

### Chips
- **Style:** pill, 12px text, 2px by 8px, a wash background with the matching deep text (room accent for meetings and events, rose for deadlines and urgent, amber for high priority).
- **Counts:** a white pill with a 1px ring, tabular figures, beside panel titles.

### Cards / Containers
- **Corner Style:** 22px.
- **Background:** Panel Grey (room-tinted) on the white page; Dark Panel in dark mode.
- **Shadow Strategy:** none at rest (see Elevation & Depth).
- **Border:** none on tonal panels; 1px Hairline on white cards, dialogs and screenshots.
- **Internal Padding:** 20px panels, 16px tiles.
- **Rows:** sit directly on the panel, divided by hairlines, with an 8px-rounded white wash on hover. Panels are never nested inside panels.

### Inputs / Fields
- **Style:** white field, 1px Control Edge border, 12px radius, 12px horizontal padding, placeholder in light grey.
- **Focus:** border turns the room accent; keyboard focus adds the global 2px accent outline at 2px offset.
- **Disabled:** 50% opacity, not-allowed cursor.

### Navigation
- **Sidebar items:** 32px tall, 8px radius, 14px text with a 16px line icon (stroke 1.75). Inactive: secondary grey text, light grey icon; hover fills Panel Grey Hover. Active: Panel Grey Hover fill, Ink text at medium weight, icon in the room accent, `aria-current="page"`. Unread is a 6px accent dot.
- **Feature header:** title with a 20px accent line icon, optional back button and pill badge, actions right, closed by a 1px hairline 20px below.
- **Mobile:** 56px translucent top bar and bottom tab navigation.

### Workspace Switch (signature)
A pill track in Panel Grey Hover holding Solo and Group. A thumb slides between halves over 260ms with the in-out curve, filled with Solo Deep Teal or Group Plum; the chosen label turns white. Pressing it with a pointer triggers the room reveal: the new room's accent and ground open as a circle from the pointer (480ms, drawer curve) over the still old room. The same reveal runs from the theme toggle for light and dark. Keyboard presses switch instantly; reduced motion and browsers without View Transitions switch instantly.

### Editorial Greeting (signature)
The home screen header: the serif greeting with the day's one fact (the next event today, else the open task count, else "Nothing is waiting on you.") in muted grey, then a 14px date line with the workspace name in accent text. The four count tiles and panels below settle in with a 30ms stagger.

### Dialogs, menus and toasts
Dialogs are white, 22px, Hairline-bordered, over a 50% scrim; they scale in from 0.97 over 260ms. Menus are white, 12px, floating-panel shadow, scaling in from their trigger's edge. Toasts slide up 8px at the bottom right with a status icon. All go through `components/ui/Modal`, `lib/dialog` or `context/ToastContext`.

### Motion grammar
- **Durations:** 150ms feedback (hover, colour), 200ms fades, 260ms panels, menus and dialogs, 280ms screen settle, 480ms room reveal, 600ms landing rise and scroll reveal.
- **Easings:** ease-out `cubic-bezier(0.16, 1, 0.3, 1)` for entrances, ease-in `cubic-bezier(0.4, 0, 1, 1)` for exits, drawer `cubic-bezier(0.32, 0.72, 0, 1)` for the room reveal, in-out `cubic-bezier(0.77, 0, 0.175, 1)` for the switch thumb.
- **What animates:** opacity and small translations (6 to 16px), scale from 0.97, the switch thumb, the circular reveal. Tab changes fade only (120ms), because a transform would trap the screen's fixed dialogs.
- **What never animates:** layout size, typing and ordinary hovers beyond a colour change, anything under `prefers-reduced-motion` (all durations collapse to near zero and the reveal is skipped).

## Do's and Don'ts

### Do:
- **Do** use the workspace accent classes for every accent role so Solo shows teal and Group shows plum without component changes.
- **Do** separate content with a tone step (white page to Panel Grey) or a 1px Hairline, and keep panels at 22px with 20px padding.
- **Do** keep text contrast at WCAG AA: muted text is 6.0:1 on white, white on Solo Deep Teal 6.1:1, white on Group Plum 7.5:1, control borders 3.4:1, dark muted text 6.3:1 on Dark Card, dark accent text 4.8:1 or better.
- **Do** give every interactive element the global 2px accent focus outline at 2px offset.
- **Do** use tabular figures for counts, times and money.
- **Do** show the real product (real screenshots with demonstration data, light and dark) on public pages.
- **Do** run the room reveal only for pointer-initiated workspace and theme changes, and change instantly for keyboard and reduced motion.

### Don't:
- **Don't** use gradients, glows or coloured shadows on any surface, avatar or button.
- **Don't** put eyebrows or kickers (small uppercase tracked labels) above headings, or uppercase tracked micro-labels anywhere.
- **Don't** use monospace for decoration; JetBrains Mono is for code and code-like identifiers only.
- **Don't** use coloured left rules thicker than 1px to mark quotes, callouts or replies.
- **Don't** nest cards inside cards or panels inside panels.
- **Don't** add shadows to resting surfaces or stack a shadow and a border on the same panel.
- **Don't** use Instrument Serif outside greetings and landing headlines.
- **Don't** show teal and plum together except on the controls that choose between them.
- **Don't** use text glyphs (such as a warning sign character) as icons; use the line icon set.
