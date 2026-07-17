import { useEffect } from 'react'
import { cardKey, cardLabel } from '../../engine/deck'
import type { Card } from '../../engine/types'
import { FLOPS } from '../../gto/data/flops'
import { isOopPosition, SCENARIOS } from '../../gto/data/scenarios'
import { selectFlopPool, useGtoStore } from '../../gto/store'
import { buildStreetTree, buildTurnSubgameTree } from '../../gto/tree/actionTree'
import type { TreeNode } from '../../gto/solver/cfr'
import type { Seat } from '../../gto/trainer/gameFlow'
import { boardFromFlop } from '../../gto/trainer/gameFlow'
import { actionLabelJa } from './labels'
import { CardPicker } from './CardPicker'
import { ReviewScreen } from './ReviewScreen'

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

function ActionButtons({ node, onChoose }: { node: TreeNode; onChoose: (seat: Seat, label: string) => void }) {
  if (node.kind !== 'decision') return null
  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
      <span style={{ color: 'var(--text-muted)', alignSelf: 'center', fontSize: 13 }}>{node.player === 0 ? 'OOP' : 'IP'} のアクション:</span>
      {node.actionLabels.map((label) => <button key={label} type="button" onClick={() => onChoose(node.player, label)}>{actionLabelJa(label)}</button>)}
    </div>
  )
}

