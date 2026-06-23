import { useState } from 'react'
import { useAppStore } from '../store/state'
import type { HandRecord } from '../store/state'
import { CardView } from './CardView'
import { betSizeVerdict } from '../advisor/explain'
import { ACTION_JA, STREET_JA } from './glossary'
import { CheckIcon, CrossIcon, CoinIcon, TargetIcon, ExpandIcon, WarningIcon } from './icons'

function pctOrDash(v: number | null | undefined): string {
  return v == null ? '—' : `${Math.round(v * 100)}%`
}

export function HistoryView() {
  const { handHistory, exportHistory, importHistory } = useAppStore()
  const [onlyMismatches, setOnlyMismatches] = useState(false)
  const [expanded, setExpanded] = useState<string | null>(null)

  const filtered = onlyMismatches ? handHistory.filter(r => !r.matched) : handHistory

  // ハンド番号ごとにグループ化 (新しい順)
  const groups = new Map<number, HandRecord[]>()
  for (const r of filtered) {
    const list = groups.get(r.handNumber) ?? []
    list.push(r)
    groups.set(r.handNumber, list)
  }
  const handNumbers = [...groups.keys()].sort((a, b) => b - a)

  const [copied, setCopied] = useState<string | null>(null)

  function handleImport() {
    const json = prompt('JSONデータを貼り付けてください:')
    if (json) importHistory(json)
  }

  function downloadJson(json: string, filename: string) {
    const blob = new Blob([json], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
    URL.revokeObjectURL(url)
  }

  async function copyJson(json: string, key: string) {
    try {
      await navigator.clipboard.writeText(json)
      setCopied(key)
      setTimeout(() => setCopied(c => (c === key ? null : c)), 1500)
    } catch {
      // クリップボード不可の環境ではダウンロードにフォールバック
      downloadJson(json, 'poker_history.json')
    }
  }

  function handleExport() {
    downloadJson(exportHistory(), 'poker_history.json')
  }

  return (
    <div style={{ padding: 16, maxWidth: 860, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <h2 style={{ color: 'var(--gold)', fontSize: 18 }}>ハンド履歴</h2>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--text-muted)', cursor: 'pointer' }}>
          <input type="checkbox" checked={onlyMismatches} onChange={e => setOnlyMismatches(e.target.checked)} />
          不一致のみ
        </label>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          <button onClick={handleExport} style={{ background: 'var(--green-mid)', color: 'var(--text)', padding: '4px 12px', fontSize: 12, borderRadius: 4 }}>
            全体DL
          </button>
          <button onClick={() => copyJson(exportHistory(), 'all')} style={{ background: 'var(--panel-bg)', color: 'var(--text)', padding: '4px 12px', fontSize: 12, borderRadius: 4, border: '1px solid var(--panel-border)' }}>
            {copied === 'all' ? 'コピー済' : '全体コピー'}
          </button>
          <button onClick={handleImport} style={{ background: 'var(--panel-bg)', color: 'var(--text)', padding: '4px 12px', fontSize: 12, borderRadius: 4, border: '1px solid var(--panel-border)' }}>
            インポート
          </button>
        </div>
      </div>

      {handNumbers.length === 0 ? (
        <p style={{ color: 'var(--text-dim)', fontSize: 14 }}>履歴がありません</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {handNumbers.map(num => {
            const records = groups.get(num)!
            const userNet = records.find(r => r.userNet !== undefined)?.userNet
            return (
              <div key={num}>
                {/* Hand header */}
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 12, marginBottom: 6,
                  fontSize: 13.5, color: 'var(--text-muted)',
                }}>
                  <span style={{ color: 'var(--gold)', fontWeight: 700, fontSize: 14.5 }}>Hand #{num}</span>
                  {records[0]?.userHoleCards?.length === 2 && (
                    <span style={{ display: 'flex', gap: 3, alignItems: 'center' }}>
                      手札:
                      {records[0].userHoleCards.map((c, i) => <CardView key={i} card={c} size="sm" />)}
                    </span>
                  )}
                  {userNet !== undefined && (
                    <span style={{
                      fontWeight: 700, marginLeft: userNet !== undefined ? 'auto' : 0,
                      color: userNet >= 0 ? 'var(--green-light)' : 'var(--red)',
                    }}>
                      収支: {userNet >= 0 ? '+' : ''}₱{userNet} ({(userNet / 50).toFixed(1)} BB)
                    </span>
                  )}
                  {/* このハンドだけをエクスポート */}
                  <span style={{ marginLeft: userNet === undefined ? 'auto' : 0, display: 'flex', gap: 6 }}>
                    <button
                      onClick={() => copyJson(exportHistory([num]), `hand-${num}`)}
                      title="このハンドだけをコピー"
                      style={{ background: 'var(--panel-bg)', color: 'var(--text-muted)', padding: '2px 8px', fontSize: 11, borderRadius: 4, border: '1px solid var(--panel-border)' }}
                    >
                      {copied === `hand-${num}` ? 'コピー済' : 'コピー'}
                    </button>
                    <button
                      onClick={() => downloadJson(exportHistory([num]), `poker_hand_${num}.json`)}
                      title="このハンドだけをダウンロード"
                      style={{ background: 'var(--panel-bg)', color: 'var(--text-muted)', padding: '2px 8px', fontSize: 11, borderRadius: 4, border: '1px solid var(--panel-border)' }}
                    >
                      DL
                    </button>
                  </span>
                </div>
                {/* Decision rows */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {records.map((record, i) => {
                    const key = `${num}-${i}`
                    return (
                      <DecisionRow
                        key={key}
                        record={record}
                        expanded={expanded === key}
                        onToggle={() => setExpanded(expanded === key ? null : key)}
                      />
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function DecisionRow({ record, expanded, onToggle }: { record: HandRecord; expanded: boolean; onToggle: () => void }) {
  const r = record
  const rec = r.recommendation
  return (
    <div style={{
      background: 'var(--panel-bg)', borderRadius: 8,
      border: `1px solid ${r.matched ? 'var(--panel-border)' : 'rgba(217,64,64,0.45)'}`,
      overflow: 'hidden',
    }}>
      {/* Summary row */}
      <div
        onClick={onToggle}
        style={{
          padding: '10px 14px', cursor: 'pointer',
          display: 'flex', alignItems: 'center', gap: 12, fontSize: 13.5,
        }}
      >
        <span style={{ color: 'var(--gold-light)', fontWeight: 700, minWidth: 76 }}>
          {STREET_JA[r.street] ?? r.street}
        </span>
        <span style={{ color: r.matched ? 'var(--green-light)' : 'var(--red)', fontWeight: 700, minWidth: 58, display: 'flex', alignItems: 'center', gap: 4 }}>
          {r.matched ? <CheckIcon size={14} /> : <CrossIcon size={14} />}{r.matched ? '一致' : '不一致'}
        </span>
        <span style={{ color: 'var(--text)' }}>
          選択: <strong>{ACTION_JA[r.userAction?.type ?? ''] ?? r.userAction?.type}</strong>
          {r.userAction && r.userAction.amount > 0 && ` ₱${r.userAction.amount}`}
        </span>
        {rec && (
          <span style={{ color: r.matched ? 'var(--text-dim)' : 'var(--gold)' }}>
            推奨: {ACTION_JA[rec.action] ?? rec.action}
          </span>
        )}
        {r.mistake && (
          <span style={{
            color: 'var(--red)', fontSize: 11, padding: '1px 6px',
            background: 'rgba(217,64,64,0.12)', borderRadius: 3,
            border: '1px solid rgba(217,64,64,0.3)', whiteSpace: 'nowrap',
          }}>
            {r.mistake.label}
          </span>
        )}
        <div style={{ display: 'flex', gap: 3, marginLeft: 'auto' }}>
          {r.board.slice(0, 5).map((c, i) => <CardView key={i} card={c} size="sm" />)}
        </div>
        <ExpandIcon size={14} style={{ color: 'var(--text-dim)' }} />
      </div>

      {/* Expanded: 状況 → 判断 → 正解 */}
      {expanded && (
        <div style={{ padding: '0 14px 14px', borderTop: '1px solid var(--panel-border)', fontSize: 13.5, lineHeight: 1.8 }}>
          {/* 状況 */}
          <div style={{ marginTop: 10, color: 'var(--text-muted)' }}>
            <strong style={{ color: 'var(--text)' }}>状況:</strong>{' '}
            {STREET_JA[r.street] ?? r.street}、ポット ₱{r.potTotal}
            {r.callAmount > 0 ? `、相手のベットに ₱${r.callAmount} のコールが必要な場面` : '、誰もベットしていない場面'}
          </div>

          {/* 数値 */}
          {rec && (
            <div style={{
              display: 'flex', gap: 16, flexWrap: 'wrap', margin: '8px 0',
              background: 'rgba(0,0,0,0.25)', borderRadius: 8, padding: '8px 12px', fontSize: 13,
            }}>
              <span style={{ color: 'var(--text-muted)' }}>あなたの読み: <strong style={{ color: 'var(--gold-light)' }}>{pctOrDash(rec.equity.estimate)}</strong></span>
              <span style={{ color: 'var(--text-muted)' }}>実際の勝率: <strong style={{ color: 'var(--gold-light)' }}>{pctOrDash(rec.equity.exact)}</strong></span>
              <span style={{ color: 'var(--text-muted)' }}>必要勝率: <strong style={{ color: 'var(--gold-light)' }}>{Math.round(rec.equity.required * 100)}%</strong></span>
            </div>
          )}

          {/* 正解とその理由 */}
          {rec && (
            <div style={{ color: 'var(--text)' }}>
              <strong style={{ color: r.matched ? 'var(--green-light)' : 'var(--gold)' }}>
                {r.matched ? '正解どおり: ' : 'どうすべきだったか: '}
              </strong>
              {ACTION_JA[rec.action] ?? rec.action}
              {rec.betSizeFraction && ` (ポットの約${Math.round(rec.betSizeFraction * 100)}%)`}
              {' — '}{rec.explanation}
            </div>
          )}
          {rec?.sizeRationale && (
            <div style={{ color: 'var(--text-muted)', fontSize: 12.5, marginTop: 4, display: 'flex', alignItems: 'flex-start', gap: 5 }}>
              <CoinIcon size={14} style={{ marginTop: 2 }} />{rec.sizeRationale}
            </div>
          )}
          {(() => {
            if (!r.userAction || (r.userAction.type !== 'bet' && r.userAction.type !== 'raise')) return null
            const sv = betSizeVerdict({
              type: r.userAction.type, amount: r.userAction.amount,
              pot: r.potTotal, betLevel: r.betLevel, recFraction: rec?.betSizeFraction,
            })
            if (!sv) return null
            return (
              <div style={{
                marginTop: 4, fontSize: 12.5, display: 'flex', alignItems: 'center', gap: 5,
                color: sv.tone === 'good' ? 'var(--green-light)' : sv.tone === 'bad' ? 'var(--red)' : 'var(--text-muted)',
              }}>
                <CoinIcon size={14} /> サイズ判定: {sv.text}
              </div>
            )
          })()}
          {rec?.gapWarning && (
            <div style={{ color: 'var(--gold-light)', fontSize: 12.5, marginTop: 6, lineHeight: 1.7 }}>
              {rec.gapWarning}
            </div>
          )}
          {r.mistake && (
            <div style={{
              marginTop: 8, display: 'flex', gap: 7, alignItems: 'flex-start',
              background: 'rgba(217,64,64,0.10)', borderRadius: 8, padding: '8px 12px',
              border: '1px solid rgba(217,64,64,0.3)',
            }}>
              <WarningIcon size={14} style={{ color: 'var(--red)', flexShrink: 0, marginTop: 2 }} />
              <div>
                <div style={{ color: 'var(--red)', fontWeight: 700, fontSize: 12.5, marginBottom: 3 }}>
                  ミス: {r.mistake.label}
                </div>
                <div style={{ color: 'var(--text-muted)', fontSize: 12, lineHeight: 1.7 }}>
                  {r.mistake.explanation}
                </div>
              </div>
            </div>
          )}

          {/* 見積もり結果 */}
          {r.estimateResult && (
            <div style={{
              marginTop: 6, display: 'flex', alignItems: 'center', gap: 5,
              color: r.estimateResult.correct ? 'var(--green-light)' : 'var(--red)',
              fontSize: 13,
            }}>
              <TargetIcon size={14} /> 見積もり: {r.estimateResult.band} と回答 → 真値 {Math.round(r.estimateResult.trueEquity * 100)}%
              ({r.estimateResult.correct ? '正解' : r.estimateResult.adjacent ? '惜しい' : '不正解'})
            </div>
          )}
        </div>
      )}
    </div>
  )
}
