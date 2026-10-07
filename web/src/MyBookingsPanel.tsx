import { dur, longDate, range, type Booking, type Clock } from '@kelmer/shared';

interface Props {
  bookings: Booking[] | null; // null while loading
  error: string | null;
  clock: Clock;
  onShowDay: (date: string) => void;
  onCancel: (b: Booking) => void;
  onClose: () => void;
}

/** The signed-in user's upcoming bookings, with cancel. */
export function MyBookingsPanel({ bookings, error, clock, onShowDay, onCancel, onClose }: Props) {
  const started = (b: Booking) => b.date < clock.today || (b.date === clock.today && b.start <= clock.now);
  return (
    <>
      <div className="scrim" onClick={onClose} />
      <aside className="panel" role="dialog" aria-modal="true" aria-labelledby="my-title">
        <div className="panel-form">
          <div className="panel-header">
            <h2 id="my-title">My bookings</h2>
            <button type="button" className="close" onClick={onClose} aria-label="Close">✕</button>
          </div>
          {error && <div className="msg error" role="alert">{error}</div>}
          {bookings && !bookings.length && <div className="empty">You have no upcoming bookings.</div>}
          {bookings?.map(b => (
            <div key={b.id} className="mine">
              <div className="mine-main">
                <button type="button" className="link" onClick={() => onShowDay(b.date)}>
                  {b.date === clock.today ? 'Today' : longDate(b.date)}
                </button>
                <span className="mine-range">{range(b.start, b.end)} · {dur(b.end - b.start)}</span>
                <span className="mine-title">{b.title}</span>
                <span className="mine-meta">{b.attendees} {b.attendees === 1 ? 'attendee' : 'attendees'}</span>
              </div>
              {started(b)
                ? <span className="badge">In progress</span>
                : <button type="button" className="btn small cancel" onClick={() => onCancel(b)}>Cancel</button>}
            </div>
          ))}
        </div>
      </aside>
    </>
  );
}
