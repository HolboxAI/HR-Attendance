import React from 'react';

export function SparklesCore({
  background,
  minSize,
  maxSize,
  particleDensity,
  className,
  particleColor
}: any) {
  return (
    <div className={`relative ${className || ''}`} style={{ background }}>
      {/* Sparkles stub */}
    </div>
  );
}
