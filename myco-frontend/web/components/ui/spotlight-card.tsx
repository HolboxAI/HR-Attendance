"use client";

import React, { useEffect, useRef, ReactNode } from 'react';

interface GlowCardProps {
  children?: ReactNode;
  className?: string;
  glowColor?: 'monochrome' | 'grey' | 'blue' | 'purple' | 'green' | 'red' | 'orange';
  size?: 'sm' | 'md' | 'lg';
  width?: string | number;
  height?: string | number;
  customSize?: boolean; // When true, ignores size prop and uses width/height or className
}

const sizeMap = {
  sm: 'w-48 h-64',
  md: 'w-64 h-80',
  lg: 'w-80 h-96',
};

const GlowCard: React.FC<GlowCardProps> = ({
  children,
  className = '',
  glowColor = 'monochrome',
  size = 'md',
  width,
  height,
  customSize = false,
}) => {
  const cardRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const syncPointer = (e: PointerEvent) => {
      const { clientX: x, clientY: y } = e;

      if (cardRef.current) {
        cardRef.current.style.setProperty('--x', x.toFixed(2));
        cardRef.current.style.setProperty('--xp', (x / window.innerWidth).toFixed(2));
        cardRef.current.style.setProperty('--y', y.toFixed(2));
        cardRef.current.style.setProperty('--yp', (y / window.innerHeight).toFixed(2));
      }
    };

    document.addEventListener('pointermove', syncPointer);
    return () => document.removeEventListener('pointermove', syncPointer);
  }, []);

  // Determine sizing
  const getSizeClasses = () => {
    if (customSize) {
      return ''; // Let className or inline styles handle sizing
    }
    return sizeMap[size];
  };

  const getInlineStyles = () => {
    const baseStyles: Record<string, any> = {
      '--radius': '24',
      '--border': '1.5',
      '--backup-border': 'var(--line)',
      '--size': '380',
      position: 'relative' as const,
      touchAction: 'none' as const,
    };

    if (width !== undefined) {
      baseStyles.width = typeof width === 'number' ? `${width}px` : width;
    }
    if (height !== undefined) {
      baseStyles.height = typeof height === 'number' ? `${height}px` : height;
    }

    return baseStyles;
  };

  const beforeAfterStyles = `
    [data-glow]::before,
    [data-glow]::after {
      pointer-events: none;
      content: "";
      position: absolute;
      inset: -1.5px;
      border: 1.5px solid transparent;
      border-radius: inherit;
      background-attachment: fixed;
      mask: linear-gradient(transparent, transparent), linear-gradient(white, white);
      mask-clip: padding-box, border-box;
      mask-composite: intersect;
      -webkit-mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
      -webkit-mask-composite: xor;
      z-index: 3;
    }
    
    [data-glow]::before {
      background-image: radial-gradient(
        380px 380px at
        calc(var(--x, 0) * 1px)
        calc(var(--y, 0) * 1px),
        rgba(228, 228, 231, 0.95) 0%,
        rgba(161, 161, 170, 0.45) 40%,
        transparent 100%
      );
    }
    
    [data-glow]::after {
      background-image: radial-gradient(
        220px 220px at
        calc(var(--x, 0) * 1px)
        calc(var(--y, 0) * 1px),
        rgba(255, 255, 255, 0.85) 0%,
        transparent 100%
      );
    }

    .bx-light [data-glow]::before,
    #bx-shell.bx-light [data-glow]::before {
      background-image: radial-gradient(
        380px 380px at
        calc(var(--x, 0) * 1px)
        calc(var(--y, 0) * 1px),
        rgba(0, 0, 0, 0.85) 0%,
        rgba(39, 39, 42, 0.35) 40%,
        transparent 100%
      );
    }

    .bx-light [data-glow]::after,
    #bx-shell.bx-light [data-glow]::after {
      background-image: radial-gradient(
        220px 220px at
        calc(var(--x, 0) * 1px)
        calc(var(--y, 0) * 1px),
        rgba(0, 0, 0, 0.5) 0%,
        transparent 100%
      );
    }
  `;

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: beforeAfterStyles }} />
      <div
        ref={cardRef}
        data-glow
        style={getInlineStyles()}
        className={`
          ${getSizeClasses()}
          ${!customSize ? 'aspect-[3/4]' : ''}
          rounded-3xl 
          relative 
          flex flex-col
          shadow-xl
          ${className}
        `}
      >
        <div ref={innerRef} data-glow></div>
        {children}
      </div>
    </>
  );
};

export { GlowCard };
export default GlowCard;
