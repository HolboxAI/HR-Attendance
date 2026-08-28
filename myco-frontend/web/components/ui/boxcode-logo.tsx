import React from 'react';

export interface BoxcodeLogoProps extends React.SVGProps<SVGSVGElement> {
  className?: string;
  size?: number | string;
}

export function BoxcodeLogo({ className = 'size-5', size, ...props }: BoxcodeLogoProps) {
  return (
    <svg
      viewBox="0 0 24 20"
      fill="currentColor"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      style={size ? { width: size, height: size } : undefined}
      aria-label="Boxcode Logo"
      {...props}
    >
      {/* Outer stepped bracket with hollow cutout */}
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M4 0H9V3H15V0H20V3H22V17H20V20H15V17H9V20H4V17H2V3H4V0ZM6 6H18V14H6V6Z"
      />
      {/* Inner solid floating core block */}
      <rect x="9" y="8" width="6" height="4" rx="0.5" />
    </svg>
  );
}

/**
 * The Holbox cube, from the brand image Krish supplied: an isometric box
 * with a dark navy top face, a white left face, a vivid blue right face,
 * and a blue diamond ring set into the lower front. Brand colours are
 * fixed hex on purpose - a logo does not re-theme with the page.
 */
export function HolboxMark({ className = 'size-16', size, ...props }: BoxcodeLogoProps) {
  return (
    <svg
      viewBox="0 0 100 100"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      style={size ? { width: size, height: size } : undefined}
      aria-label="Holbox logo"
      {...props}
    >
      {/* top face */}
      <polygon points="50,3 95,26.5 50,50 5,26.5" fill="#141BC8" />
      {/* left face */}
      <polygon points="5,26.5 50,50 50,97 5,73.5" fill="#FFFFFF" />
      {/* right face */}
      <polygon points="95,26.5 95,73.5 50,97 50,50" fill="#2E5BFF" />
      {/* diamond ring set into the lower front */}
      <polygon
        points="50,55 67,71 50,87 33,71"
        stroke="#2E5BFF"
        strokeWidth="7"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export const BoxcodeMark = BoxcodeLogo;
export default BoxcodeLogo;
