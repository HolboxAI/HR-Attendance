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

    // Border glow, the cheap way. The old version wrote viewport-space
    // --x/--y onto <html> on every mousemove AND every animation frame,
    // which invalidated the ::before gradient of EVERY card on the page at
    // once (they all read the inherited var). Combined with
    // background-attachment: fixed in the CSS, that made both mousemove
    // and scroll repaint the entire page - the "very very laggy" scroll.
    //
    // Now each element near the cursor gets its own element-LOCAL --lx/--ly
    // (rAF-throttled, reads batched before writes so there is no layout
    // thrash), and everything else keeps the off-screen default and never
    // repaints. Scroll costs nothing: the gradients live in element space.
    let borderRaf = 0;
    let glowOn = false;
    const GLOW_REACH = 420; // the CSS gradient is 400px; light neighbours too

    const updateBorderGlow = () => {
      borderRaf = 0;
      const els = Array.from(
        document.querySelectorAll<HTMLElement>(
          '.glass-panel, .bx-card, [data-glow], aside, header',
        ),
      );
      const rects = els.map((el) => el.getBoundingClientRect()); // all reads…
      els.forEach((el, i) => {                                   // …then all writes
        const r = rects[i];
        const near =
          targetX > r.left - GLOW_REACH && targetX < r.right + GLOW_REACH &&
          targetY > r.top - GLOW_REACH && targetY < r.bottom + GLOW_REACH;
        if (near) {
          el.style.setProperty('--lx', `${targetX - r.left}px`);
          el.style.setProperty('--ly', `${targetY - r.top}px`);
          el.dataset.glowNear = '1';
        } else if (el.dataset.glowNear) {
          el.style.setProperty('--lx', '-1000px');
          el.style.setProperty('--ly', '-1000px');
          delete el.dataset.glowNear;
        }
      });
    };

    const handleMouseMove = (event: MouseEvent) => {
      targetX = event.clientX;
      targetY = event.clientY;
      lastMoveTime = performance.now();
      if (mouseX === -1000) {
        mouseX = targetX;
        mouseY = targetY;
      }
      if (!glowOn) {
        glowOn = true;
        document.documentElement.style.setProperty('--glow-opacity', '1');
      }
      if (!borderRaf) borderRaf = requestAnimationFrame(updateBorderGlow);
    };

    const handleMouseLeave = () => {
      lastMoveTime = 0;
      glowOn = false;
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
      const now = performance.now();

      // Idle means IDLE. This loop used to clear and repaint a full-screen
      // canvas at display refresh even with the pointer motionless - one of
      // the two always-on loops that made scrolling feel heavy. When the
      // glow has fully faded and nothing moves, skip the frame entirely.
      const settled =
        currentOpacity <= 0.005 &&
        (now - lastMoveTime >= 450 || targetX === -1000);
      if (settled) {
        animationFrameId = requestAnimationFrame(draw);
        return;
      }

      ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);

      const isMoving = now - lastMoveTime < 450; // Active only when moving within 450ms
      const targetOpacity = isMoving && targetX !== -1000 ? 1 : 0;

      // Smooth opacity interpolation
      currentOpacity += (targetOpacity - currentOpacity) * 0.08;

      // Smooth position interpolation
      if (targetX !== -1000) {
        mouseX += (targetX - mouseX) * 0.2;
        mouseY += (targetY - mouseY) * 0.2;
      }

      // The cursor going idle fades the border glow out via the CSS
      // transition - one var write on the transition, never one per frame.
      if (!isMoving && glowOn) {
        glowOn = false;
        document.documentElement.style.setProperty('--glow-opacity', '0');
      }

      if (currentOpacity > 0.005 && mouseX !== -1000 && mouseY !== -1000) {
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
      if (borderRaf) cancelAnimationFrame(borderRaf);
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
