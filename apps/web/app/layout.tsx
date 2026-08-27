import type { Metadata } from 'next';

import './globals.css';

export const metadata: Metadata = {
  title: 'Boxcode · Attendance',
  description: 'Live attendance board',
};

/**
 * Document only. The visible frame lives in the route-group layouts:
 * (dashboard) has the header and the centred column, (auth) has neither.
 */
export default function RootLayout({ children }: { children: React.ReactNode }) {
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
          href="https://fonts.googleapis.com/css2?family=Archivo:wght@600;700;800;900&family=IBM+Plex+Mono:wght@400;500&family=Source+Sans+3:wght@400;500;600&display=swap"
        />
      </head>
      <body className="min-h-full font-body">{children}</body>
    </html>
  );
}
