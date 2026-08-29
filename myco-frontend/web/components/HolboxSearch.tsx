'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AnimatePresence, motion } from 'framer-motion';
import { ArrowUpRight, User } from 'lucide-react';

import { PlaceholdersAndVanishInput } from '@/components/ui/placeholders-and-vanish-input';
import { useDebounce } from '@/components/ui/action-search-bar';
import { SECTIONS } from '@/components/Sidebar';
import type { Capabilities } from '@/lib/capabilities';
import { proxy } from '@/lib/format';

/**
 * The search that actually goes somewhere. One component, two homes:
 *
 * - variant="global" (the header, on every dashboard page): searches people
 *   AND pages. Typing "himesh" offers his profile; typing "devices" offers
 *   the Devices page. Pages come from the sidebar's own registry, filtered
 *   by the same capability checks - the search will never suggest a page
 *   the sidebar would not show this person.
 * - variant="directory" (the people page): people only, and every keystroke
 *   still feeds the live table filter it always did.
 *
 * Idle, the input cycles example placeholders (the vanish-input treatment);
 * focused, suggestions drop down in a panel that blurs ONLY its own
 * rectangle - backdrop-blur on the panel, no full-screen overlay - so the
 * page stays readable around it. Click or Enter navigates for real.
 *
 * People for the global variant come from /admin/board, which is manager+.
 * For an employee that fetch 403s, and they still get page suggestions -
 * the API stays the boundary; the search just shows less.
 */

type Person = { code: string; name: string; department: string | null };

/**
 * What people actually type for each page, beyond its label - "who is on
 * leave" should surface the Board and Leave, "phone" should surface Devices.
 * Keyed by href so a renamed label keeps its vocabulary.
 */
const STOPWORDS = new Set([
  'who', 'what', 'where', 'when', 'how', 'the', 'and', 'for', 'was', 'are',
  'try', 'open', 'show', 'find', 'goto', 'get',
]);

const PAGE_KEYWORDS: Record<string, string> = {
  '/': 'home overview dashboard',
  '/notifications': 'inbox alerts messages unread',
  '/board': 'attendance today who is in office present absent late leave register',
  '/checkin': 'camera punch check in selfie face',
  '/corrections': 'correction fix missed punch forgot',
  '/leave': 'leave apply holiday balance sick casual',
  '/leave/balances': 'team balances leave who is on leave',
  '/leave/policy': 'policy holidays calendar quota',
  '/leave/operations': 'accrual year end carry forward',
  '/leave/audit': 'audit history log',
  '/people': 'directory people employees staff profiles',
  '/enrolment': 'face photo enrol biometric',
  '/devices': 'devices phone handset binding unbind',
};

type Suggestion = {
  key: string;
  label: string;
  description: string;
  end: 'Profile' | 'Page';
  href: string;
  icon: React.ReactNode;
};

const container = {
  hidden: { opacity: 0, height: 0 },
  show: {
    opacity: 1,
    height: 'auto',
    transition: { height: { duration: 0.3 }, staggerChildren: 0.05 },
  },
  exit: {
    opacity: 0,
    height: 0,
    transition: { height: { duration: 0.25 }, opacity: { duration: 0.15 } },
  },
};

const item = {
  hidden: { opacity: 0, y: 12 },
  show: { opacity: 1, y: 0, transition: { duration: 0.25 } },
  exit: { opacity: 0, y: -8, transition: { duration: 0.15 } },
};

