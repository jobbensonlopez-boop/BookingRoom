# Handoff: Kelmer Meeting Room Booking

## Overview
An internal web app for booking Kelmer's single meeting room ("Boardroom", seats 8). Employees can:
- See at a glance whether the room is available or occupied right now
- Browse bookings and free gaps for the next 7 working days
- Book the room with a title, date, start time, end time and number of attendees
- Cancel their own upcoming bookings

The system must make overlapping bookings impossible.

## About the Design Files
The files in this bundle are **design references created in HTML**: a working prototype that shows the intended look and behavior. They are not production code to copy directly. Your task is to **recreate this design in the target environment**. If Kelmer has no existing codebase, recommended stack:
- **Frontend:** React + TypeScript (Vite or Next.js)
- **Backend/DB:** Postgres (Supabase, Neon or similar) behind a small API
- **Auth:** Microsoft Entra ID (Azure AD) single sign-on, since Kelmer uses Microsoft 365. Restrict sign-in to the company tenant.

Open `Room Booking App.dc.html` in a browser to try the prototype (keep `support.js` and `assets/` next to it). In the prototype, data is held in memory and the clock is fixed at 10:40 for demo purposes. Both must become real.

## Fidelity
**High-fidelity.** Colors, type, spacing and copy are final. Recreate them pixel-closely. The visual language follows Microsoft Fluent (Segoe UI, 4px radii, underlined inputs). Using Fluent UI React v9 components is a good fit.

## Screen: Room booking (single screen + side panel)

### Layout
Full viewport height (`100vh`, min 640px), background `#faf9f8`. Vertical flex:
1. **App bar**: 52px tall, white, 1px bottom border `#e1dfdd`, padding 0 20px, items centered, gap 16px.
2. **Day strip**: CSS grid `repeat(7, minmax(0,1fr))`, gap 8px, padding 20px 32px 0.
3. **Content**: flex 1, padding 20px 32px 28px, column, gap 12px. A heading row sits above a scrollable agenda card.
4. **Side panel** (overlay): opened from "New booking" or any "Book" button.

### App bar (left → right)
- Logo `assets/kelmer-logo.png`, height 40px
- 1×24px divider `#e1dfdd`
- "Room booking": 16px / 600
- **Status pill** (live): 13px / 600, padding 4px 10px, radius 12px, with an 8px dot
  - Occupied: text `#a4262c`, bg `#fde7e9`, dot `#c50f1f`. Copy: `Occupied until HH:MM`
  - Available: text `#0e700e`, bg `#dff6dd`, dot `#107c10`. Copy: `Available · until HH:MM` (start of the next booking), or `Available · rest of day`
- Spacer
- **"+ New booking"** primary button: 32px tall, padding 0 16px, bg `#f2a31b`, text `#1f1f1f` 14px/600, radius 4px, hover `#e0930c`
- Avatar: 32px circle `#5c5c60`, white initials 13px/600

### Day strip
Shows the next 7 working days starting today (skip Sat/Sun). Each card:
- Padding 10px 14px, radius 8px, 1px border, pointer cursor
- Lines: day name 13px/600 ("Today" for today, else short weekday such as "Thu"); day number 22px/600; count 12px (`N booked` or `All free`)
- Unselected: bg `#fff`, text `#242424`, border `#e1dfdd`
- Selected: bg and border `#3b3a3c`, text `#fff`
- Click selects that date for the agenda.

### Heading row
Long date, 20px/600 (e.g. "Wednesday 7 October"). Next to it, 14px `#616161`: "Boardroom · seats 8 · 08:00–18:00".

### Agenda card
White, 1px `#e1dfdd`, radius 8px, scrolls vertically. Rows use a grid with columns `140px minmax(0,1fr) 160px 120px`, gap 16px, padding 14px 20px, and a 1px bottom border `#f0f0f0`. Bookings and free gaps are interleaved in time order.
- **Booking row:**
  - Time range 15px/600
  - Title 15px, with duration underneath at 13px `#616161` (e.g. "1h 30m")
  - "Organizer · attendees" at 14px `#424242`
  - Right column shows one of:
    - "In progress" badge (12px/600, `#a4262c` on `#fde7e9`, radius 10px), if the booking is happening now
    - "Cancel" button (28px, white, 1px `#d1d1d1`; hover bg `#fde7e9`, border `#c50f1f`), if the current user is the organizer and it hasn't started
  - Past bookings today render at 50% opacity.
- **Free-gap row:**
  - Bg `#f8fcf8`, padding 10px 20px
  - Range at 14px/600 `#0e700e`, then "Free · 1h 30m" at 14px `#0e700e`
  - "Book" button: 28px, white, 1px `#107c10`, text `#0e700e` 13px/600, hover bg `#dff6dd`. Opens the panel prefilled with gap start → min(start + 60 min, gap end).
  - Gaps shorter than 15 min are hidden. On today, gaps start at "now" rounded up to the next 15 min.
- **Empty state:** "No free time left on this day." (centered, 15px `#616161`, padding 40px)
- **Toast:** after booking, show a dark toast below the card (`#242424` bg, white 14px, padding 10px 14px, radius 4px). Copy: `Booked “Title” · HH:MM–HH:MM`. Auto-dismiss after 3.5s.

