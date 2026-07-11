// P6 Step B10: ReviewDataのバージョン付きバイナリコーデック(ブックマーク保存用)。
// localStorageの容量制約(数MB)に収めるため量子化する: freqはu8(/255)、evsBbはi16
// (×100・±327.67bbクランプ)、レンジ重みは配列ごとのf32スケール+u16量子化。
// GradeResult(判定)は保存せず、decodeReview時に逆量子化ノードへgradeDecisionを
// 再適用して求める(u8量子化誤差は最大1/255≈0.004、marginal許容バンド±0.05に対し
// 十分小さいためverdictは安定する、grading.tsのGRADING_TOLERANCE_BAND参照)。
// explanation/featuresも保存しない(ReviewScreen側で開いた時に再計算する、既存の
// computeSpotFeatures/buildExplanationパイプラインをそのまま再利用できるため)。
//
// review.board は常にreview.flopの3枚+ターン/リバーで配られたカードの並びである
// (buildReview/FullHandController.getReviewの両方でこの不変条件が成り立つ)ため、
// flop自体は別途保存せずboard.slice(0,3)から逆引きする(FLOPS走査、95件なので軽量)。

import type { Card } from '../../engine/types'
import { cardKey } from '../../engine/deck'
import type { Combo } from '../../analysis/range'
import { cardFromRustId, type DecodedNode } from '../loader/binaryFormat'
import { rustIdFromCard, buildComboIndexMapFromCombos, lookupComboIndex } from '../trainer/comboIndex'
import { boardFromFlop } from '../trainer/gameFlow'
import { gradeDecision } from '../trainer/grading'
import { getScenario } from '../data/scenarios'
import { FLOPS } from '../data/flops'
import type { ReviewData, ReviewDecision, HistoryEntry, Street } from '../trainer/reviewBuilder'
import type { FlopDef } from '../types'

export const BOOKMARK_CODEC_VERSION = 1

const STREET_CODES: Record<Street, number> = { preflop: 0, flop: 1, turn: 2, river: 3 }
const STREET_FROM_CODE: Street[] = ['preflop', 'flop', 'turn', 'river']
const NO_DECISION_INDEX = 0xff

class ByteWriter {
  private bytesOut: number[] = []
  u8(v: number): void {
    this.bytesOut.push(v & 0xff)
  }
  u16(v: number): void {
    this.bytesOut.push(v & 0xff, (v >> 8) & 0xff)
  }
  i16(v: number): void {
    this.u16(v < 0 ? v + 0x10000 : v)
  }
  f32(v: number): void {
    const buf = new ArrayBuffer(4)
    new DataView(buf).setFloat32(0, v, true)
    this.bytesRaw(new Uint8Array(buf))
  }
  bytesRaw(arr: Uint8Array): void {
    for (const b of arr) this.bytesOut.push(b)
  }
  strU8(s: string): void {
    const encoded = new TextEncoder().encode(s)
    if (encoded.length > 255) throw new Error(`ByteWriter.strU8: string too long (${encoded.length} bytes): "${s}"`)
    this.u8(encoded.length)
    this.bytesRaw(encoded)
  }
  toUint8Array(): Uint8Array {
    return new Uint8Array(this.bytesOut)
  }
}

class ByteReader {
  private pos = 0
  private view: DataView
  constructor(buf: ArrayBufferLike) {
    this.view = new DataView(buf as ArrayBuffer)
  }
  u8(): number {
    const v = this.view.getUint8(this.pos)
    this.pos += 1
    return v
  }
  u16(): number {
    const v = this.view.getUint16(this.pos, true)
    this.pos += 2
    return v
  }
  i16(): number {
    const v = this.view.getInt16(this.pos, true)
    this.pos += 2
    return v
  }
  f32(): number {
    const v = this.view.getFloat32(this.pos, true)
    this.pos += 4
    return v
  }
  bytes(n: number): Uint8Array {
    const v = new Uint8Array(this.view.buffer, this.view.byteOffset + this.pos, n)
    this.pos += n
    return v
  }
  strU8(): string {
    const len = this.u8()
    return new TextDecoder().decode(this.bytes(len))
  }
}

function writeCard(w: ByteWriter, c: Card): void {
  w.u8(rustIdFromCard(c))
}
function readCard(r: ByteReader): Card {
  return cardFromRustId(r.u8())
}
function writeCombo(w: ByteWriter, c: Combo): void {
  writeCard(w, c[0])
  writeCard(w, c[1])
}
function readCombo(r: ByteReader): Combo {
  return [readCard(r), readCard(r)]
}
function writeBoard(w: ByteWriter, board: readonly Card[]): void {
  w.u8(board.length)
  for (const c of board) writeCard(w, c)
}
function readBoard(r: ByteReader): Card[] {
  const len = r.u8()
  const out: Card[] = []
  for (let i = 0; i < len; i++) out.push(readCard(r))
  return out
}

