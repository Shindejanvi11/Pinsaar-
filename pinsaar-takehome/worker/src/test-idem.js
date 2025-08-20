import crypto from 'crypto';
function idemKey(noteId, releaseAt){
  return crypto.createHash('sha256').update(`${noteId}:${releaseAt}`).digest('hex');
}
const k1 = idemKey('abc123', '2025-01-01T00:00:00.000Z');
const k2 = idemKey('abc123', '2025-01-01T00:00:00.000Z');
const k3 = idemKey('abc123', '2025-01-02T00:00:00.000Z');
console.log('Same input => same key:', k1 === k2);
console.log('Different releaseAt => different key:', k1 !== k3);
