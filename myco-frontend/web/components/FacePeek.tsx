import React from 'react';

export function FacePeek({ children, code, name, className }: any) {
  return (
    <div className={className}>
      {children}
    </div>
  );
}
