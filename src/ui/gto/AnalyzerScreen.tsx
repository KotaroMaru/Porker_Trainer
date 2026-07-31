import { useEffect } from 'react'
import { cardKey } from '../../engine/deck'
import type { Card, Suit } from '../../engine/types'
import { isOopPosition } from '../../gto/data/scenarios'
import { useGtoStore } from '../../gto/store'
import { buildStreetTree, buildTurnSubgameTree } from '../../gto/tree/actionTree'
import type { DecisionNode, PlayerIdx, TreeNode } from '../../gto/solver/cfr'
import { actionLabelsWithAmounts } from '../../gto/trainer/actionMath'
import type { Seat } from '../../gto/trainer/gameFlow'
import { findIsomorphicStoredFlop } from '../../gto/flopIso'
import { STREET_LABEL_JA, actionLabelJa } from './labels'
import { CardPicker } from './CardPicker'
import { PokerTableView } from './PokerTableView'
import { ActionButtonRow } from './ActionButtonRow'
import { ReviewScreen } from './ReviewScreen'
import { PositionRingPicker } from './PositionRingPicker'

// P12 Phase C: 「カスタムハンド解析モード」をステップ式ウィザードへ刷新した(P11 Phase Bの
// 「わかりにくい・使いにくい」フィードバックの続き)。今なにを入力する番かを1つだけ提示し、
// 完了すると自動的に次のステップへ進む。マッチアップ選択はリング図(PositionRingPicker)へ
// 置き換え、「あなたのポジション」ラジオは廃止(リングで自分の席を選んだ時点でOOP/IPが
// 確定するため)。フロップ入力は収録95件の<select>から52枚の自由選択(CardPicker maxSelect:3)
// へ変更し、収録済みかどうかは解析実行(submit)時まで判定しない(customAnalyzer.flopCardsが
// 「入力中の生のフロップ」、flopは「解析実行時に解決された収録済みフロップ」という役割分担。
// store.tsのCustomAnalyzerStateコメント参照)。
// 解析ロジック(follow/buildStreetTree等)自体はP11から無変更。

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

type Step = 'matchup' | 'flop' | 'hand' | 'flopActions' | 'turnCard' | 'turnActions' | 'riverCard' | 'riverActions' | 'ready'

const STEP_ORDER: Step[] = ['matchup', 'flop', 'hand', 'flopActions', 'turnCard', 'turnActions', 'riverCard', 'riverActions', 'ready']

const STEP_LABELS: Record<Step, string> = {
  matchup: 'マッチアップを選んでください',
  flop: 'フロップを3枚選んでください',
  hand: 'あなたの手札を2枚選んでください',
  flopActions: 'フロップのアクションを再現してください',
  turnCard: 'ターンのカードを選んでください',
  turnActions: 'ターンのアクションを再現してください',
  riverCard: 'リバーのカードを選んでください',
  riverActions: 'リバーのアクションを再現してください',
  ready: '解析の準備ができました',
}

const ALL_SUITS: readonly Suit[] = ['c', 'd', 'h', 's']

