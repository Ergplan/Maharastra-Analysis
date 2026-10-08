import type { WorkerRequest, WorkerResponse } from '../worker/engine.worker.ts';

type Pending = { resolve: (v: WorkerResponse) => void; reject: (e: Error) => void; onProgress?: (done: number, total: number) => void };

export class EngineClient {
  private worker: Worker;
  private pending = new Map<number, Pending>();
  private seq = 0;
  constructor() {
    this.worker = new Worker(new URL('../worker/engine.worker.ts', import.meta.url), { type: 'module' });
    this.worker.onerror = (ev) => { const msg = `engine worker failed to load: ${ev.message || 'unknown error'}`; for (const [, p] of this.pending) p.reject(new Error(msg)); this.pending.clear(); };
    this.worker.onmessage = (ev: MessageEvent<WorkerResponse>) => {
      const m = ev.data; const p = this.pending.get(m.reqId); if (!p) return;
      if (m.type === 'progress') { p.onProgress?.(m.done, m.total); return; }
      this.pending.delete(m.reqId);
      if (m.type === 'error') p.reject(new Error(m.message)); else p.resolve(m);
    };
  }
  request<T extends WorkerResponse>(req: Omit<WorkerRequest, 'reqId'>, onProgress?: (d: number, t: number) => void): Promise<T> {
    const reqId = ++this.seq;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(reqId, { resolve: resolve as (v: WorkerResponse) => void, reject, onProgress });
      this.worker.postMessage({ ...req, reqId } as WorkerRequest);
    });
  }
  cancelAll(): void { for (const [, p] of this.pending) p.reject(new Error('cancelled')); this.pending.clear(); this.worker.terminate(); }
}
