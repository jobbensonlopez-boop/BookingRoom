import pg from 'pg';
import type { BookingDto } from '@kelmer/shared';

export type Db = pg.Pool;

export const createPool = (connectionString: string) => new pg.Pool({ connectionString });

interface Row {
  id: string;
  title: string;
  starts_at: Date;
  ends_at: Date;
  attendees: number;
  organizer_id: string;
  organizer_name: string;
  created_at: Date;
}

const COLUMNS = 'id, title, starts_at, ends_at, attendees, organizer_id, organizer_name, created_at';

export const toDto = (r: Row): BookingDto => ({
  id: r.id,
  title: r.title,
  startsAt: r.starts_at.toISOString(),
  endsAt: r.ends_at.toISOString(),
  attendees: r.attendees,
  organizerId: r.organizer_id,
  organizerName: r.organizer_name,
  createdAt: r.created_at.toISOString(),
});

/** Bookings that intersect [from, to). */
export async function listBookings(db: Db, from: Date, to: Date): Promise<BookingDto[]> {
  const { rows } = await db.query<Row>(
    `select ${COLUMNS} from bookings where starts_at < $2 and ends_at > $1 order by starts_at`,
    [from, to],
  );
  return rows.map(toDto);
}

export async function getBooking(db: Db, id: string): Promise<BookingDto | null> {
  const { rows } = await db.query<Row>(`select ${COLUMNS} from bookings where id = $1`, [id]);
  return rows[0] ? toDto(rows[0]) : null;
}

export interface NewBooking {
  title: string;
  startsAt: Date;
  endsAt: Date;
  attendees: number;
  organizerId: string;
  organizerName: string;
}

export async function insertBooking(db: Db, b: NewBooking): Promise<BookingDto> {
  const { rows } = await db.query<Row>(
    `insert into bookings (title, starts_at, ends_at, attendees, organizer_id, organizer_name)
     values ($1, $2, $3, $4, $5, $6) returning ${COLUMNS}`,
    [b.title, b.startsAt, b.endsAt, b.attendees, b.organizerId, b.organizerName],
  );
  return toDto(rows[0]);
}

export async function deleteBooking(db: Db, id: string) {
  await db.query('delete from bookings where id = $1', [id]);
}

/** Postgres error codes we translate into HTTP responses. */
export const PG_EXCLUSION_VIOLATION = '23P01';
export const PG_CHECK_VIOLATION = '23514';
export const PG_INVALID_TEXT = '22P02';
