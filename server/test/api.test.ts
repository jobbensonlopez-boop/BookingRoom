// Integration tests against a real Postgres. Set TEST_DATABASE_URL to run them
// (the database is wiped). Skipped otherwise.
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { fromZoned } from '@kelmer/shared';
import { createApp } from '../src/app';
import { loadConfig } from '../src/config';
import { createPool, type Db } from '../src/db';
import { migrate } from '../src/migrate';

const url = process.env.TEST_DATABASE_URL;
const TZ = 'Asia/Dubai';
const DAY = '2026-10-07';
const at = (hhmm: string, date = DAY) => {
  const [h, m] = hhmm.split(':').map(Number);
  return fromZoned(date, h * 60 + m, TZ).toISOString();
};

describe.skipIf(!url)('bookings API', () => {
  let db: Db;
  let app: ReturnType<typeof createApp>;
  let now = new Date(at('10:40'));

  beforeAll(async () => {
    db = createPool(url!);
    await db.query('drop table if exists bookings, schema_migrations');
    await migrate(db, () => {});
    const config = loadConfig({ DATABASE_URL: url, OFFICE_TIMEZONE: TZ, AUTH_MODE: 'dev' });
    app = createApp({ config, db, now: () => now });
  });
  afterAll(async () => db?.end());
  beforeEach(async () => {
    now = new Date(at('10:40'));
    await db.query('delete from bookings');
  });

  const book = (body: object, user?: string) => {
    const r = request(app).post('/api/bookings').send({ title: 'Planning', startsAt: at('12:00'), endsAt: at('13:00'), attendees: 4, ...body });
    return user ? r.set('X-Dev-User', user) : r;
  };

  it('returns the session', async () => {
    const res = await request(app).get('/api/me');
    expect(res.body).toMatchObject({ user: { id: 'dev-alex', name: 'Alex Morgan' }, room: { name: 'Boardroom', capacity: 8 }, timeZone: TZ });
  });

  it('creates and lists bookings; organizer comes from the signed-in user', async () => {
    const res = await book({ organizerName: 'Mallory', organizerId: 'x' });
    expect(res.status).toBe(201);
    expect(res.body.booking).toMatchObject({ title: 'Planning', organizerId: 'dev-alex', organizerName: 'Alex Morgan', attendees: 4 });
    const list = await request(app).get(`/api/bookings?from=${DAY}&to=${DAY}`);
    expect(list.body.bookings).toHaveLength(1);
    const other = await request(app).get('/api/bookings?from=2026-10-08&to=2026-10-09');
    expect(other.body.bookings).toHaveLength(0);
  });

  it('rejects overlaps with 409 and the overlap message', async () => {
    await book({ title: 'Lunch & learn', startsAt: at('13:00'), endsAt: at('14:00') });
    const res = await book({ startsAt: at('13:30'), endsAt: at('14:30') }, 'Sarah K.');
    expect(res.status).toBe(409);
    expect(res.body.error.message).toBe('Overlaps with “Lunch & learn” (13:00–14:00). Pick another time.');
    expect((await book({ startsAt: at('14:00'), endsAt: at('15:00') })).status).toBe(201);
  });

  it('lets only one of many simultaneous requests win', async () => {
    const results = await Promise.all(
      Array.from({ length: 8 }, (_, i) => book({ title: 'Race ' + i, startsAt: at('15:00'), endsAt: at('16:00') }, 'User ' + i)),
    );
    expect(results.filter(r => r.status === 201)).toHaveLength(1);
    expect(results.filter(r => r.status === 409)).toHaveLength(7);
  });

  it('enforces the database exclusion constraint directly', async () => {
    const ins = (s: string, e: string) =>
      db.query("insert into bookings (title, starts_at, ends_at, attendees, organizer_id, organizer_name) values ('t', $1, $2, 2, 'a', 'A')", [at(s), at(e)]);
    await ins('09:00', '10:00');
    await expect(ins('09:59', '10:30')).rejects.toMatchObject({ code: '23P01' });
    await expect(ins('10:00', '10:30')).resolves.toBeTruthy();
  });

  it('validates against the server clock and room rules', async () => {
    const cases: [object, number, string][] = [
      [{ endsAt: at('12:00') }, 422, 'end_before_start'],
      [{ startsAt: at('10:00'), endsAt: at('11:00') }, 422, 'in_past'],
      [{ attendees: 9 }, 422, 'over_capacity'],
      [{ attendees: 0 }, 422, 'no_attendees'],
      [{ title: '   ' }, 422, 'title_required'],
      [{ startsAt: at('12:05') }, 422, 'bad_time'],
      [{ startsAt: at('06:45'), endsAt: at('07:30') }, 422, 'outside_hours'],
      [{ startsAt: at('19:30'), endsAt: at('20:15') }, 422, 'outside_hours'],
      [{ startsAt: 'nope' }, 422, 'bad_time'],
    ];
    for (const [body, status, code] of cases) {
      const res = await book(body);
      expect([res.status, res.body.error?.code], JSON.stringify(body)).toEqual([status, code]);
    }
    // 4 minutes of grace
    expect((await book({ startsAt: at('10:45'), endsAt: at('11:00') })).status).toBe(201);
    now = new Date(at('10:49'));
    expect((await book({ startsAt: at('11:00'), endsAt: at('11:15') })).status).toBe(201);
  });

  it('lets only the organizer cancel, and only before it starts', async () => {
    const { body } = await book({});
    const id = body.booking.id;
    expect((await request(app).delete(`/api/bookings/${id}`).set('X-Dev-User', 'Sarah K.')).status).toBe(403);
    now = new Date(at('12:00'));
    expect((await request(app).delete(`/api/bookings/${id}`)).status).toBe(409);
    now = new Date(at('11:59'));
    expect((await request(app).delete(`/api/bookings/${id}`)).status).toBe(204);
    expect((await request(app).delete(`/api/bookings/${id}`)).status).toBe(404);
    expect((await request(app).delete('/api/bookings/not-a-uuid')).status).toBe(404);
  });

  it('validates list parameters', async () => {
    expect((await request(app).get('/api/bookings?from=2026-10-08&to=2026-10-07')).status).toBe(400);
    expect((await request(app).get('/api/bookings?from=x&to=y')).status).toBe(400);
    expect((await request(app).get('/api/bookings?from=2026-01-01&to=2026-12-31')).status).toBe(400);
  });
});
