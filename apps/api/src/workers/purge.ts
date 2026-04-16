import { Worker, Job } from "bullmq";
import { Redis } from "ioredis";
import { and, eq, lt, inArray, isNull } from "drizzle-orm";
import { db, schema } from "../db/index.js";
import { env } from "../lib/env.js";
import { deleteObject } from "../lib/storage.js";

export function createPurgeWorker(): Worker {
  const worker = new Worker(
    "purge-expired",
    async (job: Job) => {
      if (job.name === "purge-threads") {
        const now = new Date();
        const expiredThreads = await db.query.coachingThreads.findMany({
          where: and(
            lt(schema.coachingThreads.expiresAt, now),
            eq(schema.coachingThreads.status, "active"),
          ),
        });

        for (const thread of expiredThreads) {
          const messages = await db.query.coachingMessages.findMany({
            where: eq(schema.coachingMessages.threadId, thread.id),
          });

          for (const msg of messages) {
            if (msg.attachmentObjectKey && !msg.linkedMealEntryId) {
              try {
                await deleteObject(msg.attachmentObjectKey);
              } catch (err) {
                console.warn(`No se pudo borrar objeto ${msg.attachmentObjectKey}: ${err}`);
              }
            }
          }

          await db
            .delete(schema.coachingMessages)
            .where(eq(schema.coachingMessages.threadId, thread.id));

          await db
            .update(schema.coachingThreads)
            .set({ status: "purged" })
            .where(eq(schema.coachingThreads.id, thread.id));

          console.log(`Hilo ${thread.id} purgado`);
        }

        return { purgedThreads: expiredThreads.length };
      }

      if (job.name === "cleanup-media") {
        const cutoffDate = new Date();
        cutoffDate.setHours(cutoffDate.getHours() - 48);

        const orphanMedia = await db.query.mealMedia.findMany({
          with: { mealEntry: true },
        });

        let deletedCount = 0;
        const mediaToDelete: string[] = [];
        const entriesToDelete: string[] = [];

        for (const media of orphanMedia) {
          const entry = media.mealEntry;
          if (!entry) {
            try {
              await deleteObject(media.objectKey);
            } catch (err) {
              console.warn(`No se pudo borrar huérfano ${media.objectKey}: ${err}`);
            }
            mediaToDelete.push(media.id);
            deletedCount++;
          } else if (
            (entry.status === "draft" || entry.status === "awaiting_media") &&
            new Date(entry.createdAt) < cutoffDate
          ) {
            try {
              await deleteObject(media.objectKey);
            } catch (err) {
              console.warn(`No se pudo borrar ${media.objectKey}: ${err}`);
            }
            mediaToDelete.push(media.id);
            entriesToDelete.push(entry.id);
            deletedCount++;
          }
        }

        if (mediaToDelete.length > 0) {
          await db.delete(schema.mealMedia).where(inArray(schema.mealMedia.id, mediaToDelete));
        }

        if (entriesToDelete.length > 0) {
          await db.delete(schema.mealLogEntries).where(inArray(schema.mealLogEntries.id, entriesToDelete));
        }

        return { deletedMedia: deletedCount };
      }

      throw new Error(`Unknown job: ${job.name}`);
    },
    {
      connection: new Redis(env.REDIS_URL, { maxRetriesPerRequest: null }),
      concurrency: 1,
    },
  );

  worker.on("completed", (job: Job | undefined) => {
    if (job) console.log(`Purga completada: ${JSON.stringify(job.returnvalue)}`);
  });

  worker.on("failed", (job: Job | undefined, err: Error) => {
    console.error(`Purga falló: ${job?.name} - ${err.message}`);
  });

  return worker;
}