export function AnalyzerScreen() {
  const { review, reviewSource, customAnalyzer, availability, startCustomAnalysis, updateCustomAnalysis, addCustomAction, submitCustomHand, closeCustomAnalysis } = useGtoStore()
  useEffect(() => { if (!customAnalyzer) void startCustomAnalysis() }, [customAnalyzer, startCustomAnalysis])

  if (review && reviewSource === 'custom') {
    return <><button type="button" onClick={closeCustomAnalysis} style={{ marginBottom: 12 }}>フォームに戻る</button><ReviewScreen /></>
  }
  if (!customAnalyzer) return <div style={{ padding: 24, color: 'var(--text-dim)' }}>入力フォームを準備中…</div>

  const { scenario, flop, userSeat, userCombo, turnCard, riverCard, streetActions, phase, error } = customAnalyzer
  const oopIsRaiser = scenario ? isOopPosition(scenario.raiser.position, scenario.defender.position) : false
  const flopPool = scenario ? selectFlopPool(FLOPS, availability?.get(scenario.id)) : []
  const flopRoot = scenario ? buildStreetTree({ potBb: scenario.potBb, effectiveStackBb: scenario.effectiveStackBb, firstToAct: 0 }) : null
  const flopEnd = flopRoot ? follow(flopRoot, streetActions.flop.map((a) => a.label)) : null
  const flopDone = !!flopEnd && flopEnd.kind !== 'decision'
  const flopFold = flopEnd ? isFold(flopEnd) : false
  const flopCards = flop ? boardFromFlop(flop) : []
  const turnRoot = flopEnd?.kind === 'terminal' && !flopFold && scenario && flop
    ? buildTurnSubgameTree({ turnPotBb: flopEnd.potBb, effectiveStackBb: Math.min(scenario.effectiveStackBb - flopEnd.contributed[0], scenario.effectiveStackBb - flopEnd.contributed[1]), firstToAct: 0, deadCards: [...flopCards, ...(turnCard ? [turnCard] : [])] })
    : null
  const turnEnd = turnRoot ? follow(turnRoot, streetActions.turn.map((a) => a.label)) : null
  const turnDone = !!turnEnd && turnEnd.kind !== 'decision'
  const turnFold = turnEnd ? isFold(turnEnd) : false
  const riverRoot = turnEnd?.kind === 'chance' && turnCard && riverCard
    ? turnEnd.children[turnEnd.cards.indexOf(cardKey(riverCard))] ?? null
    : null
  const riverEnd = riverRoot ? follow(riverRoot, streetActions.river.map((a) => a.label)) : null
  const riverDone = !!riverEnd && riverEnd.kind !== 'decision'
  const hasCompleteCombo = !!userCombo?.[0] && !!userCombo?.[1] && cardKey(userCombo[0]) !== cardKey(userCombo[1])
  const canSubmit = !!scenario && !!flop && userSeat !== null && hasCompleteCombo && (flopFold || (turnCard && (turnFold || (riverCard && riverDone))))
  const usedForHand = flopCards
  const selectedCards = userCombo?.filter((card): card is Card => card !== null) ?? []
  const usedForTurn = [...usedForHand, ...selectedCards]
  const usedForRiver = turnCard ? [...usedForTurn, turnCard] : usedForTurn

  return (
    <div style={{ maxWidth: 760, display: 'flex', flexDirection: 'column', gap: 18 }}>
      <div><h3 style={{ color: 'var(--gold)', margin: 0 }}>カスタムハンド解析</h3><p style={{ color: 'var(--text-muted)', fontSize: 13 }}>実戦のアクションを再現して、あなたの判断をレビューします。</p></div>
      <label>1. マッチアップ<br /><select value={scenario?.id ?? ''} onChange={(e) => updateCustomAnalysis({ scenario: SCENARIOS.find((s) => s.id === e.target.value) ?? null })}><option value="">選択してください</option>{SCENARIOS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}</select></label>
      {scenario && <label>2. フロップ<br /><select value={flop ? flop.cards.join('') : ''} onChange={(e) => updateCustomAnalysis({ flop: flopPool.find((f) => f.cards.join('') === e.target.value) ?? null })}><option value="">選択してください</option>{flopPool.map((f) => <option key={f.cards.join('')} value={f.cards.join('')}>{boardFromFlop(f).map(cardLabel).join(' ')}</option>)}</select></label>}
      {flop && <fieldset><legend>3. あなたのポジション</legend><label><input type="radio" name="role" checked={userSeat === (oopIsRaiser ? 0 : 1)} onChange={() => updateCustomAnalysis({ userSeat: oopIsRaiser ? 0 : 1 })} /> レイザー ({scenario?.raiser.position})</label>{' '}<label><input type="radio" name="role" checked={userSeat === (oopIsRaiser ? 1 : 0)} onChange={() => updateCustomAnalysis({ userSeat: oopIsRaiser ? 1 : 0 })} /> ディフェンダー ({scenario?.defender.position})</label></fieldset>}
      {userSeat !== null && flop && <div><div style={{ marginBottom: 6 }}>4. あなたの手札 {selectedCards.map(cardLabel).join(' ')}</div><div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}><div><small>1枚目</small><CardPicker ariaLabel="手札1枚目" selected={userCombo?.[0] ?? null} unavailable={[...usedForHand, ...(userCombo?.[1] ? [userCombo[1]] : [])]} onSelect={(card) => updateCustomAnalysis({ userCombo: [card, userCombo?.[1] ?? null] })} /></div><div><small>2枚目</small><CardPicker ariaLabel="手札2枚目" selected={userCombo?.[1] ?? null} unavailable={[...usedForHand, ...(userCombo?.[0] ? [userCombo[0]] : [])]} onSelect={(card) => updateCustomAnalysis({ userCombo: [userCombo?.[0] ?? null, card] })} /></div></div></div>}
      {userCombo && flopRoot && <section><div>5. フロップのアクション</div><ActionButtons node={flopEnd ?? flopRoot} onChoose={(seat, label) => addCustomAction('flop', { seat, label })} />{flopDone && <small style={{ color: 'var(--text-muted)' }}>{flopFold ? 'フォールドでハンド終了' : 'ターンへ進みます'}</small>}</section>}
      {flopDone && !flopFold && <section><div>6. ターン {turnCard && cardLabel(turnCard)}</div><CardPicker ariaLabel="ターンカード" selected={turnCard} unavailable={usedForTurn} onSelect={(card) => updateCustomAnalysis({ turnCard: card, riverCard: null })} />{turnCard && turnEnd && <ActionButtons node={turnEnd} onChoose={(seat, label) => addCustomAction('turn', { seat, label })} />}</section>}
      {turnDone && !turnFold && <section><div>7. リバー {riverCard && cardLabel(riverCard)}</div><CardPicker ariaLabel="リバーカード" selected={riverCard} unavailable={usedForRiver} onSelect={(card) => updateCustomAnalysis({ riverCard: card })} />{riverCard && riverEnd && <ActionButtons node={riverEnd} onChoose={(seat, label) => addCustomAction('river', { seat, label })} />}</section>}
      {error && <div role="alert" style={{ color: 'var(--red)' }}>{error}</div>}
      <div><button type="button" disabled={!canSubmit || phase === 'solving'} onClick={() => void submitCustomHand()}>{phase === 'solving' ? '精密ソルブ中…' : '解析する'}</button>{(streetActions.flop.length + streetActions.turn.length + streetActions.river.length) > 0 && <button type="button" style={{ marginLeft: 8 }} onClick={() => updateCustomAnalysis({ flop })}>アクションをやり直す</button>}</div>
    </div>
  )
}
