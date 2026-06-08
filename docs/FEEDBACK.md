# External Feedback — build the roads

> Received: 2026-06-08
> Reviewer: fellow developer; tested with two browsers, two dev tokens, inspected URLs, reviewed the Nostr layer
> Tone: warm, constructive, high-effort.

---

## Summary of Reviewer Points

| # | Topic | Category | Priority |
|---|-------|----------|----------|
| 1 | **Escrow & Locking Funds** — Why not Lightning hold invoices? | Architecture | High (discuss) |
| 2 | **Two-Step Pledge Friction** — "Make it easy to give you money" | UX | High |
| 3 | **Clean URLs** — `/b/<id>` instead of `/?community=X#/b/<id>` | Technical | Done |
| 4 | **Dev Tokens Not Persisted** — Reload = logged out | Technical | Done |
| 5 | **No Live Sync** — Two browsers don't auto-update | Technical | Medium |
| 6 | **Nostr Event Notifications** — Are pledgers notified on proof? | Technical | Medium |
| 7 | **Single-Owner Coordination** — Poster should manage/vet/approve | Product | High |
| 8 | **Phased Bounties** + **Different Service Providers** | Product | Medium (Phase 2) |
| 9 | **Tendering / Inverted Pricing** — Worker sets price, not fixed bounty | Product | Medium (Phase 2) |

---

## 1. Escrow & Lightning Hold Invoices

**Reviewer argues:** Using hold invoices eliminates two problems at once:
1. **Flaky pledgers** — Someone pledges, work gets done, then they ghost. Social pressure helps, but formal lock is better.
2. **Pledger friction** — The two-step "pledge now, pay later" flow means people have to interact with the app *twice*. Just paying sats immediately with a hold invoice is far easier for the user.

**Reviewer quote:** 
> "Someone once taught me to make it as easy as possible for customers to give you their money. The same applies to pledges here."

**Jason's position:** Reputation-based, no escrow, no custody. But if escrow is ever adopted, it must be **Lightning hold invoices** (not a custodial payment hold).

**Our assessment:** Hold invoices would solve the flaky-pledger problem **without introducing custody**. Funds are locked but not held by build the roads. When the job is done, the hold is released to the worker. If not, it unlocks and the pledger gets it back automatically. 

The tradeoffs:
- **For:** Solves flaky pledgers. Kills two-step UX. No custody.
- **Against:** Requires the pledgers' wallets to support hold invoices (Spotty support — not all mobile wallets do). Locks a user's liquidity for the full job duration (days/weeks). Makes the "poster approves/renews" flow more complex.

**Decision**: Not in Phase 1. Logged for Phase 2 — if and when adoption pressure demands it, build Lightning hold invoice support. Keep reputation as the default.

---

## 2. Two-step Pledge / Friction

**Reviewer argues:** The current flow creates unnecessary friction — pledge now, come back later, notice notification, return, pay. Many people will miss the notification or simply not bother.

**Our assessment:** They're right. This is the weakest UX in the app. Even without hold invoices, there are ways to reduce friction:

