"use client";

import { liquidMetalFragmentShader, ShaderMount } from "@paper-design/shaders";
import type React from "react";
import { useEffect, useRef, useState } from "react";

export interface LiquidMetalButtonProps {
  label?: string;
  onClick?: (e?: React.MouseEvent<HTMLButtonElement>) => void;
  viewMode?: "text" | "icon";
  type?: "button" | "submit" | "reset";
  disabled?: boolean;
  className?: string;
  /** Pass width as a CSS string: "100%", "200px", etc. */
  width?: string;
  height?: number;
  children?: React.ReactNode;
}

/**
 * LiquidMetalButton
 * ─────────────────
 * The @paper-design/shaders liquid-metal WebGL canvas fills the ENTIRE button
 * surface.  Text floats above it via position:absolute so the effect is always
 * fully visible — not hidden behind an opaque inner capsule.
 *
 * Fall-back: if WebGL fails to initialise (old GPU / blocked context / SSR
 * hydration race) we keep showing the shimmering CSS gradient that was painted
 * on first render, so the button is never invisible.
 */
export function LiquidMetalButton({
  label = "Get Started",
  onClick,
  viewMode = "text",
  type = "button",
  disabled = false,
  className = "",
  width = "142px",
  height = 46,
  children,
}: LiquidMetalButtonProps) {
  const shaderRef = useRef<HTMLDivElement>(null);
  // biome-ignore lint/suspicious/noExplicitAny: external lib has no types
  const shaderMount = useRef<any>(null);
  const [pressed, setPressed] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [ripples, setRipples] = useState<
    Array<{ x: number; y: number; id: number }>
  >([]);
  const rippleId = useRef(0);
  const buttonRef = useRef<HTMLButtonElement>(null);

  // ── inject global canvas-sizing styles once ─────────────────────────────
  useEffect(() => {
    const id = "lmb-canvas-styles";
    if (document.getElementById(id)) return;
    const s = document.createElement("style");
    s.id = id;
    s.textContent = `
      .lmb-shader canvas {
        position: absolute !important;
        inset: 0 !important;
        width: 100% !important;
        height: 100% !important;
        display: block !important;
        border-radius: inherit !important;
      }
      @keyframes lmb-ripple {
        from { transform: translate(-50%,-50%) scale(0); opacity:.55 }
        to   { transform: translate(-50%,-50%) scale(5); opacity:0 }
      }
    `;
    document.head.appendChild(s);
  }, []);

  // ── mount WebGL shader ───────────────────────────────────────────────────
  useEffect(() => {
    if (!shaderRef.current) return;

    // tiny delay lets the browser paint + calculate layout first
    const tid = setTimeout(() => {
      try {
        shaderMount.current?.destroy?.();
        shaderMount.current = new ShaderMount(
          shaderRef.current!,
          liquidMetalFragmentShader,
          {
            u_repetition: 3,
            u_softness: 0.45,
            u_shiftRed: 0.28,
            u_shiftBlue: 0.28,
            u_distortion: 0.08,
            u_contour: 0.1,
            u_angle: 38,
            u_scale: 6,
            u_shape: 1,
            u_offsetX: 0.05,
            u_offsetY: -0.08,
          },
          undefined,
          /* speed */ 0.55,
        );
      } catch (err) {
        console.warn("[LiquidMetalButton] WebGL init failed — CSS fallback active", err);
      }
    }, 60);

    return () => {
      clearTimeout(tid);
      shaderMount.current?.destroy?.();
      shaderMount.current = null;
    };
  }, []);

  // ── event helpers ────────────────────────────────────────────────────────
  const onEnter = () => {
    if (disabled) return;
    setHovered(true);
    shaderMount.current?.setSpeed?.(1.4);
  };
  const onLeave = () => {
    setHovered(false);
    setPressed(false);
    shaderMount.current?.setSpeed?.(0.55);
  };
  const onDown = () => !disabled && setPressed(true);
  const onUp = () => !disabled && setPressed(false);

  const handleClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    if (disabled) return;
    shaderMount.current?.setSpeed?.(2.5);
    setTimeout(() => shaderMount.current?.setSpeed?.(hovered ? 1.4 : 0.55), 350);

    if (buttonRef.current) {
      const r = buttonRef.current.getBoundingClientRect();
      const rip = { x: e.clientX - r.left, y: e.clientY - r.top, id: rippleId.current++ };
      setRipples((p) => [...p, rip]);
      setTimeout(() => setRipples((p) => p.filter((x) => x.id !== rip.id)), 650);
    }
    onClick?.(e);
  };

  // ── derived styles ───────────────────────────────────────────────────────
  const isFullWidth = width === "100%";
  const wrapCls = `relative ${isFullWidth ? "w-full" : "inline-block"} ${className}`;

  const scale = pressed ? "scale(0.97)" : "scale(1)";
  const shadow = hovered
    ? "0 0 0 1px rgba(180,190,210,.45), 0 8px 24px rgba(0,0,0,.45), 0 0 32px rgba(100,140,255,.18)"
    : "0 0 0 1px rgba(120,130,150,.3), 0 4px 18px rgba(0,0,0,.4)";

  return (
    <div className={wrapCls}>
      <div
        style={{
          position: "relative",
          width,
          height,
          borderRadius: 100,
          transform: scale,
          transition: "transform .15s cubic-bezier(.4,0,.2,1), box-shadow .15s cubic-bezier(.4,0,.2,1)",
          boxShadow: shadow,
          overflow: "hidden",
          cursor: disabled ? "not-allowed" : "pointer",
          opacity: disabled ? 0.55 : 1,
        }}
      >
        {/* ── WebGL liquid-metal shader (full button area) ── */}
        <div
          ref={shaderRef}
          className="lmb-shader"
          style={{
            position: "absolute",
            inset: 0,
            borderRadius: 100,
            overflow: "hidden",
            /* CSS fallback gradient shown until/if WebGL kicks in */
            background:
              "linear-gradient(135deg, #c8d0dc 0%, #8a96a8 18%, #c2cad6 36%, #6e7a8a 50%, #b8c2cc 68%, #9aa4b2 84%, #d4dae2 100%)",
          }}
          aria-hidden
        />

        {/* ── subtle top highlight to add depth ── */}
        <div
          style={{
            position: "absolute",
            top: 0,
            left: "12%",
            right: "12%",
            height: 1,
            borderRadius: 1,
            background: "rgba(255,255,255,0.65)",
            pointerEvents: "none",
            zIndex: 2,
          }}
          aria-hidden
        />

        {/* ── label / children ── */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            zIndex: 3,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 6,
            pointerEvents: "none",
            /* dark overlay so text is always readable over silver */
            background: "rgba(0,0,0,0.32)",
          }}
        >
          {children ?? (
            <span
              style={{
                fontSize: 14,
                fontWeight: 600,
                color: "#ffffff",
                textShadow: "0 1px 3px rgba(0,0,0,0.7)",
                letterSpacing: "0.02em",
                whiteSpace: "nowrap",
              }}
            >
              {label}
            </span>
          )}
        </div>

        {/* ── ripples ── */}
        {ripples.map((rip) => (
          <span
            key={rip.id}
            aria-hidden
            style={{
              position: "absolute",
              left: rip.x,
              top: rip.y,
              width: 18,
              height: 18,
              borderRadius: "50%",
              background: "rgba(255,255,255,0.45)",
              pointerEvents: "none",
              animation: "lmb-ripple 0.65s ease-out forwards",
              zIndex: 5,
            }}
          />
        ))}

        {/* ── invisible interactive button ── */}
        <button
          ref={buttonRef}
          type={type}
          disabled={disabled}
          onClick={handleClick}
          onMouseEnter={onEnter}
          onMouseLeave={onLeave}
          onMouseDown={onDown}
          onMouseUp={onUp}
          aria-label={typeof label === "string" ? label : undefined}
          style={{
            position: "absolute",
            inset: 0,
            background: "transparent",
            border: "none",
            cursor: disabled ? "not-allowed" : "pointer",
            zIndex: 10,
            width: "100%",
            height: "100%",
            borderRadius: 100,
          }}
        />
      </div>
    </div>
  );
}

export default LiquidMetalButton;
