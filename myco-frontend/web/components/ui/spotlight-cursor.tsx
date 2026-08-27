'use client';
import { useRef, useEffect, HTMLAttributes } from 'react';

export interface SpotlightConfig {
  radius?: number;
  brightness?: number;
  color?: string;
  smoothing?: number;
}

const useSpotlightEffect = (config: SpotlightConfig) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animationFrameId: number;
    let mouseX = -1000;
    let mouseY = -1000;
    let targetX = -1000;
    let targetY = -1000;
    let currentOpacity = 0;
    let lastMoveTime = 0;

    const resizeCanvas = () => {
      const dpr = window.devicePixelRatio || 1;
      canvas.width = window.innerWidth * dpr;
      canvas.height = window.innerHeight * dpr;
      canvas.style.width = `${window.innerWidth}px`;
      canvas.style.height = `${window.innerHeight}px`;
      ctx.resetTransform?.();
      ctx.scale(dpr, dpr);
    };

    const handleMouseMove = (event: MouseEvent) => {
      targetX = event.clientX;
      targetY = event.clientY;
      lastMoveTime = performance.now();
      if (mouseX === -1000) {
        mouseX = targetX;
        mouseY = targetY;
      }
      document.documentElement.style.setProperty('--x', `${event.clientX}px`);
      document.documentElement.style.setProperty('--y', `${event.clientY}px`);
      document.documentElement.style.setProperty('--glow-opacity', '1');
    };

    const handleMouseLeave = () => {
      lastMoveTime = 0;
      document.documentElement.style.setProperty('--glow-opacity', '0');
    };

    const hexToRgb = (hex: string) => {
      const cleanHex = hex.replace('#', '');
      const bigint = parseInt(cleanHex, 16);
      const r = (bigint >> 16) & 255;
      const g = (bigint >> 8) & 255;
      const b = bigint & 255;
      return `${r},${g},${b}`;
    };

    const draw = () => {
      ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);

      const now = performance.now();
      const isMoving = now - lastMoveTime < 450; // Active only when moving within 450ms
      const targetOpacity = isMoving && targetX !== -1000 ? 1 : 0;

      // Smooth opacity interpolation
      currentOpacity += (targetOpacity - currentOpacity) * 0.08;

      // Smooth position interpolation
      if (targetX !== -1000) {
        mouseX += (targetX - mouseX) * 0.2;
        mouseY += (targetY - mouseY) * 0.2;
      }

      if (currentOpacity > 0.005 && mouseX !== -1000 && mouseY !== -1000) {
        document.documentElement.style.setProperty('--x', `${mouseX}px`);
        document.documentElement.style.setProperty('--y', `${mouseY}px`);
        document.documentElement.style.setProperty('--glow-opacity', currentOpacity.toFixed(3));

        // Theme detection
        const isDark =
          document.documentElement.classList.contains('bx-dark-mode') ||
          document.documentElement.classList.contains('dark');

        // Black spotlight in light theme, light grey spotlight in dark theme
        const activeColorHex = config.color
          ? config.color
          : isDark
            ? '#d4d4d8'
            : '#000000';

        const baseBrightness =
          config.brightness !== undefined
            ? config.brightness
            : isDark
              ? 0.18
              : 0.22;

        const effectiveBrightness = baseBrightness * currentOpacity;
        const radius = config.radius || (isDark ? 110 : 100);

        const gradient = ctx.createRadialGradient(
          mouseX, mouseY, 0,
          mouseX, mouseY, radius
        );
        const rgbColor = hexToRgb(activeColorHex);

        gradient.addColorStop(0, `rgba(${rgbColor}, ${effectiveBrightness})`);
        gradient.addColorStop(0.4, `rgba(${rgbColor}, ${effectiveBrightness * 0.4})`);
        gradient.addColorStop(0.8, `rgba(${rgbColor}, ${effectiveBrightness * 0.1})`);
        gradient.addColorStop(1, 'rgba(0,0,0,0)');

        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, window.innerWidth, window.innerHeight);
      }

      animationFrameId = requestAnimationFrame(draw);
    };

    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseleave', handleMouseLeave);
    animationFrameId = requestAnimationFrame(draw);

    return () => {
      window.removeEventListener('resize', resizeCanvas);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseleave', handleMouseLeave);
      cancelAnimationFrame(animationFrameId);
    };
  }, [config.radius, config.brightness, config.color]);

  return canvasRef;
};

export interface SpotlightCursorProps extends HTMLAttributes<HTMLCanvasElement> {
  config?: SpotlightConfig;
}

export const SpotlightCursor = ({
  config = {},
  className = '',
  ...rest
}: SpotlightCursorProps) => {
  const spotlightConfig = {
    radius: 110,
    smoothing: 0.1,
    ...config,
  };

  const canvasRef = useSpotlightEffect(spotlightConfig);

  return (
    <canvas
      ref={canvasRef}
      className={`fixed top-0 left-0 pointer-events-none z-[9999] w-full h-full ${className}`}
      {...rest}
    />
  );
};

export const Component = SpotlightCursor;
