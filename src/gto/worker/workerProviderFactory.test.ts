import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { RefineResult, SolveResultSummary } from './solverClient'

const mocks = vi.hoisted(() => ({
  solveStreet: vi.fn(),
  refineSession: vi.fn(),
  getNodes: vi.fn(),
  terminate: vi.fn(),
}))

vi.mock('./solverClient', () => ({
  SolverClient: class {
    solveStreet = mocks.solveStreet
    refineSession = mocks.refineSession
    getNodes = mocks.getNodes
    terminate = mocks.terminate
  },
}))

import { createWorkerProviderFactory } from './workerProviderFactory'
import type { Card } from '../../engine/types'
import type { Combo } from '../../analysis/range'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve
  })
  return { promise, resolve }
}

const board: Card[] = [
  { rank: 13, suit: 'c' },
  { rank: 11, suit: 'c' },
  { rank: 2, suit: 'd' },
  { rank: 10, suit: 's' },
  { rank: 4, suit: 'h' },
]
const oopCombos: Combo[] = [[{ rank: 14, suit: 'h' }, { rank: 14, suit: 's' }]]
const ipCombos: Combo[] = [[{ rank: 8, suit: 'h' }, { rank: 7, suit: 'h' }]]

describe('createWorkerProviderFactory P9-3', () => {
  beforeEach(() => vi.clearAllMocks())

  it('同じsolveIdを精密化し、progressを初期solve→idle→refine→idleと遷移させる', async () => {
    const solve = deferred<SolveResultSummary>()
    const refinement = deferred<RefineResult>()
    const cancelSolve = vi.fn()
    const cancelRefine = vi.fn()
    let solveProgress: ((iterationsRun: number, exploitability: number) => void) | undefined
    let refineProgress: ((iterationsRun: number, exploitability: number) => void) | undefined

    mocks.solveStreet.mockImplementation((_request, onProgress) => {
      solveProgress = onProgress
      return { promise: solve.promise, cancel: cancelSolve }
    })
    mocks.refineSession.mockImplementation((_solveId, _opts, onProgress) => {
      refineProgress = onProgress
      return { promise: refinement.promise, cancel: cancelRefine }
    })

    const factory = createWorkerProviderFactory()
    const provider = factory.forLiveStreet({
      street: 'river',
      board,
      oopCombos,
      oopReach: [1],
      ipCombos,
      ipReach: [1],
      potBb: 5.5,
      effectiveStackBb: 20,
      maxIterations: 20,
    })
    expect(provider.progress()).toEqual({ fraction: 0 })
    solveProgress?.(10, 0.2)
    expect(provider.progress()).toEqual({ fraction: 0.5 })

    solve.resolve({ solveId: 'solve42', iterationsRun: 20, exploitability: 0.1, gameValue: [0, 0] })
    await provider.ready
    expect(provider.progress()).toBeNull()

    const opts = { targetExploitability: 0.001, maxIterations: 100, chunkIterations: 20 }
    provider.refine(opts)
    expect(provider.progress()).toEqual({ fraction: 0.2 })
    await Promise.resolve()
    expect(mocks.refineSession).toHaveBeenCalledWith('solve42', opts, expect.any(Function))

    provider.refine(opts)
    expect(mocks.refineSession).toHaveBeenCalledTimes(1)
    refineProgress?.(60, 0.02)
    expect(provider.progress()).toEqual({ fraction: 0.6 })

    refinement.resolve({ solveId: 'solve42', iterationsRun: 80, exploitability: 0.0005 })
    await refinement.promise
    await Promise.resolve()
    expect(provider.progress()).toBeNull()

    provider.dispose()
    expect(cancelSolve).toHaveBeenCalledOnce()
    factory.dispose()
    expect(mocks.terminate).toHaveBeenCalledOnce()
  })

  it('ready前のrefineはsolveId確定後まで待機する', async () => {
    const solve = deferred<SolveResultSummary>()
    const refinement = deferred<RefineResult>()
    mocks.solveStreet.mockReturnValue({ promise: solve.promise, cancel: vi.fn() })
    mocks.refineSession.mockReturnValue({ promise: refinement.promise, cancel: vi.fn() })

    const provider = createWorkerProviderFactory().forLiveStreet({
      street: 'river',
      board,
      oopCombos,
      oopReach: [1],
      ipCombos,
      ipReach: [1],
      potBb: 5.5,
      effectiveStackBb: 20,
    })
    const opts = { targetExploitability: 0.001, maxIterations: 100, chunkIterations: 20 }
    provider.refine(opts)
    expect(mocks.refineSession).not.toHaveBeenCalled()

    solve.resolve({ solveId: 'solve-before-ready', iterationsRun: 50, exploitability: 0.1, gameValue: [0, 0] })
    await provider.ready
    await Promise.resolve()
    expect(mocks.refineSession).toHaveBeenCalledWith('solve-before-ready', opts, expect.any(Function))

    refinement.resolve({ solveId: 'solve-before-ready', iterationsRun: 100, exploitability: 0.01 })
    await refinement.promise
    await Promise.resolve()
  })
})
