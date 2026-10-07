import { dur, fmt, toZoned } from './time';

/** Working day shown in the agenda (gaps are computed inside this window). */
export const DAY_START = 8 * 60;
export const DAY_END = 18 * 60;
/** Bookings may run outside the working day, within these bounds. */
export const BOOKABLE_START = 7 * 60;
export const BOOKABLE_END = 20 * 60;
export const SLOT_MINUTES = 15;
/** A start time this many minutes in the past is still accepted. */
export const PAST_GRACE_MINUTES = 4;
export const MIN_GAP_MINUTES = 15;
export const MAX_TITLE_LENGTH = 200;

/** A booking as seen by the client, in office-local terms. */
export interface Booking {
  id: string;
  title: string;
  date: string; // YYYY-MM-DD (office local)
  start: number; // minutes since midnight (office local)
  end: number;
  attendees: number;
  organizerId: string;
  organizerName: string;
}

/** Wire format returned by the API. */
export interface BookingDto {
  id: string;
  title: string;
  startsAt: string; // ISO instant
  endsAt: string;
  attendees: number;
  organizerId: string;
  organizerName: string;
  createdAt: string;
}

/** Converts an API booking into office-local date and minutes. */
export function fromDto(d: BookingDto, timeZone: string): Booking {
  const s = toZoned(d.startsAt, timeZone), e = toZoned(d.endsAt, timeZone);
  // A booking never crosses midnight (the API enforces this); clamp defensively.
  const end = e.date === s.date ? e.minutes : 24 * 60;
  return {
    id: d.id, title: d.title, date: s.date, start: s.minutes, end,
    attendees: d.attendees, organizerId: d.organizerId, organizerName: d.organizerName,
  };
}

export interface Draft {
  date: string;
  start: number;
  end: number;
  title: string;
  attendees: number;
}

export interface Clock {
  today: string;
  /** minutes since midnight, office local */
  now: number;
}

export interface ValidationError {
  code: 'end_before_start' | 'in_past' | 'overlap' | 'over_capacity' | 'no_attendees';
  message: string;
  clash?: Pick<Booking, 'id' | 'title' | 'start' | 'end'>;
}

export const range = (start: number, end: number) => fmt(start) + '–' + fmt(end);

export const overlapMessage = (b: Pick<Booking, 'title' | 'start' | 'end'>) =>
  `Overlaps with “${b.title}” (${range(b.start, b.end)}). Pick another time.`;

export const sortByStart = <T extends { start: number }>(list: T[]) => [...list].sort((x, y) => x.start - y.start);

export const bookingsOn = (bookings: Booking[], date: string) => sortByStart(bookings.filter(b => b.date === date));

/**
 * The first validation error that applies to a draft, or null.
 * The title is deliberately not checked here: a blank title only disables the button.
 */
export function validate(f: Draft, bookings: Booking[], clock: Clock, capacity: number): ValidationError | null {
  if (f.end <= f.start) return { code: 'end_before_start', message: 'End time must be after the start time.' };
  if (f.date < clock.today || (f.date === clock.today && f.start < clock.now - PAST_GRACE_MINUTES))
    return { code: 'in_past', message: 'That start time has already passed.' };
  const clash = bookingsOn(bookings, f.date).find(b => b.start < f.end && f.start < b.end);
  if (clash)
    return { code: 'overlap', message: overlapMessage(clash), clash: { id: clash.id, title: clash.title, start: clash.start, end: clash.end } };
  if (f.attendees > capacity) return { code: 'over_capacity', message: `The room seats up to ${capacity} people.` };
  if (f.attendees < 1) return { code: 'no_attendees', message: 'Add at least 1 attendee.' };
  return null;
}

export const isSubmittable = (f: Draft, error: ValidationError | null) => !error && f.title.trim().length > 0;

/** Free gaps (≥ 15 min) in the working day, starting no earlier than `from`. */
export function gaps(dayBookings: Booking[], from: number): [number, number][] {
  const out: [number, number][] = [];
  let cur = Math.max(DAY_START, from);
  for (const b of sortByStart(dayBookings)) {
    if (b.end <= cur) continue;
    if (b.start > cur) out.push([cur, Math.min(b.start, DAY_END)]);
    cur = Math.max(cur, b.end);
    if (cur >= DAY_END) break;
  }
  if (cur < DAY_END) out.push([cur, DAY_END]);
  return out.filter(([s, e]) => e - s >= MIN_GAP_MINUTES);
}

export type AgendaRow =
  | {
      kind: 'booking';
      booking: Booking;
      start: number;
      range: string;
      dur: string;
      isNow: boolean;
      isPast: boolean;
      canCancel: boolean;
    }
  | { kind: 'gap'; start: number; end: number; range: string; dur: string; suggestedEnd: number };

/** Bookings and free gaps for a day, interleaved in time order. */
export function agenda(bookings: Booking[], date: string, clock: Clock, meId: string): AgendaRow[] {
  const isToday = date === clock.today;
  const now = clock.now;
  const day = bookingsOn(bookings, date);
  const rows: AgendaRow[] = day.map(b => {
    const started = date < clock.today || (isToday && b.start <= now);
    return {
      kind: 'booking',
      booking: b,
      start: b.start,
      range: range(b.start, b.end),
      dur: dur(b.end - b.start),
      isNow: isToday && b.start <= now && now < b.end,
      isPast: isToday && b.end <= now,
      canCancel: b.organizerId === meId && !started,
    };
  });
  const from = isToday ? Math.ceil(now / SLOT_MINUTES) * SLOT_MINUTES : DAY_START;
  if (date >= clock.today)
    for (const [s, e] of gaps(day, from))
      rows.push({ kind: 'gap', start: s, end: e, range: range(s, e), dur: dur(e - s), suggestedEnd: Math.min(s + 60, e) });
  return rows.sort((x, y) => x.start - y.start);
}

export type RoomStatus =
  | { busy: true; until: number; current: Booking }
  | { busy: false; next: Booking | null };

/** Whether the room is occupied right now, and until when. */
export function roomStatus(bookings: Booking[], clock: Clock): RoomStatus {
  const list = bookingsOn(bookings, clock.today);
  // Back-to-back bookings extend the occupied period.
  const current = list.find(b => b.start <= clock.now && clock.now < b.end);
  if (current) {
    let until = current.end;
    for (const b of list) if (b.start <= until && b.end > until) until = b.end;
    return { busy: true, until, current };
  }
  return { busy: false, next: list.find(b => b.start > clock.now) ?? null };
}

export const statusLabel = (s: RoomStatus) =>
  s.busy ? `Occupied until ${fmt(s.until)}` : `Available · ${s.next ? 'until ' + fmt(s.next.start) : 'rest of day'}`;

/** Start/end options for the selects: 07:00–20:00 in 15-minute steps. */
export const timeOptions = (() => {
  const out: { value: number; label: string }[] = [];
  for (let m = BOOKABLE_START; m <= BOOKABLE_END; m += SLOT_MINUTES) out.push({ value: m, label: fmt(m) });
  return out;
})();

export const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .map(w => w[0])
    .filter(c => /\p{L}/u.test(c))
    .slice(0, 2)
    .join('')
    .toUpperCase() || '?';
