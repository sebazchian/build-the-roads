# my two sats — Build Log

Chronological decision + progress log. Newest at bottom.

## 2026-06-02 ~05:45 UTC — Project kickoff

- Jason commissioned a community bounty board as a Fedi mini app. Funded in sats, reputation/trust-score based (not escrow), built first for Bitcoin Ekasi (Mossel Bay, SA).
- Researched Fedi mini-app architecture. Key finding: mini app = plain website inside Fedi browser, with `window.webln` / `window.nostr` / `window.fedi` injected. No SDK.
- Decided working name: **"my two sats"** (pun on "my two cents", humble contribution framing).
- Established docs: PROJECT.md (charter), PRIORITIES.md (guardrails), this BUILD_LOG.md.
- Port assignment: **3005** (verified free). Other services (3000-3004, 18789) untouched.
- .gitignore set up first — DB files & secrets never tracked (DC data-loss lesson).

### Architecture decision (initial)
- **Frontend:** plain HTML/CSS/JS + small framework-free SPA. Reason: must run in Fedi browser, must be light for low-end township phones, no build step needed. Progressive enhancement: WebLN/Nostr when in Fedi, mock/fallback in normal browser for dev.
- **Backend:** Node.js (Express or plain http) + SQLite (better-sqlite3) — same proven stack as Direct Current. Stores bounties, pledges, claims, proofs, trust scores.
- **Identity:** Nostr pubkey (via `window.nostr.getPublicKey()`). No passwords/accounts.
- **Provable actions:** pledges/claims are signed Nostr events; backend verifies signature against pubkey.
- **Payments:** WebLN `sendPayment` (pledger → worker invoice) at settlement. Worker generates invoice via their own Fedi wallet; pledgers each pay their share.

### Trust score model (v1)
- Pledger score = fulfilled_sats / pledged_sats over settled tasks (weighted, decays old data slowly).
- Worker score = completed_claims / total_claims, minus flags for bad/fake proof.
- Both displayed as % + simple badge. New users start at neutral (e.g., "New").

## 2026-06-02 ~12:22 UTC — Security audit + UX humanization

**AUDIT FINDINGS & FIXES:**
1. 🔴 Nostr sig enforcement: pledge/claim now hard-rejects unsigned requests in production (`NODE_ENV=production`), gives clear 401. Dev mode warns to console but accepts for local testing.
2. 🔴 CSP headers + X-Content-Type-Options + Referrer-Policy added on every response.
3. 🔴 SPA fallback hardened — no longer falls back for `/api/*` or non-html Accept headers.
4. 🔴 Image upload magic-number validation (PNG/JPEG only), 8MB limit.
5. 🟡 Upload file-size cap (10MB stat check before serving).
6. 🟡 N+1 trust computation fixed — `listBounties` now batch-preloads trust cache instead of `computeTrust` per pledge per bounty.

**UI/UX HUMANIZATION — complete redesign:**
- Moved from dark-mode crypto-template → warm, earthy palette (cream, clay, sand, moss, paper).
- Serif headings (Georgia) for warmth; human copy everywhere (not corporate/AI filler).
- Removed all "performance helpful" language — no "I'd be happy to", no motivational excess.
- Copy reads like a real person wrote it: "Your neighbour needs something done. You need a few sats." / "honour it and your trust score grows" / "now watch the sats roll in".
- Improved hierarchy: clear section labels, softer shadows, refined borders.
- Detail page now groups actions by state with context: "Show them what you did" for workers, " honour it" for pledgers.
- Mobile-first: tap targets enlarged, touch-friendly, sticky header with blur.
- Leaderboard: friendlier empty states ("Nobody's finished a job yet. Could be you.")
- Trust badges colour-coded with semantic dots (not abstract shapes).
- Status words translated to human language: "Waiting on payments" instead of "proof_submitted".

**NOTED (not fixed yet):**
- No EXIF stripping (images served raw). Phase-2: add EXIF strip on upload.
- Worker invoice stored in DB (no ZEC for now). Phase-2: consider ecash integration via `window.fedi`.
- No real Nostr relay publishing (signed events stored but not gossiped). Phase-2: publish to Nostr for discoverability.

## 2026-06-02 ~12:22 UTC — Security audit + UI humanization

**AUDIT FINDINGS:**
- 🔴 HIGH: Unsigned pledges/claims accepted in production (`sig_event` optional; server logs warning but accepts). Fix → make required when NODE_ENV=production.
- 🔴 HIGH: N+1 queries in `listBounties` → each bounty calls `getBounty` → `computeTrust` per pledge. O(n×m). Fix → request-level trust cache.
- 🟡 MEDIUM: No image content validation on proof upload (any base64 accepted). Fix → magic-number check PNG/JPEG.
- 🟡 MEDIUM: No CSP headers. Fix → add Content-Security-Policy.
- 🟢 LOW: No EXIF stripping, CORS `*` on writes, SPA fallback for API paths.
**PRIVACY:** Minimal PII (only optional display name + pubkey). No tracking. No external scripts. Data is public-by-design.

## 2026-06-02 ~06:00 UTC — MVP built & tested

- Wrote SCHEMA.md, schema.sql (users/bounties/pledges/flags).
- Built lib/db.js (data layer + backup/health + transparent trust computation + trust-weighted effective pot).
- Built server.js (plain Node http REST API + static + base64 proof upload) on port 3005.
- Built frontend SPA: public/index.html, styles.css, fedi.js (WebLN/Nostr bridge + dev fallback), app.js (browse/detail/new/leaderboard + all flows).
- Installed deps (better-sqlite3, nostr-tools, uuid). 1 moderate npm advisory (transitive) — noted, not blocking MVP.
- **End-to-end test PASSED**: bounty(8k threshold) → 2x5k pledges → claim → proof → P1 pays / P2 reneges → settle → trust scores correct (P1 100%, P2 0%, worker 100%) → leaderboards populate.
- Wiped test DB; shipped clean. Server running fresh (users=0).
- Verified all other services unaffected (3000/3001/3002/3003/3004/18789 all healthy throughout).
- Added mytwosats.service (systemd, hardened, auto-restart) and README.md.
- NOTE: pkill scare — broad `pkill -f "node server.js"` was SIGTERM'd by shell before executing; confirmed no other service harmed. LESSON: never use broad pkill patterns; target by cwd/PID. Will use precise pgrep-by-cwd going forward.

### Next (Phase 2, not yet done)
- Server-side Nostr signature verification (nostr-tools verifyEvent)
- Pledge expiry automation; categories/geo filter
- Localization (en/af/isiXhosa); public deploy + Fedi registration
- Possible: install systemd service (needs sudo — will ask Jason)
