// P5 Step B7: GTO戦略ミックスの横帯グラフ(承認済みUI仕様「レビュー画面」項目4)。
// アクション別の頻度を1本の横帯に比例配分し、下に凡例(★ベスト・自分の選択を
// 赤枠でマーク)を表示する。EVの数値表示はReviewScreen側の別テーブルが担当する
// (このコンポーネントは頻度の可視化のみに専念)。

import type { ActionBreakdownEntry } from '../../gto/trainer/grading'
import { actionColor } from './actionColors'
import { actionLabelJa } from './labels'

interface Props {
  breakdown: ActionBreakdownEntry[]
  bestLabel: string
  chosenLabel: string
}

export function StrategyMixBar({ breakdown, bestLabel, chosenLabel }: Props) {
  const visible = breakdown.filter((a) => a.freq > 0.001)

  return (
    <div>
      <div
        style={{
          display: 'flex',
          height: 28,
          borderRadius: 6,
          overflow: 'hidden',
          border: '1px solid var(--panel-border)',
        }}
      >
        {visible.map((a) => (
          <div
            key={a.label}
            title={`${actionLabelJa(a.label)} ${(a.freq * 100).toFixed(0)}%`}
            style={{
              width: `${a.freq * 100}%`,
              background: actionColor(a.label),
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              outline: a.label === chosenLabel ? '2px solid var(--red)' : 'none',
              outlineOffset: -2,
              fontSize: 10,
              color: '#fff',
              fontWeight: 600,
              overflow: 'hidden',
              whiteSpace: 'nowrap',
            }}
          >
            {a.freq > 0.12 ? `${(a.freq * 100).toFixed(0)}%` : ''}
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 6, fontSize: 11 }}>
        {breakdown.map((a) => (
          <div key={a.label} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span
              style={{
                width: 10,
                height: 10,
                borderRadius: 2,
                background: actionColor(a.label),
                display: 'inline-block',
                outline: a.label === chosenLabel ? '2px solid var(--red)' : 'none',
              }}
            />
            <span style={{ color: a.label === bestLabel ? 'var(--gold-light)' : 'var(--text)' }}>
              {a.label === bestLabel && '★ '}
              {actionLabelJa(a.label)} {(a.freq * 100).toFixed(0)}%
            </span>
          </div>
        ))}
      </div>
      {/* P7-5: ★は「頻度ベースの正解」ではなく「このソルブでの最高EV」を指すことを明示する
          (採点=頻度基準、★=EV基準、で別の軸であることが伝わらず混乱を招いていたため)。 */}
      <div style={{ fontSize: 10, color: 'var(--text-dim)', marginTop: 4 }}>★ = このソルブでの最高EVのアクション</div>
    </div>
  )
}
