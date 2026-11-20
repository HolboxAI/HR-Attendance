"use client";

import { type ReactNode } from "react";

export interface KioskCardProps {
  children: ReactNode;
  className?: string;
  onClick?: () => void;
  edgeColor?: "emerald" | "rose" | "amber" | "sky";
  style?: React.CSSProperties;
  disabled?: boolean;
}

const GRADIENTS: Record<string, string> = {
  emerald:
    "conic-gradient(from 0deg, #10b981 0%, #34d399 25%, #059669 50%, #34d399 75%, #10b981 100%)",
  rose:
    "conic-gradient(from 0deg, #f43f5e 0%, #fb7185 25%, #e11d48 50%, #fb7185 75%, #f43f5e 100%)",
  amber:
    "conic-gradient(from 0deg, #f59e0b 0%, #fbbf24 25%, #d97706 50%, #fbbf24 75%, #f59e0b 100%)",
  sky:
    "conic-gradient(from 0deg, #0ea5e9 0%, #38bdf8 25%, #0284c7 50%, #38bdf8 75%, #0ea5e9 100%)",
};

const BORDER_COLORS: Record<string, string> = {
  emerald: "rgba(16, 185, 129, 0.45)",
  rose: "rgba(244, 63, 94, 0.45)",
  amber: "rgba(245, 158, 11, 0.45)",
  sky: "rgba(14, 165, 233, 0.45)",
};

const SHADOW_COLORS: Record<string, string> = {
  emerald: "0 10px 30px -4px rgba(16, 185, 129, 0.16), 0 2px 8px -1px rgba(0, 0, 0, 0.04)",
  rose: "0 10px 30px -4px rgba(244, 63, 94, 0.16), 0 2px 8px -1px rgba(0, 0, 0, 0.04)",
  amber: "0 10px 30px -4px rgba(245, 158, 11, 0.16), 0 2px 8px -1px rgba(0, 0, 0, 0.04)",
  sky: "0 10px 30px -4px rgba(14, 165, 233, 0.16), 0 2px 8px -1px rgba(0, 0, 0, 0.04)",
};

export function KioskCard({
  children,
  className = "",
  onClick,
  edgeColor = "emerald",
  style,
  disabled = false,
}: KioskCardProps) {
  const gradient = GRADIENTS[edgeColor] || GRADIENTS.emerald;
  const fallbackBorder = BORDER_COLORS[edgeColor] || BORDER_COLORS.emerald;
  const shadow = SHADOW_COLORS[edgeColor] || SHADOW_COLORS.emerald;

  return (
    <>
      <style jsx>{`
        .kiosk-card-btn {
          position: relative;
          width: 100%;
          border-radius: 1.75rem;
          padding: 2.5px;
          background: #ffffff;
          border: 1.5px solid ${fallbackBorder};
          display: flex;
          align-items: stretch;
          justify-content: stretch;
          cursor: pointer;
          touch-action: manipulation;
          -webkit-tap-highlight-color: transparent;
          -webkit-appearance: none;
          appearance: none;
          overflow: hidden;
          box-shadow: ${shadow};
          transition: transform 0.12s ease, box-shadow 0.15s ease;
          outline: none;
        }

        .kiosk-card-btn:active:not(:disabled) {
          transform: scale(0.96);
          box-shadow: 0 2px 10px -2px rgba(0, 0, 0, 0.08);
        }

        .kiosk-card-btn:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }

        .kiosk-edge-spin {
          position: absolute;
          top: -150%;
          left: -150%;
          width: 400%;
          height: 400%;
          z-index: 1;
          background: ${gradient};
          -webkit-animation: kiosk-spin 6s linear infinite;
          animation: kiosk-spin 6s linear infinite;
          pointer-events: none;
          opacity: 0.85;
          will-change: transform;
        }

        .kiosk-inner-surface {
          position: relative;
          z-index: 2;
          width: 100%;
          height: 100%;
          background: #ffffff;
          border-radius: calc(1.75rem - 2.5px);
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          box-sizing: border-box;
        }

        @-webkit-keyframes kiosk-spin {
          from {
            -webkit-transform: rotate(0deg);
          }
          to {
            -webkit-transform: rotate(360deg);
          }
        }

        @keyframes kiosk-spin {
          from {
            transform: rotate(0deg);
          }
          to {
            transform: rotate(360deg);
          }
        }
      `}</style>

      <button
        type="button"
        className={`kiosk-card-btn ${className}`.trim()}
        onClick={onClick}
        disabled={disabled}
        style={style}
      >
        <span className="kiosk-edge-spin" aria-hidden="true" />
        <span className="kiosk-inner-surface">{children}</span>
      </button>
    </>
  );
}

export default KioskCard;
