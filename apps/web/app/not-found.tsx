import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="narrow-main">
      <section className="state-card">
        <span className="state-icon">404</span>
        <h1>Crisis not found</h1>
        <p>This crisis does not exist or has not received a score yet.</p>
        <Link className="primary-button inline-button" href="/">Return to the index</Link>
      </section>
    </main>
  );
}
