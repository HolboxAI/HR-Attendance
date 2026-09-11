import React from 'react';

export interface BoxcodeLogoProps extends React.SVGProps<SVGSVGElement> {
  className?: string;
  size?: number | string;
}

/**
 * Official Holbox brand mark (isometric open box with vivid cobalt/blue gradients).
 */
export function BoxcodeLogo({ className = 'size-5', size, ...props }: BoxcodeLogoProps) {
  return (
    <svg
      viewBox="0 0 100 100"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      style={size ? { width: size, height: size } : undefined}
      aria-label="Holbox Logo"
      {...props}
    >
      <image
        href="/holbox-logo.png"
        x="0"
        y="0"
        width="100"
        height="100"
        preserveAspectRatio="xMidYMid meet"
      />
    </svg>
  );
}

export function HolboxMark({ className = 'size-16', size, ...props }: BoxcodeLogoProps) {
  return (
    <svg
      viewBox="0 0 100 100"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      style={size ? { width: size, height: size } : undefined}
      aria-label="Holbox Logo"
      {...props}
    >
      <image
        href="/holbox-logo.png"
        x="0"
        y="0"
        width="100"
        height="100"
        preserveAspectRatio="xMidYMid meet"
      />
    </svg>
  );
}

export const BoxcodeMark = BoxcodeLogo;
export default BoxcodeLogo;

