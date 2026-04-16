/**
 * Cola BullMQ para procesamiento asíncrono de IA.
 * - nutrition-estimate: procesa comidas con foto/audio → estima macros
 * - purge-expired-threads: purga hilos de coaching expirados
 * - cleanup-orphan-media: elimina medios huérfanos
 */

import { Queue } from "bullmq";
import { Redis } from "ioredis";
import { env } from "./env.js";

let _connection: Redis | null = null;

function getConnection(): Redis {
  if (!_connection) {
    _connection = new Redis(env.REDIS_URL, {
      maxRetriesPerRequest: null,
    });
  }
  return _connection;
}

// ─── Colas ────────────────────────────────────────────────────────────────────

export const nutritionQueue = new Queue("nutrition-estimate", {
  connection: getConnection(),
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: "exponential", delay: 2000 },
    removeOnComplete: { age: 3600 },
    removeOnFail: { age: 86400 },
  },
});

export const purgeQueue = new Queue("purge-expired", {
  connection: getConnection(),
  defaultJobOptions: {
    attempts: 2,
    backoff: { type: "fixed", delay: 5000 },
  },
});

// ─── Tipos de jobs ────────────────────────────────────────────────────────────

export interface NutritionEstimateJob {
  mealEntryId: string;
  userId: string;
  nutritionDate: string;
  mediaKeys: string[];
  hasAudio: boolean;
  hasImages: boolean;
}

export interface PurgeExpiredThreadsJob {
  cutoffDate: string;
}

export interface CleanupOrphanMediaJob {
  cutoffHours: number;
}

// ─── Helpers para encolar ─────────────────────────────────────────────────────

export async function enqueueNutritionEstimate(data: NutritionEstimateJob): Promise<string> {
  const job = await nutritionQueue.add("estimate", data);
  return job.id!;
}

export async function enqueuePurgeExpiredThreads(): Promise<string> {
  const job = await purgeQueue.add("purge-threads", {
    cutoffDate: new Date().toISOString(),
  });
  return job.id!;
}

export async function enqueueCleanupOrphanMedia(): Promise<string> {
  const job = await purgeQueue.add("cleanup-media", {
    cutoffHours: 48,
  });
  return job.id!;
}
