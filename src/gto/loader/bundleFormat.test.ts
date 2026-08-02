import { describe, expect, it } from 'vitest'
import { decodeBundleIndex, decodeBundleTurn } from './bundleFormat'

function pushU8String(bytes: number[], value: string): void {
  bytes.push(value.length, ...[...value].map(char => char.charCodeAt(0)))
}

function pushU16(bytes: number[], value: number): void {
  bytes.push(value & 0xff, (value >> 8) & 0xff)
}

function pushU32(bytes: number[], value: number): void {
  bytes.push(value & 0xff, (value >> 8) & 0xff, (value >> 16) & 0xff, (value >> 24) & 0xff)
}

function pushI16(bytes: number[], value: number): void {
  pushU16(bytes, value < 0 ? value + 0x10000 : value)
}

// export.rs::write_binaryと同じ量子化・レイアウトで、独立した最小ブロブを作る。
function buildSolutionBlob(freq: number, evBb: number, nodeId: string): Uint8Array {
  const bytes: number[] = [...'GTO1'].map(char => char.charCodeAt(0))
  bytes.push(1)
  pushU8String(bytes, 'test')
  bytes.push(0, 5, 10)
  pushU32(bytes, 55)
  pushU32(bytes, 975)
  pushU16(bytes, 1)
  bytes.push(1, 2)
  pushU16(bytes, 1)
  bytes.push(3, 4)
  pushU16(bytes, 1)
  pushU8String(bytes, nodeId)
  bytes.push(0, 1)
  pushU8String(bytes, 'check')
  pushU32(bytes, 0)
  bytes.push(Math.round(Math.min(1, Math.max(0, freq)) * 255))
  pushI16(bytes, Math.round(evBb * 100))
  return new Uint8Array(bytes)
}

function buildBundle(entries: Array<{ cardId: number; blob: Uint8Array }>): ArrayBuffer {
  const bytes: number[] = [...'GTOB'].map(char => char.charCodeAt(0))
  bytes.push(1)
  pushU8String(bytes, 'test')
  bytes.push(0, 5, 10)
  pushU8String(bytes, 'check-check')
  bytes.push(entries.length)
  let offset = 0
  for (const entry of entries) {
    bytes.push(entry.cardId)
    pushU32(bytes, offset)
    pushU32(bytes, entry.blob.length)
    offset += entry.blob.length
  }
  for (const entry of entries) bytes.push(...entry.blob)
  return new Uint8Array(bytes).buffer
}

describe('turn bundle format', () => {
  it('索引から隣接する各ブロブだけを復元し、freq/EVが量子化誤差内で一致する', () => {
    const expected = [
      { cardId: 1, cardKey: '2d', freq: 0.501, evBb: 1.234, nodeId: 'first' },
      { cardId: 2, cardKey: '2h', freq: 0.249, evBb: -4.567, nodeId: 'second' },
    ]
    const buf = buildBundle(
      expected.map(value => ({
        cardId: value.cardId,
        blob: buildSolutionBlob(value.freq, value.evBb, value.nodeId),
      })),
    )
    const index = decodeBundleIndex(buf)

    expect(index.scenarioId).toBe('test')
    expect(index.flopCardKeys).toEqual(['2c', '3d', '4h'])
    expect(index.pathId).toBe('check-check')
    for (const value of expected) {
      const entry = index.entries.get(value.cardKey)
      expect(entry).toBeDefined()
      const solution = decodeBundleTurn(buf, entry!)
      const node = solution.nodes.get(value.nodeId)
      expect(node).toBeDefined()
      expect(Math.abs(node!.freqs[0] - value.freq)).toBeLessThanOrEqual(1 / 255)
      expect(Math.abs(node!.evsBb[0] - value.evBb)).toBeLessThanOrEqual(0.01)
      expect(solution.nodes.size).toBe(1)
    }
  })

  it('offset/length境界を1バイトずらすと隣接ブロブをデコードしない', () => {
    const first = buildSolutionBlob(0.2, 1.0, 'first')
    const second = buildSolutionBlob(0.8, -1.0, 'second')
    const buf = buildBundle([
      { cardId: 1, blob: first },
      { cardId: 2, blob: second },
    ])
    const entry = decodeBundleIndex(buf).entries.get('2d')!

    expect(entry.length).toBe(first.length)
    expect(() => decodeBundleTurn(buf, { offset: entry.offset + 1, length: entry.length })).toThrow(/magic/)
  })

  it('49枚のturnCardIdが一意でフロップ3枚を含まない', () => {
    const flopIds = new Set([0, 5, 10])
    const turnIds = Array.from({ length: 52 }, (_, id) => id).filter(id => !flopIds.has(id))
    const blob = buildSolutionBlob(0.5, 0, '')
    const index = decodeBundleIndex(buildBundle(turnIds.map(cardId => ({ cardId, blob }))))

    expect(index.entries.size).toBe(49)
    expect(new Set(index.entries.keys()).size).toBe(49)
    expect(index.entries.has('2c')).toBe(false)
    expect(index.entries.has('3d')).toBe(false)
    expect(index.entries.has('4h')).toBe(false)
  })
})
