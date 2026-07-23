import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { BriefPanel } from '@/components/brief-panel';
import { TrendChart } from '@/components/trend-chart';
import { getCrisis, LumenApiError } from '@/lib/api';
import {
  dateLabel,
  metricNames,
  observationValue,
  scorePercent,
  signed,
} from '@/lib/format';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  return { title: `${id.toUpperCase()} crisis detail` };
}

export default async function CrisisPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const { data } = await getCrisis(id);
    const score = data.latestScore;
    return (
      <main>
        <section className="detail-hero">
          <Link href="/" className="back-link">← Back to crisis index</Link>
          <div className="detail-title">
            <div>
              <p className="kicker">{data.region ?? 'Region unavailable'} · {data.iso3}</p>
              <h1>{data.name}</h1>
              <p>
                Latest evidence scored {dateLabel(score.scoredFor)} using algorithm{' '}
                {score.algorithmVersion}.
              </p>
            </div>
            <div className="gap-badge">
              <small>Attention gap</small>
              <strong>{signed(score.attentionGapScore)}</strong>
              <span>{score.attentionGapScore > 0 ? 'Under-reported' : 'Attention meets need'}</span>
            </div>
          </div>
        </section>

        <section className="score-grid" aria-label="Latest scores">
          <article>
            <p>Humanitarian need</p>
            <strong>{scorePercent(score.needScore)}</strong>
            <div className="large-meter"><i style={{ width: `${score.needScore * 100}%` }} /></div>
            <small>Cohort-relative severity</small>
          </article>
          <article>
            <p>Media coverage</p>
            <strong>{scorePercent(score.coverageScore)}</strong>
            <div className="large-meter coverage"><i style={{ width: `${score.coverageScore * 100}%` }} /></div>
            <small>Relative public attention</small>
          </article>
          <article>
            <p>Funding gap</p>
            <strong>{score.fundingGapPct === null ? '—' : scorePercent(score.fundingGapPct)}</strong>
            <div className="large-meter funding"><i style={{ width: `${(score.fundingGapPct ?? 0) * 100}%` }} /></div>
            <small>{score.fundingGapPct === null ? 'No active appeal data' : 'Share of appeal unfunded'}</small>
          </article>
        </section>

        <section className="evidence-grid">
          <article className="panel chart-panel">
            <div className="panel-heading">
              <div>
                <p className="kicker">History</p>
                <h2>Need vs. coverage</h2>
              </div>
              <span>0–100 normalized scale</span>
            </div>
            <TrendChart history={data.history} />
          </article>

          <article className="panel observation-panel">
            <div className="panel-heading">
              <div>
                <p className="kicker">Source evidence</p>
                <h2>Latest readings</h2>
              </div>
            </div>
            {data.latestObservations.length === 0 ? (
              <p className="muted">No source observations are available.</p>
            ) : (
              <div className="observation-list">
                {data.latestObservations.map((point) => (
                  <div key={point.metric}>
                    <span>
                      <small>{point.source}</small>
                      {metricNames[point.metric]}
                    </span>
                    <strong>{observationValue(point.metric, point.value)}</strong>
                    <time>{dateLabel(point.observedAt)}</time>
                  </div>
                ))}
              </div>
            )}
          </article>
        </section>

        <BriefPanel crisisId={data.id} briefs={data.briefs} />
      </main>
    );
  } catch (error) {
    if (error instanceof LumenApiError && error.status === 404) notFound();
    throw error;
  }
}
