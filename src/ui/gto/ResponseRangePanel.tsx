// P5 Step B8: 折りたたみパネル「相手の応答レンジ分析」。ユーザーの各選択肢に対して
// 相手がどう応答するか(fold/call/raise等のvillain加重内訳)と、継続レンジへの
// 実手札のエクイティを表示する。

import type { ActionResponseSummary } from '../../gto/explain/features'
import { actionColor } from './actionColors'
import { actionLabelJa } from './labels'

interface Props {
  responses: ActionResponseSummary[]
  chosenLabel: string
  bestLabel: string
}

export function ResponseRangePanel({ responses, chosenLabel, bestLabel }: Props) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {responses.map((r) => (
        <div key={r.forLabel} style={{ fontSize: 12.5 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
            <span style={{ fontWeight: 600, color: r.forLabel === bestLabel ? 'var(--gold-light)' : 'var(--text)' }}>
              {r.forLabel === bestLabel && '★ '}
              {actionLabelJa(r.forLabel)}
            </span>
            {r.forLabel === chosenLabel && <span style={{ fontSize: 10, color: 'var(--red)' }}>(あなたの選択)</span>}
          </div>
          {r.terminal ? (
            <div style={{ color: 'var(--text-dim)' }}>この選択で決断は終了します(相手の追加アクションなし)。</div>
          ) : (
            <>
              <div style={{ display: 'flex', height: 16, borderRadius: 4, overflow: 'hidden', border: '1px solid var(--panel-border)' }}>
                {r.breakdown
                  .filter((b) => b.freq > 0.001)
                  .map((b) => (
                    <div
                      key={b.label}
                      title={`${actionLabelJa(b.label)} ${(b.freq * 100).toFixed(0)}%`}
                      style={{ width: `${b.freq * 100}%`, background: actionColor(b.label) }}
                    />
                  ))}
              </div>
              <div style={{ marginTop: 3, color: 'var(--text-muted)' }}>
                フォールド率 {(r.foldFreq * 100).toFixed(0)}%
                {r.heroEquityVsContinueRange !== null && ` ・ 継続レンジへのエクイティ ${(r.heroEquityVsContinueRange * 100).toFixed(0)}%`}
              </div>
            </>
          )}
        </div>
      ))}
    </div>
  )
}
