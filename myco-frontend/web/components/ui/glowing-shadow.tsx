"use client";

import { type ReactNode } from "react";

export interface GlowingShadowButtonProps {
  children: ReactNode;
  className?: string;
  onClick?: () => void;
  variant?: "card" | "circle";
  edgeColor?: "emerald" | "rose" | "amber" | "sky" | "rainbow";
  style?: React.CSSProperties;
  disabled?: boolean;
}

export type GlowingShadowProps = GlowingShadowButtonProps;

const GRADIENTS = {
  emerald:
    "conic-gradient(from 0deg, #10b981 0%, #34d399 25%, #059669 50%, #34d399 75%, #10b981 100%)",
  rose:
    "conic-gradient(from 0deg, #f43f5e 0%, #fb7185 25%, #e11d48 50%, #fb7185 75%, #f43f5e 100%)",
  amber:
    "conic-gradient(from 0deg, #f59e0b 0%, #fbbf24 25%, #d97706 50%, #fbbf24 75%, #f59e0b 100%)",
  sky:
    "conic-gradient(from 0deg, #0ea5e9 0%, #38bdf8 25%, #0284c7 50%, #38bdf8 75%, #0ea5e9 100%)",
  rainbow:
    "conic-gradient(from 0deg, #10b981 0%, #6366f1 25%, #ec4899 50%, #f59e0b 75%, #10b981 100%)",
};

const BORDER_COLORS = {
  emerald: "rgba(16, 185, 129, 0.45)",
  rose: "rgba(244, 63, 94, 0.45)",
  amber: "rgba(245, 158, 11, 0.45)",
  sky: "rgba(14, 165, 233, 0.45)",
  rainbow: "rgba(99, 102, 241, 0.45)",
};

const SHADOW_COLORS = {
  emerald: "0 10px 30px -4px rgba(16, 185, 129, 0.16), 0 2px 8px -1px rgba(0, 0, 0, 0.04)",
  rose: "0 10px 30px -4px rgba(244, 63, 94, 0.16), 0 2px 8px -1px rgba(0, 0, 0, 0.04)",
  amber: "0 10px 30px -4px rgba(245, 158, 11, 0.16), 0 2px 8px -1px rgba(0, 0, 0, 0.04)",
  sky: "0 10px 30px -4px rgba(14, 165, 233, 0.16), 0 2px 8px -1px rgba(0, 0, 0, 0.04)",
  rainbow: "0 10px 30px -4px rgba(99, 102, 241, 0.16), 0 2px 8px -1px rgba(0, 0, 0, 0.04)",
};

export function GlowingShadow({
  children,
  className = "",
  onClick,
  variant = "card",
  edgeColor = "rainbow",
  style,
  disabled = false,
}: GlowingShadowButtonProps) {
  const gradient = GRADIENTS[edgeColor] || GRADIENTS.rainbow;
  const fallbackBorder = BORDER_COLORS[edgeColor] || BORDER_COLORS.rainbow;
  const shadow = SHADOW_COLORS[edgeColor] || SHADOW_COLORS.rainbow;
  const isCircle = variant === "circle";

  return (
    <button
      type="button"
      className={`relative w-full p-[2.5px] bg-white flex items-stretch justify-stretch cursor-pointer touch-manipulation overflow-hidden outline-none transition-all duration-150 active:scale-[0.97] disabled:opacity-60 disabled:cursor-not-allowed ${
        isCircle ? "rounded-full" : "rounded-3xl"
      } ${className}`.trim()}
      onClick={onClick}
      disabled={disabled}
      style={{
        border: `1.5px solid ${fallbackBorder}`,
        boxShadow: shadow,
        WebkitTapHighlightColor: "transparent",
        WebkitAppearance: "none",
        ...style,
      }}
    >
      {/* Ambient rotating edge glow */}
      <span
        className="absolute -top-[150%] -left-[150%] w-[400%] h-[400%] z-[1] pointer-events-none opacity-85 will-change-transform animate-spin-glow"
        style={{ background: gradient }}
        aria-hidden="true"
      />
      {/* Interior card surface */}
      <span
        className={`relative z-[2] w-full h-full bg-white flex flex-col items-center justify-center box-border ${
          isCircle ? "rounded-full" : "rounded-[calc(1.5rem-2px)]"
        }`}
      >
        {children}
      </span>
    </button>
  );
}

export default GlowingShadow;
