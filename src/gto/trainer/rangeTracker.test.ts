import { describe, it, expect } from 'vitest'
import { updateRangeWeights, RANGE_TRACKER_EPSILON } from './rangeTracker'

describe('updateRangeWeights', () => {
  it('手計算: 均等な初期重み+アクション頻度[0.8,0.2]で更新すると比率通りに偏る', () => {
    // 初期重み[0.5, 0.5]、観測アクションの頻度[0.8, 0.2]
    // 更新後(正規化前): [0.5*0.8, 0.5*0.2] = [0.4, 0.1]、合計0.5
    // 正規化後: [0.8, 0.2]
    const result = updateRangeWeights([0.5, 0.5], [0.8, 0.2])
    expect(result[0]).toBeCloseTo(0.8, 6)
    expect(result[1]).toBeCloseTo(0.2, 6)
  })

  it('頻度0のコンボもεフロア(0.005)でレンジに残る(完全には0にならない)', () => {
    const result = updateRangeWeights([1, 1], [1.0, 0])
    // 更新後(正規化前): [1*1.0, 1*0.005] = [1.0, 0.005]、合計1.005
    expect(result[1]).toBeCloseTo(0.005 / 1.005, 6)
    expect(result[1]).toBeGreaterThan(0)
  })

  it('結果は常に合計1に正規化される', () => {
    const result = updateRangeWeights([0.3, 0.5, 0.2], [0.1, 0.9, 0.4])
    const sum = result.reduce((a, b) => a + b, 0)
    expect(sum).toBeCloseTo(1, 6)
  })

  it('長さが一致しない場合はエラー', () => {
    expect(() => updateRangeWeights([1, 2], [1])).toThrow()
  })

  it('イプシロン定数は仕様通り0.005', () => {
    expect(RANGE_TRACKER_EPSILON).toBe(0.005)
  })
})
