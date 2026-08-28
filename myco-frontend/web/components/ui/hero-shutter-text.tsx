import React from 'react';

import { cn } from '@/lib/utils';

interface HeroTextProps {
  text?: string;
  className?: string;
}

const SIZE = 'text-[clamp(2.75rem,7vw,5rem)]';

/**
 * Per-character "shutter": three coloured slices sweep across each letter on a
 * repeating 2-second loop (the keyframes live in globals.css).
 *
 * Two deliberate departures from the component this came from, both of which
 * exist because the original made the word disappear.
 *
 * THE LETTER NEVER ANIMATES. It used to fade in from `opacity: 0` behind an
 * animated `filter: blur()`, which meant the word only existed while the
 * animation was running - so a paused rAF, a background tab or a dropped frame
 * left an empty panel. It also meant six characters being re-rasterised every
 * frame forever, because a blur cannot be composited. The letter is now plain,
 * static, always-on text, and the effect lives entirely in the slices.
 *
 * THE SLICES ARE CSS, NOT JAVASCRIPT. They animate only `transform` and
 * `opacity`, so the compositor runs them off the main thread and this costs
 * effectively nothing to leave open. Stagger comes from `animation-delay`,
 * which offsets the whole looping timeline rather than just the first pass.
 *
 * No 'use client' - there is no state, no effect and no browser API here, so
 * this stays a server component and ships no JavaScript at all.
 */
export default function HeroText({ text = 'IMMERSE', className = '' }: HeroTextProps) {
  const characters = text.split('');

  return (
    <div
      className={cn('flex flex-wrap items-center justify-center', className)}
      // The slices repeat each letter three times over. Naming the whole word
      // here and hiding the pieces keeps it one word to a screen reader.
      aria-label={text}
      role="img"
    >
      {characters.map((char, i) => {
        const stagger = 0.05 + i * 0.04;

        const slices = [
          { cls: 'bx-slice-ltr', delay: stagger, tint: 'text-[#8B7CF6]', clip: 'polygon(0 0, 100% 0, 100% 35%, 0 35%)' },
          { cls: 'bx-slice-rtl', delay: stagger + 0.1, tint: 'text-ink-2', clip: 'polygon(0 35%, 100% 35%, 100% 65%, 0 65%)' },
          { cls: 'bx-slice-ltr', delay: stagger + 0.2, tint: 'text-[#8B7CF6]', clip: 'polygon(0 65%, 100% 65%, 100% 100%, 0 100%)' },
        ];

        return (
          <div key={i} aria-hidden className="relative overflow-hidden px-[0.1vw]">
            <span
              className={cn(
                'font-display block font-black leading-none tracking-tighter text-ink',
                SIZE,
              )}
            >
              {char === ' ' ? ' ' : char}
            </span>

            {slices.map((s, n) => (
              <span
                key={n}
                className={cn(
                  'bx-slice pointer-events-none absolute inset-0 z-10 font-display font-black leading-none select-none',
                  s.cls,
                  s.tint,
                  SIZE,
                )}
                style={{ clipPath: s.clip, animationDelay: `${s.delay}s` }}
              >
                {char}
              </span>
            ))}
          </div>
        );
      })}
    </div>
  );
}
