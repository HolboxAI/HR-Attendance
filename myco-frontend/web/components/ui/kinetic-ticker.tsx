"use client";

import React from "react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

interface KineticTickerProps {
  items?: string[];
  className?: string;
}

export function KineticTicker({
  items = [
    "REAL-TIME BIOMETRIC RECOGNITION",
    "ZERO STATE DRIFT",
    "VERIFIED TIMELINES",
    "INSTANT AUDIT ACCURACY",
    "PERSISTENCE & EXCELLENCE",
  ],
  className,
}: KineticTickerProps) {
  return (
    <div
      className={cn(
        "relative w-full overflow-hidden py-1.5 sm:py-2 px-4 glass-panel rounded-full border border-line/60 shadow-xs [mask-image:linear-gradient(to_right,transparent,black_6%,black_94%,transparent)]",
        className
      )}
    >
      <div className="flex w-max select-none">
        <motion.div
          className="flex shrink-0 items-center whitespace-nowrap text-[10px] sm:text-[11px] font-mono font-medium uppercase tracking-[0.25em] text-ink-3"
          animate={{ x: ["0%", "-50%"] }}
          transition={{
            duration: 35,
            ease: "linear",
            repeat: Infinity,
          }}
        >
          {Array.from({ length: 2 }).map((_, loopIdx) => (
            <div key={loopIdx} className="flex items-center">
              {items.map((item, idx) => (
                <React.Fragment key={`${loopIdx}-${idx}`}>
                  <span className="hover:text-ink transition-colors">{item}</span>
                  <span className="mx-8 text-ink-3/40 select-none" aria-hidden>—</span>
                </React.Fragment>
              ))}
            </div>
          ))}
        </motion.div>
      </div>
    </div>
  );
}
