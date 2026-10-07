// Time helpers. Times of day are represented as minutes since midnight in the
// office's local timezone; dates as ISO "YYYY-MM-DD" strings in that timezone.

export const pad = (n: number) => String(n).padStart(2, '0');

/** 600 → "10:00" */
export const fmt = (m: number) => pad(Math.floor(m / 60)) + ':' + pad(m % 60);

/** "10:00" → 600, or NaN if malformed */
export const parseHHMM = (s: string) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s.trim());
  return m ? +m[1] * 60 + +m[2] : NaN;
};

/** 90 → "1h 30m" */
export const dur = (m: number) => {
  const h = Math.floor(m / 60), r = m % 60;
  return (h ? h + 'h' : '') + (h && r ? ' ' : '') + (r ? r + 'm' : '') || '0m';
};

const civil = (s: string) => {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
};
const civilIso = (d: Date) => d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate());

export const isIsoDate = (s: unknown): s is string =>
  typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && civilIso(civil(s)) === s;

export const addDays = (s: string, n: number) => {
  const d = civil(s);
  d.setUTCDate(d.getUTCDate() + n);
  return civilIso(d);
};

/** 0 = Sunday … 6 = Saturday */
export const weekday = (s: string) => civil(s).getUTCDay();

/** "Wednesday 7 October" */
export const longDate = (s: string) =>
  civil(s).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });

/** "Thu" */
export const shortWeekday = (s: string) => civil(s).toLocaleDateString('en-GB', { weekday: 'short', timeZone: 'UTC' });

export const dayOfMonth = (s: string) => civil(s).getUTCDate();

/** The next `n` working days (Mon–Fri) starting at `from` (inclusive if it is a working day). */
export function workingDays(from: string, n: number): string[] {
  const out: string[] = [];
  for (let d = from; out.length < n; d = addDays(d, 1)) {
    const wd = weekday(d);
    if (wd !== 0 && wd !== 6) out.push(d);
  }
  return out;
}

// ---- Timezone conversion (no dependencies, uses Intl) ----

const dtfCache = new Map<string, Intl.DateTimeFormat>();
function dtf(timeZone: string) {
  let f = dtfCache.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone, hourCycle: 'h23',
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
    dtfCache.set(timeZone, f);
  }
  return f;
}

function parts(instant: Date, timeZone: string) {
  const p: Record<string, number> = {};
  for (const { type, value } of dtf(timeZone).formatToParts(instant)) if (type !== 'literal') p[type] = +value;
  return { y: p.year, mo: p.month, d: p.day, h: p.hour % 24, mi: p.minute, s: p.second };
}

/** Offset (ms) of `timeZone` from UTC at `instant`. */
function offsetMs(instant: number, timeZone: string) {
  const p = parts(new Date(instant), timeZone);
  return Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi, p.s) - Math.floor(instant / 1000) * 1000;
}

/** Office-local date + minute of day for an instant. Seconds are truncated. */
export function toZoned(instant: Date | string | number, timeZone: string): { date: string; minutes: number } {
  const p = parts(new Date(instant), timeZone);
  return { date: p.y + '-' + pad(p.mo) + '-' + pad(p.d), minutes: p.h * 60 + p.mi };
}

/** The instant at which the office-local clock reads `date` + `minutes`. */
export function fromZoned(date: string, minutes: number, timeZone: string): Date {
  const [y, m, d] = date.split('-').map(Number);
  const wall = Date.UTC(y, m - 1, d, 0, minutes);
  const off1 = offsetMs(wall, timeZone);
  const off2 = offsetMs(wall - off1, timeZone);
  return new Date(wall - off2);
}

export function isValidTimeZone(tz: string) {
  try {
    dtf(tz);
    return true;
  } catch {
    return false;
  }
}