export function AnalyzerScreen() {
  const { review, reviewSource, customAnalyzer, startCustomAnalysis, updateCustomAnalysis, addCustomAction, goBackCustomStep, submitCustomHand, closeCustomAnalysis } = useGtoStore()
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

  const { scenario, flopCards, userSeat, userCombo, turnCard, riverCard, streetActions, phase, error } = customAnalyzer
  const oopIsRaiser = scenario ? isOopPosition(scenario.raiser.position, scenario.defender.position) : false
  const oopPosition = scenario ? (oopIsRaiser ? scenario.raiser.position : scenario.defender.position) : null
  const ipPosition = scenario ? (oopIsRaiser ? scenario.defender.position : scenario.raiser.position) : null
  const heroPosition = userSeat === null ? '?' : userSeat === 0 ? (oopPosition ?? '?') : (ipPosition ?? '?')
  const villainPosition = userSeat === 0 ? (ipPosition ?? '?') : (oopPosition ?? '?')
  const positionByPlayer = (player: PlayerIdx) => (player === 0 ? (oopPosition ?? 'OOP') : (ipPosition ?? 'IP'))

  const flopCardsFilled = flopCards.every((c): c is Card => c !== null)
  const flopCardsArr: Card[] = flopCardsFilled ? (flopCards as Card[]) : []
  // 表示用(盤面・フロップCardPickerの選択ハイライト): 3枚揃うまでの途中経過(1〜2枚)も
  // そのまま見せる。flopCardsArrは逆にツリー構築(木の完成には3枚全て必要)専用に
  // all-or-nothingのままにする(用途が違うため2つに分ける)。
  const flopCardsPartial = flopCards.filter((c): c is Card => c !== null)

  const flopRoot = scenario ? buildStreetTree({ potBb: scenario.potBb, effectiveStackBb: scenario.effectiveStackBb, firstToAct: 0 }) : null
  const flopEnd = flopRoot ? follow(flopRoot, streetActions.flop.map((a) => a.label)) : null
  const flopDone = !!flopEnd && flopEnd.kind !== 'decision'
  const flopFold = flopEnd ? isFold(flopEnd) : false
  const turnRoot =
    flopEnd?.kind === 'terminal' && !flopFold && scenario && flopCardsFilled
      ? buildTurnSubgameTree({
          turnPotBb: flopEnd.potBb,
          effectiveStackBb: Math.min(scenario.effectiveStackBb - flopEnd.contributed[0], scenario.effectiveStackBb - flopEnd.contributed[1]),
          firstToAct: 0,
          deadCards: [...flopCardsArr, ...(turnCard ? [turnCard] : [])],
        })
      : null
  const turnEnd = turnRoot ? follow(turnRoot, streetActions.turn.map((a) => a.label)) : null
  const turnDone = !!turnEnd && turnEnd.kind !== 'decision'
  const turnFold = turnEnd ? isFold(turnEnd) : false
  const riverRoot = turnEnd?.kind === 'chance' && turnCard && riverCard ? (turnEnd.children[turnEnd.cards.indexOf(cardKey(riverCard))] ?? null) : null
  const riverEnd = riverRoot ? follow(riverRoot, streetActions.river.map((a) => a.label)) : null
  const riverDone = !!riverEnd && riverEnd.kind !== 'decision'
  const hasCompleteCombo = !!userCombo?.[0] && !!userCombo?.[1] && cardKey(userCombo[0]) !== cardKey(userCombo[1])

  let step: Step
  if (!scenario) step = 'matchup'
  else if (!flopCardsFilled) step = 'flop'
  else if (!hasCompleteCombo) step = 'hand'
  else if (!flopDone) step = 'flopActions'
  else if (flopFold) step = 'ready'
  else if (!turnCard) step = 'turnCard'
  else if (!turnDone) step = 'turnActions'
  else if (turnFold) step = 'ready'
  else if (!riverCard) step = 'riverCard'
  else if (!riverDone) step = 'riverActions'
  else step = 'ready'

  const selectedCards = userCombo?.filter((card): card is Card => card !== null) ?? []
  const usedForHand = flopCardsArr
  const usedForTurn = [...usedForHand, ...selectedCards]
  const usedForRiver = turnCard ? [...usedForTurn, turnCard] : usedForTurn

  // 常設の盤面。入力が進むごとに埋まっていく(未選択のフロップ枚数分は単に表示しない、
  // heroComboの未選択スロットはPokerTableView側で破線プレースホルダになる)。
  const board = [...flopCardsPartial, ...(turnCard ? [turnCard] : []), ...(riverCard ? [riverCard] : [])]
  const heroCombo: [Card | null, Card | null] = userCombo ?? [null, null]
  const potBb = nodePotBb(riverEnd) ?? nodePotBb(turnEnd) ?? nodePotBb(flopEnd) ?? nodePotBb(flopRoot) ?? scenario?.potBb ?? 0
  const villain = scenario ? { position: villainPosition } : undefined

  // 手札1枚をトグルする。既選択なら取り除く、未選択で空きスロットがあれば先頭の空きへ入れる、
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

  // フロップ3枚をトグルする(CardPickerはmaxSelect:3、トグル判定は呼び出し側の責務)。
  function toggleFlopCard(card: Card) {
    const cards = flopCards
    const existingIdx = cards.findIndex((c) => c !== null && cardKey(c) === cardKey(card))
    if (existingIdx >= 0) {
      const next = [...cards] as [Card | null, Card | null, Card | null]
      next[existingIdx] = null
      updateCustomAnalysis({ flopCards: next })
      return
    }
    const emptyIdx = cards.findIndex((c) => c === null)
    if (emptyIdx < 0) return
    const next = [...cards] as [Card | null, Card | null, Card | null]
    next[emptyIdx] = card
    updateCustomAnalysis({ flopCards: next })
  }

  // P12 Phase D未実装分: 収録済みフロップと厳密一致(=写像が恒等写像)の場合のみ、その場で
  // 解決してsubmitCustomHandを呼ぶ。スート読み替えが必要な場合・収録データが全く無い場合の
  // 確認UI/AI相談コピーはPhase Dで追加する(ここでは送信をブロックし理由を案内するのみ)。
  const flopMatch = step === 'ready' && flopCardsFilled ? findIsomorphicStoredFlop(flopCardsArr) : null
  const flopMatchIsIdentity = flopMatch ? ALL_SUITS.every((s) => flopMatch.suitMap[s] === s) : false

  async function handleSubmit() {
    if (!flopMatch || !flopMatchIsIdentity) return
    updateCustomAnalysis({ flop: flopMatch.flop })
    await submitCustomHand()
  }

  const canGoBack = scenario !== null
  const stepIndex = STEP_ORDER.indexOf(step) + 1

  return (
    <div style={{ maxWidth: 760, display: 'flex', flexDirection: 'column', gap: 18 }}>
      <div>
        <h3 style={{ color: 'var(--gold)', margin: 0 }}>カスタムハンド解析</h3>
        <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>実戦のアクションを再現して、あなたの判断をレビューします。</p>
      </div>

      {/* 常設の盤面(入力が進むごとに埋まっていく) */}
      <PokerTableView board={board} heroCombo={heroCombo} heroPosition={heroPosition} potBb={potBb} villain={villain} />

      {/* これまでに入力したアクションの一覧(PlayScreenのストリート履歴ストリップ簡略版) */}
      {scenario && (
        <div style={{ display: 'flex', gap: 0, border: '1px solid var(--panel-border)', borderRadius: 8, overflow: 'hidden', fontSize: 13 }}>
          {(['flop', 'turn', 'river'] as const).map((street) => (
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
      )}

      {/* 現在のステップだけを表示するウィザード本体 */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ color: 'var(--gold-light)', fontSize: 14, fontWeight: 700 }}>
            {step !== 'matchup' && <span style={{ color: 'var(--text-dim)', fontWeight: 400, marginRight: 6 }}>{stepIndex}/{STEP_ORDER.length}</span>}
            {STEP_LABELS[step]}
          </div>
          {canGoBack && (
            <button type="button" onClick={goBackCustomStep} style={{ fontSize: 12.5, color: 'var(--text-dim)', background: 'transparent' }}>
              ← 戻る
            </button>
          )}
        </div>

        {step === 'matchup' && <PositionRingPicker onComplete={(s, seat) => updateCustomAnalysis({ scenario: s, userSeat: seat })} />}

        {step === 'flop' && <CardPicker ariaLabel="フロップ" selected={flopCardsPartial} unavailable={[]} maxSelect={3} onSelect={toggleFlopCard} />}

        {step === 'hand' && <CardPicker ariaLabel="あなたの手札" selected={selectedCards} unavailable={usedForHand} maxSelect={2} onSelect={toggleHandCard} />}

        {step === 'flopActions' && flopRoot && (
          <DecisionSection node={flopEnd ?? flopRoot} positionByPlayer={positionByPlayer} onChoose={(seat, label) => addCustomAction('flop', { seat, label })} />
        )}

        {step === 'turnCard' && (
          <CardPicker ariaLabel="ターンカード" selected={turnCard ? [turnCard] : []} unavailable={usedForTurn} maxSelect={1} onSelect={(card) => updateCustomAnalysis({ turnCard: card, riverCard: null })} />
        )}

        {step === 'turnActions' && turnEnd && (
          <DecisionSection node={turnEnd} positionByPlayer={positionByPlayer} onChoose={(seat, label) => addCustomAction('turn', { seat, label })} />
        )}

        {step === 'riverCard' && (
          <CardPicker ariaLabel="リバーカード" selected={riverCard ? [riverCard] : []} unavailable={usedForRiver} maxSelect={1} onSelect={(card) => updateCustomAnalysis({ riverCard: card })} />
        )}

        {step === 'riverActions' && riverEnd && (
          <DecisionSection node={riverEnd} positionByPlayer={positionByPlayer} onChoose={(seat, label) => addCustomAction('river', { seat, label })} />
        )}

        {step === 'ready' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {!flopMatch && (
              <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>
                このフロップ(やスート違いの近い盤面)の収録データが見つかりませんでした。
              </div>
            )}
            {flopMatch && !flopMatchIsIdentity && (
              <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>
                このフロップの完全一致データはありませんが、スート違いの近い盤面({flopMatch.flop.cards.join('')})が見つかりました。読み替えての解析は近日対応予定です。
              </div>
            )}
            <button type="button" disabled={!flopMatch || !flopMatchIsIdentity || phase === 'solving'} onClick={() => void handleSubmit()}>
              {phase === 'solving' ? '精密ソルブ中…' : '解析する'}
            </button>
          </div>
        )}
      </div>

      {error && (
        <div role="alert" style={{ color: 'var(--red)' }}>
          {error}
        </div>
      )}
    </div>
  )
}
