'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * A number that settles into place instead of teleporting. Runs once on
 * mount over ~0.6s with an ease-out curve; respects prefers-reduced-motion
 * by rendering the final value immediately. The real value is always in the
 * DOM for screen readers - the animation is purely visual.
 */
export function CountUp({ value, className = '' }: { value: number; className?: string }) {
  const [shown, setShown] = useState(0);
  const done = useRef(false);

  useEffect(() => {
    if (done.current) { setShown(value); return; }
    done.current = true;
    if (typeof window !== 'undefined'
        && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setShown(value);
      return;
    }
    const start = performance.now();
    const dur = 600;
    let raf = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / dur);
      const eased = 1 - Math.pow(1 - t, 3);
      setShown(Math.round(value * eased));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value]);

  return <span className={`tnum ${className}`}>{shown}</span>;
}
