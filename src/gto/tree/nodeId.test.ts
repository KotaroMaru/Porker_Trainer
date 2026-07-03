import { describe, it, expect } from 'vitest'
import { rootNodeId, childNodeId, parseNodeId, buildNodeId } from './nodeId'

describe('nodeId', () => {
  it('ルートノードIDは空文字列', () => {
    expect(rootNodeId()).toBe('')
    expect(parseNodeId(rootNodeId())).toEqual([])
  })

  it('childNodeIdで積み上げた履歴をparseNodeIdで復元できる(往復)', () => {
    let id = rootNodeId()
    id = childNodeId(id, 'check')
    id = childNodeId(id, 'bet33')
    id = childNodeId(id, 'call')
    expect(parseNodeId(id)).toEqual(['check', 'bet33', 'call'])
  })

  it('buildNodeIdとparseNodeIdは互いに逆演算', () => {
    const labels = ['bet75', 'raise55', 'call']
    const id = buildNodeId(labels)
    expect(parseNodeId(id)).toEqual(labels)
  })

  it('異なる履歴は異なるIDになる', () => {
    const a = buildNodeId(['check', 'bet33'])
    const b = buildNodeId(['bet33', 'check'])
    expect(a).not.toBe(b)
  })
})
