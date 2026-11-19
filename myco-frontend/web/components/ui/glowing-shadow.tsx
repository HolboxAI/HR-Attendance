"use client";

import { type ReactNode } from "react";

export interface GlowingShadowButtonProps {
  children: ReactNode;
  className?: string;
  onClick?: () => void;
  onTouchEnd?: (e: React.TouchEvent<HTMLDivElement>) => void;
  variant?: "card" | "circle";
  edgeColor?: "emerald" | "rose" | "amber" | "sky" | "rainbow";
  style?: React.CSSProperties;
}

export type GlowingShadowProps = GlowingShadowButtonProps;

const GRADIENTS = {
  emerald:
    "conic-gradient(from 0deg, transparent 0%, #10b981 25%, #34d399 38%, transparent 50%, #059669 75%, transparent 100%)",
  rose:
    "conic-gradient(from 0deg, transparent 0%, #f43f5e 25%, #fb7185 38%, transparent 50%, #e11d48 75%, transparent 100%)",
  amber:
    "conic-gradient(from 0deg, transparent 0%, #f59e0b 25%, #fbbf24 38%, transparent 50%, #d97706 75%, transparent 100%)",
  sky:
    "conic-gradient(from 0deg, transparent 0%, #0ea5e9 25%, #38bdf8 38%, transparent 50%, #0284c7 75%, transparent 100%)",
  rainbow:
    "conic-gradient(from 0deg, transparent 0%, #10b981 18%, #6366f1 38%, transparent 50%, #ec4899 68%, #f59e0b 88%, transparent 100%)",
};

export function GlowingShadow({
  children,
  className = "",
  onClick,
  onTouchEnd,
  variant = "card",
  edgeColor = "rainbow",
  style,
}: GlowingShadowButtonProps) {
  const gradient = GRADIENTS[edgeColor] || GRADIENTS.rainbow;

  return (
    <>
      <style jsx>{`
        .light-glow-card {
          position: relative;
          width: 100%;
          border-radius: ${variant === "circle" ? "50%" : "1.75rem"};
          padding: 2.5px;
          background: transparent;
          display: flex;
          align-items: stretch;
          justify-content: stretch;
          cursor: pointer;
          touch-action: manipulation;
          -webkit-tap-highlight-color: transparent;
          overflow: hidden;
          isolation: isolate;
          box-shadow: 0 4px 20px -2px rgba(0, 0, 0, 0.04);
        }

        .light-glow-card:active {
          transform: scale(0.97);
          transition: transform 0.1s ease;
        }

        /* Subtle ambient glow behind the edge only */
        .edge-ambient {
          position: absolute;
          inset: -100%;
          z-index: 0;
          opacity: 0.28;
          filter: blur(10px);
          background: ${gradient};
          animation: edge-spin 5.5s linear infinite;
          pointer-events: none;
        }

        /* Crisp sharp moving light on the 2.5px edge boundary */
        .edge-light {
          position: absolute;
          inset: -100%;
          z-index: 1;
          background: ${gradient};
          animation: edge-spin 5.5s linear infinite;
          pointer-events: none;
        }

        /* Pure white interior card surface */
        .edge-card-surface {
          position: relative;
          z-index: 2;
          width: 100%;
          height: 100%;
          background: #ffffff;
          border-radius: ${variant === "circle" ? "50%" : "calc(1.75rem - 2.5px)"};
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          box-sizing: border-box;
        }

        @keyframes edge-spin {
          from {
            transform: rotate(0deg);
          }
          to {
            transform: rotate(360deg);
          }
        }
      `}</style>

      <div
        className={`light-glow-card ${className}`.trim()}
        role="button"
        tabIndex={0}
        onClick={onClick}
        onTouchEnd={onTouchEnd}
        style={style}
      >
        <span className="edge-ambient" aria-hidden="true" />
        <span className="edge-light" aria-hidden="true" />
        <div className="edge-card-surface">{children}</div>
      </div>
    </>
  );
}

export default GlowingShadow;
