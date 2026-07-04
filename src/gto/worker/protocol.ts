import type { Card } from '../../engine/types'
import type { PlayerIdx } from '../solver/cfr'

/**
 * Worker境界を越える(structured cloneされる)ためのプレーンなデータ型のみで構成する。
 * cfr.tsのCfrSolutionはgetStrategyがクロージャを持つため直接は送れず、
 * SerializedSolutionに変換してから送る(solverWorker.ts参照)。
 */

export interface SolveTurnSubgameRequest {
  kind: 'solveTurnSubgame'
  requestId: string
  /** フロップ+ターンの4枚 */
  board: Card[]
  heroCombos: [Card, Card][]
  heroReach: number[]
  villainCombos: [Card, Card][]
  villainReach: number[]
  turnPotBb: number
  effectiveStackBb: number
  firstToAct: PlayerIdx
  maxIterations?: number
  targetExploitability?: number
}

export type WorkerRequest = SolveTurnSubgameRequest | { kind: 'cancel'; requestId: string }

export interface SerializedNodeStrategy {
  actionLabels: string[]
  frequencies: number[][]
}

export interface SerializedSolution {
  iterationsRun: number
  exploitability: number
  gameValue: [number, number]
  /** nodeId(tree/nodeId.tsのbuildNodeId形式) -> その決断ノードの平均戦略 */
  strategies: Record<string, SerializedNodeStrategy>
}

export interface ProgressMessage {
  kind: 'progress'
  requestId: string
  iterationsRun: number
  exploitability: number
}

export interface ResultMessage {
  kind: 'result'
  requestId: string
  solution: SerializedSolution
  elapsedMs: number
}

export interface ErrorMessage {
  kind: 'error'
  requestId: string
  message: string
}

export type WorkerResponse = ProgressMessage | ResultMessage | ErrorMessage
