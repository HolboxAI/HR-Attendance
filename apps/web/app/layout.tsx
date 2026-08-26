import type { Metadata } from 'next';
import Link from 'next/link';

import { SignOut } from '@/components/SignOut';
import { currentIdentity } from '@/lib/session';

import './globals.css';

export const metadata: Metadata = {
  title: 'Boxcode · Attendance',
  description: 'Live attendance board',
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Null on the login screen, and on any page reached without a session.
  const me = await currentIdentity();

  return (
    <html lang="en" className="h-full antialiased">
      <head>
        {/*
          Loaded by the browser rather than next/font, deliberately: next/font
          fetches at BUILD time, so the build breaks on any machine without
          access to Google Fonts. This way the build works offline and the
          fallback stack carries the page if the fonts never arrive.
        */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Archivo:wght@600;700;800&family=IBM+Plex+Mono:wght@400;500&family=Source+Sans+3:wght@400;500;600&display=swap"
        />
      </head>
      <body className="min-h-full font-body">
        <header className="border-b border-line bg-surface">
          <div className="mx-auto flex max-w-[1180px] items-center justify-between px-6 py-4">
            <div className="flex items-baseline gap-6">
              <Link href="/" className="flex items-baseline gap-3">
                <span className="font-display text-lg font-extrabold tracking-tight">Boxcode</span>
                <span className="text-xs uppercase tracking-[0.16em] text-accent">Attendance</span>
              </Link>
              {/*
                Nav follows the role. Enrolment is HR and above, so a manager
                is not shown a link that would only 403 - but note the link is
                the courtesy, not the control: the API refuses regardless.
              */}
              {me && (
                <nav className="flex items-baseline gap-4 text-sm">
                  <Link href="/" className="text-ink-2 hover:text-ink">Board</Link>
                  <Link href="/leave" className="text-ink-2 hover:text-ink">Leave</Link>
                  {me.is_admin && (
                    <Link href="/enrolment" className="text-ink-2 hover:text-ink">Enrolment</Link>
                  )}
                </nav>
              )}
            </div>
            {me
              ? <SignOut email={me.email} role={me.role} />
              : <span className="text-xs text-ink-3">IIMA Ventures, Ahmedabad</span>}
          </div>
        </header>
        <main className="mx-auto max-w-[1180px] px-6 py-8">{children}</main>
      </body>
    </html>
  );
}
