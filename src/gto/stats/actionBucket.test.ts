// P11 Phase D-1: bucketOfのテスト。既知の全ラベル(src/ui/gto/labels.ts
// ACTION_LABEL_JA・src/ui/gto/actionColors.ts ACTION_COLORSで確認した一覧)を
// 正しく分類することと、未知ラベルでは黙って誤分類せず明示的にthrowすることを検証する。

import { describe, it, expect } from 'vitest'
import { bucketOf } from './actionBucket'
import { ACTION_LABEL_JA } from '../../ui/gto/labels'
import { ACTION_COLORS } from '../../ui/gto/actionColors'

describe('bucketOf', () => {
  it('fold → fold', () => {
    expect(bucketOf('fold')).toBe('fold')
  })

  it('check・call → passive', () => {
    expect(bucketOf('check')).toBe('passive')
    expect(bucketOf('call')).toBe('passive')
  })

  it('bet33・bet75・raise55・allin → aggressive', () => {
    expect(bucketOf('bet33')).toBe('aggressive')
    expect(bucketOf('bet75')).toBe('aggressive')
    expect(bucketOf('raise55')).toBe('aggressive')
    expect(bucketOf('allin')).toBe('aggressive')
  })

  it('未知の接頭辞(bet/raise/allin以外)はthrowする', () => {
    expect(() => bucketOf('unknown')).toThrow()
    expect(() => bucketOf('')).toThrow()
    expect(() => bucketOf('donk')).toThrow()
  })

  // labels.ts/actionColors.tsに登録されている「ラベル定数の一覧全体」を実際にgrepし、
  // bucketOfが未知ラベルとしてthrowしないことを確認する(将来ラベルが増減した際の
  // 分類漏れを検出するための回帰テスト)。
  it('ACTION_LABEL_JA・ACTION_COLORSに登録されている全ラベルがthrowせず分類できる', () => {
    const allLabels = new Set([...Object.keys(ACTION_LABEL_JA), ...Object.keys(ACTION_COLORS)])
    expect(allLabels.size).toBeGreaterThan(0)
    for (const label of allLabels) {
      expect(() => bucketOf(label)).not.toThrow()
    }
  })

  it('ACTION_LABEL_JAの全ラベルの分類結果が期待通り(fold=1件・passive=2件・aggressive=残り全部)', () => {
    const labels = Object.keys(ACTION_LABEL_JA)
    const foldLabels = labels.filter((l) => bucketOf(l) === 'fold')
    const passiveLabels = labels.filter((l) => bucketOf(l) === 'passive')
    const aggressiveLabels = labels.filter((l) => bucketOf(l) === 'aggressive')

    expect(foldLabels).toEqual(['fold'])
    expect(passiveLabels.sort()).toEqual(['call', 'check'])
    // aggressiveはbet/raise/allin系全部(現時点ではbet33, bet75, raise55, allin)
    expect(aggressiveLabels.length).toBe(labels.length - foldLabels.length - passiveLabels.length)
    for (const label of aggressiveLabels) {
      expect(label.startsWith('bet') || label.startsWith('raise') || label.startsWith('allin')).toBe(true)
    }
  })
})
