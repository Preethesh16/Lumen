/**
 * Empty and error states.
 *
 * These are built first rather than last: the database is empty until n8n's
 * first ingestion run completes, so "no data" is the state the dashboard
 * opens in on day one, not an edge case.
 */

export function EmptyState({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="rounded-lg border border-dashed border-neutral-300 p-10 text-center dark:border-neutral-700">
      <p className="font-medium">{title}</p>
      <p className="mx-auto mt-2 max-w-md text-sm text-neutral-500">{detail}</p>
    </div>
  );
}

export function ErrorState({ detail }: { detail: string }) {
  return (
    <div className="rounded-lg border border-red-300 bg-red-50 p-6 dark:border-red-900 dark:bg-red-950/40">
      <p className="font-medium text-red-900 dark:text-red-200">
        Could not load crisis data
      </p>
      <p className="mt-2 text-sm text-red-800 dark:text-red-300">{detail}</p>
    </div>
  );
}

/** Shown whenever the page is rendering placeholder rather than live data. */
export function MockDataNotice() {
  return (
    <div className="mb-6 rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
      <strong className="font-medium">Placeholder data.</strong> The Lumen API
      is not configured, so these figures are illustrative and not real crisis
      measurements. Set <code className="font-mono text-xs">LUMEN_API_URL</code>{' '}
      to show live data.
    </div>
  );
}
