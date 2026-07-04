// P3 Step 4: tools/solver/FORMAT.md準拠の.binデコーダ。
// バイナリレイアウトの正典は tools/solver/FORMAT.md。

import type { Card, Suit } from '../../engine/types'
import { cardKey } from '../../engine/deck'

const RUST_SUITS: Suit[] = ['c', 'd', 'h', 's']

/** rust形式card_id(0..51)をTSのCardに変換する(FORMAT.mdセクション1)。 */
export function cardFromRustId(cardId: number): Card {
  const rustRank = Math.floor(cardId / 4)
  const suit = RUST_SUITS[cardId % 4]
  return { rank: (rustRank + 2) as Card['rank'], suit }
}

export interface DecodedNode {
  player: 0 | 1
  actionLabels: string[]
  /** action-major([action*handCount+hand])、0..1。handCountはplayerが0ならOOP、1ならIPのコンボ数。 */
  freqs: Float32Array
  /** action-major、同レイアウト。bb単位。 */
  evsBb: Float32Array
}

export interface DecodedSolution {
  scenarioId: string
  /** rust形式card_idそのまま(3枚)。表示用にはcardFromRustIdで変換する。 */
  flopCardIds: [number, number, number]
  flop: [Card, Card, Card]
  startingPotChips: number
  effectiveStackChips: number
  startingPotBb: number
  effectiveStackBb: number
  oopCombos: Combo[]
  ipCombos: Combo[]
  /** nodeId("-"連結、ルートは"") -> ノードデータ。 */
  nodes: Map<string, DecodedNode>
}

export type Combo = [Card, Card]

class ByteReader {
  private pos = 0
  private view: DataView
  constructor(buf: ArrayBuffer) {
    this.view = new DataView(buf)
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
  u32(): number {
    const v = this.view.getUint32(this.pos, true)
    this.pos += 4
    return v
  }
  i16(): number {
    const v = this.view.getInt16(this.pos, true)
    this.pos += 2
    return v
  }
  bytes(n: number): Uint8Array {
    const v = new Uint8Array(this.view.buffer, this.view.byteOffset + this.pos, n)
    this.pos += n
    return v
  }
  strU8(): string {
    const len = this.u8()
    const bytes = this.bytes(len)
    return new TextDecoder().decode(bytes)
  }
  seek(pos: number): void {
    this.pos = pos
  }
  tell(): number {
    return this.pos
  }
}

function comboFromRustPair(a: number, b: number): Combo {
  return [cardFromRustId(a), cardFromRustId(b)]
}

/** .binファイルの中身(ArrayBuffer)をデコードする。FORMAT.mdセクション4準拠。 */
export function decodeSolutionFile(buf: ArrayBuffer): DecodedSolution {
  const r = new ByteReader(buf)

  const magic = new TextDecoder().decode(r.bytes(4))
  if (magic !== 'GTO1') throw new Error(`Invalid .bin magic: ${magic}`)
  const version = r.u8()
  if (version !== 1) throw new Error(`Unsupported .bin version: ${version}`)

  const scenarioId = r.strU8()
  const flopCardIds = [r.u8(), r.u8(), r.u8()] as [number, number, number]
  const startingPotChips = r.u32()
  const effectiveStackChips = r.u32()

  const oopCount = r.u16()
  const oopCombos: Combo[] = []
  for (let i = 0; i < oopCount; i++) oopCombos.push(comboFromRustPair(r.u8(), r.u8()))
  const ipCount = r.u16()
  const ipCombos: Combo[] = []
  for (let i = 0; i < ipCount; i++) ipCombos.push(comboFromRustPair(r.u8(), r.u8()))

  interface NodeHeader {
    nodeId: string
    player: 0 | 1
    actionLabels: string[]
    dataOffset: number
  }
  const nodeCount = r.u16()
  const headers: NodeHeader[] = []
  for (let i = 0; i < nodeCount; i++) {
    const nodeId = r.strU8()
    const player = r.u8() as 0 | 1
    const actionCount = r.u8()
    const actionLabels: string[] = []
    for (let a = 0; a < actionCount; a++) actionLabels.push(r.strU8())
    const dataOffset = r.u32()
    headers.push({ nodeId, player, actionLabels, dataOffset })
  }

  const dataSectionStart = r.tell()
  const nodes = new Map<string, DecodedNode>()
  for (const h of headers) {
    const handCount = h.player === 0 ? oopCombos.length : ipCombos.length
    const n = h.actionLabels.length * handCount
    r.seek(dataSectionStart + h.dataOffset)
    const freqs = new Float32Array(n)
    for (let i = 0; i < n; i++) freqs[i] = r.u8() / 255
    const evsBb = new Float32Array(n)
    for (let i = 0; i < n; i++) evsBb[i] = r.i16() / 100
    nodes.set(h.nodeId, { player: h.player, actionLabels: h.actionLabels, freqs, evsBb })
  }

  const flop = flopCardIds.map(cardFromRustId) as [Card, Card, Card]

  return {
    scenarioId,
    flopCardIds,
    flop,
    startingPotChips,
    effectiveStackChips,
    startingPotBb: startingPotChips / 10,
    effectiveStackBb: effectiveStackChips / 10,
    oopCombos,
    ipCombos,
    nodes,
  }
}

/** デバッグ・テスト用: フロップのcardKey表現(既存TS慣習との整合確認に使う)。 */
export function flopCardKeys(sol: DecodedSolution): string[] {
  return sol.flop.map(cardKey)
}
