'use client';

import { LiquidMetalCanvasFill, useLiquidMetalShader } from './use-liquid-metal-shader';

/**
 * The same liquid-metal shader as the Sign in pill, clipped to the heading
 * glyphs so "Sign in to Holbox" is metal, not flat white.
 */
export function LiquidMetalText({
  children,
  as: Tag = 'h1',
  className = '',
}: {
  children: string;
  as?: 'h1' | 'h2' | 'p' | 'span';
  className?: string;
}) {
  const { hostRef, shaderRef } = useLiquidMetalShader(0.45);

  return (
    <div ref={hostRef} className={`relative inline-block max-w-full ${className}`}>
      <div
        className="pointer-events-none absolute inset-0 overflow-hidden"
        style={{
          borderRadius: 4,
          WebkitMaskImage: 'linear-gradient(#000 0 0)',
          maskImage: 'linear-gradient(#000 0 0)',
        }}
      >
        <LiquidMetalCanvasFill shaderRef={shaderRef} radius={4} />
      </div>
      <Tag
        className="relative z-10 font-display font-black tracking-tight"
        style={{
          color: 'transparent',
          WebkitTextFillColor: 'transparent',
          backgroundImage:
            'linear-gradient(110deg, #ffffff 0%, #f1f5f9 18%, #94a3b8 38%, #ffffff 55%, #64748b 78%, #ffffff 100%)',
          backgroundSize: '220% 100%',
          WebkitBackgroundClip: 'text',
          backgroundClip: 'text',
          animation: 'bx-liquid-text 5s linear infinite',
          mixBlendMode: 'plus-lighter',
          filter: 'drop-shadow(0 1px 1px rgba(0,0,0,0.4))',
        }}
      >
        {children}
      </Tag>
    </div>
  );
}

export default LiquidMetalText;
