// ============================================================
// /join/[token] layout — minimal full-bleed dark shell.
//
// The route group sits outside both `(auth)` and `(dashboard)`
// because it's hybrid: the page must render for anonymous
// visitors (to show "Sign up to join Acme") *and* for signed-in
// users (to show "Accept invite"). Reusing `(auth)`'s layout
// would funnel signed-in users through the middleware's auth-
// page redirect; reusing `(dashboard)` would funnel anonymous
// visitors through its login redirect. A dedicated layout
// avoids both.
//
// Styling matches the login / signup pages — centered card on a
// slate-950 background — so the join experience feels like a
// natural step in the auth funnel rather than a foreign page.
//
// Referrer-Policy: no-referrer
//   The plaintext invite token lives in the URL path. Without
//   this header, any externally-loaded resource (third-party
//   font, CDN script, image) would receive the full join URL in
//   its `Referer` header. The /join page doesn't currently load
//   anything external, but `Referrer-Policy: no-referrer` is a
//   cheap belt-and-braces guard against future regressions
//   accidentally leaking tokens. Per Next.js 16's `metadata`
//   export, this surfaces as `<meta name="referrer" content="no-referrer">`.
// ============================================================

import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import Link from 'next/link';
import { OrganiZAPLogo } from '@/components/brand/organizap-logo';

export const metadata: Metadata = {
  referrer: 'no-referrer',
  // Belt-and-braces against an invite URL ending up in search
  // results if a join page is ever crawled.
  robots: { index: false, follow: false },
};

export default function JoinLayout({ children }: { children: ReactNode }) {
  return (
    <main className="relative isolate flex min-h-[100svh] items-center justify-center overflow-hidden bg-[#020706] px-4 py-8 text-white">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 -z-10 opacity-50"
        style={{
          backgroundImage:
            'linear-gradient(rgba(110, 231, 183, 0.055) 1px, transparent 1px), linear-gradient(90deg, rgba(110, 231, 183, 0.055) 1px, transparent 1px)',
          backgroundSize: '46px 46px',
          maskImage: 'radial-gradient(ellipse at center, black 10%, transparent 74%)',
        }}
      />
      <div className="pointer-events-none absolute -left-32 top-[14%] -z-10 h-80 w-80 rounded-full bg-emerald-400/20 blur-[110px]" />
      <div className="pointer-events-none absolute -right-20 bottom-[-12%] -z-10 h-96 w-96 rounded-full bg-lime-300/10 blur-[130px]" />
      <Link href="/login" className="absolute left-5 top-5 rounded-xl bg-white px-2.5 py-1.5 shadow-[0_10px_22px_rgba(0,0,0,0.18)] sm:left-8 sm:top-8">
        <OrganiZAPLogo className="h-7 w-28" priority />
      </Link>
      {children}
    </main>
  );
}
