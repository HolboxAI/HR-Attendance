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
      className="bx-pop m-auto w-full max-w-md rounded-2xl border border-line glass-panel p-0 text-ink shadow-2xl backdrop:bg-black/10 backdrop:backdrop-blur-xl overflow-hidden"
    >
      <div className="p-6">
        <h2 className="font-display text-base font-bold text-ink">{title}</h2>
        <p className="mt-2 text-xs font-mono text-ink-3 leading-relaxed">{consequence}</p>
        {children && <div className="mt-3">{children}</div>}
      </div>
      <div className="flex justify-end gap-2.5 border-t border-line/60 bg-surface-2/60 px-6 py-4">
        <button
          type="button" onClick={onClose} disabled={busy}
          className="rounded-xl border border-line px-4 py-2 text-xs font-mono font-semibold text-ink-2 hover:text-ink hover:bg-surface-2 transition-all cursor-pointer disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          type="button" onClick={onConfirm} disabled={busy}
          className={`rounded-xl px-4 py-2 text-xs font-black uppercase tracking-wider disabled:opacity-50 active:scale-95 transition-all cursor-pointer ${
            tone === 'danger'
              ? 'bg-ink text-ground hover:opacity-90'
              : 'bg-ink text-ground hover:opacity-90'
          }`}
        >
          {busy ? 'Working…' : confirmLabel}
        </button>
      </div>
    </dialog>
  );
}
