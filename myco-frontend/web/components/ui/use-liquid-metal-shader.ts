'use client';

import { liquidMetalFragmentShader, ShaderMount } from '@paper-design/shaders';
import { useEffect, useRef, useState } from 'react';

const UNIFORMS = {
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
};

/**
 * Mounts the liquid-metal shader into a box that actually matches the
 * element's laid-out size. ShaderMount samples clientWidth once; a
 * width:100% pill that is not measured first paints a half-width canvas.
 */
export function useLiquidMetalShader(speed = 0.6) {
  const hostRef = useRef<HTMLDivElement>(null);
  const shaderRef = useRef<HTMLDivElement>(null);
  // biome-ignore lint/suspicious/noExplicitAny: ShaderMount has no public types
  const mountRef = useRef<any>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });

  useEffect(() => {
    const el = hostRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const apply = () => {
      const r = el.getBoundingClientRect();
      const w = Math.max(1, Math.round(r.width * (window.devicePixelRatio > 1 ? 1 : 1)));
      const h = Math.max(1, Math.round(r.height));
      setBox((prev) => (prev.w === w && prev.h === h ? prev : { w, h }));
    };
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const node = shaderRef.current;
    if (!node || box.w < 2 || box.h < 2) return;
    node.style.width = `${box.w}px`;
    node.style.height = `${box.h}px`;
    try {
      mountRef.current?.destroy?.();
      mountRef.current = new ShaderMount(
        node,
        liquidMetalFragmentShader,
        UNIFORMS,
        undefined,
        speed,
      );
    } catch (error) {
      console.error('[liquid-metal] shader failed to mount', error);
    }
    return () => {
      mountRef.current?.destroy?.();
      mountRef.current = null;
    };
  }, [box.w, box.h, speed]);

  return { hostRef, shaderRef, mountRef, box };
}

export function LiquidMetalCanvasFill({
  shaderRef,
  className = '',
  radius = 100,
}: {
  shaderRef: React.RefObject<HTMLDivElement | null>;
  className?: string;
  radius?: number;
}) {
  return (
    <div
      ref={shaderRef}
      className={`lmb-shader-fill ${className}`}
      style={{
        position: 'absolute',
        inset: 0,
        borderRadius: radius,
        overflow: 'hidden',
      }}
    />
  );
}
