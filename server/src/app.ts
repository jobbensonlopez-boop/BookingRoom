import express, { type ErrorRequestHandler, type RequestHandler } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import {
  BOOKABLE_END, BOOKABLE_START, MAX_TITLE_LENGTH, SLOT_MINUTES,
  addDays, fromDto, fromZoned, isIsoDate, overlapMessage, toZoned, validate,
  type BookingDto, type Draft,
} from '@kelmer/shared';
import { authenticate } from './auth';
import type { Config } from './config';
import {
  PG_CHECK_VIOLATION, PG_EXCLUSION_VIOLATION, PG_INVALID_TEXT,
  deleteBooking, getBooking, insertBooking, listBookings, listUpcomingFor, type Db,
} from './db';

export interface Deps {
  config: Config;
  db: Db;
  /** Server clock; injectable for tests. */
  now?: () => Date;
}

class HttpError extends Error {
  constructor(public status: number, public code: string, message: string, public extra: object = {}) {
    super(message);
  }
}

const wrap = (fn: RequestHandler): RequestHandler => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

const MAX_RANGE_DAYS = 62;

export function createApp({ config, db, now = () => new Date() }: Deps) {
  const tz = config.timeZone;
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '16kb' }));

  app.get('/api/health', (_req, res) => res.json({ ok: true }));

  const api = express.Router();
  api.use(authenticate(config.auth));

  /** Bookings intersecting an office-local day range. */
  const dayRange = async (fromDate: string, toDate: string) =>
    listBookings(db, fromZoned(fromDate, 0, tz), fromZoned(addDays(toDate, 1), 0, tz));

  api.get('/me', (req, res) => {
    res.json({ user: req.user, room: config.room, timeZone: tz, serverTime: now().toISOString() });
  });

  api.get('/bookings', wrap(async (req, res) => {
    const { from, to } = req.query;
    if (!isIsoDate(from) || !isIsoDate(to) || to < from)
      throw new HttpError(400, 'bad_request', 'Query parameters "from" and "to" must be dates (YYYY-MM-DD), from ≤ to.');
    if (addDays(from, MAX_RANGE_DAYS) < to) throw new HttpError(400, 'bad_request', `Range is limited to ${MAX_RANGE_DAYS} days.`);
    res.json({ bookings: await dayRange(from, to) });
  }));

  api.get('/my-bookings', wrap(async (req, res) => {
    res.json({ bookings: await listUpcomingFor(db, req.user!.id, now()) });
  }));

  api.post('/bookings', wrap(async (req, res) => {
    const user = req.user!;
    const body = req.body ?? {};
    const title = typeof body.title === 'string' ? body.title.trim() : '';
    if (!title) throw new HttpError(422, 'title_required', 'Add a meeting title.');
    if (title.length > MAX_TITLE_LENGTH) throw new HttpError(422, 'title_too_long', `Keep the title under ${MAX_TITLE_LENGTH} characters.`);
    if (!Number.isInteger(body.attendees)) throw new HttpError(422, 'no_attendees', 'Add at least 1 attendee.');

    const startsAt = new Date(body.startsAt), endsAt = new Date(body.endsAt);
    if (typeof body.startsAt !== 'string' || typeof body.endsAt !== 'string' || isNaN(+startsAt) || isNaN(+endsAt))
      throw new HttpError(422, 'bad_time', 'Start and end must be ISO timestamps.');

    const s = toZoned(startsAt, tz), e = toZoned(endsAt, tz);
    const onGrid = (d: Date, z: { date: string; minutes: number }) =>
      z.minutes % SLOT_MINUTES === 0 && +fromZoned(z.date, z.minutes, tz) === +d;
    if (!onGrid(startsAt, s) || !onGrid(endsAt, e))
      throw new HttpError(422, 'bad_time', `Times must be on a ${SLOT_MINUTES}-minute boundary.`);
    if (e.date !== s.date && +endsAt > +startsAt)
      throw new HttpError(422, 'bad_time', 'A booking must start and end on the same day.');

    const draft: Draft = { date: s.date, start: s.minutes, end: e.date === s.date ? e.minutes : s.minutes, title, attendees: body.attendees };
    if (draft.end > draft.start && (draft.start < BOOKABLE_START || draft.end > BOOKABLE_END))
      throw new HttpError(422, 'outside_hours', 'Bookings must be between 07:00 and 20:00.');

    // Same rules as the UI, checked against the server clock. The exclusion
    // constraint in Postgres is the final guard against concurrent requests.
    const clock = toZoned(now(), tz);
    const sameDay = (await dayRange(s.date, s.date)).map(b => fromDto(b, tz));
    const err = validate(draft, sameDay, { today: clock.date, now: clock.minutes }, config.room.capacity);
    if (err) throw new HttpError(err.code === 'overlap' ? 409 : 422, err.code, err.message, err.clash ? { clash: err.clash } : {});

    try {
      const booking = await insertBooking(db, { title, startsAt, endsAt, attendees: draft.attendees, organizerId: user.id, organizerName: user.name });
      res.status(201).json({ booking });
    } catch (e: any) {
      if (e?.code === PG_EXCLUSION_VIOLATION) {
        const clash = (await listBookings(db, startsAt, endsAt)).map(b => fromDto(b, tz))[0];
        throw new HttpError(409, 'overlap', clash ? overlapMessage(clash) : 'That time was just booked by someone else. Pick another time.',
          clash ? { clash: { id: clash.id, title: clash.title, start: clash.start, end: clash.end } } : {});
      }
      if (e?.code === PG_CHECK_VIOLATION) throw new HttpError(422, 'invalid', 'That booking is not valid.');
      throw e;
    }
  }));

  api.delete('/bookings/:id', wrap(async (req, res) => {
    let booking: BookingDto | null;
    try {
      booking = await getBooking(db, req.params.id);
    } catch (e: any) {
      if (e?.code === PG_INVALID_TEXT) booking = null;
      else throw e;
    }
    if (!booking) throw new HttpError(404, 'not_found', 'That booking no longer exists.');
    if (booking.organizerId !== req.user!.id) throw new HttpError(403, 'forbidden', 'Only the organizer can cancel this booking.');
    if (+new Date(booking.startsAt) <= +now()) throw new HttpError(409, 'started', 'This booking has already started.');
    await deleteBooking(db, booking.id);
    res.status(204).end();
  }));

  app.use('/api', api);
  app.use('/api', (_req, res) => res.status(404).json({ error: { code: 'not_found', message: 'Not found.' } }));

  // In production the built frontend is served from the same origin.
  if (config.staticDir && fs.existsSync(config.staticDir)) {
    const dir = path.resolve(config.staticDir);
    app.use(express.static(dir, { index: false }));
    app.get('*', (_req, res) => res.sendFile(path.join(dir, 'index.html')));
  }

  const onError: ErrorRequestHandler = (err, _req, res, _next) => {
    if (err instanceof HttpError) return res.status(err.status).json({ error: { code: err.code, message: err.message, ...err.extra } });
    if (err?.type === 'entity.parse.failed') return res.status(400).json({ error: { code: 'bad_request', message: 'Invalid JSON.' } });
    console.error(err);
    res.status(500).json({ error: { code: 'internal', message: 'Something went wrong. Try again.' } });
  };
  app.use(onError);

  return app;
}
