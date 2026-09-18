"use client";

import { useEffect, type ReactNode } from "react";

interface GlowingShadowProps {
  children: ReactNode;
  className?: string;
  /** Card tiles on the dashboard, or the round check-in control. */
  variant?: "card" | "circle";
}

const STYLE_ID = "bx-glowing-shadow-style";

const CSS = `
@property --hue { syntax: "<number>"; inherits: true; initial-value: 0; }
@property --rotate { syntax: "<number>"; inherits: true; initial-value: 0; }
@property --bg-y { syntax: "<number>"; inherits: true; initial-value: 0; }
@property --bg-x { syntax: "<number>"; inherits: true; initial-value: 0; }
@property --glow-translate-y { syntax: "<number>"; inherits: true; initial-value: 0; }
@property --bg-size { syntax: "<number>"; inherits: true; initial-value: 0; }
@property --glow-opacity { syntax: "<number>"; inherits: true; initial-value: 0; }
@property --glow-blur { syntax: "<number>"; inherits: true; initial-value: 0; }
@property --glow-scale { syntax: "<number>"; inherits: true; initial-value: 2; }
@property --glow-radius { syntax: "<number>"; inherits: true; initial-value: 2; }
@property --white-shadow { syntax: "<number>"; inherits: true; initial-value: 0; }

.bx-glow {
  --card-color: rgba(18, 18, 22, 0.92);
  --card-radius: 1rem;
  --border-width: 2px;
  --bg-size: 1;
  --hue: 0;
  --hue-speed: 1;
  --rotate: 0;
  --animation-speed: 4s;
  --interaction-speed: 0.55s;
  --glow-scale: 1.15;
  --scale-factor: 1;
  --glow-blur: 0.9;
  --glow-opacity: 0.85;
  --glow-radius: 100;
  --glow-rotate-unit: 1deg;
  position: relative;
  z-index: 2;
  width: 100%;
  height: 100%;
  min-height: 8.5rem;
  color: white;
  display: flex;
  align-items: stretch;
  justify-content: stretch;
  border-radius: var(--card-radius);
  cursor: default;
  isolation: isolate;
  overflow: hidden;
}
html:not(.bx-dark-mode) .bx-glow {
  --card-color: rgba(255, 255, 255, 0.94);
}
.bx-glow:before,
.bx-glow:after {
  content: "";
  display: block;
  position: absolute;
  inset: 0;
  border-radius: var(--card-radius);
  pointer-events: none;
}
.bx-glow:before {
  z-index: 0;
  background: hsl(0deg 0% 16%) radial-gradient(
    30% 30% at calc(var(--bg-x) * 1%) calc(var(--bg-y) * 1%),
    hsl(calc(var(--hue) * var(--hue-speed) * 1deg) 100% 90%) calc(0% * var(--bg-size)),
    hsl(calc(var(--hue) * var(--hue-speed) * 1deg) 100% 80%) calc(20% * var(--bg-size)),
    hsl(calc(var(--hue) * var(--hue-speed) * 1deg) 100% 60%) calc(40% * var(--bg-size)),
    transparent 100%
  );
  animation: bx-glow-hue var(--animation-speed) linear infinite,
             bx-glow-rotate-bg var(--animation-speed) linear infinite;
  transition: --bg-size var(--interaction-speed) ease;
}
.bx-glow-face {
  position: relative;
  z-index: 1;
  flex: 1;
  width: auto;
  margin: var(--border-width);
  background: var(--card-color);
  border-radius: calc(var(--card-radius) - var(--border-width));
  padding: 1.25rem;
  display: flex;
  flex-direction: column;
  justify-content: center;
}
.bx-glow-orb {
  --glow-translate-y: 0;
  display: block;
  position: absolute;
  z-index: 0;
  width: 22%;
  height: 36%;
  left: 39%;
  top: 32%;
  pointer-events: none;
  animation: bx-glow-rotate var(--animation-speed) linear infinite;
  transform: rotateZ(calc(var(--rotate) * var(--glow-rotate-unit)));
  transform-origin: center;
  border-radius: calc(var(--glow-radius) * 1px);
}
.bx-glow-orb:after {
  content: "";
  display: block;
  filter: blur(calc(var(--glow-blur) * 10px));
  width: 130%;
  height: 130%;
  left: -15%;
  top: -15%;
  background: hsl(calc(var(--hue) * var(--hue-speed) * 1deg) 100% 60%);
  position: relative;
  border-radius: calc(var(--glow-radius) * 1px);
  animation: bx-glow-hue var(--animation-speed) linear infinite;
  transform: scaleY(calc(var(--glow-scale) * var(--scale-factor) / 1.1))
             scaleX(calc(var(--glow-scale) * var(--scale-factor) * 1.2))
             translateY(calc(var(--glow-translate-y) * 1%));
  opacity: var(--glow-opacity);
}
@keyframes bx-glow-rotate-bg {
  0% { --bg-x: 0; --bg-y: 0; }
  25% { --bg-x: 100; --bg-y: 0; }
  50% { --bg-x: 100; --bg-y: 100; }
  75% { --bg-x: 0; --bg-y: 100; }
  100% { --bg-x: 0; --bg-y: 0; }
}
@keyframes bx-glow-rotate {
  from { --rotate: -70; --glow-translate-y: -65; }
  to { --rotate: 290; --glow-translate-y: -65; }
}
@keyframes bx-glow-hue {
  0% { --hue: 0; }
  100% { --hue: 360; }
}

.bx-glow.bx-glow-circle {
  --card-radius: 50%;
  --border-width: 3px;
  --glow-blur: 0.85;
  --glow-scale: 1.15;
  --glow-opacity: 0.8;
  min-height: 0;
  aspect-ratio: 1 / 1;
  cursor: pointer;
}
.bx-glow.bx-glow-circle .bx-glow-face {
  border-radius: 50%;
  align-items: center;
  justify-content: center;
  text-align: center;
  padding: 0.75rem;
}
.bx-glow.bx-glow-circle .bx-glow-orb {
  width: 26%;
  height: 26%;
  left: 37%;
  top: 37%;
}
`;

export function GlowingShadow({
  children,
  className = "",
  variant = "card",
}: GlowingShadowProps) {
  useEffect(() => {
    if (typeof document === "undefined") return;
    let style = document.getElementById(STYLE_ID) as HTMLStyleElement | null;
    if (!style) {
      style = document.createElement("style");
      style.id = STYLE_ID;
      document.head.appendChild(style);
    }
    // Always write current CSS so a circle variant is not stuck with an older
    // card-only stylesheet from a previous visit in the same tab.
    style.textContent = CSS;
  }, []);

  const shape = variant === "circle" ? "bx-glow-circle" : "";

  return (
    <div className={`bx-glow ${shape} ${className}`.trim()}>
      <span className="bx-glow-orb" aria-hidden />
      <div className="bx-glow-face">{children}</div>
    </div>
  );
}

export default GlowingShadow;
