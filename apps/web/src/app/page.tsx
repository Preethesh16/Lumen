import Link from 'next/link';
import { ApiUnavailableError, getCrises } from '@/lib/api/client';
import { asPoints, formatDate, fundingLabel } from '@/lib/format';
import { EmptyState, ErrorState, MockDataNotice } from '@/components/states';

export const dynamic = 'force-dynamic';

export default async function HomePage() {
  let crises;
  let isMock = false;

  try {
    ({ data: crises, isMock } = await getCrises());
  } catch (error) {
    if (error instanceof ApiUnavailableError) {
      return (
        <ErrorState detail="The Lumen API did not respond. Scores are computed daily by the ingestion pipeline; if this persists, check that the API and n8n are running." />
      );
    }
    throw error;
  }

  if (crises.length === 0) {
    return (
      <EmptyState
        title="No crises scored yet"
        detail="The ingestion pipeline has not completed a run. Scores appear here once GDELT, ReliefWeb, UNHCR, and OCHA FTS data has been collected and scored."
      />
    );
  }

  return (
    <>
      {isMock && <MockDataNotice />}

      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">
          Under-reported crises
        </h1>
        <p className="mt-1 text-sm text-neutral-500">
          Ranked by attention gap — how far humanitarian need exceeds media
          coverage. Higher is more neglected.
        </p>
      </div>

      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-neutral-200 text-left text-xs uppercase tracking-wide text-neutral-500 dark:border-neutral-800">
            <th className="py-2 pr-4 font-medium">Crisis</th>
            <th className="py-2 pr-4 text-right font-medium">Need</th>
            <th className="py-2 pr-4 text-right font-medium">Coverage</th>
            <th className="py-2 pr-4 text-right font-medium">Gap</th>
            <th className="py-2 text-right font-medium">Funding</th>
          </tr>
        </thead>
        <tbody>
          {crises.map((crisis) => (
            <tr
              key={crisis.crisisId}
              className="border-b border-neutral-100 last:border-0 hover:bg-neutral-50 dark:border-neutral-900 dark:hover:bg-neutral-900/50"
            >
              <td className="py-3 pr-4">
                <Link
                  href={`/crises/${crisis.crisisId}`}
                  className="font-medium underline-offset-4 hover:underline"
                >
                  {crisis.name}
                </Link>
                <div className="text-xs text-neutral-500">
                  {crisis.country} · scored {formatDate(crisis.computedAt)}
                </div>
              </td>
              <td className="py-3 pr-4 text-right tabular-nums">
                {asPoints(crisis.needScore)}
              </td>
              <td className="py-3 pr-4 text-right tabular-nums text-neutral-500">
                {asPoints(crisis.coverageScore)}
              </td>
              <td
                className={`py-3 pr-4 text-right font-medium tabular-nums ${
                  crisis.attentionGapScore > 0
                    ? 'text-amber-700 dark:text-amber-400'
                    : 'text-neutral-400'
                }`}
              >
                {asPoints(crisis.attentionGapScore)}
              </td>
              <td className="py-3 text-right text-neutral-500">
                {fundingLabel(crisis)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
