import { useState } from 'react'
import type { Position } from '../../engine/types'
import type { Scenario } from '../../gto/types'
import type { Seat } from '../../gto/trainer/gameFlow'
import { SCENARIOS, isOopPosition } from '../../gto/data/scenarios'

// P12 Phase C-1: マッチアップ選択をリング図からの直感的な操作へ置き換える
// (旧UIの素の<select>+「あなたのポジション」ラジオを廃止)。
// 手順: 自分の席を選ぶ → 相手の席を選ぶ → (該当シナリオが複数あれば)SRP/3betを選ぶ。
// scenario+userSeatが両方決まった時点でonCompleteを呼ぶ(以降はAnalyzerScreen側の
// 次ステップ(フロップ入力)へ進む)。

const SEATS: Position[] = ['UTG', 'HJ', 'CO', 'BTN', 'SB', 'BB']

const DEFENDER_ROLE_LABEL: Record<Scenario['defender']['role'], string> = {
  caller: 'SRP(コール)',
  coldcaller: 'SRP(コールドコール)',
  threebettor: '3ベットポット',
  // defenderは実際にはcaller/coldcaller/threebettorのみを取るが、型はPlayerRole全体
  // (raiserを含む)なので網羅性のため埋める(このラベルが実際に参照されることはない)。
  raiser: 'SRP',
}

function seatOf(scenario: Scenario, position: Position): Seat {
  const oopIsRaiser = isOopPosition(scenario.raiser.position, scenario.defender.position)
  const oopPosition = oopIsRaiser ? scenario.raiser.position : scenario.defender.position
  return position === oopPosition ? 0 : 1
}

/** posが関与するシナリオから、相手ポジションごとの候補シナリオ一覧を作る。 */
function matchupsFrom(pos: Position): Map<Position, Scenario[]> {
  const map = new Map<Position, Scenario[]>()
  for (const s of SCENARIOS) {
    const other = s.raiser.position === pos ? s.defender.position : s.defender.position === pos ? s.raiser.position : null
    if (other === null) continue
    const list = map.get(other) ?? []
    list.push(s)
    map.set(other, list)
  }
  return map
}

interface RingProps {
  highlight: (pos: Position) => 'selected' | 'selectable' | 'disabled'
  onSelect: (pos: Position) => void
  label: string
}

function Ring({ highlight, onSelect, label }: RingProps) {
  const W = 320
  const H = 200
  const cx = W / 2
  const cy = H / 2
  const rx = 128
  const ry = 78

  const seatCoords = SEATS.map((pos, i) => {
    const angle = -Math.PI / 2 + (2 * Math.PI * i) / SEATS.length
    return { pos, x: cx + rx * Math.cos(angle), y: cy + ry * Math.sin(angle) }
  })

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
      <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>{label}</div>
      <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} style={{ display: 'block', maxWidth: '100%' }}>
        <ellipse cx={cx} cy={cy} rx={rx - 14} ry={ry - 10} fill="#1a3020" stroke="var(--green-mid)" strokeWidth={2} />
        {seatCoords.map(({ pos, x, y }) => {
          const state = highlight(pos)
          const fill = state === 'selected' ? 'var(--gold)' : state === 'selectable' ? 'var(--green-mid)' : 'rgba(60,70,60,0.5)'
          const stroke = state === 'selected' ? 'var(--gold-light)' : state === 'selectable' ? 'var(--green-light)' : 'var(--panel-border)'
          const textColor = state === 'selected' ? '#1a2a1a' : state === 'selectable' ? 'var(--gold-light)' : 'var(--text-dim)'
          const clickable = state !== 'disabled'
          return (
            <g
              key={pos}
              role="button"
              aria-label={pos}
              aria-disabled={!clickable}
              onClick={() => clickable && onSelect(pos)}
              style={{ cursor: clickable ? 'pointer' : 'not-allowed' }}
            >
              <circle cx={x} cy={y} r={22} fill={fill} stroke={stroke} strokeWidth={state === 'selected' ? 3 : 1.5} opacity={state === 'disabled' ? 0.5 : 1} />
              <text x={x} y={y} textAnchor="middle" dominantBaseline="middle" fontSize={13} fontWeight={700} fill={textColor} style={{ pointerEvents: 'none' }}>
                {pos}
              </text>
            </g>
          )
        })}
      </svg>
    </div>
  )
}

interface Props {
  onComplete: (scenario: Scenario, userSeat: Seat) => void
}

type Step = { kind: 'own' } | { kind: 'opponent'; own: Position } | { kind: 'pot'; own: Position; opponent: Position; candidates: Scenario[] }

export function PositionRingPicker({ onComplete }: Props) {
  const [step, setStep] = useState<Step>({ kind: 'own' })

  if (step.kind === 'own') {
    return (
      <Ring
        label="1. あなたの席を選んでください"
        highlight={() => 'selectable'}
        onSelect={(pos) => setStep({ kind: 'opponent', own: pos })}
      />
    )
  }

  if (step.kind === 'opponent') {
    const matchups = matchupsFrom(step.own)
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, alignItems: 'center' }}>
        <Ring
          label={`2. あなた(${step.own})の相手の席を選んでください`}
          highlight={(pos) => (pos === step.own ? 'selected' : matchups.has(pos) ? 'selectable' : 'disabled')}
          onSelect={(pos) => {
            const candidates = matchups.get(pos)
            if (!candidates || candidates.length === 0) return
            if (candidates.length === 1) {
              onComplete(candidates[0], seatOf(candidates[0], step.own))
              return
            }
            setStep({ kind: 'pot', own: step.own, opponent: pos, candidates })
          }}
        />
        <button type="button" onClick={() => setStep({ kind: 'own' })} style={{ fontSize: 12.5, color: 'var(--text-dim)', background: 'transparent' }}>
          ← 自分の席を選び直す
        </button>
      </div>
    )
  }

  // step.kind === 'pot'
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, alignItems: 'center' }}>
      <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>
        3. {step.own} vs {step.opponent}: 状況を選んでください
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
        {step.candidates.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => onComplete(s, seatOf(s, step.own))}
            style={{
              padding: '10px 16px',
              borderRadius: 8,
              border: '1px solid var(--panel-border)',
              background: 'var(--panel-bg-light)',
              color: 'var(--text)',
              fontSize: 13.5,
              fontWeight: 600,
            }}
          >
            {DEFENDER_ROLE_LABEL[s.defender.role]}
          </button>
        ))}
      </div>
      <button type="button" onClick={() => setStep({ kind: 'opponent', own: step.own })} style={{ fontSize: 12.5, color: 'var(--text-dim)', background: 'transparent' }}>
        ← 相手の席を選び直す
      </button>
    </div>
  )
}
