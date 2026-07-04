import type { SolveTurnSubgameRequest, WorkerResponse, SerializedSolution } from './protocol'

export type { SerializedSolution } from './protocol'

let requestCounter = 0
function nextRequestId(): string {
  requestCounter += 1
  return `req${requestCounter}`
}

export interface SolveHandle {
  /** 解が完成するかキャンセルされるとresolve/rejectするPromise。 */
  promise: Promise<SerializedSolution>
  /** ソルブを中断する(Workerにキャンセルを通知し、途中経過を破棄する)。 */
  cancel: () => void
}

/**
 * ターン部分ゲームソルバーをWeb Worker上で動かすクライアント。
 * ハンド終了時にterminate()でWorkerごと破棄することを想定している
 * (P1計画の前提: 1ハンドごとにメモリを解放する)。
 */
export class SolverClient {
  private worker: Worker
  private pending = new Map<string, {
    resolve: (s: SerializedSolution) => void
    reject: (err: Error) => void
    onProgress?: (iterationsRun: number, exploitability: number) => void
  }>()

  constructor() {
    this.worker = new Worker(new URL('./solverWorker.ts', import.meta.url), { type: 'module' })
    this.worker.onmessage = (ev: MessageEvent<WorkerResponse>) => this.handleMessage(ev.data)
    this.worker.onerror = (ev) => {
      // 特定のrequestIdに紐づかない致命的エラー(構文エラー等)。全pendingをreject。
      for (const [, p] of this.pending) p.reject(new Error(ev.message))
      this.pending.clear()
    }
  }

  private handleMessage(msg: WorkerResponse) {
    const pending = this.pending.get(msg.requestId)
    if (!pending) return
    if (msg.kind === 'progress') {
      pending.onProgress?.(msg.iterationsRun, msg.exploitability)
      return
    }
    if (msg.kind === 'result') {
      this.pending.delete(msg.requestId)
      pending.resolve(msg.solution)
      return
    }
    // error
    this.pending.delete(msg.requestId)
    pending.reject(new Error(msg.message))
  }

  solveTurnSubgame(
    request: Omit<SolveTurnSubgameRequest, 'kind' | 'requestId'>,
    onProgress?: (iterationsRun: number, exploitability: number) => void,
  ): SolveHandle {
    const requestId = nextRequestId()
    const promise = new Promise<SerializedSolution>((resolve, reject) => {
      this.pending.set(requestId, { resolve, reject, onProgress })
    })
    this.worker.postMessage({ ...request, kind: 'solveTurnSubgame', requestId } satisfies SolveTurnSubgameRequest)
    const cancel = () => {
      this.worker.postMessage({ kind: 'cancel', requestId })
    }
    return { promise, cancel }
  }

  /** Workerを破棄する(メモリ解放)。ハンド終了時に呼ぶこと。 */
  terminate() {
    this.worker.terminate()
    for (const [, p] of this.pending) p.reject(new Error('SolverClient terminated'))
    this.pending.clear()
  }
}
