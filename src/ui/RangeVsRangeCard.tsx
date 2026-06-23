import { useMemo, useState } from 'react'
import type { GameState, Street } from '../engine/types'
import { inferPlayerRange, combosToHandSet } from '../advisor/rangeModel'
import { monteCarloRangeEquity } from '../analysis/equity'
import { STREET_JA, POSITION_INFO, ACTION_JA } from './glossary'
import { RangeSetGrid } from './RangeSetGrid'

const BETTING_STREETS = new Set(['PREFLOP_BETTING', 'FLOP_BETTING', 'TURN_BETTING', 'RIVER_BETTING'])
const STREETS_ORDER: Street[] = ['PREFLOP_BETTING', 'FLOP_BETTING', 'TURN_BETTING', 'RIVER_BETTING']

/** このプレイヤーのストリート毎のアクションを「プリフロップ: レイズ ₱150 → フロップ: ベット ₱100」の形にまとめる(レンジが絞られた根拠の表示用)。 */
function buildActionLine(game: GameState, playerId: string): string {
  const actions = game.actionHistory.filter(a => a.playerId === playerId)
  if (actions.length === 0) return '未行動'

  const parts: string[] = []
  for (const street of STREETS_ORDER) {
    const streetActions = actions.filter(a => (a.street ?? 'PREFLOP_BETTING') === street)
    if (streetActions.length === 0) continue
    const streetLabel = STREET_JA[street] ?? street
    const actionLabels = streetActions
      .map(a => {
        const label = ACTION_JA[a.type] ?? a.type
        return a.amount > 0 ? `${label} ₱${a.amount}` : label
      })
      .join('・')
    parts.push(`${streetLabel}: ${actionLabels}`)
  }
  return parts.length > 0 ? parts.join(' → ') : '未行動'
}

/** テーブルモード: 各ストリートで「あなたの手」「あなたのレンジ平均」「相手レンジ」の勝率(レンジ対レンジ)を表示する。 */
export function RangeVsRangeCard({ game }: { game: GameState }) {
  const [showDetail, setShowDetail] = useState(false)

  const hero = game.players.find(p => p.isUser)
  const villains = game.players.filter(p => !p.isUser && !p.folded)
  const showable = !!hero && !hero.folded && hero.holeCards.length === 2 &&
    villains.length > 0 && BETTING_STREETS.has(game.street)

  // ハンド/ストリート/ボード/各プレイヤーのアクション履歴が変わった時のみ再計算する
  const actionSig = game.actionHistory.map(a => `${a.playerId}:${a.type}:${a.street ?? ''}`).join('|')
  const boardSig = game.board.map(c => `${c.rank}${c.suit}`).join(',')

  const result = useMemo(() => {
    if (!showable || !hero) return null
    const board = game.board

    const villainRangesList = villains.map(v => {
      const dead = [...board, ...hero.holeCards]
      return inferPlayerRange(game, v, dead)
    })
    if (villainRangesList.some(r => r.length === 0)) return null

    // ヒーロー自身のレンジ(実手札を含めるため dead には自分の手札を入れない)
    const heroRangeCombos = inferPlayerRange(game, hero, board)

    // A: あなたの実手札 vs 相手の推定レンジ
    const heroVsRange = monteCarloRangeEquity({
      heroFixed: hero.holeCards,
      villainRanges: villainRangesList,
      board,
      iterations: 2500,
    })

    // C: あなたの推定レンジ平均 vs 相手の推定レンジ (レンジアドバンテージ)
    const rangeVsRange = monteCarloRangeEquity({
      heroRange: heroRangeCombos,
      villainRanges: villainRangesList,
      board,
      iterations: 2500,
    })

    return {
      heroEquity: heroVsRange.equity,
      heroRangeEquity: rangeVsRange.equity,
      villainRangeEquity: 1 - rangeVsRange.equity,
      villainRangesList,
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showable, game.handNumber, game.street, boardSig, actionSig])

  if (!showable || !hero || !result) return null

  return (
    <div style={{
      background: 'linear-gradient(160deg, #1f2f22, #142016)', borderRadius: 10, padding: 13,
      border: '1px solid #2f5c3a',
    }}>
      <div style={{ fontSize: 11.5, color: 'var(--text-dim)', marginBottom: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 6 }}>
        <span style={{ color: '#8fd49a', fontWeight: 700, letterSpacing: 0.5 }}>
          レンジ対レンジ勝率 ({STREET_JA[game.street] ?? game.street})
        </span>
        <button
          onClick={() => setShowDetail(v => !v)}
          style={{ background: 'none', border: '1px solid #2f5c3a', borderRadius: 6, padding: '2px 8px', fontSize: 11, color: 'var(--gold)', cursor: 'pointer' }}
        >
          {showDetail ? '▲ 推定レンジを閉じる' : '▼ 推定レンジを見る'}
        </button>
      </div>

      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 6 }}>
        <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>あなたの手</span>
        <span style={{ fontSize: 26, fontWeight: 700, color: 'var(--gold-light)' }}>
          {Math.round(result.heroEquity * 100)}%
        </span>
      </div>
      <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
        あなたのレンジ平均: <strong style={{ color: '#8fd49a' }}>{Math.round(result.heroRangeEquity * 100)}%</strong>
        {' '}/ 相手レンジ: <strong style={{ color: '#e08585' }}>{Math.round(result.villainRangeEquity * 100)}%</strong>
      </div>

      {showDetail && (
        <div style={{ marginTop: 10, display: 'flex', flexWrap: 'wrap', gap: 12 }}>
          {villains.map((v, i) => {
            const hands = combosToHandSet(result.villainRangesList[i])
            return (
              <div key={v.id} style={{ display: 'flex', flexDirection: 'column', gap: 4, maxWidth: 220 }}>
                <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>
                  {v.name}の推定レンジ ({POSITION_INFO[v.position]?.nameJa ?? v.position})
                </span>
                <RangeSetGrid hands={hands} cellSize={16} fillColor="#e08585" fillBorder="#a55454" />
                <div style={{ fontSize: 10.5, color: 'var(--text-dim)', lineHeight: 1.5 }}>
                  <span style={{ color: '#cdd6f4', fontWeight: 600 }}>絞り込みの根拠(アクション履歴): </span>
                  {buildActionLine(game, v.id)}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
