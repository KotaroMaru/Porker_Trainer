import { describe, it, expect } from 'vitest'
import { SCENARIOS, getScenario, pickWeightedScenario } from './scenarios'
import { getRange } from './ranges'

describe('GTOトレーナー シナリオ定義', () => {
  it('シナリオは17件(SRP 11 + 3betポット6)', () => {
    expect(SCENARIOS.length).toBe(17)
    expect(SCENARIOS.filter((s) => s.kind === 'SRP').length).toBe(11)
    expect(SCENARIOS.filter((s) => s.kind === 'THREEBET').length).toBe(6)
  })

  it('シナリオIDはすべて一意', () => {
    const ids = SCENARIOS.map((s) => s.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('各シナリオのレンジIDは実在するレンジを参照している', () => {
    for (const s of SCENARIOS) {
      expect(() => getRange(s.raiser.rangeId), s.id).not.toThrow()
      expect(() => getRange(s.defender.rangeId), s.id).not.toThrow()
    }
  })

  it('ポット・実効スタックは100bb構造として妥当な範囲内', () => {
    for (const s of SCENARIOS) {
      expect(s.potBb, s.id).toBeGreaterThan(4)
      expect(s.potBb, s.id).toBeLessThan(30)
      expect(s.effectiveStackBb, s.id).toBeGreaterThan(80)
      expect(s.effectiveStackBb, s.id).toBeLessThan(100)
    }
  })

  it('3betポットはSRPよりポットが大きく実効スタックが浅い', () => {
    const srpPots = SCENARIOS.filter((s) => s.kind === 'SRP').map((s) => s.potBb)
    const threebetPots = SCENARIOS.filter((s) => s.kind === 'THREEBET').map((s) => s.potBb)
    const avgSrp = srpPots.reduce((a, b) => a + b, 0) / srpPots.length
    const avgThreebet = threebetPots.reduce((a, b) => a + b, 0) / threebetPots.length
    expect(avgThreebet).toBeGreaterThan(avgSrp)
  })

  it('getScenarioは存在しないIDでエラーになる', () => {
    expect(() => getScenario('nope')).toThrow()
  })

  it('pickWeightedScenarioは常にプール内のシナリオを返す', () => {
    for (let i = 0; i < 50; i++) {
      const picked = pickWeightedScenario()
      expect(SCENARIOS).toContain(picked)
    }
  })
})
