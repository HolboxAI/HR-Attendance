import React from 'react';

export function PlaceholdersAndVanishInput({ placeholders, onChange, onSubmit }: any) {
  return (
    <div className="w-full relative">
      <input
        type="text"
        placeholder={placeholders?.[0] || "Search"}
        onChange={onChange}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            onSubmit?.(e);
          }
        }}
        className="w-full rounded-full border border-line bg-surface px-4 py-2 pr-10 text-sm outline-none focus:border-accent"
      />
    </div>
  );
}
