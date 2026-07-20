import { Resend } from 'resend';
import type { RankedCrisis } from '@lumen/shared-types';
import { fundingLabel, gapPoints } from '../format';
import type { DeliveryResult } from './telegram';

/**
 * Weekly digest email — the top under-reported crises by attention gap.
 *
 * Deliberately plain HTML: digest emails get read in clients with hostile
 * CSS support, and this is a working tool rather than a marketing send.
 */

const MAX_ATTEMPTS = 3;

let client: Resend | undefined;

function resend(): Resend {
  if (!client) {
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) {
      throw new Error('RESEND_API_KEY is not set — see README.md for required env vars');
    }
    client = new Resend(apiKey);
  }
  return client;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function renderDigest(crises: RankedCrisis[], dashboardUrl: string): string {
  // The database is empty until n8n's first ingestion run completes, so the
  // no-data case is a real state this will hit, not a defensive afterthought.
  if (crises.length === 0) {
    return `
      <h2>Lumen weekly digest</h2>
      <p>No crisis scores were available this week. This usually means the
      ingestion pipeline did not complete a run — the dashboard has the
      current status.</p>
      <p><a href="${escapeHtml(dashboardUrl)}">Open the Lumen dashboard</a></p>
    `.trim();
  }

  const rows = crises
    .map((crisis) => {
      const funding = fundingLabel(crisis.latestScore);

      return `
        <tr>
          <td style="padding:8px 12px;border-bottom:1px solid #e5e5e5;">
            <strong>${escapeHtml(crisis.name)}</strong><br>
            <span style="color:#666;font-size:13px;">${escapeHtml(crisis.region ?? '')}</span>
          </td>
          <td style="padding:8px 12px;border-bottom:1px solid #e5e5e5;text-align:right;">
            ${gapPoints(crisis.latestScore.attentionGapScore)}
          </td>
          <td style="padding:8px 12px;border-bottom:1px solid #e5e5e5;text-align:right;color:#666;">
            ${escapeHtml(funding)}
          </td>
        </tr>`;
    })
    .join('');

  return `
    <h2>Lumen weekly digest</h2>
    <p>The ${crises.length} most under-reported crises this week, ranked by the
    gap between humanitarian need and media coverage.</p>
    <table style="border-collapse:collapse;width:100%;font-family:system-ui,sans-serif;font-size:14px;">
      <thead>
        <tr style="text-align:left;color:#666;font-size:12px;text-transform:uppercase;">
          <th style="padding:8px 12px;">Crisis</th>
          <th style="padding:8px 12px;text-align:right;">Gap</th>
          <th style="padding:8px 12px;text-align:right;">Funding</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
    <p style="margin-top:24px;">
      <a href="${escapeHtml(dashboardUrl)}">Open the Lumen dashboard</a>
    </p>
    <p style="color:#888;font-size:12px;">
      Scores are relative rankings across the crises Lumen tracks, not absolute
      measurements. Figures come from GDELT, ReliefWeb, UNHCR, and OCHA FTS.
    </p>
  `.trim();
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Sends the weekly digest. Never throws — failures are returned for logging. */
export async function sendDigest(
  crises: RankedCrisis[],
  recipients: string[],
): Promise<DeliveryResult> {
  if (recipients.length === 0) {
    return { delivered: false, error: 'No digest recipients configured' };
  }

  const from = process.env.DIGEST_FROM_EMAIL;
  const dashboardUrl = process.env.NEXT_PUBLIC_DASHBOARD_URL ?? 'http://localhost:3000';

  if (!from) {
    return { delivered: false, error: 'DIGEST_FROM_EMAIL is not set' };
  }

  let lastError = 'unknown error';

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      const { error } = await resend().emails.send({
        from,
        to: recipients,
        subject: `Lumen weekly digest — ${crises.length} under-reported crises`,
        html: renderDigest(crises, dashboardUrl),
      });

      if (!error) return { delivered: true };
      lastError = error.message;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }

    if (attempt < MAX_ATTEMPTS) await sleep(1_000 * 2 ** (attempt - 1));
  }

  return { delivered: false, error: lastError };
}
