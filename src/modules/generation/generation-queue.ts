import { Queue } from "bullmq";

export const GENERATION_QUEUE_NAME = "prompt-notebook-image-generation";

export interface GenerationQueue {
  enqueue(jobId: string, maxAttempts: number): Promise<void>;
  remove(jobId: string): Promise<void>;
  close?(): Promise<void>;
}

export function redisConnection(urlValue = process.env.REDIS_URL, worker = false) {
  if (!urlValue) throw new Error("REDIS_URL is required for image generation");
  const url = new URL(urlValue);
  if (url.protocol !== "redis:" && url.protocol !== "rediss:") {
    throw new Error("REDIS_URL must use redis:// or rediss://");
  }
  const database = url.pathname && url.pathname !== "/" ? Number(url.pathname.slice(1)) : 0;
  if (!Number.isInteger(database) || database < 0) throw new Error("REDIS_URL database is invalid");
  return {
    host: url.hostname,
    port: url.port ? Number(url.port) : 6379,
    username: url.username ? decodeURIComponent(url.username) : undefined,
    password: url.password ? decodeURIComponent(url.password) : undefined,
    db: database,
    tls: url.protocol === "rediss:" ? {} : undefined,
    connectTimeout: 3_000,
    enableOfflineQueue: worker,
    maxRetriesPerRequest: worker ? null : 1,
  };
}

export class BullMqGenerationQueue implements GenerationQueue {
  private readonly queue: Queue<{ jobId: string }>;

  constructor(redisUrl = process.env.REDIS_URL) {
    this.queue = new Queue(GENERATION_QUEUE_NAME, {
      connection: redisConnection(redisUrl),
      defaultJobOptions: {
        removeOnComplete: 500,
        removeOnFail: 1_000,
      },
    });
    this.queue.on("error", (error) => {
      console.error("Generation queue error", error.name);
    });
  }

  async enqueue(jobId: string, maxAttempts: number) {
    const existing = await this.queue.getJob(jobId);
    if (existing) {
      const state = await existing.getState();
      if (["active", "waiting", "delayed", "prioritized", "waiting-children"].includes(state)) return;
      await existing.remove().catch(() => undefined);
    }
    await this.queue.add("generate", { jobId }, {
      jobId,
      attempts: maxAttempts,
      backoff: { type: "exponential", delay: 5_000 },
    });
  }

  async remove(jobId: string) {
    const job = await this.queue.getJob(jobId);
    if (!job) return;
    const state = await job.getState();
    if (state !== "active") await job.remove().catch(() => undefined);
  }

  async close() {
    await this.queue.close();
  }
}
