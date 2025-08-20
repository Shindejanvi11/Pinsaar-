import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import Redis from 'ioredis';
import pino from 'pino';

const logger = pino({ level: 'info' });

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
const PORT = process.env.SINK_PORT || 5000;
const ALWAYS_FAIL = (process.env.SINK_ALWAYS_FAIL || 'false').toLowerCase() === 'true';

const redis = new Redis(REDIS_URL);

const app = express();
app.use(cors());
app.use(express.json());

app.get('/health', (req, res) => res.json({ ok: true }));

app.post('/sink', async (req, res) => {
  const key = req.headers['x-idempotency-key'];
  if(!key) return res.status(400).json({ error: 'Missing X-Idempotency-Key' });

  const lock = await redis.setnx(`idem:${key}`, 1);
  if(lock === 0){
    // already processed
    logger.info({ key }, 'Duplicate received -> idempotent OK');
    return res.status(200).json({ ok: true, duplicate: true });
  }
  await redis.expire(`idem:${key}`, 24 * 3600); // 24h TTL

  if(ALWAYS_FAIL){
    logger.warn({ key, body: req.body }, 'Forced failure (ALWAYS_FAIL=true)');
    return res.status(500).json({ ok: false, forced: true });
  }

  // Simulate useful work (log the note)
  logger.info({ key, body: req.body }, 'Processed note');
  res.json({ ok: true });
});

app.listen(PORT, () => logger.info(`Sink listening on :${PORT}`));
