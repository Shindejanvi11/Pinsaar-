import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import mongoose from 'mongoose';
import pino from 'pino';
import path from 'path';
import { fileURLToPath } from 'url';
import { z } from 'zod';

const logger = pino({ level: 'info' });

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ENV
const PORT = process.env.API_PORT || 3000;
const MONGO_URL = process.env.MONGO_URL || 'mongodb://localhost:27017/pinsaar';
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || 'dev-secret-token';

// DB
await mongoose.connect(MONGO_URL);
logger.info('API connected to Mongo');

const attemptSchema = new mongoose.Schema({
  at: { type: Date, default: Date.now },
  statusCode: Number,
  ok: Boolean,
  error: String
}, { _id: false });

const noteSchema = new mongoose.Schema({
  title: String,
  body: String,
  releaseAt: String, // ISO string
  webhookUrl: String,
  status: { type: String, enum: ['pending','processing','delivered','dead'], default: 'pending' },
  attempts: [attemptSchema],
  deliveredAt: Date,
  lockedAt: Date
}, { timestamps: true });

noteSchema.index({ status: 1, releaseAt: 1 });
noteSchema.index({ releaseAt: 1 });

const Note = mongoose.model('Note', noteSchema);

// App
const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));

const limiter = rateLimit({ windowMs: 60_000, max: 60, standardHeaders: true, legacyHeaders: false });
app.use(limiter);

// Auth middleware
function auth(req, res, next) {
  const authz = req.headers.authorization || '';
  const token = authz.startsWith('Bearer ') ? authz.slice(7) : '';
  if (!token || token !== ADMIN_TOKEN) return res.status(401).json({ error: 'Unauthorized' });
  next();
}

// Validation schema
const createSchema = z.object({
  title: z.string().min(1),
  body: z.string().min(1),
  releaseAt: z.string().refine(v => !Number.isNaN(Date.parse(v)), 'Invalid ISO date'),
  webhookUrl: z.string().url()
});

// Routes
app.get('/health', (req, res) => res.json({ ok: true }));

app.post('/api/notes', auth, async (req, res) => {
  try {
    const data = createSchema.parse(req.body);
    const doc = await Note.create({ ...data, status: 'pending' });
    res.json({ id: String(doc._id) });
  } catch (e) {
    res.status(400).json({ error: 'Bad Request', details: String(e) });
  }
});

app.get('/api/notes', auth, async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page || '1', 10));
  const limit = 50;
  const q = {};
  if (req.query.status) q.status = req.query.status;
  const total = await Note.countDocuments(q);
  const items = await Note.find(q).sort({ createdAt: -1 }).skip((page-1)*limit).limit(limit).lean();
  res.json({ page, total, items });
});

app.post('/api/notes/:id/replay', auth, async (req, res) => {
  const id = req.params.id;
  const note = await Note.findById(id);
  if (!note) return res.status(404).json({ error: 'Not found' });
  // Reset status and set releaseAt to now for immediate replay
  note.status = 'pending';
  note.lockedAt = null;
  note.deliveredAt = null;
  note.releaseAt = new Date().toISOString();
  await note.save();
  res.json({ ok: true, id });
});

// Serve admin
app.use('/', express.static(path.join(__dirname, '..', 'public')));

app.listen(PORT, () => logger.info(`API listening on :${PORT}`));
