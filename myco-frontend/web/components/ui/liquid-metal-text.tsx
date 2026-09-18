'use client';

/**
 * Chrome on the letter EDGES only. A stroke layer sits behind a solid white
 * fill so the metal never paints across the glyphs (the old shader fill
 * blobbed the left half of "Sign in to Holbox").
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
  return (
    <Tag className={`relative font-display font-black tracking-tight ${className}`}>
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 select-none"
        style={{
          color: 'transparent',
          WebkitTextFillColor: 'transparent',
          WebkitTextStroke: '1.35px #c9d2de',
          filter: 'drop-shadow(0 0 10px rgba(148, 163, 184, 0.45))',
        }}
      >
        {children}
      </span>
      <span className="relative text-white">{children}</span>
    </Tag>
  );
}

export default LiquidMetalText;
