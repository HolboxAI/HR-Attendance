/**
 * The signed-out shell: no chrome at all.
 *
 * The auth page is a full-bleed split that runs its own background, so the
 * header and the centred max-width column that every signed-in page gets
 * would both fight it. Route groups exist for exactly this - `(auth)` and
 * `(dashboard)` do not appear in any URL, they just let the two halves of the
 * product have different frames.
 */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