export function HolboxSearch({
  variant,
  caps,
  people,
  placeholders,
  onQueryChange,
  className,
}: {
  variant: 'global' | 'directory';
  caps?: Capabilities;
  /** directory passes its rows; global fetches the board once on focus */
  people?: Person[];
  placeholders: string[];
  onQueryChange?: (q: string) => void;
  className?: string;
}) {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [focused, setFocused] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [fetched, setFetched] = useState<Person[] | null>(null);
  const fetchStarted = useRef(false);
  const debounced = useDebounce(query, 200);

  // One board fetch per page life, started the first time the field is
  // focused or hovered - not on mount, so pages don't pay for a search
  // nobody opens.
  useEffect(() => {
    if ((!focused && !hovered) || variant !== 'global' || fetchStarted.current) return;
    fetchStarted.current = true;
    fetch(proxy('/api/v1/admin/board'))
      .then((r) => (r.ok ? r.json() : null))
      .then((body) => {
        if (body?.rows) {
          setFetched(body.rows.map((r: any) => ({
            code: r.employee_code, name: r.full_name, department: r.department ?? null,
          })));
        }
      })
      .catch(() => { /* employees get page suggestions only */ });
  }, [focused, hovered, variant]);

  const pool: Person[] = people ?? fetched ?? [];
  const q = debounced.toLowerCase().trim();
  // Token matching, not whole-phrase: the idle placeholders suggest natural
  // questions ("who is on leave?"), so typing one must still land - any
  // meaningful word of the query hitting any searchable text counts.
  // Stopwords are dropped first, or "is" would match Kr-IS-h and the
  // question would surface the whole company.
  const tokens = q.replace(/[?.,!]/g, ' ').split(/\s+/)
    .filter((t) => t.length >= 3 && !STOPWORDS.has(t));
  const hits = (text: string) =>
    !q || text.includes(q) || tokens.some((t) => text.includes(t));

  const peopleMatches: Suggestion[] = pool
    .filter((p) => hits(`${p.name} ${p.code} ${p.department ?? ''}`.toLowerCase()))
    .slice(0, q ? 6 : 4)
    .map((p) => ({
      key: `person-${p.code}`,
      label: p.name,
      description: `${p.code}${p.department ? ` · ${p.department}` : ''}`,
      end: 'Profile' as const,
      href: `/people/${p.code}`,
      icon: <User className="h-4 w-4 text-accent" />,
    }));

  const pageMatches: Suggestion[] = variant === 'global' && caps
    ? SECTIONS.flatMap((s) => s.items)
      .filter((i) => i.show(caps))
      .filter((i) => hits(`${i.label} ${i.href} ${PAGE_KEYWORDS[i.href] ?? ''}`.toLowerCase()))
      .slice(0, q ? 5 : 4)
      .map((i) => {
        const Icon = i.icon;
        return {
          key: `page-${i.href}`,
          label: i.label,
          description: i.href,
          end: 'Page' as const,
          href: i.href,
          icon: <Icon className="h-4 w-4 text-ink-3" />,
        };
      })
    : [];

  const suggestions = [...peopleMatches, ...pageMatches];

  function go(href: string) {
    setFocused(false);
    setQuery('');
    onQueryChange?.('');
    router.push(href);
  }

  return (
    <div
      className={`relative w-full ${className ?? ''}`}
      // The dropdown is hover-driven, not focus-driven: clicking into the
      // box just gives you a caret to type with. Hovering the box opens
      // the suggestions; they stay while the cursor is over them (the
      // panel is a child of this div, so it keeps `hovered` true) and
      // collapse the moment it leaves.
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          setFocused(false);
          setHovered(false);
          (document.activeElement as HTMLElement | null)?.blur?.();
        }
      }}
    >
      <PlaceholdersAndVanishInput
        placeholders={placeholders}
        onChange={(e) => { setQuery(e.target.value); onQueryChange?.(e.target.value); }}
        onFocus={() => setFocused(true)}
        // The delay is what lets a click on a suggestion land before the
        // dropdown unmounts - the same trick the imported component used.
        onBlur={() => setTimeout(() => setFocused(false), 200)}
        onSubmit={() => { if (suggestions[0]) go(suggestions[0].href); }}
        className={variant === 'global' ? 'h-9 text-xs' : 'h-11'}
      />

      <AnimatePresence>
        {/* Open while hovered, or while there is typed text being worked
            on - results must not vanish mid-typing just because the mouse
            drifted off. An empty box that is merely focused stays shut. */}
        {(hovered || (focused && query.trim().length > 0)) && suggestions.length > 0 && (
          <motion.div
            variants={container}
            initial="hidden"
            animate="show"
            exit="exit"
            // glass-panel is the app's own near-opaque card surface (0.9
            // white in light, 0.85 dark in dark), so the page text cannot
            // read through it; backdrop-blur frosts what little does - and
            // only the panel's own rectangle, never the whole screen.
            className="absolute left-0 right-0 top-full z-50 mt-2 overflow-hidden glass-panel backdrop-blur-2xl shadow-2xl"
          >
            <motion.ul className="p-1.5">
              {suggestions.map((s) => (
                <motion.li
                  key={s.key}
                  variants={item}
                  layout
                  // mousedown, not click: it fires before the input's blur
                  // timer can tear the list down under the cursor. onClick
                  // stays as the fallback for anything that synthesizes a
                  // click without the mousedown (some assistive tech does).
                  onMouseDown={(e) => { e.preventDefault(); go(s.href); }}
                  onClick={() => go(s.href)}
                  className="group flex cursor-pointer items-center justify-between rounded-xl px-3 py-2 hover:bg-surface-2"
                >
                  <div className="flex min-w-0 items-center gap-2.5">
                    <span className="shrink-0">{s.icon}</span>
                    <span className="truncate text-sm font-medium text-ink">{s.label}</span>
                    <span className="truncate text-xs font-mono text-ink-3">{s.description}</span>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5 pl-3">
                    <span className="text-xs font-mono text-ink-3">{s.end}</span>
                    <ArrowUpRight className="size-3.5 text-ink-3 opacity-0 transition-opacity group-hover:opacity-100" aria-hidden />
                  </div>
                </motion.li>
              ))}
            </motion.ul>
            <div className="border-t border-line/60 px-3.5 py-2">
              <div className="flex items-center justify-between text-[10px] font-mono text-ink-3">
                <span>Enter opens the first match</span>
                <span>Esc to close</span>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