/** heroCombos/heroWeights(またはvillain側)の組を1単位として量子化する。 */
function writeRangeSnapshot(w: ByteWriter, combos: readonly Combo[], weights: readonly number[]): void {
  if (combos.length !== weights.length) throw new Error('writeRangeSnapshot: combos/weights length mismatch')
  w.u16(combos.length)
  for (const c of combos) writeCombo(w, c)
  const max = weights.reduce((m, v) => Math.max(m, v), 0)
  w.f32(max)
  for (const wt of weights) {
    const q = max > 0 ? Math.round((wt / max) * 65535) : 0
    w.u16(Math.max(0, Math.min(65535, q)))
  }
}
function readRangeSnapshot(r: ByteReader): { combos: Combo[]; weights: number[] } {
  const count = r.u16()
  const combos: Combo[] = []
  for (let i = 0; i < count; i++) combos.push(readCombo(r))
  const max = r.f32()
  const weights: number[] = []
  for (let i = 0; i < count; i++) {
    const q = r.u16()
    weights.push(max > 0 ? (q / 65535) * max : 0)
  }
  return { combos, weights }
}

const EVS_BB_SCALE = 100
const EVS_BB_CLAMP = 327.67

function writeDecodedNode(w: ByteWriter, node: DecodedNode): void {
  w.u8(node.player)
  w.u8(node.actionLabels.length)
  for (const label of node.actionLabels) w.strU8(label)
  const actionCount = node.actionLabels.length
  const handCount = actionCount > 0 ? node.freqs.length / actionCount : 0
  w.u16(handCount)
  for (let i = 0; i < node.freqs.length; i++) {
    w.u8(Math.max(0, Math.min(255, Math.round(node.freqs[i] * 255))))
  }
  for (let i = 0; i < node.evsBb.length; i++) {
    const clamped = Math.max(-EVS_BB_CLAMP, Math.min(EVS_BB_CLAMP, node.evsBb[i]))
    w.i16(Math.round(clamped * EVS_BB_SCALE))
  }
}
function readDecodedNode(r: ByteReader): DecodedNode {
  const player = r.u8() as 0 | 1
  const actionCount = r.u8()
  const actionLabels: string[] = []
  for (let i = 0; i < actionCount; i++) actionLabels.push(r.strU8())
  const handCount = r.u16()
  const total = actionCount * handCount
  const freqs = new Float32Array(total)
  for (let i = 0; i < total; i++) freqs[i] = r.u8() / 255
  const evsBb = new Float32Array(total)
  for (let i = 0; i < total; i++) evsBb[i] = r.i16() / EVS_BB_SCALE
  return { player, actionLabels, freqs, evsBb }
}

function writeHistory(w: ByteWriter, history: readonly HistoryEntry[]): void {
  w.u16(history.length)
  for (const h of history) {
    w.u8(STREET_CODES[h.street])
    w.strU8(h.position)
    w.strU8(h.label)
    w.u8(h.isUserDecision ? 1 : 0)
    w.u8(h.decisionIndex === undefined ? NO_DECISION_INDEX : h.decisionIndex)
  }
}
function readHistory(r: ByteReader): HistoryEntry[] {
  const count = r.u16()
  const out: HistoryEntry[] = []
  for (let i = 0; i < count; i++) {
    const street = STREET_FROM_CODE[r.u8()]
    const position = r.strU8()
    const label = r.strU8()
    const isUserDecision = r.u8() === 1
    const decisionIndexRaw = r.u8()
    out.push({ street, position, label, isUserDecision, decisionIndex: decisionIndexRaw === NO_DECISION_INDEX ? undefined : decisionIndexRaw })
  }
  return out
}

function writeDecision(w: ByteWriter, d: ReviewDecision): void {
  w.u8(STREET_CODES[d.street])
  w.strU8(d.nodeId)
  w.u8(d.seat)
  writeBoard(w, d.boardAtDecision)
  w.strU8(d.chosenLabel)
  w.f32(d.potBbAtDecision)
  w.f32(d.effectiveStackRemainingBb)
  w.u8(d.actionsWithAmounts.length)
  for (const a of d.actionsWithAmounts) {
    w.strU8(a.label)
    w.f32(a.amountBb)
  }
  writeDecodedNode(w, d.decodedNode)
  writeRangeSnapshot(w, d.heroCombos, d.heroWeights)
  writeRangeSnapshot(w, d.villainCombos, d.villainWeights)
  w.u8(d.responseNodes.length)
  for (const rn of d.responseNodes) {
    w.strU8(rn.forLabel)
    w.strU8(rn.nodeId)
    writeDecodedNode(w, rn.node)
  }
}

