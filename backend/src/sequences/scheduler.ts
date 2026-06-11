import { pool } from '../config/db';
import { Queue } from 'bullmq';
import { bullConnection } from '../config/redis';
import { getSteps, getProspects, setSequenceStatus, type Step } from './service';
import type { RowDataPacket, ResultSetHeader } from 'mysql2';

export const SEND_QUEUE = 'email-send';
export const sendQueue = new Queue(SEND_QUEUE, { connection: bullConnection });

interface ScheduleOpts {
  sequenceId: number;
  /** When to start scheduling from. Defaults to now. */
  from?: Date;
  mailboxId?: number
}

interface ScheduleResult {
  scheduled: number;
  skipped: number;
}

/**
 * Schedule a sequence: for each (prospect, step) pair, create a
 * `scheduled_emails` row and enqueue a delayed BullMQ job.
 */
export async function scheduleSequence(opts: ScheduleOpts): Promise<ScheduleResult> {
  const { sequenceId, from = new Date() } = opts;

  const steps = await getSteps(sequenceId);
  const prospects = await getProspects(sequenceId);
  const mailboxId = opts.mailboxId ?? await pickMailboxForSequence(sequenceId);

  let scheduled = 0;
  let skipped = 0;

  for (const prospect of prospects) {
    if (prospect.status !== 'active') {
      skipped++;
      continue;
    }

    // Walk every step for this prospect.
    for (let i = 0; i < steps.length; i++) {
      try {
        const step = steps[i];
        const delayMs = step.delay_days * 24 * 60 * 60 * 1000;
        const scheduledAt = new Date(from.getTime() + delayMs);

        const [result] = await pool.execute<ResultSetHeader>(
          `INSERT INTO scheduled_emails
             (sequence_id, step_id, prospect_id, mailbox_id, scheduled_at, status, attempts)
           VALUES (?, ?, ?, ?, ?, 'pending', 0)`,
          [sequenceId, step.id, prospect.id, mailboxId, scheduledAt],
        );

        const delay = Math.max(0, scheduledAt.getTime() - Date.now());
        await sendQueue.add(
          'send',
          { scheduledEmailId: result.insertId },
          {
            delay,
            jobId: `se-${result.insertId}`,
            attempts: 3,
            backoff: {
              delay: 5000,
              type: "exponential"
            }
          },
        );
        scheduled++;
      } catch (err) {
        console.error(
          `[scheduler] step skipped for prospect ${prospect.id} at index ${i}:`,
          (err as Error).message,
        );
        skipped++;
      }
    }
  }

  await setSequenceStatus(sequenceId, 'active');
  return { scheduled, skipped };
}

/**
 * Resume a paused sequence: pick remaining pending emails and re-enqueue
 * them spaced by the configured step delays from "now". (This is partial —
 * candidate is expected to finish.)
 */
export async function resumeSequence(sequenceId: number): Promise<ScheduleResult> {
  // TODO(candidate): implement.
  // Hints:
  //  - SELECT pending scheduled_emails for this sequence ordered by id
  //  - bucket them by prospect; the first one in each bucket fires after
  //    step1.delay_days from now, subsequent ones cascade by their step delay
  //  - respect remainingBudget() per mailbox so we don't queue past today's quota
  void sequenceId;
  return { scheduled: 0, skipped: 0 };
}

async function pickMailboxForSequence(sequenceId: number): Promise<number> {
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT m.id
       FROM sequences s
       JOIN mailboxes m ON m.user_id = s.user_id
      WHERE s.id = ?
      ORDER BY m.id ASC
      LIMIT 1`,
    [sequenceId],
  );
  if (rows.length === 0) {
    throw new Error('no mailbox available for sequence');
  }
  return rows[0].id as number;
}

export async function cancelDelayedJobs(sequenceId: number): Promise<number> {
  const jobs = await sendQueue.getDelayed(0, 5000);
  let cancelled = 0;

  const scheduledEmails = jobs.map(job => job.data?.scheduledEmailId).filter((id): id is number => id !== undefined)
  if (scheduledEmails.length === 0) return 0;

  const placeholders = scheduledEmails.map(() => '?').join(',')

  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT id, sequence_id FROM scheduled_emails WHERE id IN (${placeholders})`,
    scheduledEmails
  )

  const sequenceMap = new Map<number, number>();

  for (const row of rows) {
    sequenceMap.set(row.id as number, row.sequence_id as number)
  }

  for (const job of jobs) {
    const seId = job.data?.scheduledemailid;
    if (seId && sequenceMap.get(seId) === sequenceId) {
      await job.remove();
      cancelled++
    }
  }
  return cancelled;
}

export function _typeBrand(): Step | undefined {
  return undefined;
}
