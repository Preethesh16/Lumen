import type { Metadata } from 'next';
import Link from 'next/link';
import './globals.css';

export const metadata: Metadata = {
  title: 'Lumen — under-reported humanitarian crises',
  description:
    'Ranks humanitarian crises by the gap between severity of need and volume of media coverage.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="mx-auto max-w-5xl px-6 py-10">
          <header className="mb-10 flex items-baseline justify-between border-b border-neutral-200 pb-4 dark:border-neutral-800">
            <Link href="/" className="text-xl font-semibold tracking-tight">
              Lumen
            </Link>
            <p className="text-sm text-neutral-500">
              Crises ranked by need against coverage
            </p>
          </header>
          <main>{children}</main>
          <footer className="mt-16 border-t border-neutral-200 pt-4 text-xs text-neutral-500 dark:border-neutral-800">
            Data from GDELT, ReliefWeb, UNHCR, and UN OCHA FTS. Scores are
            relative rankings across tracked crises, not absolute measurements.
          </footer>
        </div>
      </body>
    </html>
  );
}