/** GradeResultは保存せず、逆量子化したdecodedNode+userComboからgradeDecisionで再計算する。 */
function readDecision(r: ByteReader, userCombo: Combo): ReviewDecision {
  const street = STREET_FROM_CODE[r.u8()] as 'flop' | 'turn' | 'river'
  const nodeId = r.strU8()
  const seat = r.u8() as 0 | 1
  const boardAtDecision = readBoard(r)
  const chosenLabel = r.strU8()
  const potBbAtDecision = r.f32()
  const effectiveStackRemainingBb = r.f32()
  const actionsCount = r.u8()
  const actionsWithAmounts: { label: string; amountBb: number }[] = []
  for (let i = 0; i < actionsCount; i++) actionsWithAmounts.push({ label: r.strU8(), amountBb: r.f32() })
  const decodedNode = readDecodedNode(r)
  const hero = readRangeSnapshot(r)
  const villain = readRangeSnapshot(r)
  const responseCount = r.u8()
  const responseNodes: ReviewDecision['responseNodes'] = []
  for (let i = 0; i < responseCount; i++) {
    const forLabel = r.strU8()
    const rNodeId = r.strU8()
    const node = readDecodedNode(r)
    responseNodes.push({ forLabel, nodeId: rNodeId, node })
  }

  const comboIdx = lookupComboIndex(buildComboIndexMapFromCombos(hero.combos), userCombo)
  const grading = gradeDecision(decodedNode, comboIdx, chosenLabel)

  return {
    street,
    nodeId,
    seat,
    boardAtDecision,
    chosenLabel,
    grading,
    potBbAtDecision,
    effectiveStackRemainingBb,
    actionsWithAmounts,
    decodedNode,
    heroCombos: hero.combos,
    heroWeights: hero.weights,
    villainCombos: villain.combos,
    villainWeights: villain.weights,
    responseNodes,
  }
}

/** board(3枚目まで)に一致するFlopDefをFLOPSから逆引きする(review.boardは常にflopの3枚で始まる)。 */
function findFlopDef(board: readonly Card[]): FlopDef {
  const flopKeys = new Set(board.slice(0, 3).map(cardKey))
  const found = FLOPS.find((f) => {
    const cards = boardFromFlop(f)
    return cards.length === flopKeys.size && cards.every((c) => flopKeys.has(cardKey(c)))
  })
  if (!found) throw new Error(`decodeReview: no matching FlopDef found for board ${board.map(cardKey).join(',')}`)
  return found
}

export function encodeReview(review: ReviewData): Uint8Array {
  const w = new ByteWriter()
  w.u8(BOOKMARK_CODEC_VERSION)
  w.strU8(review.scenario.id)
  writeBoard(w, review.board)
  writeCombo(w, review.userCombo)
  w.strU8(review.userPosition)
  w.strU8(review.botPosition)
  writeHistory(w, review.history)
  w.u8(review.decisions.length)
  for (const d of review.decisions) writeDecision(w, d)
  return w.toUint8Array()
}

export function decodeReview(bytes: Uint8Array): ReviewData {
  const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
  const r = new ByteReader(buf)
  const version = r.u8()
  if (version !== BOOKMARK_CODEC_VERSION) {
    throw new Error(`decodeReview: unsupported bookmark codec version ${version} (expected ${BOOKMARK_CODEC_VERSION})`)
  }
  const scenarioId = r.strU8()
  const scenario = getScenario(scenarioId)
  const board = readBoard(r)
  const userCombo = readCombo(r)
  const userPosition = r.strU8()
  const botPosition = r.strU8()
  const history = readHistory(r)
  const decisionsCount = r.u8()
  const decisions: ReviewDecision[] = []
  for (let i = 0; i < decisionsCount; i++) decisions.push(readDecision(r, userCombo))

  return {
    scenario,
    flop: findFlopDef(board),
    board,
    userCombo,
    userPosition,
    botPosition,
    history,
    decisions,
  }
}

export function toBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
  return btoa(binary)
}

export function fromBase64(b64: string): Uint8Array {
  const binary = atob(b64)
  const out = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i)
  return out
}
