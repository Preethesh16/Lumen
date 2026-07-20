import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Brief, BriefAudience } from '@lumen/shared-types';
import { ApiUnavailableError, getCrisis } from '@/lib/api/client';
import { generateAllBriefs } from '@/lib/content-agent/generate';
import { BriefViewer } from '@/components/brief-viewer';
import { ErrorState } from '@/components/states';

export const dynamic = 'force-dynamic';

export default async function BriefsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  let result;
  try {
    result = await getCrisis(id);
  } catch (error) {
    if (error instanceof ApiUnavailableError) {
      return <ErrorState detail="The Lumen API did not respond, so briefs could not be generated." />;
    }
    throw error;
  }

  if (!result) notFound();

  const { crisis, history, sources } = result.data;

  let briefs: Brief[] = [];
  let failures: { audience: BriefAudience; error: string }[] = [];

  if (!process.env.ANTHROPIC_API_KEY) {
    failures = (['journalist', 'donor', 'ngo'] as BriefAudience[]).map((audience) => ({
      audience,
      error: 'ANTHROPIC_API_KEY is not set, so no brief could be generated.',
    }));
  } else {
    ({ briefs, failures } = await generateAllBriefs({ crisis, history, sources }));
  }

  return (
    <>
      <Link
        href={`/crises/${crisis.crisisId}`}
        className="text-sm text-neutral-500 underline-offset-4 hover:underline"
      >
        ← {crisis.name}
      </Link>

      <h1 className="mt-4 text-2xl font-semibold tracking-tight">Generated briefs</h1>
      <p className="mb-6 mt-1 text-sm text-neutral-500">
        Written from this crisis&rsquo;s source data only. A brief containing a
        figure that cannot be traced back to that data is withheld rather than
        shown.
      </p>

      <BriefViewer briefs={briefs} failures={failures} />
    </>
  );
}
