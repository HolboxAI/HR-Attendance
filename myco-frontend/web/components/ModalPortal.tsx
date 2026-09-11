'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

/**
 * Render a modal on document.body so it is not trapped under the Shell
 * topbar. <main> is `relative z-10` and the header is `z-20`, so a
 * `fixed z-50` child of the page cannot paint above the global Search box.
 */
export function ModalPortal({ children }: { children: React.ReactNode }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;
  return createPortal(children, document.body);
}
