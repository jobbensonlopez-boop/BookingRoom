# Kelmer Meeting Room Booking

Internal web app for booking Kelmer's single meeting room (Boardroom, seats 8). Employees can see whether the room is free right now, browse the next 7 working days, book the room, and cancel their own upcoming bookings. Overlapping bookings are rejected by the database itself, so two people can never hold the same slot.

The design handoff (spec + HTML prototype) is in [`docs/design/`](docs/design/README.md).

## Stack

| Part | What |
| --- | --- |
| `web/` | React 18 + TypeScript (Vite). Plain CSS that matches the Fluent-style design tokens. MSAL for Entra ID sign-in. |
| `server/` | Node + Express API, Postgres via `pg`, Entra ID access-token validation via `jose`. |
| `shared/` | Booking rules used by both sides: validation, free gaps, room status, timezone conversion. |
| `db/migrations/` | SQL migrations, including the `no_overlap` exclusion constraint. |

## Running locally

You need **Node.js 22+**, **Git**, and **Postgres** (the easiest way to get Postgres is Docker Desktop). Local mode skips Microsoft sign-in, and you are signed in as "Alex Morgan".

1. **Get the code and install dependencies**
   ```sh
   git clone https://github.com/jobbensonlopez-boop/BookingRoom.git
   cd BookingRoom
   npm install
   ```
2. **Start Postgres.** With Docker:
   ```sh
   docker compose up -d
   ```
   This starts Postgres on port 5432 with user `booking`, password `booking`, and database `booking`. If you already run Postgres, create that user and database instead.
3. **Create a `.env` file** in the repository root with:
   ```ini
   DATABASE_URL=postgres://booking:booking@localhost:5432/booking
   OFFICE_TIMEZONE=Asia/Dubai
   AUTH_MODE=dev
   VITE_AUTH_MODE=dev
   ```
4. **Create the table and add demo bookings**
   ```sh
   npm run migrate
   npm run seed        # optional: today's and the next two working days' demo bookings
   ```
5. **Start the API and the web app together**
   ```sh
   npm run dev
   ```
   Wait for `[api] Room booking API listening on :3001` and `[web] Local: http://localhost:5173/`, then open **http://localhost:5173** in your browser. Press Ctrl+C to stop both.

### Things to try

| Check | How |
| --- | --- |
| Create a booking | Click **Book** on a green free row (or **+ New booking**), enter a title, then click **Book room**. A toast appears and the booking shows in the day's schedule. |
| Overlap is prevented | Open **+ New booking** and pick a start time that falls inside an existing booking. A red "Overlaps with …" message appears and **Book room** is disabled. The API also returns 409, and the database constraint blocks overlaps even if the UI is bypassed. |
| Today's schedule | **Today** in the day strip lists bookings and free gaps in time order. Past bookings are faded, and the current one shows **In progress**. The status pill in the top bar shows whether the room is occupied right now. |
| My bookings | **My bookings** in the top bar lists your upcoming bookings. Click a date to jump to that day. |
| Cancel | Click **Cancel** on one of your bookings, either in the schedule or in My bookings, then confirm. Other people's bookings and ones already in progress have no Cancel button. |
| Other people's bookings | The seed data includes bookings by Omar H., Sarah K. and Rania B. These show the organizer's name but no Cancel button. |

Local mode refuses to start when `NODE_ENV=production`. To act as another user through the API, send an `X-Dev-User: Some Name` header.

### Tests

```sh
npm test                                                     # shared rules (unit tests)
TEST_DATABASE_URL=postgres://…/booking_test npm test         # plus API integration tests (wipes that DB)
npm run typecheck
```

GitHub Actions (`.github/workflows/ci.yml`) runs the typecheck, all tests (with a Postgres service, so the integration tests always run), and the web build on every pull request and every push to `main`.

The integration tests cover the overlap constraint, including 8 simultaneous requests for the same slot, of which exactly one succeeds.

## Production

