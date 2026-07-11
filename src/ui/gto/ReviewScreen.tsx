// P5 Step B9: レビュー画面。承認済みUI仕様「結論→理由→証拠→深掘り」の順で
// 8要素を組み立てる(①履歴ストリップ=ナビゲータ ②ステッパー+判定バッジ
// ③ボード+ハンド1行 ④戦略ミックス+EV表 ⑤「なぜ」解説カード ⑥レンジ
// グリッド ⑦折りたたみ3パネル ⑧保存(disabled)+次のハンド)。
// storeを読む薄いコンテナで、実際の描画は各presentationalコンポーネントに委ねる。
// P5は常にreview.decisions.length===1だが、①②のナビゲータ/ステッパーは
// 複数決断を前提に実装してあり、P6の通しモードでそのまま機能する。

import { useState, useEffect } from 'react'
import { useGtoStore } from '../../gto/store'
import { buildExplanation } from '../../gto/explain/templates'
import { buildSpotMarkdown } from '../../gto/explain/exportSpot'
import { handStrFromCombo } from '../../gto/trainer/reviewBuilder'
import { StrategyMixBar } from './StrategyMixBar'
import { RangeHeatGrid } from './RangeHeatGrid'
import { ResponseRangePanel } from './ResponseRangePanel'
import { EquityDistChart } from './EquityDistChart'
import { BlockerPanel } from './BlockerPanel'
import { CollapsibleSection } from './CollapsibleSection'
import { actionLabelJa, rankLabel, suitSymbol, VERDICT_LABEL, VERDICT_COLOR, STREET_LABEL_JA } from './labels'

function verdictMark(verdict: 'correct' | 'marginal' | 'incorrect'): string {
  return verdict === 'correct' ? '○' : verdict === 'marginal' ? '△' : '✕'
}

