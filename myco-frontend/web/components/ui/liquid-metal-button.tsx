"use client";

import { liquidMetalFragmentShader, ShaderMount } from "@paper-design/shaders";
import { Sparkles } from "lucide-react";
import type React from "react";
import { useEffect, useMemo, useRef, useState } from "react";

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
  width,
  height,
  textColor,
  variant = "dark",
  children,
}: LiquidMetalButtonProps) {
  const [isHovered, setIsHovered] = useState(false);
  const [isPressed, setIsPressed] = useState(false);
  const [ripples, setRipples] = useState<
    Array<{ x: number; y: number; id: number }>
  >([]);
  const shaderRef = useRef<HTMLDivElement>(null);
  // biome-ignore lint/suspicious/noExplicitAny: External library without types
  const shaderMount = useRef<any>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const rippleId = useRef(0);

  const dimensions = useMemo(() => {
    if (viewMode === "icon") {
      return {
        width: typeof width === "number" ? `${width}px` : (width || "46px"),
        height: typeof height === "number" ? `${height}px` : (height || "46px"),
        innerWidth: typeof width === "number" ? `${width - 4}px` : (width ? `calc(${width} - 4px)` : "42px"),
        innerHeight: typeof height === "number" ? `${height - 4}px` : (height ? `calc(${height} - 4px)` : "42px"),
        shaderWidth: typeof width === "number" ? `${width}px` : (width || "46px"),
        shaderHeight: typeof height === "number" ? `${height}px` : (height || "46px"),
      };
    } else {
      return {
        width: typeof width === "number" ? `${width}px` : (width || "142px"),
        height: typeof height === "number" ? `${height}px` : (height || "46px"),
        innerWidth: typeof width === "number" ? `${width - 4}px` : (width ? `calc(${width} - 4px)` : "138px"),
        innerHeight: typeof height === "number" ? `${height - 4}px` : (height ? `calc(${height} - 4px)` : "42px"),
        shaderWidth: typeof width === "number" ? `${width}px` : (width || "142px"),
        shaderHeight: typeof height === "number" ? `${height}px` : (height || "46px"),
      };
    }
  }, [viewMode, width, height]);

  useEffect(() => {
    const styleId = "shader-canvas-style-exploded";
    if (typeof document !== "undefined" && !document.getElementById(styleId)) {
      const style = document.createElement("style");
      style.id = styleId;
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
          0% {
            transform: translate(-50%, -50%) scale(0);
            opacity: 0.6;
          }
          100% {
            transform: translate(-50%, -50%) scale(4);
            opacity: 0;
          }
        }
      `;
      document.head.appendChild(style);
    }

    const loadShader = async () => {
      try {
        if (shaderRef.current) {
          if (shaderMount.current?.destroy) {
            shaderMount.current.destroy();
          }

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
              u_scale: 8,
              u_shape: 1,
              u_offsetX: 0.1,
              u_offsetY: -0.1,
            },
            undefined,
            0.6,
          );
        }
      } catch (error) {
        console.error("[LiquidMetalButton] Failed to load shader:", error);
      }
    };

    loadShader();

    return () => {
      if (shaderMount.current?.destroy) {
        shaderMount.current.destroy();
        shaderMount.current = null;
      }
    };
  }, []);

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

    if (shaderMount.current?.setSpeed) {
      shaderMount.current.setSpeed(2.4);
      setTimeout(() => {
        if (isHovered) {
          shaderMount.current?.setSpeed?.(1);
        } else {
          shaderMount.current?.setSpeed?.(0.6);
        }
      }, 300);
    }

    if (buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const ripple = { x, y, id: rippleId.current++ };

      setRipples((prev) => [...prev, ripple]);
      setTimeout(() => {
        setRipples((prev) => prev.filter((r) => r.id !== ripple.id));
      }, 600);
    }

    onClick?.(e);
  };

  return (
    <div className={`relative inline-block ${width === "100%" ? "w-full" : ""} ${className}`}>
      <div
        style={{
          perspective: "1000px",
          perspectiveOrigin: "50% 50%",
          width: dimensions.width,
        }}
      >
        <div
          style={{
            position: "relative",
            width: dimensions.width,
            height: dimensions.height,
            transformStyle: "preserve-3d",
            transition:
              "all 0.8s cubic-bezier(0.34, 1.56, 0.64, 1), width 0.4s ease, height 0.4s ease",
            transform: "none",
          }}
        >
          {/* Foreground label / content */}
          <div
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              width: dimensions.width,
              height: dimensions.height,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: "6px",
              transformStyle: "preserve-3d",
              transition:
                "all 0.8s cubic-bezier(0.34, 1.56, 0.64, 1), width 0.4s ease, height 0.4s ease, gap 0.4s ease",
              transform: "translateZ(20px)",
              zIndex: 30,
              pointerEvents: "none",
            }}
          >
            {viewMode === "icon" && (
              <Sparkles
                size={16}
                style={{
                  color: textColor || "#666666",
                  filter: "drop-shadow(0px 1px 2px rgba(0, 0, 0, 0.5))",
                  transition: "all 0.8s cubic-bezier(0.34, 1.56, 0.64, 1)",
                  transform: "scale(1)",
                }}
              />
            )}
            {viewMode === "text" && (
              children ? (
                children
              ) : (
                <span
                  style={{
                    fontSize: "14px",
                    color: textColor || "#666666",
                    fontWeight: 500,
                    textShadow: "0px 1px 2px rgba(0, 0, 0, 0.5)",
                    transition: "all 0.8s cubic-bezier(0.34, 1.56, 0.64, 1)",
                    transform: "scale(1)",
                    whiteSpace: "nowrap",
                  }}
                >
                  {label}
                </span>
              )
            )}
          </div>

          {/* Inner dark capsule */}
          <div
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              width: dimensions.width,
              height: dimensions.height,
              transformStyle: "preserve-3d",
              transition:
                "all 0.8s cubic-bezier(0.34, 1.56, 0.64, 1), width 0.4s ease, height 0.4s ease",
              transform: `translateZ(10px) ${isPressed ? "translateY(1px) scale(0.98)" : "translateY(0) scale(1)"}`,
              zIndex: 20,
            }}
          >
            <div
              style={{
                width: dimensions.innerWidth,
                height: dimensions.innerHeight,
                margin: "2px",
                borderRadius: "100px",
                background:
                  variant === "silver"
                    ? "linear-gradient(180deg, rgba(255, 255, 255, 0.95) 0%, rgba(226, 232, 240, 0.92) 100%)"
                    : variant === "liquid"
                      ? "linear-gradient(180deg, rgba(30, 30, 35, 0.65) 0%, rgba(10, 10, 15, 0.75) 100%)"
                      : "linear-gradient(180deg, #202020 0%, #000000 100%)",
                border:
                  variant === "liquid"
                    ? "1px solid rgba(255, 255, 255, 0.15)"
                    : variant === "silver"
                      ? "1px solid rgba(255, 255, 255, 0.9)"
                      : "none",
                boxShadow: isPressed
                  ? "inset 0px 2px 4px rgba(0, 0, 0, 0.4), inset 0px 1px 2px rgba(0, 0, 0, 0.3)"
                  : "none",
                transition:
                  "all 0.8s cubic-bezier(0.34, 1.56, 0.64, 1), width 0.4s ease, height 0.4s ease, box-shadow 0.15s cubic-bezier(0.4, 0, 0.2, 1)",
              }}
            />
          </div>

          {/* Liquid Metal Shader rim */}
          <div
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              width: dimensions.width,
              height: dimensions.height,
              transformStyle: "preserve-3d",
              transition:
                "all 0.8s cubic-bezier(0.34, 1.56, 0.64, 1), width 0.4s ease, height 0.4s ease",
              transform: `translateZ(0px) ${isPressed ? "translateY(1px) scale(0.98)" : "translateY(0) scale(1)"}`,
              zIndex: 10,
            }}
          >
            <div
              style={{
                height: dimensions.height,
                width: dimensions.width,
                borderRadius: "100px",
                boxShadow: isPressed
                  ? "0px 0px 0px 1px rgba(0, 0, 0, 0.5), 0px 1px 2px 0px rgba(0, 0, 0, 0.3)"
                  : isHovered
                    ? "0px 0px 0px 1px rgba(0, 0, 0, 0.4), 0px 12px 6px 0px rgba(0, 0, 0, 0.05), 0px 8px 5px 0px rgba(0, 0, 0, 0.1), 0px 4px 4px 0px rgba(0, 0, 0, 0.15), 0px 1px 2px 0px rgba(0, 0, 0, 0.2)"
                    : "0px 0px 0px 1px rgba(0, 0, 0, 0.3), 0px 36px 14px 0px rgba(0, 0, 0, 0.02), 0px 20px 12px 0px rgba(0, 0, 0, 0.08), 0px 9px 9px 0px rgba(0, 0, 0, 0.12), 0px 2px 5px 0px rgba(0, 0, 0, 0.15)",
                transition:
                  "all 0.8s cubic-bezier(0.34, 1.56, 0.64, 1), width 0.4s ease, height 0.4s ease, box-shadow 0.15s cubic-bezier(0.4, 0, 0.2, 1)",
                background: "rgb(0 0 0 / 0)",
              }}
            >
              <div
                ref={shaderRef}
                className="shader-container-exploded"
                style={{
                  borderRadius: "100px",
                  overflow: "hidden",
                  position: "relative",
                  width: dimensions.shaderWidth,
                  maxWidth: dimensions.shaderWidth,
                  height: dimensions.shaderHeight,
                  transition: "width 0.4s ease, height 0.4s ease",
                }}
              />
            </div>
          </div>

          {/* Interactive button element */}
          <button
            ref={buttonRef}
            type={type}
            disabled={disabled}
            onClick={handleClick}
            onMouseEnter={handleMouseEnter}
            onMouseLeave={handleMouseLeave}
            onMouseDown={() => !disabled && setIsPressed(true)}
            onMouseUp={() => !disabled && setIsPressed(false)}
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              width: dimensions.width,
              height: dimensions.height,
              background: "transparent",
              border: "none",
              cursor: disabled ? "not-allowed" : "pointer",
              outline: "none",
              zIndex: 40,
              transformStyle: "preserve-3d",
              transform: "translateZ(25px)",
              transition:
                "all 0.8s cubic-bezier(0.34, 1.56, 0.64, 1), width 0.4s ease, height 0.4s ease",
              overflow: "hidden",
              borderRadius: "100px",
              opacity: disabled ? 0.6 : 1,
            }}
            aria-label={label}
          >
            {ripples.map((ripple) => (
              <span
                key={ripple.id}
                style={{
                  position: "absolute",
                  left: `${ripple.x}px`,
                  top: `${ripple.y}px`,
                  width: "20px",
                  height: "20px",
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
