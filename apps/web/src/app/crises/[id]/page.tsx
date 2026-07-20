import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ApiUnavailableError, getCrisis } from '@/lib/api/client';
import { asPoints, formatDate, fundingLabel, trendLabel, trendOf } from '@/lib/format';
import { TrendChart } from '@/components/trend-chart';
import { ErrorState, MockDataNotice } from '@/components/states';

export const dynamic = 'force-dynamic';

const SOURCE_NAMES: Record<string, string> = {
  gdelt: 'GDELT',
  reliefweb: 'ReliefWeb',
  unhcr: 'UNHCR',
  'ocha-fts': 'UN OCHA FTS',
};

export default async function CrisisDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  let result;
  try {
    result = await getCrisis(id);
  } catch (error) {
    if (error instanceof ApiUnavailableError) {
      return <ErrorState detail="The Lumen API did not respond, so this crisis could not be loaded." />;
    }
    throw error;
  }

  if (!result) notFound();

  const { data, isMock } = result;
  const { crisis, history, sources } = data;
  const trend = trendOf(history.points);

  return (
    <>
      {isMock && <MockDataNotice />}

      <Link href="/" className="text-sm text-neutral-500 underline-offset-4 hover:underline">
        ← All crises
      </Link>

      <h1 className="mt-4 text-2xl font-semibold tracking-tight">{crisis.name}</h1>
      <p className="mt-1 text-sm text-neutral-500">
        {crisis.country} · last scored {formatDate(crisis.computedAt)}
      </p>

      <dl className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Stat label="Need" value={asPoints(crisis.needScore)} />
        <Stat label="Coverage" value={asPoints(crisis.coverageScore)} />
        <Stat label="Attention gap" value={asPoints(crisis.attentionGapScore)} emphasis />
        <Stat label="Funding" value={fundingLabel(crisis)} />
      </dl>

      <section className="mt-10">
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="text-lg font-medium">Need against coverage</h2>
          <span className="text-sm text-neutral-500">{trendLabel(trend)}</span>
        </div>
        <TrendChart points={history.points} />
      </section>

      <section className="mt-10">
        <h2 className="mb-3 text-lg font-medium">Underlying data</h2>
        {sources.length === 0 ? (
          <p className="text-sm text-neutral-500">
            No source observations were recorded for this scoring run.
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-neutral-200 text-left text-xs uppercase tracking-wide text-neutral-500 dark:border-neutral-800">
                <th className="py-2 pr-4 font-medium">Measure</th>
                <th className="py-2 pr-4 text-right font-medium">Value</th>
                <th className="py-2 pr-4 font-medium">Source</th>
                <th className="py-2 font-medium">Retrieved</th>
              </tr>
            </thead>
            <tbody>
              {sources.map((observation, index) => (
                <tr
                  key={`${observation.source}-${index}`}
                  className="border-b border-neutral-100 last:border-0 dark:border-neutral-900"
                >
                  <td className="py-2 pr-4">{observation.label}</td>
                  <td className="py-2 pr-4 text-right tabular-nums">
                    {observation.value.toLocaleString('en-GB')}{' '}
                    <span className="text-neutral-500">{observation.unit}</span>
                  </td>
                  <td className="py-2 pr-4 text-neutral-500">
                    {observation.url ? (
                      <a
                        href={observation.url}
                        className="underline-offset-4 hover:underline"
                        rel="noreferrer"
                        target="_blank"
                      >
                        {SOURCE_NAMES[observation.source] ?? observation.source}
                      </a>
                    ) : (
                      (SOURCE_NAMES[observation.source] ?? observation.source)
                    )}
                  </td>
                  <td className="py-2 text-neutral-500">
                    {formatDate(observation.retrievedAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <div className="mt-10">
        <Link
          href={`/crises/${crisis.crisisId}/briefs`}
          className="inline-block rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white dark:bg-neutral-100 dark:text-neutral-900"
        >
          View generated briefs
        </Link>
      </div>
    </>
  );
}

function Stat({
  label,
  value,
  emphasis,
}: {
  label: string;
  value: string;
  emphasis?: boolean;
}) {
  return (
    <div className="rounded-lg border border-neutral-200 p-4 dark:border-neutral-800">
      <dt className="text-xs uppercase tracking-wide text-neutral-500">{label}</dt>
      <dd
        className={`mt-1 text-xl font-semibold tabular-nums ${
          emphasis ? 'text-amber-700 dark:text-amber-400' : ''
        }`}
      >
        {value}
      </dd>
    </div>
  );
}
