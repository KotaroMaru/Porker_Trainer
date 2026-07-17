import { useEffect } from 'react'
import { cardKey, cardLabel } from '../../engine/deck'
import type { Card } from '../../engine/types'
import { FLOPS } from '../../gto/data/flops'
import { isOopPosition, SCENARIOS } from '../../gto/data/scenarios'
import { selectFlopPool, useGtoStore } from '../../gto/store'
import { buildStreetTree, buildTurnSubgameTree } from '../../gto/tree/actionTree'
import type { DecisionNode, PlayerIdx, TreeNode } from '../../gto/solver/cfr'
import { actionLabelsWithAmounts } from '../../gto/trainer/actionMath'
import type { Seat } from '../../gto/trainer/gameFlow'
import { boardFromFlop } from '../../gto/trainer/gameFlow'
import { STREET_LABEL_JA, actionLabelJa } from './labels'
import { CardPicker } from './CardPicker'
import { PokerTableView } from './PokerTableView'
import { ActionButtonRow } from './ActionButtonRow'
import { ReviewScreen } from './ReviewScreen'

// P11 Phase B: 「カスタムハンド解析モード」のUIを通常プレイ画面(PlayScreen.tsx)と
// 同じ見た目・体験へ刷新した(素の<select>+52マスのカード盤2枚+文脈のないボタン列、
// という従来UIが「わかりにくい・使いにくい」というユーザーフィードバックを受けた対応)。
// 解析ロジック(follow/buildStreetTree等)自体はPhase Aから正しく動いており無変更、
// 表示層のみをPhase Aで切り出した共有部品(PokerTableView/ActionButtonRow)へ差し替えた。

function follow(root: TreeNode, labels: readonly string[]): TreeNode {
  let node = root
  for (const label of labels) {
    if (node.kind !== 'decision') return node
    const index = node.actionLabels.indexOf(label)
    if (index < 0) return node
    node = node.children[index]
  }
  return node
}

function isFold(node: TreeNode): boolean {
  return node.kind === 'terminal' && node.outcome.kind === 'fold'
}

/** 決断ノードの直近ポット額(bb)。UI表示用。ノード種別によっては持たないためundefinedを返す。 */
function nodePotBb(node: TreeNode | null): number | undefined {
  if (!node) return undefined
  if (node.kind === 'decision') return node.potBb
  if (node.kind === 'terminal') return node.potBb
  return undefined
}

/** 決断ノードのアクション列を、PlayScreenと同じ見出し付きActionButtonRowで描画する。
 *  positionByPlayerがあれば「BTNの番です」のように具体的なポジション名を見出しに使う。 */
function DecisionSection({
  node,
  positionByPlayer,
  onChoose,
}: {
  node: TreeNode
  positionByPlayer: (player: PlayerIdx) => string
  onChoose: (seat: Seat, label: string) => void
}) {
  if (node.kind !== 'decision') return null
  const decision: DecisionNode = node
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>{positionByPlayer(decision.player)}の番です</div>
      <ActionButtonRow actions={actionLabelsWithAmounts(decision)} onChoose={(label) => onChoose(decision.player, label)} />
    </div>
  )
}

