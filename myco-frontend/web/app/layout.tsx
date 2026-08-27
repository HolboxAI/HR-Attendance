import type { Metadata } from 'next';
import Script from 'next/script';

import './globals.css';

export const metadata: Metadata = {
  title: 'Boxcode · HRMS',
  description: 'Attendance, leave and people - Boxcode HRMS',
};

/**
 * Document only. The visible frame lives in the route-group layouts:
 * (dashboard) has the header and the centred column, (auth) has neither.
 */
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full antialiased" suppressHydrationWarning>
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
          href="https://fonts.googleapis.com/css2?family=Archivo:wght@600;700;800;900&family=Geist:wght@400;500;600;700;800&family=IBM+Plex+Mono:wght@400;500&family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600;700&family=Source+Sans+3:wght@400;500;600&display=swap"
        />
      </head>
      <body className="min-h-full font-body">
        {/*
          Theme preference, applied before first paint so a dark-theme user
          never sees a white flash. It flags <html>; the CSS scopes the flag
          to #bx-shell, so the sign-in page keeps its own approved design.
          Failure (no storage, private mode) leaves the light default.
        */}
        <Script id="bx-theme-init" strategy="beforeInteractive">{`
          try {
            var m = localStorage.getItem('bx-theme');
            if (m === 'dark' || (m === 'system' && matchMedia('(prefers-color-scheme: dark)').matches)) {
              document.documentElement.classList.add('bx-dark-mode');
            }
          } catch (e) {}
          try {
            var nav = performance.getEntriesByType('navigation')[0];
            var isReload = (nav && nav.type === 'reload') || (performance.navigation && performance.navigation.type === 1);
            if (isReload && window.location.pathname !== '/' && window.location.pathname !== '/login') {
              window.location.replace('/');
            }
          } catch (e) {}
        `}</Script>
        {children}
      </body>
    </html>
  );
}
