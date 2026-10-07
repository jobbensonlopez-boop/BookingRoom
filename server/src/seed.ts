// Inserts the prototype's demo bookings for today and the next two working days.
// Development only.
import { fromZoned, toZoned, workingDays } from '@kelmer/shared';
import { loadConfig } from './config';
import { createPool, insertBooking } from './db';

const config = loadConfig();
if (process.env.NODE_ENV === 'production') throw new Error('Refusing to seed in production');
const db = createPool(config.databaseUrl);
const tz = config.timeZone;
const me = config.auth.mode === 'dev' ? { id: config.auth.userId, name: config.auth.userName } : { id: 'seed-me', name: 'Alex Morgan' };
const other = (name: string) => ({ id: 'dev-' + name.toLowerCase().replace(/\W+/g, '-'), name });

const [d0, d1, d2] = workingDays(toZoned(new Date(), tz).date, 3);
const rows: [string, number, number, string, number, { id: string; name: string }][] = [
  [d0, 540, 570, 'Daily stand-up', 6, other('Omar H.')],
  [d0, 600, 690, 'Client call – Al Noor', 5, other('Sarah K.')],
  [d0, 780, 840, 'Lunch & learn: VAT update', 8, other('Rania B.')],
  [d0, 930, 990, 'Proposal review', 4, me],
  [d1, 540, 570, 'Daily stand-up', 6, other('Omar H.')],
  [d1, 660, 780, 'Workshop – market entry', 7, other('Sarah K.')],
  [d2, 540, 570, 'Daily stand-up', 6, other('Omar H.')],
  [d2, 840, 900, '1:1 Review', 2, me],
];

let n = 0;
for (const [date, s, e, title, attendees, who] of rows) {
  try {
    await insertBooking(db, {
      title, attendees, organizerId: who.id, organizerName: who.name,
      startsAt: fromZoned(date, s, tz), endsAt: fromZoned(date, e, tz),
    });
    n++;
  } catch (err: any) {
    if (err?.code !== '23P01') throw err; // already seeded / slot taken
  }
}
console.log(`seeded ${n} bookings`);
await db.end();
