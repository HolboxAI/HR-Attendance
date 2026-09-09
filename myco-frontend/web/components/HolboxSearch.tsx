import React from 'react';

export function HolboxSearch({ value, onChange, placeholder }: any) {
  return (
    <div className="holbox-search relative w-full max-w-sm">
      <input
        type="text"
        placeholder={placeholder || "Search..."}
        value={value}
        onChange={(e) => onChange?.(e.target.value)}
        className="w-full rounded-md border border-line bg-surface px-4 py-2 text-sm text-ink outline-none focus:border-accent focus:ring-1 focus:ring-accent"
      />
    </div>
  );
}
