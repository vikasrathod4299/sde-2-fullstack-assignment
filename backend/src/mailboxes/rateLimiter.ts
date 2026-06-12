import { redis } from '../config/redis';
import { pool } from '../config/db';
import type { RowDataPacket } from 'mysql2';


export interface Mailbox {
  id: number;
  user_id: number;
  email: string;
  daily_limit: number;
  hourly_limit: number;
}

export type LimitReason = 'daily' | 'hourly';
export type CheckResult =
  | { allowed: true }
  | { allowed: false; reason: LimitReason };

function dayKey(mailboxId: number, now = new Date()): string {
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, '0');
  const d = String(now.getUTCDate()).padStart(2, '0');
  return `rl:daily:${mailboxId}:${y}-${m}-${d}`;
}

function hourKey(mailboxId: number, now = new Date()): string {
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, '0');
  const d = String(now.getUTCDate()).padStart(2, '0');
  const h = String(now.getUTCHours()).padStart(2, '0');
  return `rl:hourly:${mailboxId}:${y}-${m}-${d}T${h}`;
}

export async function getMailbox(mailboxId: number): Promise<Mailbox | null> {
  const [rows] = await pool.execute<RowDataPacket[]>(
    'SELECT id, user_id, email, daily_limit, hourly_limit FROM mailboxes WHERE id = ?',
    [mailboxId],
  );
  return (rows[0] as Mailbox) ?? null;
}

/**
 * Check whether the mailbox can send another email right now, and if so,
 * increment the counter. Returns { allowed: false } when a limit would be
 * crossed.
 */
// TODO should this should be atomic with multi or lua script
export async function checkAndIncrement(mailboxId: number): Promise<CheckResult> {
  const mailbox = await getMailbox(mailboxId);
  if (!mailbox) return { allowed: false, reason: 'daily' };

  const dKey = dayKey(mailboxId);
  const hKey = hourKey(mailboxId);

  const dailyRaw = await redis.get(dKey);
  const hourlyRaw = await redis.get(hKey);

  const dailyCount = parseInt(dailyRaw ?? '0', 10);
  const hourlyCount = parseInt(hourlyRaw ?? '0', 10);

  if (dailyCount >= mailbox.daily_limit) return { allowed: false, reason: 'daily' };
  if (hourlyCount >= mailbox.hourly_limit) return { allowed: false, reason: 'hourly' };


  const results = await redis
    .multi()
    .incr(dKey)
    .expire(dKey, 86400)
    .incr(hKey)
    .expire(hKey, 3600)
    .exec();

  if (!results) {
    throw new Error("Failed to update rate limit counter")
  }

  const count = await redis.publish('quota-changed', String(mailboxId))
  console.log('published to', count, 'subscribers', mailboxId);

  return { allowed: true };
}

export interface QuotaSnapshot {
  mailboxId: number;
  email: string;
  daily: { used: number; limit: number };
  hourly: { used: number; limit: number };
}

export async function readQuota(mailboxId: number): Promise<QuotaSnapshot | null> {
  const mailbox = await getMailbox(mailboxId);
  if (!mailbox) return null;

  const dKey = dayKey(mailboxId);
  const hKey = hourKey(mailboxId);

  let dailyRaw = await redis.get(dKey);
  if (dailyRaw === null) {
    // Initialize the counter so subsequent reads are stable.
    await redis.set(dKey, 0);
    dailyRaw = '0';
  }
  let hourlyRaw = await redis.get(hKey);
  if (hourlyRaw === null) {
    await redis.set(hKey, 0);
    hourlyRaw = '0';
  }

  return {
    mailboxId,
    email: mailbox.email,
    daily: { used: parseInt(dailyRaw, 10), limit: mailbox.daily_limit },
    hourly: { used: parseInt(hourlyRaw, 10), limit: mailbox.hourly_limit },
  };
}

/**
 * Approximate remaining budget for a mailbox in a given window. Used by the
 * resume code path to decide how many sends to schedule "today".
 */
export async function remainingBudget(mailboxId: number): Promise<{
  daily: number;
  hourly: number;
} | null> {
  const snapshot = await readQuota(mailboxId);
  if (!snapshot) return null;
  return {
    daily: Math.max(0, snapshot.daily.limit - snapshot.daily.used),
    hourly: Math.max(0, snapshot.hourly.limit - snapshot.hourly.used),
  };
}

export async function getAllMailboxQuotasForUser(userId: number): Promise<QuotaSnapshot[]> {
  const [rows] = await pool.execute<RowDataPacket[]>(
    'SELECT id FROM mailboxes WHERE user_id = ?',
    [userId]
  )
  return Promise.all(rows.map(row => readQuota(row.id))).then((res) => res.filter((quota): quota is QuotaSnapshot => quota !== null))
}
