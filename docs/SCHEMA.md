# Bounty — Data Model & Trust Score

## Entities

- **users** — keyed by Nostr pubkey (hex). No passwords. Holds denormalized trust counters.
- **bounties** — a community task. Lifecycle: `open → claimed → proof_submitted → settled` (also `cancelled / expired`).
- **pledges** — one user's sats commitment to one bounty. Lifecycle: `pledged → paid` (or `reneged / refunded / expired`). Backed by a signed Nostr event (proof of intent).
- **flags** — community reports of bad work or bad pledgers (feeds trust score down).

## Bounty Lifecycle

1. `open` — accepting pledges. If `threshold_sats > 0`, not claimable until pot ≥ threshold.
2. `claimed` — a worker took it (`worker_pubkey` set, `claimed_at`).
3. `proof_submitted` — worker uploaded photo + note. Pledgers now review.
4. `settled` — all pledgers have paid or reneged; trust scores recomputed.
5. `cancelled` / `expired` — creator cancelled, or expiry passed with no claim.

## Provable Actions (Nostr-signed)

Pledges and claims are accompanied by a NIP-07 `signEvent` result. The backend stores `sig_event_id` + `sig`. This makes a pledge **provable**: "this pubkey publicly committed N sats to this bounty." Signature verification can be added (nostr-tools `verifyEvent`) — MVP stores them; verification is a fast-follow.

## Trust Score (v1)

Two independent, transparent scores. Both shown as a percentage + a human badge.

### Pledger Score — "Do they pay what they promise?"
```
fulfillment_rate = sats_paid_total / sats_pledged_total   (over settled bounties)
```
- < 3 settled pledges → badge **"New"** (no score yet, shown as neutral).
- ≥ 90% → **"Reliable"** (green)
- 60–89% → **"Mixed"** (amber)
- < 60% → **"Flaky"** (red) — workers warned to discount this pledge.

A worker deciding whether a job is "worth it" sees the **trust-weighted pot**:
```
effective_pot = Σ (pledge_amount × pledger_fulfillment_rate)
```
So a 10,000-sat pledge from a 20%-reliable user counts as ~2,000 effective sats. This is the heart of the free-rider defense.

### Worker Score — "Do they actually do the work?"
```
completion_rate = claims_completed_count / claims_made_count
flag_penalty     = flags_received (each flag dents the score)
```
- New worker → **"New"**.
- High completion, no flags → **"Trusted"**.
- Claims-and-ghosts or flagged for fake proof → score drops; community can flag.

### Recompute timing
Counters updated on settlement (pledge marked `paid`/`reneged`) and on flag creation. Denormalized on `users` for fast reads; can be recomputed from source tables anytime (audit-safe).

## Why denormalized + recomputable
Fast profile/leaderboard reads, but the source of truth is always the `pledges`/`bounties`/`flags` tables — so the scores can be rebuilt and audited (no silent corruption, per DC lesson).
