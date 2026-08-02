// P15 S2: tools/solver/FORMAT.md Section 7準拠のターンバンドル索引デコーダ。

import { cardKey } from '../../engine/deck'
import { cardFromRustId, decodeSolutionFile } from './binaryFormat'
import type { DecodedSolution } from './binaryFormat'

export interface BundleEntry {
  /** バンドル全体のArrayBuffer先頭からの絶対offset。 */
  offset: number
  length: number
}

export interface DecodedBundleIndex {
  scenarioId: string
  flopCardKeys: [string, string, string]
  pathId: string
  entries: Map<string, BundleEntry>
}

class BundleReader {
  private pos = 0
  private readonly view: DataView

  constructor(buf: ArrayBuffer) {
    this.view = new DataView(buf)
  }

  u8(): number {
    this.require(1)
    const value = this.view.getUint8(this.pos)
    this.pos += 1
    return value
  }

  u32(): number {
    this.require(4)
    const value = this.view.getUint32(this.pos, true)
    this.pos += 4
    return value
  }

  bytes(length: number): Uint8Array {
    this.require(length)
    const value = new Uint8Array(this.view.buffer, this.view.byteOffset + this.pos, length)
    this.pos += length
    return value
  }

  strU8(): string {
    return new TextDecoder().decode(this.bytes(this.u8()))
  }

  tell(): number {
    return this.pos
  }

  private require(length: number): void {
    if (!Number.isSafeInteger(length) || length < 0 || this.pos + length > this.view.byteLength) {
      throw new Error(`Turn bundle ended unexpectedly at byte ${this.pos}`)
    }
  }
}

interface RawEntry {
  turnCardId: number
  offset: number
  length: number
}

/** バンドルのヘッダと索引だけを解析し、各ターンの単体.bin位置を返す。 */
export function decodeBundleIndex(buf: ArrayBuffer): DecodedBundleIndex {
  const reader = new BundleReader(buf)
  const magic = new TextDecoder().decode(reader.bytes(4))
  if (magic !== 'GTOB') throw new Error(`Invalid turn bundle magic: ${magic}`)
  const version = reader.u8()
  if (version !== 1) throw new Error(`Unsupported turn bundle version: ${version}`)

  const scenarioId = reader.strU8()
  const flopCardIds = [reader.u8(), reader.u8(), reader.u8()] as const
  if (new Set(flopCardIds).size !== 3 || flopCardIds.some(id => id >= 52)) {
    throw new Error('Invalid or duplicate flop card id in turn bundle')
  }
  const flopCardKeys = flopCardIds.map(id => cardKey(cardFromRustId(id))) as [string, string, string]
  const pathId = reader.strU8()
  const turnCount = reader.u8()

  const rawEntries: RawEntry[] = []
  let previousCardId = -1
  for (let i = 0; i < turnCount; i++) {
    const turnCardId = reader.u8()
    const offset = reader.u32()
    const length = reader.u32()
    if (turnCardId >= 52 || flopCardIds.includes(turnCardId)) {
      throw new Error(`Invalid turn card id ${turnCardId}`)
    }
    if (turnCardId <= previousCardId) {
      throw new Error('Turn bundle index must contain unique ascending turn card ids')
    }
    previousCardId = turnCardId
    rawEntries.push({ turnCardId, offset, length })
  }

  const bodyStart = reader.tell()
  let expectedOffset = 0
  const entries = new Map<string, BundleEntry>()
  for (const raw of rawEntries) {
    if (raw.offset !== expectedOffset) {
      throw new Error(`Non-contiguous turn bundle offset for card ${raw.turnCardId}`)
    }
    const end = raw.offset + raw.length
    if (!Number.isSafeInteger(end) || bodyStart + end > buf.byteLength) {
      throw new Error(`Turn bundle entry for card ${raw.turnCardId} exceeds file length`)
    }
    entries.set(cardKey(cardFromRustId(raw.turnCardId)), {
      offset: bodyStart + raw.offset,
      length: raw.length,
    })
    expectedOffset = end
  }
  if (bodyStart + expectedOffset !== buf.byteLength) {
    throw new Error('Turn bundle body length does not match its index')
  }

  return { scenarioId, flopCardKeys, pathId, entries }
}

/** 索引で指定された1ターン分だけを既存の単体.binデコーダへ渡す。 */
export function decodeBundleTurn(buf: ArrayBuffer, entry: BundleEntry): DecodedSolution {
  if (
    !Number.isSafeInteger(entry.offset) ||
    !Number.isSafeInteger(entry.length) ||
    entry.offset < 0 ||
    entry.length < 0 ||
    entry.offset + entry.length > buf.byteLength
  ) {
    throw new Error('Turn bundle entry is outside the supplied buffer')
  }
  return decodeSolutionFile(buf.slice(entry.offset, entry.offset + entry.length))
}
