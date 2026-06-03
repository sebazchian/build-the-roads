# build the roads

A community bounty board funded in sats  -  a **Fedi mini app**. Neighbors pledge sats toward shared needs (trash cleanup, painting, repairs); a worker provably claims and completes the task; pledgers pay out via Lightning; and a **trust score** tracks who actually pays. It solves the free-rider problem for hyper-local public goods.

> Small pledges. Real work. Nobody forced.

## Status: MVP working (2026-06-03)

Full loop functional end-to-end: pitch → pledge → claim → proof → payment → trust score → leaderboards.

## Run

```bash
npm install
node server.js   # http://localhost:3005
```

Or install the systemd unit (`bounty.service`) for auto-restart.

## How it's a Fedi mini app

A Fedi mini app is just a website that runs inside the Fedi browser, which injects:
- `window.webln`  -  Lightning payments via the user's Fedi wallet (pledge payout).
- `window.nostr`  -  NIP-07 identity + event signing (provable pledges/claims, no passwords).
- `window.fedi`  -  ecash, user currency/language.

`public/fedi.js` wraps these with a **dev fallback** so the app also runs in a normal browser for testing (simulated payments, local test identity).

## Architecture

- **Backend:** Node `http` + `better-sqlite3`. REST API + static frontend + proof-photo uploads. Port **3005**.
- **Frontend:** framework-free ES-module SPA (`public/`). Light enough for low-end township phones.
- **Identity:** Nostr pubkey. **Trust score:** transparent, recomputable from source tables (pledger fulfillment %, worker completion %).
- **Data safety:** DB gitignored, hourly backups w/ 7-day retention, startup health validation.

## Docs

- `docs/PROJECT.md`  -  charter & MVP scope
- `docs/PRIORITIES.md`  -  guardrails
- `docs/SCHEMA.md`  -  data model + trust score algorithm
- `docs/NARRATIVE.md`  -  the "who will build the roads" / responsibility-poem literature
- `docs/BUILD_LOG.md`  -  decision log

## API (brief)

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/bounties?status=` | list bounties |
| POST | `/api/bounties` | create bounty |
| GET | `/api/bounties/:id` | bounty detail (pot, trust-weighted pot, pledges) |
| POST | `/api/bounties/:id/pledge` | pledge sats |
| POST | `/api/bounties/:id/claim` | claim bounty (worker) |
| POST | `/api/bounties/:id/proof` | submit proof (worker) |
| POST | `/api/pledges/:id/pay` | report payment (pledger) |
| GET | `/api/users/:pubkey` | trust + leaderboards |
| GET | `/api/leaderboards` | top workers + top pledgers |
| GET | `/api/pending?pubkey=` | my pending actions |
| GET | `/api/health` | service health |

## Payment Flow

1. **Worker** submits proof + Lightning address
2. **Pledger** clicks "⚡ Pay now" → WebLN resolves address → pays → preimage stored
3. **Server** verifies preimage, marks `payment_claimed`
4. **All paid?** Bounty auto-settles

## Trust Score

- **Pledger:** % of pledged sats actually paid (vs reneged)
- **Worker:** % of claimed jobs completed (vs abandoned)
- **Flags:** Pledgers can flag bad work, which hurts worker score

## License

MIT
