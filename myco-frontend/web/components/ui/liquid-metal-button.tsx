"use client";

import { Sparkles } from "lucide-react";
import type React from "react";
import { useEffect, useRef, useState } from "react";

import { LiquidMetalCanvasFill, useLiquidMetalShader } from "./use-liquid-metal-shader";

export interface LiquidMetalButtonProps {
  label?: string;
  onClick?: (e?: React.MouseEvent<HTMLButtonElement>) => void;
  viewMode?: "text" | "icon";
  type?: "button" | "submit" | "reset";
  disabled?: boolean;
  className?: string;
  width?: number | string;
  height?: number | string;
  textColor?: string;
  variant?: "dark" | "liquid" | "silver";
  children?: React.ReactNode;
}

export function LiquidMetalButton({
  label = "Get Started",
  onClick,
  viewMode = "text",
  type = "button",
  disabled = false,
  className = "",
  width = "100%",
  height = 48,
  textColor,
  variant = "liquid",
  children,
}: LiquidMetalButtonProps) {
  const { hostRef, shaderRef, mountRef } = useLiquidMetalShader(0.6);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [isHovered, setIsHovered] = useState(false);
  const [isPressed, setIsPressed] = useState(false);
  const [ripples, setRipples] = useState<Array<{ x: number; y: number; id: number }>>([]);
  const rippleId = useRef(0);

  useEffect(() => {
    const id = "lmb-shader-fill-style";
    if (typeof document === "undefined" || document.getElementById(id)) return;
    const style = document.createElement("style");
    style.id = id;
    style.textContent = `
      .lmb-shader-fill canvas {
        position: absolute !important;
        inset: 0 !important;
        width: 100% !important;
        height: 100% !important;
        display: block !important;
        object-fit: cover !important;
        border-radius: inherit !important;
      }
      @keyframes lmb-ripple {
        from { transform: translate(-50%,-50%) scale(0); opacity: .55 }
        to   { transform: translate(-50%,-50%) scale(5); opacity: 0 }
      }
    `;
    document.head.appendChild(style);
  }, []);

  const heightCss = typeof height === "number" ? `${height}px` : height;
  const widthCss = typeof width === "number" ? `${width}px` : width;
  const fill = width === "100%";

  const handleMouseEnter = () => {
    if (disabled) return;
    setIsHovered(true);
    mountRef.current?.setSpeed?.(1);
  };
  const handleMouseLeave = () => {
    setIsHovered(false);
    setIsPressed(false);
    mountRef.current?.setSpeed?.(0.6);
  };
  const handleClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    if (disabled) return;
    mountRef.current?.setSpeed?.(2.4);
    setTimeout(() => mountRef.current?.setSpeed?.(isHovered ? 1 : 0.6), 300);
    if (buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      const ripple = { x: e.clientX - rect.left, y: e.clientY - rect.top, id: rippleId.current++ };
      setRipples((prev) => [...prev, ripple]);
      setTimeout(() => setRipples((prev) => prev.filter((r) => r.id !== ripple.id)), 600);
    }
    onClick?.(e);
  };

  const labelColor = textColor || "#ffffff";

  return (
    <div
      ref={hostRef}
      className={`relative ${fill ? "w-full" : "inline-block"} ${className}`}
      style={{
        width: fill ? "100%" : widthCss,
        height: heightCss,
        borderRadius: 100,
        transform: isPressed ? "translateY(1px) scale(0.98)" : "none",
        transition: "transform 0.15s ease, box-shadow 0.15s ease",
        boxShadow: isPressed
          ? "0 1px 2px rgba(0,0,0,0.35)"
          : isHovered
            ? "0 10px 24px rgba(0,0,0,0.28)"
            : "0 8px 18px rgba(0,0,0,0.22)",
        opacity: disabled ? 0.6 : 1,
      }}
    >
      <LiquidMetalCanvasFill shaderRef={shaderRef} />

      {/* Glass wash — lets the metal show across the WHOLE pill, not a half rim */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          borderRadius: 100,
          pointerEvents: "none",
          background:
            variant === "silver"
              ? "linear-gradient(180deg, rgba(255,255,255,0.35) 0%, rgba(226,232,240,0.2) 100%)"
              : variant === "dark"
                ? "linear-gradient(180deg, rgba(20,20,20,0.45) 0%, rgba(0,0,0,0.55) 100%)"
                : "linear-gradient(180deg, rgba(255,255,255,0.12) 0%, rgba(0,0,0,0.28) 100%)",
          border: "1px solid rgba(255,255,255,0.28)",
        }}
      />

      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 8,
          pointerEvents: "none",
          zIndex: 2,
        }}
      >
        {viewMode === "icon" && (
          <Sparkles size={16} style={{ color: labelColor, filter: "drop-shadow(0 1px 2px rgba(0,0,0,0.5))" }} />
        )}
        {viewMode === "text" &&
          (children ?? (
            <span
              style={{
                fontSize: 14,
                fontWeight: 600,
                color: labelColor,
                textShadow: "0 1px 2px rgba(0,0,0,0.55)",
                whiteSpace: "nowrap",
              }}
            >
              {label}
            </span>
          ))}
      </div>

      <button
        ref={buttonRef}
        type={type}
        disabled={disabled}
        onClick={handleClick}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        onMouseDown={() => !disabled && setIsPressed(true)}
        onMouseUp={() => !disabled && setIsPressed(false)}
        aria-label={label}
        style={{
          position: "absolute",
          inset: 0,
          borderRadius: 100,
          background: "transparent",
          border: "none",
          cursor: disabled ? "not-allowed" : "pointer",
          zIndex: 3,
          overflow: "hidden",
        }}
      >
        {ripples.map((ripple) => (
          <span
            key={ripple.id}
            style={{
              position: "absolute",
              left: ripple.x,
              top: ripple.y,
              width: 20,
              height: 20,
              borderRadius: "50%",
              background: "radial-gradient(circle, rgba(255,255,255,0.45) 0%, rgba(255,255,255,0) 70%)",
              pointerEvents: "none",
              animation: "lmb-ripple 0.6s ease-out",
            }}
          />
        ))}
      </button>
    </div>
  );
}

export default LiquidMetalButton;
