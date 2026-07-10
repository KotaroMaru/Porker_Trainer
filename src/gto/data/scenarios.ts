import type { Position } from '../../engine/types'
import type { Scenario } from '../types'

export const STARTING_STACK_BB = 100
// プリフロップのオープン/3ベットサイズ(ポジション別)。trainer/preflopScript.tsが
// プリフロップ履歴の表示行を再構成する際にも使う唯一の正典。
export const OPEN_SIZE_BB: Record<Position, number> = {
  UTG: 2.5, 'UTG+1': 2.5, MP: 2.5, HJ: 2.5, CO: 2.5, BTN: 2.5, SB: 3, BB: 2.5,
}
export const THREEBET_SIZE_BB: Record<Position, number> = {
  UTG: 7.5, 'UTG+1': 7.5, MP: 7.5, HJ: 7.5, CO: 7.5, BTN: 7.5, SB: 11, BB: 12,
}

/** プリフロップで参加せず倒れたポジションが没収するデッドマネー(ブラインドのみ) */
function deadBlinds(foldedPositions: Position[]): number {
  let dead = 0
  if (foldedPositions.includes('SB')) dead += 0.5
  if (foldedPositions.includes('BB')) dead += 1
  return dead
}

const ALL_POSITIONS: Position[] = ['UTG', 'HJ', 'CO', 'BTN', 'SB', 'BB']

function foldedBetween(raiser: Position, defender: Position): Position[] {
  // raiserとdefenderの間で、実際にプレイに絡まないポジション(ブラインド没収分だけ計上)
  return ALL_POSITIONS.filter((p) => p !== raiser && p !== defender)
}

function srpScenario(opts: {
  id: string
  raiser: Position
  defender: Position
  defenderRole: 'caller' | 'coldcaller'
  raiserRangeId: string
  defenderRangeId: string
  weight: number
}): Scenario {
  const openSize = OPEN_SIZE_BB[opts.raiser]
  const folded = foldedBetween(opts.raiser, opts.defender)
  const dead = deadBlinds(folded)
  const potBb = openSize * 2 + dead
  const effectiveStackBb = STARTING_STACK_BB - openSize
  const defenderLabel = opts.defenderRole === 'caller' ? 'コール' : 'コールドコール'
  return {
    id: opts.id,
    kind: 'SRP',
    label: `${opts.raiser} vs ${opts.defender}・SRP`,
    descriptionJa: `${opts.raiser}がオープンレイズし、${opts.defender}が${defenderLabel}。`,
    raiser: { position: opts.raiser, role: 'raiser', rangeId: opts.raiserRangeId },
    defender: { position: opts.defender, role: opts.defenderRole, rangeId: opts.defenderRangeId },
    potBb: Math.round(potBb * 10) / 10,
    effectiveStackBb: Math.round(effectiveStackBb * 10) / 10,
    weight: opts.weight,
  }
}

function threebetScenario(opts: {
  id: string
  raiser: Position
  threebettor: Position
  raiserRangeId: string
  threebettorRangeId: string
  weight: number
}): Scenario {
  const threebetSize = THREEBET_SIZE_BB[opts.threebettor]
  const folded = foldedBetween(opts.raiser, opts.threebettor)
  const dead = deadBlinds(folded)
  const potBb = threebetSize * 2 + dead
  const effectiveStackBb = STARTING_STACK_BB - threebetSize
  return {
    id: opts.id,
    kind: 'THREEBET',
    label: `${opts.raiser} vs ${opts.threebettor}・3bet`,
    descriptionJa: `${opts.raiser}がオープンレイズし、${opts.threebettor}が3ベット、${opts.raiser}がコール。`,
    raiser: { position: opts.raiser, role: 'raiser', rangeId: opts.raiserRangeId },
    defender: { position: opts.threebettor, role: 'threebettor', rangeId: opts.threebettorRangeId },
    potBb: Math.round(potBb * 10) / 10,
    effectiveStackBb: Math.round(effectiveStackBb * 10) / 10,
    weight: opts.weight,
  }
}

// ============================================================
// SRP: vs BB call (5)
// ============================================================
const SRP_VS_BB: Scenario[] = [
  srpScenario({ id: 'srp_utg_vs_bb', raiser: 'UTG', defender: 'BB', defenderRole: 'caller', raiserRangeId: 'rfi_utg', defenderRangeId: 'bb_call_vs_utg', weight: 12 }),
  srpScenario({ id: 'srp_hj_vs_bb', raiser: 'HJ', defender: 'BB', defenderRole: 'caller', raiserRangeId: 'rfi_hj', defenderRangeId: 'bb_call_vs_hj', weight: 12 }),
  srpScenario({ id: 'srp_co_vs_bb', raiser: 'CO', defender: 'BB', defenderRole: 'caller', raiserRangeId: 'rfi_co', defenderRangeId: 'bb_call_vs_co', weight: 14 }),
  srpScenario({ id: 'srp_btn_vs_bb', raiser: 'BTN', defender: 'BB', defenderRole: 'caller', raiserRangeId: 'rfi_btn', defenderRangeId: 'bb_call_vs_btn', weight: 18 }),
  srpScenario({ id: 'srp_sb_vs_bb', raiser: 'SB', defender: 'BB', defenderRole: 'caller', raiserRangeId: 'rfi_sb', defenderRangeId: 'bb_call_vs_sb', weight: 10 }),
]

