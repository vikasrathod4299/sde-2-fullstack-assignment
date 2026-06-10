import { Worker } from 'bullmq';
import { bullConnection } from './config/redis';
import { SEND_QUEUE } from './sequences/scheduler';
import { processSendJob } from './worker/processor';
import { pool } from './config/db';

const worker = new Worker(SEND_QUEUE, processSendJob, {
  connection: bullConnection,
  concurrency: 4,
});

worker.on('completed', async (job) => {
  console.log(`[worker] job ${job.id} ok`);

});

worker.on('failed', async (job, err) => {
  console.warn(`[worker] job ${job?.id} failed: ${err.message}`);
  const isLastAttempt = job && job.attemptsMade >= (job.opts.attempts ?? 1)
  if (isLastAttempt) {
    await pool.execute(
      "UPDATE scheduled_emails SET status='failed', last_error=? WHERE id=?",
      [err.message, job.data.scheduledEmailId],
    );
  } else {
    console.log(`[worker] job ${job?.id} re-trying: attempt - ${job?.opts.attempts}`)
  }
});

console.log('[worker] listening on queue', SEND_QUEUE);