export function ReviewScreen() {
  const { review, reviewSource, reviewFeatures, reviewFeaturesStatus, activeDecisionIdx, setActiveDecisionIdx, saveCurrentReview, nextSpot, closeBookmark } =
    useGtoStore()
  const [copied, setCopied] = useState(false)
  const [saveState, setSaveState] = useState<'idle' | 'saved' | 'error'>('idle')

  // 別のreviewへ切り替わったら(次のハンド/別ブックマークを開く等)、前回の保存フィードバックを引きずらない。
  useEffect(() => {
    setSaveState('idle')
  }, [review])

  function handleSave() {
    const result = saveCurrentReview()
    if (!result) return
    setSaveState(result.ok ? 'saved' : 'error')
  }

  if (!review) return null // graded状態では常にreviewが設定されている(store側の不変条件)

  const decision = review.decisions[activeDecisionIdx]
  const features = reviewFeatures[activeDecisionIdx] ?? null
  const explanation = features ? buildExplanation(decision, features) : null
  const { grading } = decision
  const hasMultipleDecisions = review.decisions.length > 1

  async function copyMarkdown() {
    const md = buildSpotMarkdown(review!, activeDecisionIdx, features, explanation)
    try {
      await navigator.clipboard.writeText(md)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      const blob = new Blob([md], { type: 'text/markdown' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'gto_spot.md'
      a.click()
      URL.revokeObjectURL(url)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* 1. 履歴ストリップ=ナビゲータ */}
      <div style={{ display: 'flex', gap: 4, overflowX: 'auto', paddingBottom: 2 }}>
        {review.decisions.map((d, i) => (
          <button
            key={i}
            onClick={() => setActiveDecisionIdx(i)}
            disabled={!hasMultipleDecisions}
            style={{
              flexShrink: 0,
              padding: '6px 12px',
              borderRadius: 6,
              fontSize: 12,
              fontWeight: 600,
              border: i === activeDecisionIdx ? '2px solid var(--gold)' : '1px solid var(--panel-border)',
              background: 'var(--panel-bg-light)',
              color: VERDICT_COLOR[d.grading.verdict],
              cursor: hasMultipleDecisions ? 'pointer' : 'default',
            }}
          >
            {hasMultipleDecisions && `${STREET_LABEL_JA[d.street]} `}
            {verdictMark(d.grading.verdict)} {actionLabelJa(d.chosenLabel)}
            {d.grading.evLossBb > 0.01 && ` -${d.grading.evLossBb.toFixed(2)}bb`}
          </button>
        ))}
      </div>

      {/* 2. 決断ステッパー+判定バッジ */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <button
          onClick={() => setActiveDecisionIdx(Math.max(0, activeDecisionIdx - 1))}
          disabled={activeDecisionIdx === 0}
          style={{ padding: '4px 10px', opacity: activeDecisionIdx === 0 ? 0.3 : 1 }}
        >
          ◀ 前
        </button>
        <div style={{ fontWeight: 700, color: VERDICT_COLOR[grading.verdict], textAlign: 'center' }}>
          {VERDICT_LABEL[grading.verdict]}
          {grading.evLossBb > 0.01 && <span style={{ fontWeight: 400, fontSize: 13, marginLeft: 8 }}>EVロス -{grading.evLossBb.toFixed(2)}bb</span>}
        </div>
        <button
          onClick={() => setActiveDecisionIdx(Math.min(review.decisions.length - 1, activeDecisionIdx + 1))}
          disabled={activeDecisionIdx >= review.decisions.length - 1}
          style={{ padding: '4px 10px', opacity: activeDecisionIdx >= review.decisions.length - 1 ? 0.3 : 1 }}
        >
          次 ▶
        </button>
      </div>

      {/* 3. ボード+自分のハンド コンパクト1行 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, padding: '8px 10px', background: 'var(--panel-bg)', borderRadius: 8, flexWrap: 'wrap' }}>
        <span style={{ color: 'var(--text-dim)' }}>ボード</span>
        {review.board.map((c, i) => (
          <span key={i} style={{ color: c.suit === 'h' || c.suit === 'd' ? 'var(--card-red)' : 'var(--text)', fontWeight: 600 }}>
            {rankLabel(c.rank)}
            {suitSymbol(c.suit)}
          </span>
        ))}
        <span style={{ color: 'var(--text-dim)', marginLeft: 8 }}>あなたの手</span>
        {review.userCombo.map((c, i) => (
          <span key={i} style={{ color: c.suit === 'h' || c.suit === 'd' ? 'var(--card-red)' : 'var(--text)', fontWeight: 600 }}>
            {rankLabel(c.rank)}
            {suitSymbol(c.suit)}
          </span>
        ))}
      </div>

      {/* この決断時点のボードが最終ボードと異なる場合のみ表示(通しモード・flop/turn決断)。 */}
      {decision.boardAtDecision.length !== review.board.length && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, padding: '4px 10px', color: 'var(--text-dim)', flexWrap: 'wrap' }}>
          <span>{STREET_LABEL_JA[decision.street]}決断時点のボード</span>
          {decision.boardAtDecision.map((c, i) => (
            <span key={i} style={{ color: c.suit === 'h' || c.suit === 'd' ? 'var(--card-red)' : 'var(--text)', fontWeight: 600 }}>
              {rankLabel(c.rank)}
              {suitSymbol(c.suit)}
            </span>
          ))}
        </div>
      )}

      {/* 4. GTO戦略ミックス帯グラフ+アクション別EV表 */}
      <div>
        <StrategyMixBar breakdown={grading.actionBreakdown} bestLabel={grading.bestLabel} chosenLabel={decision.chosenLabel} />
        <table style={{ width: '100%', fontSize: 12.5, marginTop: 10, borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ color: 'var(--text-dim)' }}>
              <td>アクション</td>
              <td style={{ textAlign: 'right' }}>頻度</td>
              <td style={{ textAlign: 'right' }}>EV</td>
            </tr>
          </thead>
          <tbody>
            {grading.actionBreakdown.map((a) => (
              <tr
                key={a.label}
                style={{ color: a.label === decision.chosenLabel ? 'var(--red)' : a.label === grading.bestLabel ? 'var(--gold-light)' : 'var(--text)' }}
              >
                <td>
                  {a.label === grading.bestLabel && '★ '}
                  {actionLabelJa(a.label)}
                </td>
                <td style={{ textAlign: 'right' }}>{(a.freq * 100).toFixed(1)}%</td>
                <td style={{ textAlign: 'right' }}>{a.evBb.toFixed(2)}bb</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* 5. 「なぜ」解説カード(金枠=画面の主役) */}
      <div style={{ border: '2px solid var(--gold)', boxShadow: 'var(--glow-gold)', borderRadius: 10, padding: 14, position: 'relative' }}>
        <button
          onClick={() => void copyMarkdown()}
          style={{
            position: 'absolute',
            top: 10,
            right: 10,
            fontSize: 11,
            padding: '4px 10px',
            background: 'var(--panel-bg-light)',
            border: '1px solid var(--panel-border)',
            borderRadius: 6,
            color: 'var(--text-muted)',
          }}
        >
          {copied ? 'コピー済み' : 'AIに質問用コピー'}
        </button>
        {reviewFeaturesStatus === 'computing' && <div style={{ color: 'var(--text-dim)', padding: '20px 0' }}>解説を計算中...</div>}
        {reviewFeaturesStatus === 'error' && (
          <div style={{ color: 'var(--red)', padding: '20px 0' }}>解説の計算に失敗しました。上のGTO戦略表を参考にしてください。</div>
        )}
        {reviewFeaturesStatus === 'ready' && explanation && (
          <>
            <div style={{ fontWeight: 700, marginBottom: 8, paddingRight: 100, color: 'var(--gold-light)' }}>{explanation.headline}</div>
            {explanation.paragraphs.map((p, i) => (
              <p key={i} style={{ fontSize: 13, lineHeight: 1.6, marginBottom: 8, color: 'var(--text)' }}>
                {p}
              </p>
            ))}
            <div style={{ fontSize: 12.5, color: 'var(--text-muted)', borderTop: '1px solid var(--panel-border)', paddingTop: 8, marginTop: 4 }}>
              {explanation.sameClassLine}
            </div>
          </>
        )}
      </div>

      {/* 6. レンジ戦略グリッド */}
      {features && (
        <RangeHeatGrid
          combos={decision.heroCombos}
          weights={decision.heroWeights}
          node={decision.decodedNode}
          highlightHand={handStrFromCombo(review.userCombo)}
          title="自分のレンジ戦略"
        />
      )}

      {/* 7. 折りたたみ3パネル */}
      {features && (
        <>
          <CollapsibleSection title="相手の応答レンジ分析">
            <ResponseRangePanel responses={features.responses} chosenLabel={decision.chosenLabel} bestLabel={grading.bestLabel} />
          </CollapsibleSection>
          <CollapsibleSection title="エクイティ分布">
            <EquityDistChart buckets={features.equityBuckets} rangeAdvantage={features.rangeAdvantage} nutsAdvantage={features.nutsAdvantage} />
          </CollapsibleSection>
          <CollapsibleSection title="ブロッカー分析">
            <BlockerPanel blockers={features.blockers} userCombo={review.userCombo} />
          </CollapsibleSection>
        </>
      )}

      {/* 8. 保存+次のハンド(reviewSource==='bookmark'時は「一覧へ戻る」に差し替え) */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {saveState === 'error' && (
          <div style={{ fontSize: 12, color: 'var(--red)', textAlign: 'center' }}>保存容量が一杯です。古いブックマークを削除してください。</div>
        )}
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={handleSave}
            disabled={saveState === 'saved' || reviewSource === 'bookmark'}
            style={{
              flex: 1,
              padding: 10,
              borderRadius: 8,
              border: '1px solid var(--panel-border)',
              background: saveState === 'saved' ? 'var(--panel-bg)' : 'var(--panel-bg-light)',
              color: saveState === 'saved' ? 'var(--green-light)' : 'var(--text)',
              opacity: reviewSource === 'bookmark' ? 0.5 : 1,
              cursor: saveState === 'saved' || reviewSource === 'bookmark' ? 'default' : 'pointer',
            }}
          >
            {reviewSource === 'bookmark' ? '保存済み' : saveState === 'saved' ? '保存済み' : 'ハンドを保存'}
          </button>
          {reviewSource === 'bookmark' ? (
            <button
              onClick={() => closeBookmark()}
              style={{ flex: 2, padding: 10, fontWeight: 600, background: 'var(--green-mid)', border: '1px solid var(--green-light)', borderRadius: 8, color: 'var(--gold-light)' }}
            >
              一覧へ戻る
            </button>
          ) : (
            <button
              onClick={() => void nextSpot()}
              style={{ flex: 2, padding: 10, fontWeight: 600, background: 'var(--green-mid)', border: '1px solid var(--green-light)', borderRadius: 8, color: 'var(--gold-light)' }}
            >
              次のハンド
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
