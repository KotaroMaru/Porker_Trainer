// P6 Step B4: StreetNodeProviderのターン/リバー(ライブソルブ)実装のうち、
// Web Worker裏付けの本番用実装。1ハンド=1 SolverClient(1 Worker)。ターン/
// リバーは同じWorkerを直列で再利用する(Worker内は常に最新1ソルブのみ保持、
// 次のsolveStreetで前のソルブは自然に上書きされる。呼び出し側は上書き前に
// 必要なノードを収穫し終えている前提)。factory.dispose()でWorkerをterminateする。

import { SolverClient } from './solverClient'
import type { DecodedNode } from '../loader/binaryFormat'
import type { NodeProviderFactory, RefineOptions, StreetNodeProvider, StreetSolveInput } from '../trainer/nodeDataProvider'
import { createPrecomputedProvider } from '../trainer/precomputedProvider'

export function createWorkerProviderFactory(): NodeProviderFactory {
  const client = new SolverClient()

  return {
    forFlop(solution, board) {
      return createPrecomputedProvider(solution, board)
    },

    forLiveStreet(input: StreetSolveInput): StreetNodeProvider {
      const maxIterations = input.maxIterations ?? 500
      let latestProgress: { fraction: number } | null = { fraction: 0 }
      let solveId: string | null = null
      let iterationsRun = 0
      let refining = false
      let cancelRefine: (() => void) | null = null
      let disposed = false

      const handle = client.solveStreet(
        {
          street: input.street,
          board: input.board,
          oopCombos: input.oopCombos,
          oopReach: input.oopReach,
          ipCombos: input.ipCombos,
          ipReach: input.ipReach,
          potBb: input.potBb,
          effectiveStackBb: input.effectiveStackBb,
          firstToAct: 0,
          maxIterations: input.maxIterations,
          targetExploitability: input.targetExploitability,
          checkEveryIterations: input.checkEveryIterations,
        },
        (nextIterationsRun) => {
          iterationsRun = nextIterationsRun
          latestProgress = { fraction: Math.min(1, nextIterationsRun / maxIterations) }
        },
      )

      const ready = handle.promise.then((summary) => {
        solveId = summary.solveId
        iterationsRun = summary.iterationsRun
        if (!refining) latestProgress = null
      })

      function refine(opts: RefineOptions): void {
        if (refining) return
        refining = true
        latestProgress = { fraction: opts.maxIterations === 0 ? 1 : Math.min(1, iterationsRun / opts.maxIterations) }

        void (async () => {
          try {
            await ready
            if (disposed) return
            if (!solveId) throw new Error('refine: solve did not complete successfully (no solveId)')
            latestProgress = { fraction: opts.maxIterations === 0 ? 1 : Math.min(1, iterationsRun / opts.maxIterations) }
            const refineHandle = client.refineSession(solveId, opts, (nextIterationsRun) => {
              iterationsRun = nextIterationsRun
              latestProgress = { fraction: Math.min(1, nextIterationsRun / opts.maxIterations) }
            })
            cancelRefine = refineHandle.cancel
            const result = await refineHandle.promise
            iterationsRun = result.iterationsRun
          } finally {
            cancelRefine = null
            refining = false
            latestProgress = null
          }
        })().catch(() => undefined)
      }

      return {
        street: input.street,
        board: input.board,
        oopCombos: input.oopCombos,
        ipCombos: input.ipCombos,
        ready,
        async getNodes(nodeIds: string[]) {
          await ready
          if (!solveId) throw new Error('getNodes: solve did not complete successfully (no solveId)')
          const record = await client.getNodes(solveId, nodeIds)
          const map = new Map<string, DecodedNode | null>()
          for (const id of nodeIds) map.set(id, record[id] ?? null)
          return map
        },
        progress: () => latestProgress,
        refine,
        dispose: () => {
          disposed = true
          cancelRefine?.()
          handle.cancel()
        },
      }
    },

    dispose() {
      client.terminate()
    },
  }
}
