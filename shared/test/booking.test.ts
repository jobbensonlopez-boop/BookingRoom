import { describe, expect, it } from 'vitest';
import {
  agenda, fmt, fromZoned, gaps, initials, longDate, roomStatus, statusLabel, toZoned, validate, workingDays,
  type Booking, type Draft,
} from '../src';

const T = '2026-10-07'; // a Wednesday
let n = 0;
const b = (start: number, end: number, title = 'Meeting', organizerId = 'other', date = T): Booking => ({
  id: String(++n), title, date, start, end, attendees: 4, organizerId, organizerName: 'Someone',
});
const clock = { today: T, now: 640 }; // 10:40
const draft = (p: Partial<Draft> = {}): Draft => ({ date: T, start: 720, end: 780, title: 'x', attendees: 4, ...p });

describe('validate', () => {
  const list = [b(600, 690, 'Client call'), b(780, 840, 'Lunch')];

  it('accepts a free slot', () => expect(validate(draft(), list, clock, 8)).toBeNull());

  it('reports errors in priority order', () => {
    expect(validate(draft({ start: 780, end: 780, attendees: 99 }), list, clock, 8)?.code).toBe('end_before_start');
    expect(validate(draft({ start: 600, end: 660, attendees: 99 }), list, clock, 8)?.code).toBe('in_past');
    expect(validate(draft({ start: 660, end: 720, attendees: 99 }), list, clock, 8)?.code).toBe('overlap');
    expect(validate(draft({ attendees: 9 }), list, clock, 8)?.message).toBe('The room seats up to 8 people.');
    expect(validate(draft({ attendees: 0 }), list, clock, 8)?.message).toBe('Add at least 1 attendee.');
  });

  it('formats the overlap message', () => {
    expect(validate(draft({ start: 765, end: 800 }), list, clock, 8)?.message).toBe('Overlaps with “Lunch” (13:00–14:00). Pick another time.');
  });

  it('treats touching bookings as non-overlapping', () => {
    expect(validate(draft({ start: 690, end: 780 }), list, clock, 8)).toBeNull();
  });

  it('allows 4 minutes of grace for the start time', () => {
    expect(validate(draft({ start: 645 - 9, end: 690 + 30 }), [], { today: T, now: 640 }, 8)).toBeNull();
    expect(validate(draft({ start: 630, end: 700 }), [], { today: T, now: 640 }, 8)?.code).toBe('in_past');
    expect(validate(draft({ date: '2026-10-06' }), [], clock, 8)?.code).toBe('in_past');
  });

  it('ignores bookings on other days', () => {
    expect(validate(draft(), [b(720, 780, 'x', 'o', '2026-10-08')], clock, 8)).toBeNull();
  });
});

describe('gaps & agenda', () => {
  it('finds gaps inside the working day, dropping ones under 15 min', () => {
    expect(gaps([b(540, 570), b(580, 690), b(930, 990)], 480)).toEqual([[480, 540], [690, 930], [990, 1080]]);
  });

  it('clamps gaps to 18:00 and ignores bookings outside the day', () => {
    expect(gaps([b(420, 500), b(1140, 1200)], 480)).toEqual([[500, 1080]]);
  });

  it('starts today at now rounded up to 15 min and interleaves rows', () => {
    const list = [b(540, 570), b(600, 690, 'Call'), b(930, 990, 'Mine', 'me')];
    const rows = agenda(list, T, clock, 'me');
    expect(rows.map(r => r.kind + ':' + r.range)).toEqual([
      'booking:09:00–09:30', 'booking:10:00–11:30', 'gap:11:30–15:30', 'booking:15:30–16:30', 'gap:16:30–18:00',
    ]);
    const [past, now, gap, mine] = rows as any[];
    expect(past.isPast).toBe(true);
    expect(now.isNow).toBe(true);
    expect(now.canCancel).toBe(false);
    expect(gap.suggestedEnd).toBe(750);
    expect(mine.canCancel).toBe(true);
  });

  it('uses the full day for future dates and rounds up today', () => {
    const rows = agenda([], '2026-10-08', clock, 'me');
    expect(rows.map(r => r.range)).toEqual(['08:00–18:00']);
    expect(agenda([], T, { today: T, now: 641 }, 'me').map(r => r.range)).toEqual(['10:45–18:00']);
    expect(agenda([], T, { today: T, now: 1080 }, 'me')).toEqual([]);
  });
});

describe('roomStatus', () => {
  it('is occupied during a booking, extended by back-to-back bookings', () => {
    const s = roomStatus([b(600, 690), b(690, 720)], clock);
    expect(statusLabel(s)).toBe('Occupied until 12:00');
  });
  it('is available until the next booking or rest of day', () => {
    expect(statusLabel(roomStatus([b(780, 840)], clock))).toBe('Available · until 13:00');
    expect(statusLabel(roomStatus([b(540, 570)], clock))).toBe('Available · rest of day');
  });
});

describe('time helpers', () => {
  it('skips weekends', () => {
    expect(workingDays('2026-10-09', 3)).toEqual(['2026-10-09', '2026-10-12', '2026-10-13']);
    expect(workingDays('2026-10-10', 1)).toEqual(['2026-10-12']);
  });
  it('formats', () => {
    expect(fmt(545)).toBe('09:05');
    expect(longDate(T)).toBe('Wednesday 7 October');
    expect(initials('Alex Morgan')).toBe('AM');
    expect(initials('Omar H.')).toBe('OH');
  });
  it('round-trips office-local times across timezones and DST', () => {
    for (const tz of ['Asia/Dubai', 'Europe/London', 'America/New_York', 'UTC']) {
      for (const [date, m] of [['2026-03-29', 600], ['2026-10-25', 90], ['2026-10-07', 1200], ['2026-01-01', 0]] as const) {
        expect(toZoned(fromZoned(date, m, tz), tz)).toEqual({ date, minutes: m });
      }
    }
    expect(fromZoned('2026-10-07', 600, 'Asia/Dubai').toISOString()).toBe('2026-10-07T06:00:00.000Z');
    expect(fromZoned('2026-07-01', 600, 'Europe/London').toISOString()).toBe('2026-07-01T09:00:00.000Z');
  });
});
