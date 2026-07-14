// P6 Step B4: StreetNodeProviderのターン/リバー(ライブソルブ)実装のうち、
// Worker本体と全く同じソルブ・EV抽出・ノード変換パイプラインを同期的・
// インプロセスで実行するテストシーム。fullHandFlow等のテストがWorkerなしで
// 通しモードのフローを検証するために使う(Web WorkerはVitestのjsdom環境で
// 動かせない)。solverWorker.tsの実装と処理内容を完全に一致させておくこと
// (このファイルはworker/solverWorker.tsの「生きたドキュメント」も兼ねる)。

import { createCfrSession } from '../solver/cfr'
import { extractDecisionEvs } from '../solver/nodeEvs'
import { scoreComboOnBoard } from '../solver/handEval'
import { buildTurnSubgameTree, buildStreetTree } from '../tree/actionTree'
import { buildNodeIndex, nodeDataAt } from '../worker/solutionRepo'
import { cardKey } from '../../engine/deck'
import type { CfrGame, DecisionNode } from '../solver/cfr'
import type { Combo } from '../../analysis/range'
import type { DecodedNode } from '../loader/binaryFormat'
import type { NodeProviderFactory, RefineOptions, StreetNodeProvider, StreetSolveInput } from './nodeDataProvider'
import { createPrecomputedProvider } from './precomputedProvider'

function comboCards(combo: Combo): string[] {
  return combo.map(cardKey)
}

export interface InProcessProviderFactoryOptions {
  maxIterations?: number
  targetExploitability?: number
  checkEveryIterations?: number
}

/**
 * maxIterationsを低く設定して高速化できる(既定は本番相当の500/0.5%pot)。
 *
 * P7-6a: 優先順は`opts`(このファクトリを構築したテストシーム側)が`input`
 * (fullHandFlow.ts等が渡すプレイ用/リファイン用の実値、例えばTURN_PLAY_SOLVEの
 * maxIterations:75)より**常に勝つ**。逆順だとテストが実運用の反復数をそのまま
 * 使ってしまい遅くなる/収束が粗すぎて不安定になる。テストが意図的に本番相当の
 * 値を検証したい場合はoptsを省略してinputをそのまま通す。
 */
export function createInProcessProviderFactory(opts?: InProcessProviderFactoryOptions): NodeProviderFactory {

  return {
    forFlop(solution, board) {
      return createPrecomputedProvider(solution, board)
    },

    forLiveStreet(input: StreetSolveInput): StreetNodeProvider {
      const boardKeys = input.board.map(cardKey)
      const tree =
        input.street === 'turn'
          ? buildTurnSubgameTree({ turnPotBb: input.potBb, effectiveStackBb: input.effectiveStackBb, firstToAct: 0, deadCards: input.board })
          : buildStreetTree({ potBb: input.potBb, effectiveStackBb: input.effectiveStackBb, firstToAct: 0 })

      const game: CfrGame<Combo> = {
        root: tree,
        players: [
          { hands: input.oopCombos, initialReach: input.oopReach, cards: comboCards },
          { hands: input.ipCombos, initialReach: input.ipReach, cards: comboCards },
        ],
        score: input.street === 'turn' ? scoreComboOnBoard : (combo: Combo) => scoreComboOnBoard(combo, boardKeys),
      }

      const maxIterations = opts?.maxIterations ?? input.maxIterations ?? 500
      const targetExploitability = opts?.targetExploitability ?? input.targetExploitability ?? 0.005
      const checkEvery = opts?.checkEveryIterations ?? input.checkEveryIterations ?? 50
      const session = createCfrSession(game)

      // solverWorker.handleSolveStreetと同じチェックポイント境界で進める。
      while (session.iterationsRun < maxIterations) {
        const current = session.iterationsRun
        const nextCheckpoint = Math.min(Math.ceil((current + 1) / checkEvery) * checkEvery, maxIterations)
        session.advance(nextCheckpoint - current)
        if (session.iterationsRun % checkEvery === 0 || session.iterationsRun === maxIterations) {
          const exploitability = session.measureExploitability()
          if (exploitability < targetExploitability) break
        }
      }

      const index = buildNodeIndex(tree)
      let evsCache: { iterationsRun: number; evs: Map<DecisionNode, Float32Array> } | null = null
      let latestProgress: { fraction: number } | null = null
      let refining = false

      function decisionEvs(): Map<DecisionNode, Float32Array> {
        if (evsCache?.iterationsRun === session.iterationsRun) return evsCache.evs
        const evs = extractDecisionEvs(game, (node) => session.getStrategy(node).frequencies)
        evsCache = { iterationsRun: session.iterationsRun, evs }
        return evs
      }

      function refine(refineOpts: RefineOptions): void {
        if (refining) return
        if (!Number.isInteger(refineOpts.chunkIterations) || refineOpts.chunkIterations <= 0) {
          throw new Error('refine: chunkIterations must be a positive integer')
        }
        if (!Number.isInteger(refineOpts.maxIterations) || refineOpts.maxIterations < 0) {
          throw new Error('refine: maxIterations must be a non-negative integer')
        }
        refining = true
        latestProgress = { fraction: refineOpts.maxIterations === 0 ? 1 : Math.min(1, session.iterationsRun / refineOpts.maxIterations) }
        try {
          let currentExploitability = session.measureExploitability()
          while (
            session.iterationsRun < refineOpts.maxIterations &&
            currentExploitability >= refineOpts.targetExploitability
          ) {
            session.advance(Math.min(refineOpts.chunkIterations, refineOpts.maxIterations - session.iterationsRun))
            currentExploitability = session.measureExploitability()
            latestProgress = { fraction: Math.min(1, session.iterationsRun / refineOpts.maxIterations) }
          }
        } finally {
          refining = false
          latestProgress = null
        }
      }

      return {
        street: input.street,
        board: input.board,
        oopCombos: input.oopCombos,
        ipCombos: input.ipCombos,
        ready: Promise.resolve(),
        async getNodes(nodeIds: string[]) {
          const evs = decisionEvs()
          const result = new Map<string, DecodedNode | null>()
          for (const id of nodeIds) result.set(id, nodeDataAt(index, session.getStrategy, evs, id))
          return result
        },
        progress: () => latestProgress,
        refine,
        dispose: () => {},
      }
    },

    dispose() {},
  }
}