export function AnalyzerScreen() {
  const { review, reviewSource, customAnalyzer, availability, startCustomAnalysis, updateCustomAnalysis, addCustomAction, submitCustomHand, closeCustomAnalysis } = useGtoStore()
  useEffect(() => {
    if (!customAnalyzer) void startCustomAnalysis()
  }, [customAnalyzer, startCustomAnalysis])

  if (review && reviewSource === 'custom') {
    return (
      <>
        <button type="button" onClick={closeCustomAnalysis} style={{ marginBottom: 12 }}>
          フォームに戻る
        </button>
        <ReviewScreen />
      </>
    )
  }
  if (!customAnalyzer) return <div style={{ padding: 24, color: 'var(--text-dim)' }}>入力フォームを準備中…</div>

  const { scenario, flop, userSeat, userCombo, turnCard, riverCard, streetActions, phase, error } = customAnalyzer
  const oopIsRaiser = scenario ? isOopPosition(scenario.raiser.position, scenario.defender.position) : false
  const oopPosition = scenario ? (oopIsRaiser ? scenario.raiser.position : scenario.defender.position) : null
  const ipPosition = scenario ? (oopIsRaiser ? scenario.defender.position : scenario.raiser.position) : null
  const heroPosition = userSeat === null ? '?' : userSeat === 0 ? (oopPosition ?? '?') : (ipPosition ?? '?')
  const villainPosition = userSeat === 0 ? (ipPosition ?? '?') : (oopPosition ?? '?')
  const positionByPlayer = (player: PlayerIdx) => (player === 0 ? (oopPosition ?? 'OOP') : (ipPosition ?? 'IP'))

  const flopPool = scenario ? selectFlopPool(FLOPS, availability?.get(scenario.id)) : []
  const flopRoot = scenario ? buildStreetTree({ potBb: scenario.potBb, effectiveStackBb: scenario.effectiveStackBb, firstToAct: 0 }) : null
  const flopEnd = flopRoot ? follow(flopRoot, streetActions.flop.map((a) => a.label)) : null
  const flopDone = !!flopEnd && flopEnd.kind !== 'decision'
  const flopFold = flopEnd ? isFold(flopEnd) : false
  const flopCards = flop ? boardFromFlop(flop) : []
  const turnRoot =
    flopEnd?.kind === 'terminal' && !flopFold && scenario && flop
      ? buildTurnSubgameTree({
          turnPotBb: flopEnd.potBb,
          effectiveStackBb: Math.min(scenario.effectiveStackBb - flopEnd.contributed[0], scenario.effectiveStackBb - flopEnd.contributed[1]),
          firstToAct: 0,
          deadCards: [...flopCards, ...(turnCard ? [turnCard] : [])],
        })
      : null
  const turnEnd = turnRoot ? follow(turnRoot, streetActions.turn.map((a) => a.label)) : null
  const turnDone = !!turnEnd && turnEnd.kind !== 'decision'
  const turnFold = turnEnd ? isFold(turnEnd) : false
  const riverRoot = turnEnd?.kind === 'chance' && turnCard && riverCard ? (turnEnd.children[turnEnd.cards.indexOf(cardKey(riverCard))] ?? null) : null
  const riverEnd = riverRoot ? follow(riverRoot, streetActions.river.map((a) => a.label)) : null
  const riverDone = !!riverEnd && riverEnd.kind !== 'decision'
  const hasCompleteCombo = !!userCombo?.[0] && !!userCombo?.[1] && cardKey(userCombo[0]) !== cardKey(userCombo[1])
  const canSubmit = !!scenario && !!flop && userSeat !== null && hasCompleteCombo && (flopFold || (turnCard && (turnFold || (riverCard && riverDone))))
  const usedForHand = flopCards
  const selectedCards = userCombo?.filter((card): card is Card => card !== null) ?? []
  const usedForTurn = [...usedForHand, ...selectedCards]
  const usedForRiver = turnCard ? [...usedForTurn, turnCard] : usedForTurn

  // 常設の盤面。入力が進むごとに埋まっていく(NF1: heroComboの未選択スロットはPokerTableView側で
  // 破線プレースホルダになる)。
  const board = [...flopCards, ...(turnCard ? [turnCard] : []), ...(riverCard ? [riverCard] : [])]
  const heroCombo: [Card | null, Card | null] = userCombo ?? [null, null]
  const potBb = nodePotBb(riverEnd) ?? nodePotBb(turnEnd) ?? nodePotBb(flopEnd) ?? nodePotBb(flopRoot) ?? scenario?.potBb ?? 0
  const villain = scenario && flop ? { position: villainPosition } : undefined

  // 手札1枚をトグルする(P11 Phase B: 1枚目/2枚目の別ピッカーを1つに統合)。
  // 既選択なら取り除く、未選択で空きスロットがあれば先頭の空きへ入れる、
  // 両方埋まっている状態で未選択カードをクリックした場合は無視する。
  function toggleHandCard(card: Card) {
    const combo = userCombo ?? [null, null]
    const existingIdx = combo.findIndex((c) => c !== null && cardKey(c) === cardKey(card))
    if (existingIdx >= 0) {
      const next: [Card | null, Card | null] = [...combo] as [Card | null, Card | null]
      next[existingIdx] = null
      updateCustomAnalysis({ userCombo: next })
      return
    }
    const emptyIdx = combo.findIndex((c) => c === null)
    if (emptyIdx < 0) return
    const next: [Card | null, Card | null] = [...combo] as [Card | null, Card | null]
    next[emptyIdx] = card
    updateCustomAnalysis({ userCombo: next })
  }

  const streetColumns: { street: 'flop' | 'turn' | 'river' }[] = [{ street: 'flop' }, { street: 'turn' }, { street: 'river' }]

  return (
    <div style={{ maxWidth: 760, display: 'flex', flexDirection: 'column', gap: 18 }}>
      <div>
        <h3 style={{ color: 'var(--gold)', margin: 0 }}>カスタムハンド解析</h3>
        <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>実戦のアクションを再現して、あなたの判断をレビューします。</p>
      </div>

      {/* 常設の盤面(入力が進むごとに埋まっていく) */}
      <PokerTableView board={board} heroCombo={heroCombo} heroPosition={heroPosition} potBb={potBb} villain={villain} />

      {/* これまでに入力したアクションの一覧(PlayScreenのストリート履歴ストリップ簡略版) */}
      <div style={{ display: 'flex', gap: 0, border: '1px solid var(--panel-border)', borderRadius: 8, overflow: 'hidden', fontSize: 13 }}>
        {streetColumns.map(({ street }) => (
          <div key={street} style={{ flex: 1, padding: 8, borderRight: '1px solid var(--panel-border)' }}>
            <div style={{ color: 'var(--text-dim)', fontSize: 11, marginBottom: 4 }}>{STREET_LABEL_JA[street]}</div>
            {streetActions[street].map((a, i) => (
              <div key={i} style={{ color: 'var(--text)' }}>
                {positionByPlayer(a.seat)}: {actionLabelJa(a.label)}
              </div>
            ))}
          </div>
        ))}
      </div>

      <label>
        1. マッチアップ
        <br />
        <select value={scenario?.id ?? ''} onChange={(e) => updateCustomAnalysis({ scenario: SCENARIOS.find((s) => s.id === e.target.value) ?? null })}>
          <option value="">選択してください</option>
          {SCENARIOS.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </select>
      </label>

      {scenario && (
        <label>
          2. フロップ
          <br />
          <select value={flop ? flop.cards.join('') : ''} onChange={(e) => updateCustomAnalysis({ flop: flopPool.find((f) => f.cards.join('') === e.target.value) ?? null })}>
            <option value="">選択してください</option>
            {flopPool.map((f) => (
              <option key={f.cards.join('')} value={f.cards.join('')}>
                {boardFromFlop(f).map(cardLabel).join(' ')}
              </option>
            ))}
          </select>
        </label>
      )}

      {flop && (
        <fieldset>
          <legend>3. あなたのポジション</legend>
          <label>
            <input type="radio" name="role" checked={userSeat === (oopIsRaiser ? 0 : 1)} onChange={() => updateCustomAnalysis({ userSeat: oopIsRaiser ? 0 : 1 })} /> レイザー ({scenario?.raiser.position})
          </label>{' '}
          <label>
            <input type="radio" name="role" checked={userSeat === (oopIsRaiser ? 1 : 0)} onChange={() => updateCustomAnalysis({ userSeat: oopIsRaiser ? 1 : 0 })} /> ディフェンダー ({scenario?.defender.position})
          </label>
        </fieldset>
      )}

      {userSeat !== null && flop && (
        <div>
          <div style={{ marginBottom: 6 }}>4. あなたの手札 {selectedCards.map(cardLabel).join(' ')}</div>
          <CardPicker ariaLabel="あなたの手札" selected={selectedCards} unavailable={usedForHand} maxSelect={2} onSelect={toggleHandCard} />
        </div>
      )}

      {hasCompleteCombo && flopRoot && (
        <section>
          <div style={{ marginBottom: 6 }}>5. フロップのアクション</div>
          <DecisionSection node={flopEnd ?? flopRoot} positionByPlayer={positionByPlayer} onChoose={(seat, label) => addCustomAction('flop', { seat, label })} />
          {flopDone && <small style={{ color: 'var(--text-muted)' }}>{flopFold ? 'フォールドでハンド終了' : 'ターンへ進みます'}</small>}
        </section>
      )}

      {flopDone && !flopFold && (
        <section>
          <div style={{ marginBottom: 6 }}>6. ターン {turnCard && cardLabel(turnCard)}</div>
          <CardPicker ariaLabel="ターンカード" selected={turnCard ? [turnCard] : []} unavailable={usedForTurn} maxSelect={1} onSelect={(card) => updateCustomAnalysis({ turnCard: card, riverCard: null })} />
          {turnCard && turnEnd && <div style={{ marginTop: 8 }}><DecisionSection node={turnEnd} positionByPlayer={positionByPlayer} onChoose={(seat, label) => addCustomAction('turn', { seat, label })} /></div>}
        </section>
      )}

      {turnDone && !turnFold && (
        <section>
          <div style={{ marginBottom: 6 }}>7. リバー {riverCard && cardLabel(riverCard)}</div>
          <CardPicker ariaLabel="リバーカード" selected={riverCard ? [riverCard] : []} unavailable={usedForRiver} maxSelect={1} onSelect={(card) => updateCustomAnalysis({ riverCard: card })} />
          {riverCard && riverEnd && <div style={{ marginTop: 8 }}><DecisionSection node={riverEnd} positionByPlayer={positionByPlayer} onChoose={(seat, label) => addCustomAction('river', { seat, label })} /></div>}
        </section>
      )}

      {error && (
        <div role="alert" style={{ color: 'var(--red)' }}>
          {error}
        </div>
      )}

      <div>
        <button type="button" disabled={!canSubmit || phase === 'solving'} onClick={() => void submitCustomHand()}>
          {phase === 'solving' ? '精密ソルブ中…' : '解析する'}
        </button>
        {streetActions.flop.length + streetActions.turn.length + streetActions.river.length > 0 && (
          <button type="button" style={{ marginLeft: 8 }} onClick={() => updateCustomAnalysis({ flop })}>
            アクションをやり直す
          </button>
        )}
      </div>
    </div>
  )
}
