import { describe, it, expect } from 'vitest'
import { gradeDecision, CORRECT_FREQ_ABS_THRESHOLD, CORRECT_FREQ_REL_THRESHOLD } from './grading'
import type { DecodedNode } from '../loader/binaryFormat'

function makeNode(actionLabels: string[], freqsPerHand: number[][], evsPerHand: number[][]): DecodedNode {
  const handCount = freqsPerHand.length
  const freqs = new Float32Array(actionLabels.length * handCount)
  const evsBb = new Float32Array(actionLabels.length * handCount)
  for (let h = 0; h < handCount; h++) {
    for (let a = 0; a < actionLabels.length; a++) {
      freqs[a * handCount + h] = freqsPerHand[h][a]
      evsBb[a * handCount + h] = evsPerHand[h][a]
    }
  }
  return { player: 0, actionLabels, freqs, evsBb }
}

describe('gradeDecision', () => {
  it('最頻度アクションを選べば常に正解(EVロス0)', () => {
    const node = makeNode(['check', 'bet33'], [[0.2, 0.8]], [[1.0, 2.0]])
    const result = gradeDecision(node, 0, 'bet33')
    expect(result.correct).toBe(true)
    expect(result.evLossBb).toBeCloseTo(0, 6)
    expect(result.bestLabel).toBe('bet33')
  })

  it('絶対閾値(0.15)未満の頻度は最頻度に対する比率が高くても不正解', () => {
    // 最頻度0.9のとき相対閾値=0.25*0.9=0.225 > 絶対閾値0.15なので、相対閾値が支配的
    // ここでは選択したアクションの頻度を0.1にして両閾値未満にする
    const node = makeNode(['check', 'bet33'], [[0.1, 0.9]], [[1.0, 2.0]])
    const result = gradeDecision(node, 0, 'check')
    expect(result.correct).toBe(false)
    expect(result.evLossBb).toBeCloseTo(1.0, 6) // best(2.0) - chosen(1.0)
  })

  it('相対閾値(最頻度×0.25)ちょうどの境界で正解になる', () => {
    // 最頻度0.4 → 相対閾値0.1 < 絶対閾値0.15 なので絶対閾値0.15が支配的
    const node = makeNode(['check', 'bet33', 'bet75'], [[0.4, 0.15, 0.45]], [[1.0, 1.5, 2.0]])
    const result = gradeDecision(node, 0, 'bet33')
    expect(result.correct).toBe(true) // ちょうど0.15 >= max(0.15, 0.25*0.45=0.1125)
  })

  it('混合戦略で複数アクションが頻度を持つ場合、最頻度以外を選んでも閾値以上なら正解', () => {
    const node = makeNode(['check', 'bet33'], [[0.4, 0.6]], [[1.0, 1.2]])
    const result = gradeDecision(node, 0, 'check')
    // 相対閾値 = 0.25*0.6 = 0.15 = 絶対閾値と同じ。0.4 >= 0.15 なので正解
    expect(result.correct).toBe(true)
    expect(result.evLossBb).toBeCloseTo(0.2, 6)
  })

  it('存在しないアクションラベルはエラーを投げる', () => {
    const node = makeNode(['check', 'bet33'], [[0.5, 0.5]], [[1.0, 1.0]])
    expect(() => gradeDecision(node, 0, 'raise55')).toThrow()
  })

  it('閾値定数が仕様通り(絶対0.15・相対0.25)', () => {
    expect(CORRECT_FREQ_ABS_THRESHOLD).toBe(0.15)
    expect(CORRECT_FREQ_REL_THRESHOLD).toBe(0.25)
  })
})