**Quick wins (Phase 1):**
- **Nostr event notifications** (#6 below) — every action publishes a Nostr event, so pledgers see it in their Fedi feed.
- **Push-style badge on To-do** — already exists (action-alert). Expand this to more channels.
- **Auto-refresh / live sync** (#5) — so a pledge on one browser instantly shows on the other.

**Medium (Phase 2):**
- **QR code at work-site** — pay sats while standing at the completed project.
- **"Remind me" buttons** — one-click 24h reminder notification.

---

## 3. Clean URLs

**Reviewer argues:** URL structure is fragile: `/?community=mountain#/b/<id>`. The hash fragment (`#`) is semantically overloaded — browsers use it for in-page anchors, some clients strip it.

**Suggested:** `https://buildtheroads.sebaszchian.xyz/b/<id>`

**Status:** ✅ Fixed 2026-06-08.
- Hash routing (`#/b/<id>`) replaced with History API (`pushState`/`popstate`).
- All `go()` calls now update `location.pathname` instead of `location.hash`.
- Server-side `serveStatic` already serves `index.html` for all non-API paths — `/b/<id>` refreshes work.
- Community ID now comes from localStorage/`m2s_community` or persisted query param.

---

## 4. Dev Tokens Not Persisted

**Reviewer argues:** Dev keys aren't stored in the browser. Reload loses the dev session, which makes multi-browser testing harder.

**Status:** ✅ Fixed 2026-06-08.
- Dev keys are already persisted to `localStorage` in `fedi.js` (`LS_KEY`), but `app.js` boot didn't reload them.
- Boot now loads stored dev key first: `localStorage.getItem('***')` → sets `ME` and `MENAME` → then tries real wallet if no dev key.
- Note: The `LS_KEY` is literally the string `***` (declared in `fedi.js`). This works because localStorage keys can be any string.

---

## 5. Live Sync Between Clients

**Reviewer argues:** Opened two browsers with different dev tokens. Pledged in one — doesn't auto-show in the other. Same for claims, proof submissions, updates.

**Root cause:** Client is entirely SPA — each call updates local state. No active sync mechanism.

**Options (Phase 2):**
- **Short polling:** Refresh state every 30s on visible tabs. Simplest.
- **Nostr subscription:** Subscribe to event kinds related to this community. Fedi has `subscribeToEvents`. Would require a Nostr relay connection.
- **WebSocket/Push:** Not available with the current plain-Node server. Would need an upgrade.

**Decision:** Short polling for Phase 2 is the pragmatic minimum. Nostr subscription is ideal if Fedi supports it.

---

## 6. Nostr Event Notifications

**Reviewer asks:** "Does events trigger Nostr messages to everyone involved? E.g. if a worker submits proof of work, all pledgers should be notified."

**Current state:** Unknown — `fedi.js` and `server.js` need review. The `NOSTR_FEED` constant exists but its wiring is not yet confirmed.

**Expected behavior:** Every action (new bounty, pledge, claim, proof, payment, expiry) should:
1. Publish a Nostr event via `window.fedi.postNote()` (or equivalent).
2. Event content should include the bounty title, status, and deep link (`/b/<id>`).
3. Every pledger, the worker, and the poster should get notified for actions they participate in.

**Action needed:** Audit `fedi.js` and `server.js` for Nostr event emission. Implement missing hooks. This kills the "I'll miss the notification" UX problem elegantly.

---

## 7. Single-Owner Job Coordination

**Reviewer argues:** Currently the approval flow is too diffuse. The poster of a job should be the single owner who:
1. Defines the job parameters (already true).
2. **Vets and approves** the service provider before work begins.
3. Is the **final judge** of whether the work was done well.

**Reviewer:** "Coordination gets messy and breaks down if there's not a single person who takes ownership of it."

**Assessment:** This is *the strongest product suggestion* in the review. It pairs naturally with trust scores:
- Poster gets "jobs managed" count added to their trust profile.
- Prevents low-trust workers from claiming important bounties.
- Creates a natural approval queue — worker applies, poster approves.

**Implementation (Phase 2):**
- Add status: `claimed_awaiting_approval` before entering `claimed`.
- `applyToWork()` (current `claimBounty()`) → application is a request, not a done deal.
- Poster sees applications in their To-do, approves or declines with optional message.
- After approval, work begins. Proof is still submitted, poster still approves for payout.
- This creates two touchpoints for the poster: approve application → approve proof.

**Risk:** Adds friction to the simplest-case scenario ("someone posted a thing, I did it"). Mitigate with trust tiers: bounties below X sats skip approval (low-risk), or open claiming for new bounties.

---

## 8. Phased Bounties

Same reviewer + a second reviewer both suggested this independently.

**Proposal:** Large projects broken into phases, each with own sats requirement, possibly different workers.

**Use case:** Church parking lot repaving — Phase 1: Clear debris (10k), Phase 2: Gravel base (25k), Phase 3: Asphalt (40k).

**Phase 2 product note:** See separate PRIORITIES.md for phased bounty design spec.

---

## 9. Tendering / Inverted Pricing

**Reviewer suggests:** The inverse of our model — instead of "post a bounty with price, worker takes it or leaves it," you could:
1. Post a need without knowing the price.
2. Service providers tender bids — "I can do this for X sats."
3. Poster picks the best bid (or cheapest, or from most trusted worker).

**Use case:** "The gate is rusted. I have no idea what it costs to fix." — workers bid. This is how real procurement works.

**Assessment:** Strong idea. Would need significant UX changes:
- Tendering toggle when creating a bounty ("fixed price" vs "open bidding").
- Worker side: ability to set ask, not just accept offer.
- Poster side: comparison table of bids.
- Auction-style: first-accepted wins, or time-limited when bounty closes.

**Decision:** Phase 2 or 3. Excellent addition once base flow is solid.

---

## Implementation Priority Queue

### Phase 1 — Immediate (Week 1)
| # | Task | Status |
|---|------|--------|
| 3 | Clean URLs (`/b/<id>`) | ✅ |
| 4 | Dev key persistence | ✅ |
| 6 | Nostr event notifications (audit + implement) | 🔲 |

### Phase 2 — Next (Week 2-3)
| # | Task | Rationale |
|---|------|-----------|
| 5 | Live sync (short polling) | Kills "two browsers" testing pain |
| 6 | Nostr events → Fedi feed | Pledgers notified in feed |
| 7 | Single-owner coordination | Biggest product improvement |
| 8 | Phased bounties design spec | Two reviewers asked for it |

### Phase 3 — Later
| # | Task | Rationale |
|---|------|-----------|
| 1 | Lightning hold invoices | If flaky-pledger problem proves real |
| 9 | Tendering / inverted pricing | Marketplace direction |

---

## Open Decisions for Jason

1. **Single-owner coordination:** Do you want worker claims to require poster approval? This adds friction to the simple case but makes coordination quality far better.
2. **Nostr push notifications:** The reviewer expected proof → all pledgers notified. Is this the behavior you want Fedi to do natively, or should build the roads publish its own Nostr events that Fedi picks up?
3. **If escrow ever happens:** Confirming the hold-invoice-only path (no custodial). Reviewer explicitly agrees with this — "Why did you avoid escrow?" → because custody introduces trust burden we're deliberately avoiding.
4. **Bounty scope normalization:** ^Both phased and tendering change the mental model. Is "build the roads" fundamentally a bounty board (fixed tasks) or a community marketplace (open jobs)? Picking one identity matters for UX.
