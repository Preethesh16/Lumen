'use client';

import { useState } from 'react';
import type { Brief, BriefAudience } from '@lumen/shared-types';

const AUDIENCE_LABELS: Record<BriefAudience, string> = {
  journalist: 'Journalist pitch',
  donor: 'Donor one-pager',
  ngo: 'NGO fundraising angle',
};

export function BriefViewer({
  briefs,
  failures,
}: {
  briefs: Brief[];
  failures: { audience: BriefAudience; error: string }[];
}) {
  const [active, setActive] = useState(0);
  const [copied, setCopied] = useState(false);

  if (briefs.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-neutral-300 p-8 text-center dark:border-neutral-700">
        <p className="font-medium">No briefs generated</p>
        <p className="mx-auto mt-2 max-w-md text-sm text-neutral-500">
          {failures.length > 0
            ? 'Generation failed for every audience. A brief is withheld rather than published when it contains a figure that cannot be traced to the source data.'
            : 'Briefs have not been generated for this crisis yet.'}
        </p>
      </div>
    );
  }

  const brief = briefs[active];

  async function copy() {
    try {
      await navigator.clipboard.writeText(`${brief.headline}\n\n${brief.body}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 2_000);
    } catch {
      // Clipboard access is denied in some browsers and over plain HTTP.
      // Say so rather than showing a success state that did not happen.
      setCopied(false);
      alert('Could not copy — your browser blocked clipboard access. Select the text manually.');
    }
  }

  return (
    <>
      <div className="mb-4 flex flex-wrap gap-2 border-b border-neutral-200 dark:border-neutral-800">
        {briefs.map((entry, index) => (
          <button
            key={entry.briefId}
            onClick={() => setActive(index)}
            className={`-mb-px border-b-2 px-3 py-2 text-sm ${
              index === active
                ? 'border-neutral-900 font-medium dark:border-neutral-100'
                : 'border-transparent text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100'
            }`}
          >
            {AUDIENCE_LABELS[entry.audience]}
          </button>
        ))}
      </div>

      <article className="rounded-lg border border-neutral-200 p-6 dark:border-neutral-800">
        <div className="flex items-start justify-between gap-4">
          <h3 className="text-lg font-medium">{brief.headline}</h3>
          <button
            onClick={copy}
            className="shrink-0 rounded-md border border-neutral-300 px-3 py-1.5 text-xs hover:bg-neutral-50 dark:border-neutral-700 dark:hover:bg-neutral-900"
          >
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>

        <div className="mt-4 whitespace-pre-wrap text-sm leading-relaxed">
          {brief.body}
        </div>

        <div className="mt-6 border-t border-neutral-200 pt-4 dark:border-neutral-800">
          <p className="text-xs text-neutral-500">
            Every figure below was checked against the source data before this
            brief was shown. {brief.statsUsed.length} figure
            {brief.statsUsed.length === 1 ? '' : 's'} cited · generated with{' '}
            {brief.model}.
          </p>
          {brief.statsUsed.length > 0 && (
            <ul className="mt-2 space-y-1 text-xs text-neutral-500">
              {brief.statsUsed.map((stat, index) => (
                <li key={index}>
                  <span className="font-medium text-neutral-700 dark:text-neutral-300">
                    {stat.value}
                  </span>{' '}
                  — {stat.from} ({stat.source})
                </li>
              ))}
            </ul>
          )}
        </div>
      </article>

      {failures.length > 0 && (
        <div className="mt-4 rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
          <p className="font-medium">
            {failures.length} brief{failures.length === 1 ? '' : 's'} withheld
          </p>
          <ul className="mt-1 space-y-1 text-xs">
            {failures.map((failure) => (
              <li key={failure.audience}>
                {AUDIENCE_LABELS[failure.audience]}: {failure.error}
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}
