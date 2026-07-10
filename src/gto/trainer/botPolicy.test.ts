import { describe, it, expect } from 'vitest'
import { sampleAction } from './botPolicy'
import type { DecodedNode } from '../loader/binaryFormat'

function makeNode(actionLabels: string[], freqsPerHand: number[][]): DecodedNode {
  const handCount = freqsPerHand.length
  const freqs = new Float32Array(actionLabels.length * handCount)
  for (let h = 0; h < handCount; h++) {
    for (let a = 0; a < actionLabels.length; a++) freqs[a * handCount + h] = freqsPerHand[h][a]
  }
  return { player: 0, actionLabels, freqs, evsBb: new Float32Array(freqs.length) }
}

describe('sampleAction', () => {
  it('rng()=0は常に最初の非ゼロ頻度アクションを返す', () => {
    const node = makeNode(['check', 'bet33', 'bet75'], [[0.2, 0.3, 0.5]])
    const result = sampleAction(node, 0, () => 0)
    expect(result.label).toBe('check')
    expect(result.actionIndex).toBe(0)
  })

  it('rng()が1に近いと最後のアクションを返す', () => {
    const node = makeNode(['check', 'bet33', 'bet75'], [[0.2, 0.3, 0.5]])
    const result = sampleAction(node, 0, () => 0.9999)
    expect(result.label).toBe('bet75')
  })

  it('頻度0のアクションは選ばれない(多数回サンプル)', () => {
    const node = makeNode(['check', 'bet33'], [[0, 1.0]])
    let seed = 1
    const rng = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff
      return seed / 0x7fffffff
    }
    for (let i = 0; i < 100; i++) {
      const result = sampleAction(node, 0, rng)
      expect(result.label).toBe('bet33')
    }
  })

  it('全アクションが頻度0のコンボはエラーを投げる', () => {
    const node = makeNode(['check', 'bet33'], [[0, 0]])
    expect(() => sampleAction(node, 0, () => 0.5)).toThrow()
  })
})
