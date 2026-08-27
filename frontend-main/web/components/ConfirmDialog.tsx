'use client';

import { useEffect, useRef } from 'react';

/**
 * A blocking confirmation that states its consequence. Used for the actions
 * that change someone's attendance or leave - the CLAUDE.md rule is that
 * every approving or destructive action says what will happen BEFORE it does.
 *
 * Native <dialog> gives focus trapping, Escape handling and a ::backdrop for
 * free, which is most of what an a11y dialog needs.
 */
export function ConfirmDialog({
  open, title, consequence, confirmLabel, tone = 'accent', busy = false,
  onConfirm, onClose, children,
}: {
  open: boolean;
  title: string;
  consequence: string;
  confirmLabel: string;
  tone?: 'accent' | 'danger';
  busy?: boolean;
  onConfirm: () => void;
  onClose: () => void;
  children?: React.ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onCancel={onClose}
      className="bx-pop m-auto w-full max-w-md rounded-xl border border-line bg-surface p-0 text-ink shadow-xl backdrop:bg-black/40 backdrop:backdrop-blur-sm"
    >
      <div className="p-5">
        <h2 className="font-display text-base font-bold">{title}</h2>
        <p className="mt-2 text-sm text-ink-2">{consequence}</p>
        {children && <div className="mt-3">{children}</div>}
      </div>
      <div className="flex justify-end gap-2 border-t border-line bg-surface-2/60 px-5 py-3">
        <button
          type="button" onClick={onClose} disabled={busy}
          className="rounded-md border border-line px-3 py-1.5 text-sm text-ink-2 hover:bg-surface-2 disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          type="button" onClick={onConfirm} disabled={busy}
          className={`rounded-md px-3 py-1.5 text-sm font-semibold disabled:opacity-50 ${
            tone === 'danger'
              ? 'bg-st-absent text-white hover:opacity-90'
              : 'bg-accent text-white hover:opacity-90'
          }`}
        >
          {busy ? 'Working…' : confirmLabel}
        </button>
      </div>
    </dialog>
  );
}
