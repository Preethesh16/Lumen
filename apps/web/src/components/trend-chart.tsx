'use client';

import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { ScoreHistoryPoint } from '@lumen/shared-types';

/**
 * Need against coverage over time. Both series share one 0-100 axis because
 * the whole point is the distance between them — separate axes would let a
 * rendering choice manufacture or hide the gap.
 */
export function TrendChart({ points }: { points: ScoreHistoryPoint[] }) {
  if (points.length < 2) {
    return (
      <p className="rounded-md border border-dashed border-neutral-300 p-6 text-center text-sm text-neutral-500 dark:border-neutral-700">
        Only one observation so far — a trend needs at least two. Scores are
        computed daily, so this fills in over the coming days.
      </p>
    );
  }

  const data = [...points]
    .sort((a, b) => a.computedAt.localeCompare(b.computedAt))
    .map((point) => ({
      date: new Date(point.computedAt).toLocaleDateString('en-GB', {
        day: 'numeric',
        month: 'short',
      }),
      need: Math.round(point.needScore * 100),
      coverage: Math.round(point.coverageScore * 100),
    }));

  return (
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 8, bottom: 8, left: -16 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="currentColor" opacity={0.12} />
          <XAxis dataKey="date" tick={{ fontSize: 12 }} stroke="currentColor" opacity={0.5} />
          <YAxis domain={[0, 100]} tick={{ fontSize: 12 }} stroke="currentColor" opacity={0.5} />
          <Tooltip
            contentStyle={{ fontSize: 12, borderRadius: 6 }}
            formatter={(value: number, name: string) => [value, name]}
          />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Line
            type="monotone"
            dataKey="need"
            name="Need"
            stroke="#b45309"
            strokeWidth={2}
            dot={false}
          />
          <Line
            type="monotone"
            dataKey="coverage"
            name="Media coverage"
            stroke="#0369a1"
            strokeWidth={2}
            dot={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
