import { useEffect, useRef } from 'react';

interface Props {
  title: string;
  body: string;
  confirmLabel: string;
  dismissLabel: string;
  onConfirm: () => void;
  onDismiss: () => void;
}

export function ConfirmDialog({ title, body, confirmLabel, dismissLabel, onConfirm, onDismiss }: Props) {
  const keepRef = useRef<HTMLButtonElement>(null);
  const dismissRef = useRef(onDismiss);
  dismissRef.current = onDismiss;
  useEffect(() => {
    keepRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && dismissRef.current();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="dialog-scrim" onClick={onDismiss}>
      <div className="dialog" role="alertdialog" aria-modal="true" aria-labelledby="dlg-title" onClick={e => e.stopPropagation()}>
        <h2 id="dlg-title">{title}</h2>
        <p>{body}</p>
        <div className="dialog-actions">
          <button className="btn danger large" onClick={onConfirm}>{confirmLabel}</button>
          <button ref={keepRef} className="btn secondary large" onClick={onDismiss}>{dismissLabel}</button>
        </div>
      </div>
    </div>
  );
}
