import { MIN_DIVERGENCE_SAMPLE, type DivergencePoint } from '../../gto/stats/divergence'

interface DivergencePlotProps {
  point: DivergencePoint
  ready: boolean
  trajectory?: readonly DivergencePoint[]
  compact?: boolean
}

const SIZE = 240
const PAD = 28
const CENTER = SIZE / 2
const RANGE = 0.5

function coord(value: number): number {
  const clamped = Math.max(-RANGE, Math.min(RANGE, value))
  return CENTER + (clamped / RANGE) * (CENTER - PAD)
}

export function DivergencePlot({ point, ready, trajectory = [], compact = false }: DivergencePlotProps) {
  if (!ready) {
    return (
      <div data-testid="divergence-insufficient" style={{ padding: compact ? 8 : 18, textAlign: 'center', color: 'var(--text-dim)', fontSize: 12 }}>
        {point.decisionCount < MIN_DIVERGENCE_SAMPLE
          ? `サンプル不足 (${point.decisionCount}/${MIN_DIVERGENCE_SAMPLE}決断)`
          : `フォールド軸を集計中 (${point.foldEligibleCount}/${MIN_DIVERGENCE_SAMPLE}件)`}
      </div>
    )
  }

  const validTrajectory = trajectory.filter(
    (p) => p.decisionCount >= MIN_DIVERGENCE_SAMPLE && p.foldEligibleCount >= MIN_DIVERGENCE_SAMPLE,
  )
  const polyline = validTrajectory.map((p) => `${coord(p.x)},${coord(-p.y)}`).join(' ')
  const x = coord(point.x)
  const y = coord(-point.y)

  return (
    <svg
      data-testid="divergence-plot"
      viewBox={`0 0 ${SIZE} ${SIZE}`}
      role="img"
      aria-label={`攻めのずれ${(point.x * 100).toFixed(0)}%、降りにくさのずれ${(point.y * 100).toFixed(0)}%`}
      style={{ width: '100%', maxWidth: compact ? 210 : 300, display: 'block', margin: '0 auto' }}
    >
      <rect x={PAD} y={PAD} width={SIZE - PAD * 2} height={SIZE - PAD * 2} fill="var(--panel-bg-light)" rx="4" />
      <line x1={PAD} y1={CENTER} x2={SIZE - PAD} y2={CENTER} stroke="var(--text-dim)" />
      <line x1={CENTER} y1={PAD} x2={CENTER} y2={SIZE - PAD} stroke="var(--text-dim)" />
      <text x={SIZE - PAD} y={CENTER - 5} textAnchor="end" fontSize="9" fill="var(--text-dim)">攻めすぎ</text>
      <text x={PAD} y={CENTER - 5} fontSize="9" fill="var(--text-dim)">攻め不足</text>
      <text x={CENTER + 5} y={PAD + 10} fontSize="9" fill="var(--text-dim)">降りなさすぎ</text>
      <text x={CENTER + 5} y={SIZE - PAD - 5} fontSize="9" fill="var(--text-dim)">降りすぎ</text>
      {polyline && <polyline data-testid="divergence-trajectory" points={polyline} fill="none" stroke="var(--gold)" strokeWidth="2" opacity="0.65" />}
      {validTrajectory.map((p) => (
        <circle key={`${p.decisionCount}-${p.foldEligibleCount}`} cx={coord(p.x)} cy={coord(-p.y)} r="2.5" fill="var(--gold)" opacity="0.65" />
      ))}
      <circle data-testid="divergence-point" cx={x} cy={y} r="6" fill="var(--accent, #4aa3ff)" stroke="white" strokeWidth="1.5" />
    </svg>
  )
}