// ============================================================
// SRP: IPコールドコール (6)
// ============================================================
const SRP_COLD_CALL: Scenario[] = [
  srpScenario({ id: 'srp_utg_vs_hj_cc', raiser: 'UTG', defender: 'HJ', defenderRole: 'coldcaller', raiserRangeId: 'rfi_utg', defenderRangeId: 'cc_hj_vs_utg', weight: 6 }),
  srpScenario({ id: 'srp_utg_vs_co_cc', raiser: 'UTG', defender: 'CO', defenderRole: 'coldcaller', raiserRangeId: 'rfi_utg', defenderRangeId: 'cc_co_vs_utg', weight: 6 }),
  srpScenario({ id: 'srp_utg_vs_btn_cc', raiser: 'UTG', defender: 'BTN', defenderRole: 'coldcaller', raiserRangeId: 'rfi_utg', defenderRangeId: 'cc_btn_vs_utg', weight: 7 }),
  srpScenario({ id: 'srp_hj_vs_co_cc', raiser: 'HJ', defender: 'CO', defenderRole: 'coldcaller', raiserRangeId: 'rfi_hj', defenderRangeId: 'cc_co_vs_hj', weight: 6 }),
  srpScenario({ id: 'srp_hj_vs_btn_cc', raiser: 'HJ', defender: 'BTN', defenderRole: 'coldcaller', raiserRangeId: 'rfi_hj', defenderRangeId: 'cc_btn_vs_hj', weight: 7 }),
  srpScenario({ id: 'srp_co_vs_btn_cc', raiser: 'CO', defender: 'BTN', defenderRole: 'coldcaller', raiserRangeId: 'rfi_co', defenderRangeId: 'cc_btn_vs_co', weight: 8 }),
]

// ============================================================
// 3betポット (6)
// ============================================================
const THREEBET_POTS: Scenario[] = [
  threebetScenario({ id: '3bet_co_vs_btn', raiser: 'CO', threebettor: 'BTN', raiserRangeId: 'defend_call_co_vs_btn3bet', threebettorRangeId: 'threebet_btn_vs_co', weight: 8 }),
  threebetScenario({ id: '3bet_btn_vs_sb', raiser: 'BTN', threebettor: 'SB', raiserRangeId: 'defend_call_btn_vs_sb3bet', threebettorRangeId: 'threebet_sb_vs_btn', weight: 6 }),
  threebetScenario({ id: '3bet_btn_vs_bb', raiser: 'BTN', threebettor: 'BB', raiserRangeId: 'defend_call_btn_vs_bb3bet', threebettorRangeId: 'bb_3bet_vs_btn', weight: 8 }),
  threebetScenario({ id: '3bet_hj_vs_co', raiser: 'HJ', threebettor: 'CO', raiserRangeId: 'defend_call_hj_vs_co3bet', threebettorRangeId: 'threebet_co_vs_hj', weight: 6 }),
  threebetScenario({ id: '3bet_hj_vs_btn', raiser: 'HJ', threebettor: 'BTN', raiserRangeId: 'defend_call_hj_vs_btn3bet', threebettorRangeId: 'threebet_btn_vs_hj', weight: 6 }),
  threebetScenario({ id: '3bet_utg_vs_btn', raiser: 'UTG', threebettor: 'BTN', raiserRangeId: 'defend_call_utg_vs_btn3bet', threebettorRangeId: 'threebet_btn_vs_utg', weight: 5 }),
]

// ポストフロップの実際の行動順(早い方がOOP)。raiser/defenderの役割とは独立
// (例: BTNがオープンしてSBが3ベット・コールでも、ポストフロップはSBが先手=OOP)。
// tools/gen-solver-scenarios.mjsとtrainer層(src/gto/trainer/)の両方がこれを使う
// (重複ロジックを避けるため、ここが唯一の正典)。
const POSTFLOP_ORDER: Position[] = ['SB', 'BB', 'UTG', 'HJ', 'CO', 'BTN']

/** aがbよりポストフロップで先手(OOP)かどうか。 */
export function isOopPosition(a: Position, b: Position): boolean {
  return POSTFLOP_ORDER.indexOf(a) < POSTFLOP_ORDER.indexOf(b)
}

export const SCENARIOS: Scenario[] = [...SRP_VS_BB, ...SRP_COLD_CALL, ...THREEBET_POTS]

export function getScenario(id: string): Scenario {
  const s = SCENARIOS.find((x) => x.id === id)
  if (!s) throw new Error(`Unknown GTO scenario id: ${id}`)
  return s
}

/** 実戦頻度の重みに基づくランダム抽選(設定によるフィルタ後の候補リストを渡す想定)。 */
export function pickWeightedScenario(pool: Scenario[] = SCENARIOS): Scenario {
  const total = pool.reduce((s, sc) => s + sc.weight, 0)
  let r = Math.random() * total
  for (const sc of pool) {
    r -= sc.weight
    if (r <= 0) return sc
  }
  return pool[pool.length - 1]
}
