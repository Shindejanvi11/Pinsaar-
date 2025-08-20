# Pinsaar - SDE - Take-Home Assignment (Complete Solution)

This repository implements a "drop later" note delivery service with:
- API to create/list/replay scheduled notes
- Worker that delivers due notes to a webhook with retries + exponential backoff
- Exactly-once semantics at the receiver via idempotency keys
- Tiny Admin page (static) to create and view notes
- Health check `/health`
- Docker Compose for one-command spin-up

## Architecture (Quick)
- **api**: Express, MongoDB (Mongoose). Endpoints for notes.
- **worker**: Node process polling Mongo for due notes & delivering them.
- **sink**: Webhook receiver with Redis-based idempotency.
- **mongo/redis**: Data stores.
- **admin**: Static HTML served by the API.

### Delivery & Idempotency
- Worker posts the note payload to the given `webhookUrl` with headers:
  - `X-Note-Id`
  - `X-Idempotency-Key = sha256(noteId + ':' + releaseAt)`
- The sink uses `SETNX` in Redis to accept each idempotency key **only once**.
- Retries with exponential backoff `[1s, 5s, 25s]`, then mark `dead`.

## Run locally (Docker)
1. Copy `.env.example` to `.env` (optional – compose uses `.env.example` defaults).
2. `docker compose up --build`
3. Open API Admin UI: http://localhost:3000 (token required; default `dev-secret-token`)

## Quick CURLs
Create a note scheduled in the past (immediate delivery):
```bash
curl -X POST http://localhost:3000/api/notes       -H "Authorization: Bearer dev-secret-token"       -H "Content-Type: application/json"       -d '{
    "title":"Hello",
    "body":"World",
    "releaseAt":"2024-01-01T00:00:00.000Z",
    "webhookUrl":"http://sink:5000/sink"
  }'
```

List notes:
```bash
curl -H "Authorization: Bearer dev-secret-token" http://localhost:3000/api/notes
```

Replay a note:
```bash
curl -X POST -H "Authorization: Bearer dev-secret-token"       http://localhost:3000/api/notes/<NOTE_ID>/replay
```

Force sink failures to observe retries by setting env:
- In `.env` set `SINK_ALWAYS_FAIL=true` and restart compose.

## Development (without Docker)
- Start MongoDB and Redis locally.
- In `api/` and `sink/` and `worker/`: `npm i` then `npm run dev`.

## Tests
- A small unit test checks the idempotency key generator.
- Run with `npm test` inside `worker/`.
