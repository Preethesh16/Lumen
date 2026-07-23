import type { Metadata } from 'next';
import Link from 'next/link';
import './globals.css';

export const metadata: Metadata = {
  title: {
    default: 'Lumen — Attention where it matters',
    template: '%s — Lumen',
  },
  description:
    'A live signal for humanitarian crises where human need outpaces media attention.',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <header className="site-header">
          <Link className="brand" href="/" aria-label="Lumen home">
            <span className="brand-mark" aria-hidden="true">
              L
            </span>
            <span>
              <strong>Lumen</strong>
              <small>Humanitarian attention monitor</small>
            </span>
          </Link>
          <nav aria-label="Main navigation">
            <Link href="/">Crisis index</Link>
            <a href="https://apidoc.reliefweb.int/" target="_blank" rel="noreferrer">
              Methodology ↗
            </a>
          </nav>
        </header>
        {children}
        <footer className="site-footer">
          <p>Lumen measures the distance between humanitarian need and public attention.</p>
          <p>Built by Preethesh &amp; Deepthi · Data updates daily</p>
        </footer>
      </body>
    </html>
  );
}
