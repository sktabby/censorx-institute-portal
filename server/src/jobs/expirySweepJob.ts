import cron, { type ScheduledTask } from "node-cron";
import { env } from "../config/env";
import { logger } from "../config/logger";
import { runExpirySweep } from "../services/expirySweepService";
import { runBatchNotifications } from "../services/notificationService";

let task: ScheduledTask | null = null;
/** Guards against a slow sweep overlapping the next scheduled tick. */
let running = false;

async function executeSweep(trigger: "cron" | "boot") {
  if (running) {
    logger.warn({ trigger }, "Expiry sweep already in progress; skipping this tick");
    return;
  }

  running = true;
  try {
    const result = await runExpirySweep();
    // `running` is cleared after the notifications step below.
    // Only log at info when the sweep actually changed something, so a healthy
    // converged system stays quiet.
    if (result.writes > 0) {
      logger.info({ trigger, ...result }, "Expiry sweep applied updates");
    } else {
      logger.debug({ trigger, durationMs: result.durationMs }, "Expiry sweep found nothing to expire");
    }
  } catch (err) {
    // Never let a sweep failure take the process down: read-time projection
    // still returns correct statuses until the next successful run.
    logger.error({ err, trigger }, "Expiry sweep failed");
  }

  // Batch notices run after the sweep on the same tick: "ends in N days" and "has ended".
  if (env.BATCH_NOTIFICATIONS_ENABLED) {
    try {
      const notified = await runBatchNotifications();
      const changed =
        notified.remindersCreated +
        notified.reminderEmailsSent +
        notified.endedNoticesCreated +
        notified.endedEmailsSent +
        notified.paymentRemindersSent;
      if (changed > 0 || notified.emailFailures > 0) {
        logger.info({ trigger, ...notified }, "Batch notifications sent");
      } else {
        logger.debug({ trigger, durationMs: notified.durationMs }, "Batch notifications found nothing to send");
      }
    } catch (err) {
      logger.error({ err, trigger }, "Batch notifications failed");
    }
  }

  running = false;
}

/**
 * Starts the scheduled expiry sweep. Called from server.ts only — importing
 * the Express app (as route tests do) must not start background timers.
 */
export function startExpirySweepJob(): ScheduledTask | null {
  if (!env.EXPIRY_SWEEP_ENABLED) {
    logger.info("Expiry sweep is disabled (EXPIRY_SWEEP_ENABLED=false)");
    return null;
  }

  if (!cron.validate(env.EXPIRY_SWEEP_CRON)) {
    logger.error(
      { cronExpression: env.EXPIRY_SWEEP_CRON },
      "Invalid EXPIRY_SWEEP_CRON expression; expiry sweep not scheduled"
    );
    return null;
  }

  task = cron.schedule(env.EXPIRY_SWEEP_CRON, () => void executeSweep("cron"));
  logger.info({ cronExpression: env.EXPIRY_SWEEP_CRON }, "Expiry sweep scheduled");

  if (env.EXPIRY_SWEEP_RUN_ON_BOOT) {
    void executeSweep("boot");
  }

  return task;
}

export function stopExpirySweepJob() {
  task?.stop();
  task = null;
}
