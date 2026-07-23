import { NextResponse } from 'next/server';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const secret = process.env.LUMEN_ADMIN_SECRET || process.env.N8N_WEBHOOK_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: { code: 'not_configured', message: 'LUMEN_ADMIN_SECRET is not configured.' } },
      { status: 503 },
    );
  }
  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const response = await fetch(
    `${process.env.API_BASE_URL ?? 'http://localhost:4000'}/briefs/${encodeURIComponent(id)}/deliver`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-lumen-admin-secret': secret,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20_000),
    },
  ).catch(() => null);
  if (!response) {
    return NextResponse.json(
      { error: { code: 'api_unavailable', message: 'The Lumen API is unavailable.' } },
      { status: 503 },
    );
  }
  return NextResponse.json(await response.json(), { status: response.status });
}
