// P6 Step B4: StreetNodeProviderのターン/リバー(ライブソルブ)実装のうち、
// Web Worker裏付けの本番用実装。1ハンド=1 SolverClient(1 Worker)。ターン/
// リバーは同じWorkerを直列で再利用する(Worker内は常に最新1ソルブのみ保持、
// 次のsolveStreetで前のソルブは自然に上書きされる。呼び出し側は上書き前に
// 必要なノードを収穫し終えている前提)。factory.dispose()でWorkerをterminateする。

import { SolverClient } from './solverClient'
import type { DecodedNode } from '../loader/binaryFormat'
import type { NodeProviderFactory, StreetNodeProvider, StreetSolveInput } from '../trainer/nodeDataProvider'
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
        },
        (iterationsRun) => {
          latestProgress = { fraction: Math.min(1, iterationsRun / maxIterations) }
        },
      )

      const ready = handle.promise.then((summary) => {
        solveId = summary.solveId
        latestProgress = null
      })

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
        dispose: () => {
          handle.cancel()
        },
      }
    },

    dispose() {
      client.terminate()
    },
  }
}