```sh
npm run build                                  # builds web/dist (VITE_* variables are read at build time)
NODE_ENV=production STATIC_DIR=../web/dist npm start
```

The API serves the built frontend from the same origin, so no CORS setup is needed. Run `npm run migrate` on each deploy.

### Configuration

All settings are in [`.env.example`](.env.example). The main ones:

- `OFFICE_TIMEZONE`: the office's IANA timezone (for example `Asia/Dubai`). Every time shown, validated, or stored is converted through this zone, whatever timezone the browser or server is in.
- `ROOM_NAME`, `ROOM_CAPACITY`: if you change the capacity, also change the `attendees between 1 and 8` check in the migration.

### Microsoft Entra ID setup

Create two app registrations in the Kelmer tenant:

1. **API** (for example "Room Booking API")
   - *Expose an API*: set the Application ID URI to `api://<api-client-id>` and add a scope named `access_as_user`.
   - In the manifest, set `"accessTokenAcceptedVersion": 2`.
   - Set `ENTRA_TENANT_ID` and `ENTRA_API_CLIENT_ID` on the server.
2. **SPA** (for example "Room Booking")
   - *Authentication*: add a Single-page application platform with the app's URL as the redirect URI (and `http://localhost:5173` for development).
   - *Supported account types*: accounts in this organizational directory only.
   - *API permissions*: add `access_as_user` from the API registration and grant admin consent.
   - Set `VITE_ENTRA_TENANT_ID`, `VITE_ENTRA_CLIENT_ID` and `VITE_ENTRA_API_SCOPE=api://<api-client-id>/access_as_user` at build time.

The server accepts only tokens from the configured tenant that carry the `access_as_user` scope. The organizer is taken from the token's `oid` and `name` claims, never from the request body.

## API

All endpoints require `Authorization: Bearer <token>`. Errors look like `{ "error": { "code", "message" } }`.

| Method | Path | Notes |
| --- | --- | --- |
| `GET` | `/api/me` | Signed-in user, room info, office timezone, and server time. |
| `GET` | `/api/my-bookings` | The signed-in user's bookings that have not ended yet, soonest first. |
| `GET` | `/api/bookings?from=YYYY-MM-DD&to=YYYY-MM-DD` | Bookings that intersect those office-local days (inclusive, up to 62 days). |
| `POST` | `/api/bookings` | Body: `{ title, startsAt, endsAt, attendees }` (ISO timestamps). Returns `201` on success, `409` with `clash` on overlap, or `422` for other rule failures. |
| `DELETE` | `/api/bookings/:id` | Organizer only (otherwise `403`), and only before the booking starts (otherwise `409`). |

`POST` applies the same rules as the UI, checked against the server clock: end after start, not in the past (4 minutes of grace), no overlap, 1 to capacity attendees, times between 07:00 and 20:00 on a 15-minute grid, and start and end on the same day. The Postgres `no_overlap` exclusion constraint is the final guard against concurrent requests.

## Notes and deviations from the prototype

- **Live data.** The status pill and clock update every 30 seconds and whenever the window regains focus. Bookings are re-fetched at the same moments, so other people's bookings appear. The client corrects for clock skew using the server time.
- **Status pill.** Back-to-back bookings are merged. If 10:00–11:00 is followed by 11:00–12:00, the pill reads "Occupied until 12:00".
- **Cancelling** asks for confirmation in a dialog, then shows a toast.
- **My bookings** (not in the original design) is a side panel opened from the top bar. It lists your upcoming bookings so you can cancel ones beyond the 7-day strip.
- **Loading:** the status pill, day counts and free gaps stay hidden until the first data load finishes, so the room never shows as free by mistake.
- **Not built yet:** Outlook calendar invites via Microsoft Graph (listed as nice-to-have), and realtime push. The app polls every 30 seconds instead of receiving pushed updates.
- **Logo:** `web/public/kelmer-logo.png` is the supplied PNG. Swap in a vector version when Kelmer provides one.
