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

export const BoxcodeMark = BoxcodeLogo;
export default BoxcodeLogo;
