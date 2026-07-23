import type { ScoreHistoryPoint } from '@lumen/shared-types';

function points(values: number[], width: number, height: number): string {
  const min = Math.min(...values, 0);
  const max = Math.max(...values, 1);
  const spread = max - min || 1;
  return values
    .map((value, index) => {
      const x = values.length === 1 ? width / 2 : (index / (values.length - 1)) * width;
      const y = height - ((value - min) / spread) * height;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
}

export function TrendChart({ history }: { history: ScoreHistoryPoint[] }) {
  const width = 720;
  const height = 220;
  const need = history.map((item) => item.needScore);
  const coverage = history.map((item) => item.coverageScore);

  return (
    <div className="chart-wrap">
      <div className="chart-legend">
        <span><i className="legend-need" /> Need</span>
        <span><i className="legend-coverage" /> Coverage</span>
        <small>{history.length} scored {history.length === 1 ? 'day' : 'days'}</small>
      </div>
      <svg
        viewBox={`-24 -20 ${width + 48} ${height + 48}`}
        role="img"
        aria-label="Need and media coverage score history"
      >
        {[0, 0.25, 0.5, 0.75, 1].map((tick) => {
          const y = height - tick * height;
          return (
            <g key={tick}>
              <line className="chart-grid" x1="0" x2={width} y1={y} y2={y} />
              <text className="chart-label" x="-8" y={y + 4} textAnchor="end">
                {Math.round(tick * 100)}
              </text>
            </g>
          );
        })}
        <polyline className="line-need" points={points(need, width, height)} />
        <polyline className="line-coverage" points={points(coverage, width, height)} />
        {need.map((value, index) => {
          const x = need.length === 1 ? width / 2 : (index / (need.length - 1)) * width;
          return <circle key={`n-${index}`} className="dot-need" cx={x} cy={height - value * height} r="4" />;
        })}
        {coverage.map((value, index) => {
          const x = coverage.length === 1 ? width / 2 : (index / (coverage.length - 1)) * width;
          return <circle key={`c-${index}`} className="dot-coverage" cx={x} cy={height - value * height} r="4" />;
        })}
      </svg>
    </div>
  );
}
