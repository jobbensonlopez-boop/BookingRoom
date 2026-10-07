import { useEffect, useRef } from 'react';
import { dur, range, timeOptions, type Draft } from '@kelmer/shared';

interface Props {
  form: Draft;
  organizerName: string;
  minDate: string;
  error: string | null;
  canSubmit: boolean;
  submitting: boolean;
  onChange: (patch: Partial<Draft>) => void;
  onSubmit: () => void;
  onClose: () => void;
}

export function BookingPanel({ form, organizerName, minDate, error, canSubmit, submitting, onChange, onSubmit, onClose }: Props) {
  const titleRef = useRef<HTMLInputElement>(null);
  useEffect(() => titleRef.current?.focus(), []);

  const options = timeOptions.map(t => <option key={t.value} value={t.value}>{t.label}</option>);

  return (
    <>
      <div className="scrim" onClick={onClose} />
      <aside className="panel" role="dialog" aria-modal="true" aria-labelledby="panel-title">
        <form
          className="panel-form"
          onSubmit={e => {
            e.preventDefault();
            onSubmit();
          }}
        >
          <div className="panel-header">
            <h2 id="panel-title">New booking</h2>
            <button type="button" className="close" onClick={onClose} aria-label="Close">✕</button>
          </div>

          <label className="field">
            Meeting title
            <input ref={titleRef} className="input" value={form.title} maxLength={200} placeholder="e.g. Client kickoff"
              onChange={e => onChange({ title: e.target.value })} />
          </label>

          <label className="field">
            Date
            <input type="date" className="input" value={form.date} min={minDate}
              onChange={e => e.target.value && onChange({ date: e.target.value })} />
          </label>

          <div className="two-col">
            <label className="field">
              Start
              <select className="input" value={form.start} onChange={e => onChange({ start: +e.target.value })}>{options}</select>
            </label>
            <label className="field">
              End
              <select className="input" value={form.end} onChange={e => onChange({ end: +e.target.value })}>{options}</select>
            </label>
          </div>

          <label className="field">
            Attendees
            <input type="number" className="input attendees" min={1} value={form.attendees}
              onChange={e => onChange({ attendees: Math.max(0, parseInt(e.target.value || '0', 10) || 0) })} />
          </label>

          <div className="meta">Booked by {organizerName} · {form.end > form.start ? dur(form.end - form.start) : '—'}</div>

          {error
            ? <div className="msg error" role="alert">{error}</div>
            : <div className="msg ok">✓ {range(form.start, form.end)} is free</div>}

          <div className="spacer" />
          <div className="panel-footer">
            <button type="submit" className="btn primary large" disabled={!canSubmit} aria-busy={submitting}>Book room</button>
            <button type="button" className="btn secondary large" onClick={onClose}>Cancel</button>
          </div>
        </form>
      </aside>
    </>
  );
}
