'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { Brief, BriefAudience, DeliveryChannel } from '@lumen/shared-types';

export function BriefPanel({ crisisId, briefs }: { crisisId: string; briefs: Brief[] }) {
  const router = useRouter();
  const [audience, setAudience] = useState<BriefAudience>('journalist');
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function generate() {
    setBusy('generate');
    setNotice(null);
    try {
      const response = await fetch(`/api/crises/${crisisId}/briefs`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ audience }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message ?? 'Brief generation failed');
      setNotice(body.usedFallback ? 'Brief generated with the grounded template.' : 'Groq brief generated and verified.');
      router.refresh();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Brief generation failed');
    } finally {
      setBusy(null);
    }
  }

  async function copy(content: string) {
    await navigator.clipboard.writeText(content);
    setNotice('Brief copied to clipboard.');
  }

  async function deliver(briefId: string, channels: DeliveryChannel[]) {
    setBusy(briefId);
    setNotice(null);
    try {
      const response = await fetch(`/api/briefs/${briefId}/deliver`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ channels }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message ?? 'Delivery failed');
      setNotice(
        body.data.map((item: { channel: string; status: string }) => `${item.channel}: ${item.status}`).join(' · '),
      );
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Delivery failed');
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="brief-section" aria-labelledby="brief-title">
      <div className="section-heading compact-heading">
        <div>
          <p className="kicker">Grounded outreach</p>
          <h2 id="brief-title">Humanitarian briefs</h2>
        </div>
        <div className="brief-controls">
          <label>
            <span className="sr-only">Audience</span>
            <select value={audience} onChange={(event) => setAudience(event.target.value as BriefAudience)}>
              <option value="journalist">For journalists</option>
              <option value="donor">For donors</option>
              <option value="ngo">For NGOs</option>
            </select>
          </label>
          <button className="primary-button" onClick={generate} disabled={busy !== null}>
            {busy === 'generate' ? 'Generating…' : 'Generate brief'}
          </button>
        </div>
      </div>

      {notice && <p className="notice" role="status">{notice}</p>}

      {briefs.length === 0 ? (
        <div className="brief-empty">
          <span>✦</span>
          <p>No brief has been generated for this crisis yet.</p>
          <small>Every number will remain linked to the score and observations above.</small>
        </div>
      ) : (
        <div className="brief-list">
          {briefs.map((brief) => (
            <article className="brief-card" key={brief.id}>
              <div className="brief-meta">
                <span>{brief.audience}</span>
                <span>{brief.model}</span>
                <time>{new Date(brief.generatedAt).toLocaleString()}</time>
              </div>
              <p>{brief.content}</p>
              <div className="brief-actions">
                <button onClick={() => copy(brief.content)}>Copy</button>
                <button disabled={busy !== null} onClick={() => deliver(brief.id, ['telegram'])}>
                  Telegram
                </button>
                <button disabled={busy !== null} onClick={() => deliver(brief.id, ['email'])}>
                  Email
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
