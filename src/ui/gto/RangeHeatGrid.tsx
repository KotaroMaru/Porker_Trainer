// P5 Step B7: 頻度付き13×13レンジ戦略グリッド(承認済みUI仕様「レビュー画面」項目6)。
// ポーカー標準配色(ベット=赤系濃淡・チェック/コール=緑・フォールド=青)で、
// 混合戦略のセルは内部を割合で塗り分ける(position:absoluteの縦帯を左から積む)。
// RangeSetGrid.tsx(既存、単純な二値レンジ表示専用)のRANKS/cellHand規約を踏襲した
// 新規実装(既存コンポーネントは比例塗り分けに対応していないため拡張ではなく新設)。

import type { Combo } from '../../analysis/range'
import type { DecodedNode } from '../../gto/loader/binaryFormat'
import { handStrFromCombo } from '../../gto/trainer/reviewBuilder'
import { actionColor } from './actionColors'
import { actionLabelJa } from './labels'

const RANKS = ['A', 'K', 'Q', 'J', 'T', '9', '8', '7', '6', '5', '4', '3', '2']

interface Props {
  combos: readonly Combo[]
  weights: readonly number[]
  node: DecodedNode
  highlightHand?: string
  cellSize?: number
  title?: string
}

interface CellMix {
  label: string
  freq: number
}

/** weight>0のコンボをhandStrFromComboで集計し、ハンド文字列ごとの加重アクション頻度を求める。 */
function computeCellMixes(combos: readonly Combo[], weights: readonly number[], node: DecodedNode): Map<string, CellMix[]> {
  const handCount = combos.length
  const byHand = new Map<string, { actionSum: number[]; totalWeight: number }>()
  for (let h = 0; h < handCount; h++) {
    if (weights[h] <= 0) continue
    const handStr = handStrFromCombo(combos[h])
    let entry = byHand.get(handStr)
    if (!entry) {
      entry = { actionSum: new Array(node.actionLabels.length).fill(0), totalWeight: 0 }
      byHand.set(handStr, entry)
    }
    entry.totalWeight += weights[h]
    for (let a = 0; a < node.actionLabels.length; a++) {
      entry.actionSum[a] += weights[h] * node.freqs[a * handCount + h]
    }
  }
  const result = new Map<string, CellMix[]>()
  for (const [hand, entry] of byHand) {
    result.set(
      hand,
      node.actionLabels.map((label, a) => ({ label, freq: entry.totalWeight > 0 ? entry.actionSum[a] / entry.totalWeight : 0 })),
    )
  }
  return result
}

function cellHandStr(i: number, j: number): string {
  if (i === j) return RANKS[i] + RANKS[j]
  if (i < j) return RANKS[i] + RANKS[j] + 's'
  return RANKS[j] + RANKS[i] + 'o'
}

export function RangeHeatGrid({ combos, weights, node, highlightHand, cellSize = 24, title }: Props) {
  const cellMixes = computeCellMixes(combos, weights, node)

  return (
    <div style={{ overflowX: 'auto' }}>
      {title && <div style={{ fontSize: 12, color: 'var(--text-dim)', marginBottom: 4 }}>{title}</div>}
      <div style={{ display: 'inline-block' }}>
        <div style={{ display: 'flex', gap: 1, marginBottom: 1 }}>
          <div style={{ width: 14 }} />
          {RANKS.map((r) => (
            <div key={r} style={{ width: cellSize, fontSize: 9, color: 'var(--text-dim)', textAlign: 'center' }}>
              {r}
            </div>
          ))}
        </div>
        {RANKS.map((_, i) => (
          <div key={i} style={{ display: 'flex', gap: 1, marginBottom: 1 }}>
            <div style={{ width: 14, fontSize: 9, color: 'var(--text-dim)', lineHeight: `${cellSize}px` }}>{RANKS[i]}</div>
            {RANKS.map((_, j) => {
              const hand = cellHandStr(i, j)
              const mix = cellMixes.get(hand)
              const isHighlight = highlightHand === hand
              const visibleMix = mix?.filter((m) => m.freq > 0.001) ?? []
              let cumulative = 0
              const tooltip = visibleMix.length > 0 ? `${hand}: ${visibleMix.map((m) => `${actionLabelJa(m.label)} ${(m.freq * 100).toFixed(0)}%`).join(' / ')}` : `${hand}: レンジ外`

              return (
                <div
                  key={j}
                  data-hand={hand}
                  title={tooltip}
                  style={{
                    position: 'relative',
                    width: cellSize,
                    height: cellSize,
                    borderRadius: 2,
                    overflow: 'hidden',
                    background: 'var(--panel-bg)',
                    outline: isHighlight ? '2px solid var(--gold)' : '1px solid var(--panel-border)',
                    outlineOffset: -1,
                    boxShadow: isHighlight ? 'var(--glow-gold)' : 'none',
                  }}
                >
                  {visibleMix.map((m) => {
                    const left = cumulative
                    cumulative += m.freq * 100
                    return (
                      <div
                        key={m.label}
                        style={{
                          position: 'absolute',
                          top: 0,
                          bottom: 0,
                          left: `${left}%`,
                          width: `${m.freq * 100}%`,
                          background: actionColor(m.label),
                        }}
                      />
                    )
                  })}
                </div>
              )
            })}
          </div>
        ))}
      </div>
    </div>
  )
}
