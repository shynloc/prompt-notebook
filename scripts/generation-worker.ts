import { Worker } from "bullmq";

import {
  GENERATION_QUEUE_NAME,
  redisConnection,
} from "../src/modules/generation/generation-queue";
import { GenerationService } from "../src/modules/generation/generation-service";
import { GenerationWorkerProcessor } from "../src/modules/generation/generation-worker";

const processor = new GenerationWorkerProcessor();
const service = new GenerationService();
const requestedConcurrency = Number(process.env.GENERATION_WORKER_CONCURRENCY ?? 1);
const concurrency = process.env.NODE_ENV === "production"
  ? 1
  : Math.min(Math.max(Number.isInteger(requestedConcurrency) ? requestedConcurrency : 1, 1), 4);

const worker = new Worker<{ jobId: string }>(
  GENERATION_QUEUE_NAME,
  async (job) => processor.process(job.data.jobId, {
    attempt: job.attemptsMade + 1,
    maxAttempts: typeof job.opts.attempts === "number" ? job.opts.attempts : 3,
  }),
  {
    connection: redisConnection(undefined, true),
    concurrency,
  },
);

worker.on("error", (error) => console.error("Generation worker error", error.name));
worker.on("failed", (job, error) => console.error("Generation job failed", job?.id, error.name));

let maintaining = false;
async function maintain() {
  if (maintaining) return;
  maintaining = true;
  try {
    await service.recoverStale(new Date(Date.now() - 5 * 60_000));
    await service.reconcileQueued();
  } catch (error) {
    console.error("Generation queue reconciliation failed", error instanceof Error ? error.name : "UnknownError");
  } finally {
    maintaining = false;
  }
}

await maintain();
const maintenanceTimer = setInterval(() => void maintain(), 60_000);
maintenanceTimer.unref();

let stopping = false;
async function shutdown(signal: string) {
  if (stopping) return;
  stopping = true;
  console.info("Generation worker shutting down", signal);
  clearInterval(maintenanceTimer);
  await worker.close();
  await service.close();
  process.exit(0);
}

process.once("SIGTERM", () => void shutdown("SIGTERM"));
process.once("SIGINT", () => void shutdown("SIGINT"));
