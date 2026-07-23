'use client';

export default function ErrorPage({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="narrow-main">
      <section className="state-card error-state">
        <span className="state-icon">!</span>
        <h1>Something interrupted the signal</h1>
        <p>The dashboard could not complete this request. Your stored data was not changed.</p>
        <button className="primary-button" onClick={reset}>Try again</button>
      </section>
    </main>
  );
}
