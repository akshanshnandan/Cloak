import path from 'node:path';
import { env, pipeline } from '@huggingface/transformers';
import type { ModelStatus } from './types.ts';

export const MODEL = 'Xenova/all-MiniLM-L6-v2';
export class SemanticModel {
  status: ModelStatus = { phase: 'idle', message: 'Local model is waiting to start', progress: 0 };
  private extractor: any;
  private loading?: Promise<void>;
  private cache = new Map<string, number[]>();
  private queue = Promise.resolve();
  constructor(cacheDirectory: string, private changed: () => void = () => {}) {
    env.cacheDir = path.resolve(cacheDirectory);
    env.allowLocalModels = false;
  }
  private update(status: Partial<ModelStatus>) { Object.assign(this.status, status); this.changed(); }
  load(): Promise<void> {
    if (this.extractor) return Promise.resolve();
    if (this.loading) return this.loading;
    this.update({ phase: 'loading', message: 'Loading quantized MiniLM · first run downloads weights', progress: 0 });
    this.loading = (async () => {
      try {
        this.extractor = await pipeline('feature-extraction', MODEL, {
          dtype: 'q8', device: 'cpu',
          progress_callback: (event: any) => {
            if (event.status === 'progress' && event.file?.endsWith('.onnx') && Math.round(event.progress) !== this.status.progress) this.update({ progress: Math.round(event.progress), message: 'Downloading local model weights' });
          }
        });
        this.update({ phase: 'ready', message: 'MiniLM is running locally on your CPU', progress: 100 });
      } catch (error) {
        this.update({ phase: 'error', message: `Model failed to load: ${error instanceof Error ? error.message : error}`, progress: 0 });
        throw error;
      } finally { this.loading = undefined; }
    })();
    return this.loading;
  }
  async embed(texts: string[]): Promise<number[][]> {
    await this.load();
    const task = this.queue.then(async () => {
      const missing = [...new Set(texts.filter(t => !this.cache.has(t)))];
      for (let i = 0; i < missing.length; i += 16) {
        const batch = missing.slice(i, i + 16);
        const output = await this.extractor(batch, { pooling: 'mean', normalize: true });
        const vectors = output.tolist() as number[][];
        batch.forEach((t, j) => this.cache.set(t, vectors[j]));
      }
      const result = texts.map(t => this.cache.get(t)!);
      if (this.cache.size > 3000) this.cache.clear();
      return result;
    });
    this.queue = task.then(() => {}, () => {});
    return task;
  }
}
export function cosine(a: number[], b: number[]) { return a.reduce((sum, value, i) => sum + value * b[i], 0); }
