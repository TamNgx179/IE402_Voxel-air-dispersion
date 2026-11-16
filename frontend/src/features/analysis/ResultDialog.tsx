import { useEffect, useRef, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';

export function CsvDownload({ id, label, busyLabel, busy, disabled, onClick }: {
  id: string;
  label: string;
  busyLabel: string;
  busy: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  const text = busy ? busyLabel : label;
  return (
    <span className="analysis-icon-action">
      <button id={id} type="button" aria-label={text} disabled={disabled || busy} onClick={onClick}>
        <i className={busy ? 'bi bi-hourglass-split' : 'bi bi-download'} aria-hidden="true" />
      </button>
      <span className="analysis-icon-tooltip" aria-hidden="true">{text}</span>
    </span>
  );
}

interface ResultDialogProps {
  id: string;
  open: boolean;
  title: string;
  closeLabel: string;
  onClose: () => void;
  initialFocus?: RefObject<HTMLElement>;
  headingHelp?: ReactNode;
  actions: ReactNode;
  children: ReactNode;
}

/** Native modality keeps the map inert and returns keyboard focus on close. */
export function ResultDialog({ id, open, title, closeLabel, onClose, initialFocus, headingHelp, actions, children }: ResultDialogProps) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog || !open) return;
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
    (initialFocus?.current ?? closeRef.current)?.focus({ preventScroll: true });
    return () => {
      if (typeof dialog.close === 'function') dialog.close();
      else dialog.removeAttribute('open');
    };
  }, [open, initialFocus]);

  return createPortal(
    <dialog
      ref={dialogRef}
      id={id}
      className="analysis-result-dialog"
      aria-labelledby={`${id}-title`}
      hidden={!open}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target !== event.currentTarget) return;
        const rect = event.currentTarget.getBoundingClientRect();
        if (event.clientX < rect.left || event.clientX > rect.right ||
            event.clientY < rect.top || event.clientY > rect.bottom) onClose();
      }}
    >
      <div className="analysis-dialog-header">
        <div className="analysis-actions">
          {actions}
          <button ref={closeRef} id={id.replace(/-result$/, '-close')} type="button" aria-label={closeLabel} onClick={onClose}>
            <i className="bi bi-x-lg" aria-hidden="true" />
          </button>
        </div>
        <div className="section-heading">
          <h2 id={`${id}-title`}>{title}</h2>
          {headingHelp}
        </div>
      </div>
      <div className="analysis-dialog-body">{children}</div>
    </dialog>,
    document.body,
  );
}
