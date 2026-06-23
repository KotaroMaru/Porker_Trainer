import type { Position } from '../engine/types'
import { positionsByOffset } from '../engine/positions'
import { playersBehind } from '../engine/positions'

interface Props {
  tableSize: number
  heroPosition?: Position
  raiserPosition?: Position
}

/** テーブルの楕円に沿って席を配置した簡易図。ヒーロー席を金、レイザー席を赤でハイライト。heroPosition省略時はレイザーのみハイライト。 */
export function MiniTableDiagram({ tableSize, heroPosition, raiserPosition }: Props) {
  const seats = positionsByOffset(tableSize)
  const W = 220
  const H = 140
  const cx = W / 2
  const cy = H / 2
  const rx = 85
  const ry = 52

  // 各席を楕円上に等間隔配置(上から時計回り)
  const seatCoords = seats.map((pos, i) => {
    const angle = (-Math.PI / 2) + (2 * Math.PI * i) / tableSize
    return {
      pos,
      x: cx + rx * Math.cos(angle),
      y: cy + ry * Math.sin(angle),
    }
  })

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} style={{ display: 'block' }}>
      {/* テーブル楕円 */}
      <ellipse cx={cx} cy={cy} rx={rx - 10} ry={ry - 8}
        fill="#1a3020" stroke="var(--green-mid)" strokeWidth={2} />

      {seatCoords.map(({ pos, x, y }) => {
        const isHero = pos === heroPosition
        const isRaiser = !isHero && pos === raiserPosition
        const behind = playersBehind(pos, tableSize)
        const fillColor = isHero
          ? 'var(--gold)'
          : isRaiser
            ? '#c0392b'
            : behind >= 3
              ? 'rgba(100,80,40,0.8)'
              : 'rgba(60,90,60,0.8)'
        const strokeColor = isHero ? 'var(--gold-light)' : isRaiser ? '#e05050' : 'var(--panel-border)'
        const textColor = isHero ? '#1a2a1a' : '#ffffff'

        return (
          <g key={pos}>
            <circle cx={x} cy={y} r={isHero ? 18 : isRaiser ? 16 : 15}
              fill={fillColor}
              stroke={strokeColor}
              strokeWidth={isHero || isRaiser ? 2 : 1}
            />
            <text x={x} y={y - 3} textAnchor="middle" dominantBaseline="middle"
              fontSize={isHero ? 9 : 8} fontWeight={isHero || isRaiser ? 700 : 500}
              fill={textColor}
            >
              {pos}
            </text>
            <text x={x} y={y + 7} textAnchor="middle" dominantBaseline="middle"
              fontSize={7} fill={isHero ? '#1a2a1a' : isRaiser ? '#ffcccc' : 'var(--text-dim)'}
            >
              {isHero ? '★YOU' : isRaiser ? 'RAISE' : `後${behind}`}
            </text>
          </g>
        )
      })}

      {/* 中央テキスト */}
      <text x={cx} y={cy - 6} textAnchor="middle" fontSize={10} fill="var(--text-dim)">
        {tableSize}人
      </text>
      <text x={cx} y={cy + 7} textAnchor="middle" fontSize={9} fill="var(--text-dim)">
        テーブル
      </text>
    </svg>
  )
}
