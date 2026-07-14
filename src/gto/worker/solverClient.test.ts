import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SolverClient } from './solverClient'
import type { WorkerRequest, WorkerResponse } from './protocol'

class MockWorker {
  static latest: MockWorker
  onmessage: ((event: MessageEvent<WorkerResponse>) => void) | null = null
  onerror: ((event: ErrorEvent) => void) | null = null
  posted: WorkerRequest[] = []
  terminated = false

  constructor() {
    MockWorker.latest = this
  }

  postMessage(message: WorkerRequest): void {
    this.posted.push(message)
  }

  emit(message: WorkerResponse): void {
    this.onmessage?.(new MessageEvent('message', { data: message }))
  }

  terminate(): void {
    this.terminated = true
  }
}

describe('SolverClient.refineSession', () => {
  beforeEach(() => {
    vi.stubGlobal('Worker', MockWorker)
  })

  it('進捗をrequestIdでルーティングし、doneでresolveする', async () => {
    const client = new SolverClient()
    const onProgress = vi.fn()
    const handle = client.refineSession(
      'solve42',
      { targetExploitability: 0.001, maxIterations: 500, chunkIterations: 25 },
      onProgress,
    )
    const worker = MockWorker.latest
    const request = worker.posted[0]
    expect(request).toMatchObject({
      kind: 'refineSession',
      solveId: 'solve42',
      targetExploitability: 0.001,
      maxIterations: 500,
      chunkIterations: 25,
    })
    const requestId = request.requestId

    worker.emit({ kind: 'refineProgress', requestId, solveId: 'solve42', iterationsRun: 125, exploitability: 0.02 })
    expect(onProgress).toHaveBeenCalledWith(125, 0.02)
    worker.emit({ kind: 'refineDone', requestId, solveId: 'solve42', iterationsRun: 200, exploitability: 0.009 })
    await expect(handle.promise).resolves.toEqual({ solveId: 'solve42', iterationsRun: 200, exploitability: 0.009 })
  })

  it('cancelは対象refineのrequestIdを送る', () => {
    const client = new SolverClient()
    const handle = client.refineSession('solve7', { targetExploitability: 0, maxIterations: 20, chunkIterations: 2 })
    const worker = MockWorker.latest
    const requestId = worker.posted[0].requestId
    handle.cancel()
    expect(worker.posted[1]).toEqual({ kind: 'cancel', requestId })
    client.terminate()
    void handle.promise.catch(() => undefined)
  })
})
