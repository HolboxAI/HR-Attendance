"use client";

import { liquidMetalFragmentShader, ShaderMount } from "@paper-design/shaders";
import { Sparkles } from "lucide-react";
import type React from "react";
import { useEffect, useRef, useState } from "react";

export interface LiquidMetalButtonProps {
  label?: string;
  onClick?: (e?: React.MouseEvent<HTMLButtonElement>) => void;
  viewMode?: "text" | "icon";
  type?: "button" | "submit" | "reset";
  disabled?: boolean;
  className?: string;
  /** Pixel width, or "100%" to fill the parent. */
  width?: number | string;
  height?: number;
  textColor?: string;
  children?: React.ReactNode;
}

/**
 * Chrome rim + dark inner capsule — the metal lives on the EDGE of the pill,
 * not across the face or the label. Width "100%" is measured in pixels so
 * ShaderMount paints the full perimeter instead of a half-width canvas.
 */
export function LiquidMetalButton({
  label = "Get Started",
  onClick,
  viewMode = "text",
  type = "button",
  disabled = false,
  className = "",
  width,
  height,
  textColor,
  children,
}: LiquidMetalButtonProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const shaderRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  // biome-ignore lint/suspicious/noExplicitAny: ShaderMount has no public types
  const shaderMount = useRef<any>(null);
  const [isHovered, setIsHovered] = useState(false);
  const [isPressed, setIsPressed] = useState(false);
  const [ripples, setRipples] = useState<Array<{ x: number; y: number; id: number }>>([]);
  const rippleId = useRef(0);
  const [measuredW, setMeasuredW] = useState(0);

  const fill = width === "100%";
  const fallbackW = viewMode === "icon" ? 46 : 142;
  const h = height ?? (viewMode === "icon" ? 46 : 46);
  const w = fill ? Math.max(measuredW, 1) : typeof width === "number" ? width : fallbackW;
  const ready = !fill || measuredW >= 8;

  useEffect(() => {
    const el = hostRef.current;
    if (!el || !fill) return;
    const apply = () => {
      const next = Math.round(el.clientWidth);
      setMeasuredW((prev) => (prev === next ? prev : next));
    };
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    return () => ro.disconnect();
  }, [fill]);

  useEffect(() => {
    const id = "shader-container-exploded-style";
    if (typeof document !== "undefined" && !document.getElementById(id)) {
      const style = document.createElement("style");
      style.id = id;
      style.textContent = `
        .shader-container-exploded canvas {
          width: 100% !important;
          height: 100% !important;
          display: block !important;
          position: absolute !important;
          top: 0 !important;
          left: 0 !important;
          border-radius: 100px !important;
        }
        @keyframes ripple-animation {
          0% { transform: translate(-50%, -50%) scale(0); opacity: 0.6; }
          100% { transform: translate(-50%, -50%) scale(4); opacity: 0; }
        }
      `;
      document.head.appendChild(style);
    }
  }, []);

  useEffect(() => {
    if (!ready || !shaderRef.current || w < 8) return;
    try {
      shaderMount.current?.destroy?.();
      // u_shape 0 = full-canvas metal. Shape 1 is a CIRCLE — on a compact
      // 142×46 pill it fills the face; on a full-width Sign in button it
      // only paints the left half. The dark inner capsule then punches a
      // 2px hole so chrome lives on the perimeter all the way around.
      shaderMount.current = new ShaderMount(
        shaderRef.current,
        liquidMetalFragmentShader,
        {
          u_repetition: 4,
          u_softness: 0.5,
          u_shiftRed: 0.3,
          u_shiftBlue: 0.3,
          u_distortion: 0,
          u_contour: 0,
          u_angle: 45,
          u_scale: 1,
          u_shape: 0,
          u_offsetX: 0,
          u_offsetY: 0,
          u_fit: 0,
        },
        undefined,
        0.6,
      );
    } catch (error) {
      console.error("[LiquidMetalButton] Failed to load shader:", error);
    }
    return () => {
      shaderMount.current?.destroy?.();
      shaderMount.current = null;
    };
  }, [ready, w, h]);

  const handleMouseEnter = () => {
    if (disabled) return;
    setIsHovered(true);
    shaderMount.current?.setSpeed?.(1);
  };
  const handleMouseLeave = () => {
    setIsHovered(false);
    setIsPressed(false);
    shaderMount.current?.setSpeed?.(0.6);
  };
  const handleClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    if (disabled) return;
    shaderMount.current?.setSpeed?.(2.4);
    setTimeout(() => shaderMount.current?.setSpeed?.(isHovered ? 1 : 0.6), 300);
    if (buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      const ripple = { x: e.clientX - rect.left, y: e.clientY - rect.top, id: rippleId.current++ };
      setRipples((prev) => [...prev, ripple]);
      setTimeout(() => setRipples((prev) => prev.filter((r) => r.id !== ripple.id)), 600);
    }
    onClick?.(e);
  };

  const labelColor = textColor ?? "#a1a1aa";
  const press = isPressed ? "translateY(1px) scale(0.98)" : "translateY(0) scale(1)";

  return (
    <div
      ref={hostRef}
      className={`relative ${fill ? "w-full" : "inline-block"} ${className}`}
      style={{ width: fill ? "100%" : w, opacity: disabled ? 0.6 : 1 }}
    >
      <div style={{ perspective: 1000, perspectiveOrigin: "50% 50%", width: fill ? "100%" : w }}>
        <div
          style={{
            position: "relative",
            width: fill ? "100%" : w,
            height: h,
            transformStyle: "preserve-3d",
            transition: "all 0.8s cubic-bezier(0.34, 1.56, 0.64, 1)",
          }}
        >
          {/* Label sits above the dark face */}
          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 6,
              color: labelColor,
              transform: "translateZ(20px)",
              zIndex: 30,
              pointerEvents: "none",
            }}
          >
            {viewMode === "icon" && (
              <Sparkles
                size={16}
                style={{
                  color: labelColor,
                  filter: "drop-shadow(0px 1px 2px rgba(0, 0, 0, 0.5))",
                }}
              />
            )}
            {viewMode === "text" &&
              (children ?? (
                <span
                  style={{
                    fontSize: 14,
                    color: labelColor,
                    fontWeight: 400,
                    textShadow: "0px 1px 2px rgba(0, 0, 0, 0.5)",
                    whiteSpace: "nowrap",
                  }}
                >
                  {label}
                </span>
              ))}
          </div>

          {/* Dark inner capsule — covers the shader except a 2px rim */}
          <div
            style={{
              position: "absolute",
              inset: 0,
              transform: `translateZ(10px) ${press}`,
              zIndex: 20,
              transition: "transform 0.15s cubic-bezier(0.4, 0, 0.2, 1)",
            }}
          >
            <div
              style={{
                position: "absolute",
                top: 2,
                right: 2,
                bottom: 2,
                left: 2,
                borderRadius: 100,
                background: "linear-gradient(180deg, #202020 0%, #000000 100%)",
                boxShadow: isPressed
                  ? "inset 0px 2px 4px rgba(0, 0, 0, 0.4), inset 0px 1px 2px rgba(0, 0, 0, 0.3)"
                  : "none",
              }}
            />
          </div>

          {/* Shader rim — PIXEL sized so the chrome runs the full perimeter */}
          <div
            style={{
              position: "absolute",
              inset: 0,
              transform: `translateZ(0px) ${press}`,
              zIndex: 10,
              transition: "transform 0.15s cubic-bezier(0.4, 0, 0.2, 1)",
            }}
          >
            <div
              style={{
                width: fill ? "100%" : w,
                height: h,
                borderRadius: 100,
                overflow: "hidden",
                background:
                  "linear-gradient(135deg, #f4f4f5 0%, #94a3b8 28%, #7dd3fc 50%, #64748b 72%, #fafafa 100%)",
                boxShadow: isPressed
                  ? "0px 0px 0px 1px rgba(0, 0, 0, 0.5), 0px 1px 2px 0px rgba(0, 0, 0, 0.3)"
                  : isHovered
                    ? "0px 0px 0px 1px rgba(0, 0, 0, 0.4), 0px 12px 6px 0px rgba(0, 0, 0, 0.05), 0px 8px 5px 0px rgba(0, 0, 0, 0.1), 0px 4px 4px 0px rgba(0, 0, 0, 0.15), 0px 1px 2px 0px rgba(0, 0, 0, 0.2)"
                    : "0px 0px 0px 1px rgba(0, 0, 0, 0.3), 0px 36px 14px 0px rgba(0, 0, 0, 0.02), 0px 20px 12px 0px rgba(0, 0, 0, 0.08), 0px 9px 9px 0px rgba(0, 0, 0, 0.12), 0px 2px 5px 0px rgba(0, 0, 0, 0.15)",
              }}
            >
              {ready && (
                <div
                  ref={shaderRef}
                  className="shader-container-exploded"
                  style={{
                    borderRadius: 100,
                    overflow: "hidden",
                    position: "relative",
                    width: fill ? "100%" : w,
                    height: h,
                  }}
                />
              )}
            </div>
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
              width: fill ? "100%" : w,
              height: h,
              background: "transparent",
              border: "none",
              cursor: disabled ? "not-allowed" : "pointer",
              outline: "none",
              zIndex: 40,
              transform: "translateZ(25px)",
              overflow: "hidden",
              borderRadius: 100,
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
                  background:
                    "radial-gradient(circle, rgba(255, 255, 255, 0.4) 0%, rgba(255, 255, 255, 0) 70%)",
                  pointerEvents: "none",
                  animation: "ripple-animation 0.6s ease-out",
                }}
              />
            ))}
          </button>
        </div>
      </div>
    </div>
  );
}

export default LiquidMetalButton;
