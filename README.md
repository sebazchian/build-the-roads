# my two sats ◎

A community bounty board funded in sats — a **Fedi mini app**. Neighbors pledge sats toward shared needs (trash cleanup, painting, repairs); a worker provably claims and completes the task; pledgers pay out; and a **trust score** tracks who actually pays. It solves the free-rider problem for hyper-local public goods.

> *Two sats from each of us. A whole community's worth of work.*

Built first for **Bitcoin Ekasi** (Mossel Bay, South Africa).

## Status: MVP working (2026-06-02)

Full loop functional end-to-end: pitch → pledge → claim → proof → settle → trust score → leaderboards.

## Run

```bash
npm install
node server.js   # http://localhost:3005
```

Or install the systemd unit (`mytwosats.service`) for auto-restart.

## How it's a Fedi mini app

A Fedi mini app is just a website that runs inside the Fedi browser, which injects:
- `window.webln` — Lightning payments via the user's Fedi wallet (pledge payout).
- `window.nostr` — NIP-07 identity + event signing (provable pledges/claims, no passwords).
- `window.fedi` — ecash, user currency/language.

`public/fedi.js` wraps these with a **dev fallback** so the app also runs in a normal browser for testing (simulated payments, local test identity).

## Architecture

- **Backend:** Node `http` + `better-sqlite3`. REST API + static frontend + proof-photo uploads. Port **3005**.
- **Frontend:** framework-free ES-module SPA (`public/`). Light enough for low-end township phones.
- **Identity:** Nostr pubkey. **Trust score:** transparent, recomputable from source tables (pledger fulfillment %, worker completion %).
- **Data safety:** DB gitignored, hourly backups w/ 7-day retention, startup health validation (lessons from the Direct Current data-loss postmortem).

## Docs

- `docs/PROJECT.md` — charter & MVP scope
- `docs/PRIORITIES.md` — guardrails (don't break other projects, port map, anti-derail checklist)
- `docs/SCHEMA.md` — data model + trust score algorithm
- `docs/NARRATIVE.md` — the "who will build the roads" / responsibility-poem literature
- `docs/BUILD_LOG.md` — decision log

## API (brief)

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/bounties?status=` | list bounties |
| POST | `/api/bounties` | create bounty |
| GET | `/api/bounties/:id` | bounty detail (pot, trust-weighted pot, pledges) |
| POST | `/api/bounties/:id/pledge` | pledge sats (signed) |
| POST | `/api/bounties/:id/claim` | claim task (signed) |
| POST | `/api/bounties/:id/proof` | submit proof photo + invoice |
| POST | `/api/pledges/:id/pay` | record WebLN payment |
| POST | `/api/bounties/:id/settle` | close & settle |
| POST | `/api/bounties/:id/flag` | flag bad work/pledger |
| GET | `/api/users/:pubkey` | trust profile |
| GET | `/api/leaderboards` | top workers & funders |

## Not done yet (Phase 2)

- Nostr signature **verification** server-side (currently stored, not verified)
- Pledge expiry automation
- Categories filter / geo
- Nostr DM notifications
- Localization (en/af/isiXhosa for Mossel Bay)
- Public deployment + Fedi community registration
