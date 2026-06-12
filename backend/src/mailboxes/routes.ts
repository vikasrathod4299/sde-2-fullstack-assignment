import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../config/db';
import { requireAuth, AuthedRequest } from '../auth/middleware';
import { getAllMailboxQuotasForUser, readQuota } from './rateLimiter';
import type { RowDataPacket, ResultSetHeader } from 'mysql2';
import jwt from 'jsonwebtoken'
import { env } from '../config/env';
import { redis } from '../config/redis';

const router = Router();

router.get('/quota/stream', async (req, res) => {
  const token = req.query.token as string;
  if (!token) return res.status(401).end();

  try {
    const payload = jwt.verify(token, env.jwtSecret) as { sub: number | undefined };
    if (!payload.sub) return res.status(401).end()

    const userId = payload.sub;

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const sendSnapshot = async () => {
      const quotas = await getAllMailboxQuotasForUser(userId);
      res.write(`data: ${JSON.stringify(quotas)}\n\n`);
    };

    await sendSnapshot();

    const subscriber = redis.duplicate();

    await subscriber.subscribe('quota-changed');

    subscriber.on('message', async (channel, _) => {
      if (channel === 'quota-changed') await sendSnapshot();
    });

    req.on('close', async () => {
      await subscriber.unsubscribe('quota-changed');
      subscriber.disconnect();
    })
  } catch (err) {
    console.log(err)
    return res.status(401).end();
  }

});

router.use(requireAuth);

router.get('/', async (req: AuthedRequest, res) => {
  const [rows] = await pool.execute<RowDataPacket[]>(
    'SELECT id, email, daily_limit, hourly_limit, created_at FROM mailboxes WHERE user_id = ? ORDER BY id',
    [req.userId!],
  );
  res.json(rows);
});

const createSchema = z.object({
  email: z.string().email(),
  daily_limit: z.number().int().positive().optional(),
  hourly_limit: z.number().int().positive().optional(),
});

router.post('/', async (req: AuthedRequest, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'invalid_input' });
  const { email, daily_limit, hourly_limit } = parsed.data;
  const [result] = await pool.execute<ResultSetHeader>(
    'INSERT INTO mailboxes (user_id, email, daily_limit, hourly_limit) VALUES (?, ?, ?, ?)',
    [req.userId!, email, daily_limit ?? 100, hourly_limit ?? 10],
  );
  res.status(201).json({ id: result.insertId });
});

router.get('/:id/quota', async (req: AuthedRequest, res) => {
  const id = Number(req.params.id);
  const [rows] = await pool.execute<RowDataPacket[]>(
    'SELECT id FROM mailboxes WHERE id = ? AND user_id = ? LIMIT 1',
    [id, req.userId!],
  );
  if (rows.length === 0) return res.status(404).json({ error: 'not_found' });
  const snapshot = await readQuota(id);
  if (!snapshot) return res.status(404).json({ error: 'not_found' });
  res.json(snapshot);
});

export default router;
