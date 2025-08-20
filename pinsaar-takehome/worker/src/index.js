import 'dotenv/config';
import mongoose from 'mongoose';
import pino from 'pino';
import crypto from 'crypto';

const logger = pino({ level: 'info' });

const MONGO_URL = process.env.MONGO_URL || 'mongodb://localhost:27017/pinsaar';
const MAX_RETRIES = 3;
const BACKOFF_MS = [1000, 5000, 25000];

await mongoose.connect(MONGO_URL);
logger.info('Worker connected to Mongo');

const attemptSchema = new mongoose.Schema({
  at: { type: Date, default: Date.now },
  statusCode: Number,
  ok: Boolean,
  error: String
}, { _id: false });

const noteSchema = new mongoose.Schema({
  title: String,
  body: String,
  releaseAt: String, // ISO
  webhookUrl: String,
  status: { type: String, enum: ['pending','processing','delivered','dead'], default: 'pending' },
  attempts: [attemptSchema],
  deliveredAt: Date,
  lockedAt: Date
});

noteSchema.index({ status: 1, releaseAt: 1 });

const Note = mongoose.model('Note', noteSchema);

function idemKey(note){
  return crypto.createHash('sha256').update(`${note._id}:${note.releaseAt}`).digest('hex');
}

async function deliver(note){
  const key = idemKey(note);
  const payload = { title: note.title, body: note.body, releaseAt: note.releaseAt };
  const headers = {
    'Content-Type': 'application/json',
    'X-Note-Id': String(note._id),
    'X-Idempotency-Key': key
  };
  const t0 = Date.now();
  try{
    const resp = await fetch(note.webhookUrl, { method:'POST', headers, body: JSON.stringify(payload) });
    const ms = Date.now() - t0;
    const attempt = { at: new Date(), statusCode: resp.status, ok: resp.ok, error: resp.ok ? undefined : `HTTP ${resp.status}` };
    note.attempts.push(attempt);
    if(resp.ok){
      note.status = 'delivered';
      note.deliveredAt = new Date();
      note.lockedAt = null;
      await note.save();
      logger.info({ noteId: String(note._id), ms, code: resp.status }, 'Delivered');
      return;
    }else{
      throw new Error(`Bad status ${resp.status}`);
    }
  }catch(err){
    const ms = Date.now() - t0;
    const attempt = { at: new Date(), statusCode: 0, ok: false, error: String(err?.message || err) };
    note.attempts.push(attempt);
    // compute failed attempts count
    const failures = note.attempts.filter(a => !a.ok).length;
    if(failures < MAX_RETRIES){
      const delay = BACKOFF_MS[Math.min(failures-1, BACKOFF_MS.length-1)];
      note.status = 'pending';
      note.lockedAt = null;
      note.releaseAt = new Date(Date.now() + delay).toISOString();
      await note.save();
      logger.warn({ noteId: String(note._id), ms, failures, nextInMs: delay }, 'Retry scheduled');
    }else{
      note.status = 'dead';
      note.lockedAt = null;
      await note.save();
      logger.error({ noteId: String(note._id), ms, failures }, 'Giving up (dead)');
    }
  }
}

// Claim a note atomically (avoid double-processing)
async function claimOneDue(){
  const nowIso = new Date().toISOString();
  const note = await Note.findOneAndUpdate(
    { status: 'pending', releaseAt: { $lte: nowIso } },
    { $set: { status: 'processing', lockedAt: new Date() } },
    { sort: { releaseAt: 1 }, new: true }
  );
  return note;
}

async function loop(){
  while(true){
    try{
      let processed = 0;
      while(true){
        const note = await claimOneDue();
        if(!note) break;
        await deliver(note);
        processed++;
      }
      if(processed === 0){
        await new Promise(r => setTimeout(r, 5000));
      }
    }catch(e){
      logger.error({ err: String(e) }, 'Worker loop error');
      await new Promise(r => setTimeout(r, 5000));
    }
  }
}

loop();
