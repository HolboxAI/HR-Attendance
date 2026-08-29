'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion, useMotionValue, useSpring } from 'framer-motion';

import { proxy } from '@/lib/format';

/**
 * Hover an employee's avatar (or name, where a list has no avatar) and their
 * reference photo floats up beside the cursor - the same photo every check-in
 * is verified against, so HR sees the face behind the row.
 *
 * Design constraints this encodes, in order of importance:
 * - The card NEVER covers the thing being hovered. It trails the cursor at an
 *   offset, flipping to the other side near a viewport edge, and is
 *   pointer-events-none throughout - the name stays clickable and the click
 *   still goes to the profile.
 * - It works for every employee automatically. The photo comes from the live
 *   enrolment endpoint; someone not yet enrolled (or a viewer without HR
 *   rights - the endpoint is hr_admin) gets an initials card saying "No photo
 *   yet" instead of a broken image. As faces are added, no code changes.
 * - The photo stays crisp while the page behind the card blurs: the frame is
 *   translucent with backdrop-blur, the image itself is solid on top.
 * - Medium-small on purpose - a preview, not a lightbox.
 */

const CARD_W = 160;
const CARD_H = 200;
const GAP = 22;

/**
 * What each hover taught us ('ok' | 'none'), kept for the page's lifetime so
 * the second hover over an unenrolled person answers instantly instead of
 * re-firing a request that will 404 again.
 */
const photoState = new Map<string, 'ok' | 'none'>();

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  const first = parts[0]?.[0] ?? '';
  const last = parts.length > 1 ? parts[parts.length - 1][0] : '';
  return (first + last).toUpperCase();
}

export function FacePeek({
  code, name, className, children,
}: {
  code: string;
  name: string;
  className?: string;
  children: React.ReactNode;
}) {
  const [active, setActive] = useState(false);
  const [canHover, setCanHover] = useState(false);
  const [, bump] = useState(0); // re-render when a photo load fails

  const mx = useMotionValue(0);
  const my = useMotionValue(0);
  const springCfg = { damping: 22, stiffness: 260, mass: 0.5 };
  const x = useSpring(mx, springCfg);
  const y = useSpring(my, springCfg);

  // Touch screens have no hover; this also doubles as the mounted gate the
  // portal needs (document does not exist during SSR).
  useEffect(() => {
    setCanHover(window.matchMedia('(hover: hover)').matches);
  }, []);

  function target(e: React.MouseEvent): [number, number] {
    // Above-right of the cursor by default: the row being hovered - the
    // name, the code, the link - stays completely visible below the card.
    // Near a viewport edge the card flips sides rather than clipping.
    const px = e.clientX + GAP + CARD_W > window.innerWidth
      ? e.clientX - GAP - CARD_W
      : e.clientX + GAP;
    const py = e.clientY - GAP - CARD_H < 0
      ? e.clientY + GAP
      : e.clientY - GAP - CARD_H;
    return [px, py];
  }

  function place(e: React.MouseEvent) {
    const [px, py] = target(e);
    mx.set(px);
    my.set(py);
  }

  const noPhoto = photoState.get(code) === 'none';

  return (
    <span
      className={className}
      onMouseEnter={(e) => {
        if (!canHover) return;
        // Teleport, don't spring, to the first position - otherwise the card
        // sails in from wherever the last hover left it.
        const [px, py] = target(e);
        mx.jump(px);
        my.jump(py);
        setActive(true);
      }}
      onMouseMove={(e) => { if (active) place(e); }}
      onMouseLeave={() => setActive(false)}
    >
      {children}
      {canHover && createPortal(
        // Portalled into #bx-shell, not body: the light/dark tokens are
        // scoped to the shell, and a card outside it would render in the
        // dark defaults no matter what theme the page is showing.
        <motion.div
          style={{ x, y }}
          className="pointer-events-none fixed left-0 top-0 z-[100]"
          aria-hidden
        >
          <AnimatePresence>
            {active && (
              <motion.div
                initial={{ opacity: 0, scale: 0.6, filter: 'blur(8px)' }}
                animate={{ opacity: 1, scale: 1, filter: 'blur(0px)' }}
                exit={{ opacity: 0, scale: 0.6, filter: 'blur(8px)' }}
                transition={{ type: 'spring', stiffness: 320, damping: 24 }}
                style={{ width: CARD_W }}
                className="overflow-hidden rounded-2xl border border-line bg-surface/70 p-1.5 shadow-2xl backdrop-blur-md"
              >
                {noPhoto ? (
                  <div className="flex h-36 w-full flex-col items-center justify-center gap-2 rounded-xl bg-surface-2">
                    <span className="flex size-12 items-center justify-center rounded-full bg-accent/15 text-lg font-bold text-accent">
                      {initials(name)}
                    </span>
                    <span className="text-[10px] font-mono uppercase tracking-widest text-ink-3">
                      No photo yet
                    </span>
                  </div>
                ) : (
                  // Plain <img>, not next/image: the bytes come through the
                  // authed gateway with Cache-Control: no-store (biometric
                  // data), which an optimizing image proxy must not re-cache.
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={proxy(`/api/v1/admin/enrolments/${code}/photo`)}
                    alt={name}
                    onLoad={() => photoState.set(code, 'ok')}
                    onError={() => { photoState.set(code, 'none'); bump((n) => n + 1); }}
                    className="h-36 w-full rounded-xl bg-surface-2 object-cover"
                  />
                )}
                <div className="px-1.5 pb-1 pt-2">
                  <span className="block truncate text-xs font-semibold text-ink">{name}</span>
                  <span className="block text-[10px] font-mono text-ink-3">{code}</span>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>,
        document.getElementById('bx-shell') ?? document.body,
      )}
    </span>
  );
}