### Side panel (New booking)
- Scrim: `rgba(0,0,0,.25)` covering everything below the app bar. Clicking it closes the panel.
- Panel: anchored right, below the app bar, width `min(420px, 100%)`, white, shadow `-8px 0 24px rgba(0,0,0,.14)`, padding 24px, column, gap 14px.
- Header: "New booking" 20px/600, with a ✕ close button (32px, hover `#f5f5f5`).
- Fields (label 14px/600 above, 4px gap). Inputs are 32px tall, 1px `#d1d1d1` border with 1px `#616161` bottom border, radius 4px, 14px text. On focus the bottom border becomes 2px `#f2a31b`.
  - Meeting title: text input, placeholder "e.g. Client kickoff"
  - Date: date picker
  - Start / End: two-column grid with a 12px gap. Selects from 07:00 to 20:00 in 15-minute steps.
  - Attendees: number input, 100px wide, min 1
- Meta line, 13px `#616161`: "Booked by {user full name} · {duration}"
- Validation message:
  - Error: bg `#fde7e9`, text `#a4262c`
  - Success hint: bg `#dff6dd`, text `#0e700e`, copy `✓ HH:MM–HH:MM is free`
  - Both: 14px, padding 10px 12px, radius 4px
- Footer (pushed to the bottom):
  - "Book room": primary orange, 36px tall. When invalid it is disabled: bg `#f0f0f0`, text `#8a8a8a`, not-allowed cursor.
  - "Cancel": secondary button that closes the panel

## Interactions & Behavior
- **Opening the panel.** "+ New booking" prefills the first free gap of the selected day (1 hour, or shorter if the gap is shorter). If the day has no gap, it uses 12:00–13:00.
- **Changing the start time.** If the new start is at or after the current end, the end moves to start + 60 min.
- **Live validation** runs on every change. Show the first error that applies:
  1. End ≤ start → "End time must be after the start time."
  2. Date or start in the past (today with start before now, allowing 4 min of grace) → "That start time has already passed."
  3. Overlap with any booking where `existing.start < new.end && new.start < existing.end` → `Overlaps with “{title}” ({HH:MM}–{HH:MM}). Pick another time.`
  4. Attendees above capacity → "The room seats up to 8 people."
  5. Attendees below 1 → "Add at least 1 attendee."

  "Book room" is enabled only when there is no error and the title is not blank. A blank title shows no error, only the disabled button.
- **Submitting.** Save the booking, close the panel, switch the day strip to the booked date and show the toast.
- **Cancelling.** Removes the booking. Ask for confirmation in production.
- **Status pill.** Recompute at least every 30 seconds and when the window regains focus. Also refresh the data (or subscribe to realtime changes) so other people's bookings appear.
- **Times.** All times use 24-hour HH:MM and the office's local timezone. The working day is 08:00–18:00 for gaps; bookings may run 07:00–20:00.

## Data & Backend (must-haves for production)
**Table `bookings`:**
- `id` uuid pk
- `title` text not null
- `starts_at` timestamptz not null
- `ends_at` timestamptz not null, with `check (ends_at > starts_at)`
- `attendees` int, with `check (attendees between 1 and capacity)`
- `organizer_id`, `organizer_name`
- `created_at`

**Hard overlap guard (Postgres).** Enforce this in the database, not only in the UI, so two simultaneous requests can't both succeed:
```sql
create extension if not exists btree_gist;
alter table bookings add constraint no_overlap
  exclude using gist (tstzrange(starts_at, ends_at, '[)') with &&);
```
If you add more rooms later, include `room_id with =` in the constraint. When the constraint is violated, return 409 and show the overlap message.

**API:**
- `GET /bookings?from=&to=`
- `POST /bookings`: validate, check against the server clock, return 409 on overlap
- `DELETE /bookings/:id`: organizer only

**Auth.** Entra ID SSO. The organizer comes from the signed-in user, never from the form.

**Nice to have.** Send an Outlook calendar invite on booking via Microsoft Graph.

## State (client)
- `bookings[]`, fetched for the visible 7-day window
- `selectedDate`
- `panelOpen`
- `form = { date, start, end, title, attendees }`
- `toast`
- `now`, a ticking clock

Derived values: status (current or next booking), the agenda (bookings plus gaps), validation error, and whether the form is valid.

## Design Tokens
- **Font:** "Segoe UI", -apple-system, "Helvetica Neue", Helvetica, Arial, sans-serif
- **Brand:**
  - Accent / primary button: `#f2a31b`, hover `#e0930c`
  - Charcoal (selected day): `#3b3a3c`
  - Avatar: `#5c5c60`
- **Neutrals:**
  - Text: `#242424`
  - Secondary text: `#424242`, `#616161`
  - Borders: `#e1dfdd`, `#d1d1d1`
  - Row divider: `#f0f0f0`
  - Hover: `#f5f5f5`
  - App background: `#faf9f8`
  - Surface: `#ffffff`
- **Success:** `#107c10`, text `#0e700e`, background `#dff6dd`, row tint `#f8fcf8`
- **Danger:** `#c50f1f`, text `#a4262c`, background `#fde7e9`
- **Radii:** 4px (controls), 8px (cards), 10–12px (pills)
- **Spacing:** 4 / 8 / 12 / 14 / 16 / 20 / 24 / 32px
- **Type scale:** 12 / 13 / 14 / 15 / 16 / 20 / 22px. Weights 400 and 600.

## Assets
- `assets/kelmer-logo.png`: the Kelmer Group logo, supplied by the client. Its grey background was made transparent. Ask Kelmer for a vector or SVG version for production.

## Files
- `Room Booking App.dc.html`: the interactive prototype (template + logic). Its logic class holds the reference implementation of validation, gaps and status.
- `support.js`: the runtime needed to open the prototype in a browser
- `assets/kelmer-logo.png`
