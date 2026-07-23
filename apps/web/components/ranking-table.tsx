'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import type { RankedCrisis } from '@lumen/shared-types';
import { dateLabel, scorePercent, signed } from '@/lib/format';

type Sort = 'rank' | 'need' | 'coverage' | 'funding';

export function RankingTable({
  crises,
  scoredFor,
}: {
  crises: RankedCrisis[];
  scoredFor: string;
}) {
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<Sort>('rank');

  const visible = useMemo(() => {
    const lowered = query.trim().toLowerCase();
    const filtered = lowered
      ? crises.filter((crisis) =>
          `${crisis.name} ${crisis.iso3} ${crisis.region ?? ''}`.toLowerCase().includes(lowered),
        )
      : [...crises];
    return filtered.sort((a, b) => {
      if (sort === 'need') return b.latestScore.needScore - a.latestScore.needScore;
      if (sort === 'coverage') return a.latestScore.coverageScore - b.latestScore.coverageScore;
      if (sort === 'funding') {
        return (b.latestScore.fundingGapPct ?? -1) - (a.latestScore.fundingGapPct ?? -1);
      }
      return a.rank - b.rank;
    });
  }, [crises, query, sort]);

  return (
    <section className="ranking-section" aria-labelledby="ranking-title">
      <div className="section-heading">
        <div>
          <p className="kicker">Crisis attention index</p>
          <h2 id="ranking-title">Where the gap is widest</h2>
        </div>
        <p>
          Scored {dateLabel(scoredFor)} · Select a crisis to inspect the evidence.
        </p>
      </div>

      <div className="table-tools">
        <label className="search-box">
          <span aria-hidden="true">⌕</span>
          <span className="sr-only">Search crises</span>
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search country or region"
          />
        </label>
        <label className="sort-box">
          <span>Sort by</span>
          <select value={sort} onChange={(event) => setSort(event.target.value as Sort)}>
            <option value="rank">Attention gap</option>
            <option value="need">Highest need</option>
            <option value="coverage">Lowest coverage</option>
            <option value="funding">Funding gap</option>
          </select>
        </label>
      </div>

      <div className="ranking-table" role="table" aria-label="Ranked humanitarian crises">
        <div className="ranking-head" role="row">
          <span role="columnheader">Rank / crisis</span>
          <span role="columnheader">Need</span>
          <span role="columnheader">Coverage</span>
          <span role="columnheader">Funding gap</span>
          <span role="columnheader">Attention gap</span>
        </div>
        {visible.map((crisis) => {
          const need = crisis.latestScore.needScore;
          const coverage = crisis.latestScore.coverageScore;
          return (
            <Link
              className="ranking-row"
              role="row"
              href={`/crises/${crisis.iso3}`}
              key={crisis.id}
            >
              <span className="crisis-cell" role="cell">
                <span className="rank">{String(crisis.rank).padStart(2, '0')}</span>
                <span>
                  <strong>{crisis.name}</strong>
                  <small>
                    {crisis.iso3} · {crisis.region ?? 'Region unavailable'}
                    {crisis.rankDelta !== null && crisis.rankDelta !== 0 && (
                      <b className={crisis.rankDelta > 0 ? 'delta-up' : 'delta-down'}>
                        {crisis.rankDelta > 0 ? ' ↑' : ' ↓'} {Math.abs(crisis.rankDelta)}
                      </b>
                    )}
                  </small>
                </span>
              </span>
              <span className="meter-cell" role="cell">
                <span className="meter" aria-hidden="true">
                  <i style={{ width: `${need * 100}%` }} />
                </span>
                <strong>{scorePercent(need)}</strong>
              </span>
              <span className="meter-cell coverage-meter" role="cell">
                <span className="meter" aria-hidden="true">
                  <i style={{ width: `${coverage * 100}%` }} />
                </span>
                <strong>{scorePercent(coverage)}</strong>
              </span>
              <span role="cell">
                {crisis.latestScore.fundingGapPct === null
                  ? 'No data'
                  : scorePercent(crisis.latestScore.fundingGapPct)}
              </span>
              <span className="gap-cell" role="cell">
                <strong>{signed(crisis.latestScore.attentionGapScore)}</strong>
                <span aria-hidden="true">↗</span>
              </span>
            </Link>
          );
        })}
      </div>

      {visible.length === 0 && (
        <div className="no-results">
          No crises match “{query}”. Try a country code or region.
        </div>
      )}
    </section>
  );
}
