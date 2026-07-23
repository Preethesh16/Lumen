import type { Metadata } from 'next';
import { RankingTable } from '@/components/ranking-table';
import { getCrises, LumenApiError } from '@/lib/api';
import { dateLabel, scorePercent } from '@/lib/format';

export const metadata: Metadata = {
  title: 'Crisis index',
};

export default async function HomePage() {
  try {
    const response = await getCrises();
    const top = response.data[0];
    const averageGap =
      response.data.length === 0
        ? 0
        : response.data.reduce((sum, item) => sum + item.latestScore.attentionGapScore, 0) /
          response.data.length;
    const highNeed = response.data.filter((item) => item.latestScore.needScore >= 0.65).length;

    return (
      <main>
        <section className="hero">
          <div className="eyebrow">
            <span className="live-dot" aria-hidden="true" />
            Daily humanitarian signal
          </div>
          <h1>
            Need is visible.
            <br />
            <em>Attention is not equal.</em>
          </h1>
          <p className="hero-copy">
            Lumen cross-references humanitarian severity, funding, and media coverage to
            surface crises being overlooked right now.
          </p>
          <div className="hero-meta">
            <span>
              Last scored
              <strong>{response.scoredFor ? dateLabel(response.scoredFor) : 'Awaiting data'}</strong>
            </span>
            <span>
              Active cohort
              <strong>{response.count} crises</strong>
            </span>
          </div>
        </section>

        {response.data.length === 0 ? (
          <section className="state-card" aria-labelledby="empty-title">
            <span className="state-icon">○</span>
            <h2 id="empty-title">No ranking yet</h2>
            <p>
              The database is ready, but no ingestion run has produced scores. Run the daily
              ingest once and this dashboard will populate automatically.
            </p>
            <code>pnpm --filter @lumen/api ingest</code>
          </section>
        ) : (
          <>
            <section className="signal-strip" aria-label="Current signal overview">
              <article>
                <span className="signal-number">01</span>
                <p>Most overlooked</p>
                <strong>{top?.name}</strong>
                <small>{top ? `${scorePercent(top.latestScore.needScore)} relative need` : '—'}</small>
              </article>
              <article>
                <span className="signal-number">02</span>
                <p>High-need crises</p>
                <strong>{highNeed}</strong>
                <small>Need score at or above 65%</small>
              </article>
              <article>
                <span className="signal-number">03</span>
                <p>Average attention gap</p>
                <strong>{averageGap > 0 ? '+' : ''}{averageGap.toFixed(3)}</strong>
                <small>Positive means under-reported</small>
              </article>
            </section>
            <RankingTable crises={response.data} scoredFor={response.scoredFor!} />
          </>
        )}
      </main>
    );
  } catch (error) {
    const message =
      error instanceof LumenApiError ? error.message : 'The dashboard could not load.';
    return (
      <main className="narrow-main">
        <section className="state-card error-state">
          <span className="state-icon">!</span>
          <h1>Signal temporarily unavailable</h1>
          <p>{message}</p>
          <p className="muted">Your data is safe. Refresh after the API is running.</p>
        </section>
      </main>
    );
  }
}
