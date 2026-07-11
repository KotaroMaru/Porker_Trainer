// P6 Step B4: StreetNodeProviderのフロップ(事前計算)実装。DecodedSolutionを
// そのままラップするだけの薄い同期実装。

import type { Card } from '../../engine/types'
import type { DecodedNode, DecodedSolution } from '../loader/binaryFormat'
import type { StreetNodeProvider } from './nodeDataProvider'

export function createPrecomputedProvider(solution: DecodedSolution, board: Card[]): StreetNodeProvider {
  return {
    street: 'flop',
    board,
    oopCombos: solution.oopCombos,
    ipCombos: solution.ipCombos,
    ready: Promise.resolve(),
    async getNodes(nodeIds: string[]) {
      const result = new Map<string, DecodedNode | null>()
      for (const id of nodeIds) result.set(id, solution.nodes.get(id) ?? null)
      return result
    },
    progress: () => null,
    dispose: () => {},
  }
}
