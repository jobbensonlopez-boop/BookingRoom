import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  BOOKABLE_END, agenda, bookingsOn, dayOfMonth, fromDto, fromZoned, initials, isSubmittable, longDate,
  range, roomStatus, shortWeekday, statusLabel, toZoned, validate, workingDays,
  type Booking, type Draft,
} from '@kelmer/shared';
import { ApiError, api, type Session } from './api';
import { BookingPanel } from './BookingPanel';
import { ConfirmDialog } from './ConfirmDialog';
import { MyBookingsPanel } from './MyBookingsPanel';

const REFRESH_MS = 30_000;
const TOAST_MS = 3_500;

export function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api.session().then(setSession, (e: Error) => setError(e.message));
  }, []);
  if (error) return <div className="fatal">{error}</div>;
  if (!session) return <div className="screen" aria-busy="true" />;
  return <RoomBooking session={session} />;
}

function RoomBooking({ session }: { session: Session }) {
  const { timeZone: tz, user: me } = session;
  const { name: roomName, capacity } = session.room;

  // ---- Clock (office timezone, corrected for client clock skew) ----
  const skew = useMemo(() => Date.parse(session.serverTime) - Date.now(), [session.serverTime]);
  const [tick, setTick] = useState(() => Date.now());
  const clock = useMemo(() => {
    const z = toZoned(tick + skew, tz);
    return { today: z.date, now: z.minutes };
  }, [tick, skew, tz]);

  const days = useMemo(() => workingDays(clock.today, 7), [clock.today]);
  const [pickedDate, setPickedDate] = useState(days[0]);
  const selected = pickedDate >= clock.today ? pickedDate : days[0];

  // ---- Form & panel ----
  const [panelOpen, setPanelOpen] = useState(false);
  const [form, setForm] = useState<Draft>({ date: clock.today, start: 720, end: 780, title: '', attendees: 4 });
  const [serverError, setServerError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [confirming, setConfirming] = useState<Booking | null>(null);

  // ---- My bookings panel ----
  const [mineOpen, setMineOpen] = useState(false);
  const [mine, setMine] = useState<Booking[] | null>(null);
  const [mineError, setMineError] = useState<string | null>(null);
  const loadMine = useCallback(async () => {
    try {
      setMine((await api.mine()).map(d => fromDto(d, tz)));
      setMineError(null);
    } catch (e) {
      setMineError((e as Error).message);
    }
  }, [tz]);

  // ---- Data: the visible 7-day window, plus any day selected/being booked beyond it ----
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  // Nothing availability-related is shown until the first fetch lands, so the
  // room never flashes as "Available"/"All free" while bookings are loading.
  const [loaded, setLoaded] = useState(false);
  const lastDay = days[days.length - 1];
  const rangesKey = JSON.stringify([
    [clock.today, lastDay],
    ...[...new Set([selected, panelOpen ? form.date : ''])].filter(d => d > lastDay).map(d => [d, d]),
  ]);
  const reqId = useRef(0);
  const refresh = useCallback(async () => {
    const id = ++reqId.current;
    try {
      const lists = await Promise.all((JSON.parse(rangesKey) as [string, string][]).map(([f, t]) => api.bookings(f, t)));
      if (id !== reqId.current) return;
      const byId = new Map<string, Booking>();
      for (const d of lists.flat()) byId.set(d.id, fromDto(d, tz));
      setBookings([...byId.values()]);
      setLoadError(null);
      setLoaded(true);
    } catch (e) {
      if (id === reqId.current) setLoadError((e as Error).message);
    }
  }, [rangesKey, tz]);
  useEffect(() => void refresh(), [refresh]);

  // Recompute status every 30 s and when the window regains focus; refresh data at the same time.
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;
  useEffect(() => {
    const update = () => {
      setTick(Date.now());
      refreshRef.current();
    };
    const onVisible = () => document.visibilityState === 'visible' && update();
    const iv = setInterval(update, REFRESH_MS);
    window.addEventListener('focus', update);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(iv);
      window.removeEventListener('focus', update);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  // ---- Toast ----
  const [toast, setToast] = useState('');
  const toastTimer = useRef<ReturnType<typeof setTimeout>>();
  const showToast = (msg: string) => {
    setToast(msg);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(''), TOAST_MS);
  };
  useEffect(() => () => clearTimeout(toastTimer.current), []);

  // ---- Derived ----
  const status = roomStatus(bookings, clock);
  const rows = agenda(bookings, selected, clock, me.id);
  const validation = validate(form, bookings, clock, capacity);
  const error = validation?.message ?? serverError;
  const canSubmit = loaded && isSubmittable(form, validation) && !serverError && !submitting;

  // ---- Actions ----
  const openWith = (start: number, end: number) => {
    setForm(f => ({ ...f, date: selected, start, end }));
    setServerError(null);
    setMineOpen(false);
    setPanelOpen(true);
  };
  const openMine = () => {
    setPanelOpen(false);
    setMine(null);
    setMineOpen(true);
    loadMine();
  };
  const openNew = () => {
    const gap = rows.find(r => r.kind === 'gap');
    if (gap && gap.kind === 'gap') openWith(gap.start, gap.suggestedEnd);
    else openWith(720, 780);
  };
  const updateForm = (patch: Partial<Draft>) => {
    setForm(f => {
      const next = { ...f, ...patch };
      // Moving the start to or past the end pushes the end to start + 60 min.
      if (patch.start !== undefined && patch.end === undefined && f.end <= patch.start)
        next.end = Math.min(patch.start + 60, BOOKABLE_END);
      return next;
    });
    setServerError(null);
  };

  const submit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      const dto = await api.create({
        title: form.title.trim(),
        startsAt: fromZoned(form.date, form.start, tz).toISOString(),
        endsAt: fromZoned(form.date, form.end, tz).toISOString(),
        attendees: form.attendees,
      });
      const b = fromDto(dto, tz);
      setBookings(list => [...list.filter(x => x.id !== b.id), b]);
      setPanelOpen(false);
      setPickedDate(b.date);
      setForm(f => ({ ...f, title: '' }));
      showToast(`Booked “${b.title}” · ${range(b.start, b.end)}`);
    } catch (e) {
      setServerError((e as Error).message);
      if (e instanceof ApiError && e.status === 409) refresh();
    } finally {
      setSubmitting(false);
    }
  };

  const cancelBooking = async (b: Booking) => {
    setConfirming(null);
    try {
      await api.cancel(b.id);
      setBookings(list => list.filter(x => x.id !== b.id));
      setMine(list => list && list.filter(x => x.id !== b.id));
      showToast(`Cancelled “${b.title}” · ${range(b.start, b.end)}`);
    } catch (e) {
      showToast((e as Error).message);
      refresh();
      if (mineOpen) loadMine();
    }
  };

  // Escape closes a side panel (the confirm dialog handles its own Escape).
  useEffect(() => {
    if ((!panelOpen && !mineOpen) || confirming) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setPanelOpen(false);
      setMineOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [panelOpen, mineOpen, confirming]);

  return (
    <div className="screen">
      <header className="appbar">
        <img src="/kelmer-logo.png" alt="Kelmer Group" className="logo" />
        <div className="divider" />
        <div className="app-title">Room booking</div>
        {loaded && (
          <span className={'status ' + (status.busy ? 'busy' : 'free')} role="status">
            <span className="dot" />
            {statusLabel(status)}
          </span>
        )}
        <div className="spacer" />
        <button className="btn secondary appbar-secondary" onClick={openMine}>My bookings</button>
        <button className="btn primary" onClick={openNew}>+ New booking</button>
        <div className="avatar" title={me.name} aria-label={me.name}>{initials(me.name)}</div>
      </header>

      <nav className="days" aria-label="Choose a day">
        {days.map(d => {
          const n = bookingsOn(bookings, d).length;
          return (
            <button key={d} className={'day' + (d === selected ? ' selected' : '')} aria-pressed={d === selected} onClick={() => setPickedDate(d)}>
              <span className="dow">{d === clock.today ? 'Today' : shortWeekday(d)}</span>
              <span className="num">{dayOfMonth(d)}</span>
              <span className="count">{!loaded ? '\u00a0' : n ? `${n} booked` : 'All free'}</span>
            </button>
          );
        })}
      </nav>

      <main className="content">
        <div className="heading">
          <h1>{longDate(selected)}</h1>
          <div className="room-meta">{roomName} · seats {capacity} · 08:00–18:00</div>
        </div>
        {loadError && <div className="msg error" role="alert">{loadError}</div>}
        <div className="agenda">
          {!loaded && !loadError && <div className="empty">Loading…</div>}
          {loaded && rows.map(r =>
            r.kind === 'booking' ? (
              <div key={r.booking.id} className={'row booking' + (r.isPast ? ' past' : '')}>
                <div className="range">{r.range}</div>
                <div className="what"><span className="title">{r.booking.title}</span><span className="dur">{r.dur}</span></div>
                <div className="who">{r.booking.organizerName} · {r.booking.attendees}</div>
                <div className="actions">
                  {r.isNow && <span className="badge">In progress</span>}
                  {r.canCancel && <button className="btn small cancel" onClick={() => setConfirming(r.booking)}>Cancel</button>}
                </div>
              </div>
            ) : (
              <div key={'gap-' + r.start} className="row gap">
                <div className="range">{r.range}</div>
                <div className="free">Free · {r.dur}</div>
                <div />
                <div className="actions">
                  <button className="btn small book" onClick={() => openWith(r.start, r.suggestedEnd)}>Book</button>
                </div>
              </div>
            ),
          )}
          {loaded && !rows.length && <div className="empty">No free time left on this day.</div>}
        </div>
        {toast && <div className="toast" role="status">{toast}</div>}
      </main>

      {panelOpen && (
        <BookingPanel
          form={form}
          organizerName={me.name}
          minDate={clock.today}
          error={error}
          canSubmit={canSubmit}
          submitting={submitting}
          onChange={updateForm}
          onSubmit={submit}
          onClose={() => setPanelOpen(false)}
        />
      )}

      {mineOpen && (
        <MyBookingsPanel
          bookings={mine}
          error={mineError}
          clock={clock}
          onShowDay={date => {
            setPickedDate(date);
            setMineOpen(false);
          }}
          onCancel={setConfirming}
          onClose={() => setMineOpen(false)}
        />
      )}

      {confirming && (
        <ConfirmDialog
          title={`Cancel “${confirming.title}”?`}
          body={`${longDate(confirming.date)}, ${range(confirming.start, confirming.end)}. The room will be freed for others.`}
          confirmLabel="Cancel booking"
          dismissLabel="Keep booking"
          onConfirm={() => cancelBooking(confirming)}
          onDismiss={() => setConfirming(null)}
        />
      )}
    </div>
  );
}
