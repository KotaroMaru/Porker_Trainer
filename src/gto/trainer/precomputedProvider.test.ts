/// <reference types="node" />
import { describe, it, expect, beforeAll } from 'vitest'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createPrecomputedProvider } from './precomputedProvider'
import { decodeSolutionFile, type DecodedSolution } from '../loader/binaryFormat'

describe('createPrecomputedProvider (実.binフィクスチャによる統合テスト)', () => {
  let solution: DecodedSolution

  beforeAll(async () => {
    const binPath = join(process.cwd(), 'public/gto/solutions/srp_btn_vs_bb/AsQsJs.bin')
    const buf = await readFile(binPath)
    const arrayBuf = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
    solution = decodeSolutionFile(arrayBuf)
  })

  it('street/board/combosがsolutionと一致し、readyは即座に解決済み', async () => {
    const provider = createPrecomputedProvider(solution, solution.flop)
    expect(provider.street).toBe('flop')
    expect(provider.board).toEqual(solution.flop)
    expect(provider.oopCombos).toBe(solution.oopCombos)
    expect(provider.ipCombos).toBe(solution.ipCombos)
    await provider.ready // 即resolveすることの確認(タイムアウトしない)
  })

  it('getNodesはsolution.nodesの内容をそのまま返す', async () => {
    const provider = createPrecomputedProvider(solution, solution.flop)
    const nodes = await provider.getNodes(['', 'check'])
    expect(nodes.get('')).toBe(solution.nodes.get(''))
    // 'check'が実在しないノードなら両者ともundefined→null変換後null
    const expectedCheck = solution.nodes.get('check') ?? null
    expect(nodes.get('check')).toEqual(expectedCheck)
  })

  it('存在しないnodeIdはnullを返す', async () => {
    const provider = createPrecomputedProvider(solution, solution.flop)
    const nodes = await provider.getNodes(['not-a-real-node-id'])
    expect(nodes.get('not-a-real-node-id')).toBeNull()
  })

  it('progress()は常にnull、refine()/dispose()は例外を投げない', () => {
    const provider = createPrecomputedProvider(solution, solution.flop)
    expect(provider.progress()).toBeNull()
    expect(() => provider.refine({ targetExploitability: 0, maxIterations: 200, chunkIterations: 20 })).not.toThrow()
    expect(provider.progress()).toBeNull()
    expect(() => provider.dispose()).not.toThrow()
  })
})
