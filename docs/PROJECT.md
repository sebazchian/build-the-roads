# Bounty — Project Charter

**Status:** Active (started 2026-06-02)
**Owner:** Jason
**Builder:** Sebastian (AI agent)
**Working name:** "Bounty" (candidates: everybody's job / you will build the roads / nobody's jobs / Bounty)

---

## One-Line Pitch

A community bounty board where neighbors pledge sats toward shared needs (trash cleanup, painting, repairs), a worker provably claims and completes the task, pledgers pay out, and a **trust score** tracks who actually pays — solving the free-rider problem for hyper-local public goods.

## The Mission Alignment

- **Bitcoin as freedom money** — coordinating real community labor with sats, no banks, no middlemen.
- **Financial inclusion** — built first for Bitcoin Ekasi (Mossel Bay, SA township). Must feel native and exciting to that community.
- **Honest work that helps people** — this rewards people for doing real, visible good in their neighborhood.

## Target Platform

**Fedi Mini App** (fedi.xyz). Technical reality (confirmed from Fedi docs 2026-06-02):
- A Mini App is **just a website** that runs inside Fedi's built-in browser. No SDK to install.
- Three injected JS objects when running inside Fedi:
  - `window.webln` — Lightning pay/invoice via user's Fedi wallet (WebLN spec). Methods: `enable()`, `makeInvoice({amount, defaultMemo})`, `sendPayment(bolt11)`, `getInfo()`. NOTE: `signMessage` is NOT supported.
  - `window.nostr` — NIP-07: `getPublicKey()`, `signEvent(event)`, encrypt/decrypt. This is our **identity + provable-action** layer.
  - `window.fedi` — ecash generate/receive, user currency, language.
- Every money/signing action shows a Fedi confirmation screen. User is always in control.
- App must degrade gracefully in a normal browser (for dev/testing) when these objects are absent.

## Core User Flow

1. **Pitch** — User posts a bounty ("Clean trash around the community center").
2. **Pledge** — Others commit sats to the pot (signed Nostr event = provable pledge).
3. **Threshold** — Task becomes claimable once pot crosses an (optional) all-or-nothing threshold.
4. **Claim** — A worker taps "I'll do this." Task → In Progress. (signed Nostr event)
5. **Proof** — Worker uploads photo proof of completion.
6. **Settlement** — Pledgers review proof; each pays their pledge via one-click WebLN `sendPayment`.
7. **Trust Score** — App records who paid vs. who flaked. Two-sided:
   - **Pledger score** = pledge fulfillment rate (did they pay what they promised?).
   - **Worker score** = completion quality / no fake proofs.

## Why Trust Score (not escrow) for MVP

Escrow is technically complex and adds friction. Fedi communities are built on **pre-existing social trust** (a neighborhood). A reputation layer is the right MVP:
- High pledger score → workers trust the pledge is good for the money.
- Low score → workers discount that pledge when deciding if a job is worth it.
- This is a *social* solution that fits a real, bounded community — exactly Bitcoin Ekasi's situation.

## Solving the Two Classic Problems

- **Payment Risk** → Trust Score (reputation, not cryptographic escrow, for MVP).
- **Oracle Problem** ("did they do it?") → Decentralized human verification. Worker posts photo proof; pledgers individually decide to pay. Bad work → pledgers refuse/flag.

## Feature Set

**MVP (must-have):**
- Pitch / list / view bounties
- Pledge sats (signed)
- Claim a task (signed)
- Photo proof upload
- Per-pledger one-click payout (WebLN)
- Trust scores (pledger + worker), visible on profiles & pledges
- Nostr-pubkey identity (no passwords)
- Graceful degradation outside Fedi

**Phase 2 (nice-to-have):**
- All-or-nothing thresholds
- Pledge time limits (expire after N days if unclaimed)
- Leaderboards (top workers / top benefactors)
- Categories & local geo filtering
- Notifications via Nostr DMs

## Narrative / Literature (deliverable)

Strong written material on:
- How this solves the **"who will build the roads?"** problem (the classic objection that without coercive taxation, public goods go unfunded). Answer: voluntary, transparent, micro-coordinated sats pledges + reputation.
- The **"responsibility poem"** ("Everybody, Somebody, Anybody, Nobody") — and how Bounty adds a missing element: it turns diffuse responsibility into a concrete, funded, claimable task. A **symbiotic loop** between community *needs* and community *service*.

## Success Definition

Someone from Bitcoin Ekasi opens it in Fedi and thinks: "Yes — I would use this to get my street cleaned / earn sats helping my neighbors."
