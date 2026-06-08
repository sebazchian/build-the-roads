# Build the Roads — Feedback-Driven Improvements (2026-06-08)

> External reviewer: fellow developer who tested with two browsers, two dev tokens, inspected URLs, and reviewed the Nostr layer.

---

## 1. Clean URLs (`/b/<id>` instead of `/?community=X#/b/<id>`)

**Before:** Hash-based routing (`/#/b/<id>`) with community stuffed in query params. URLs looked like:
```
https://buildtheroads.sebaszchian.xyz/?community=mountain#/b/634f8e4d...
```

**Problem:** The `#` fragment is semantically for in-page anchors. Email clients, link previewers, and some browsers strip it. Sharing a bounty link could silently break.

**After:** History API routing with clean paths:
```
https://buildtheroads.sebaszchian.xyz/b/634f8e4d-c72c-44a8-9dbf-b5b9c8595752
```
Server serves `index.html` for all non-API routes. Refreshes work.

---

## 2. Dev Key Persistence (and later: real wallet as primary)

**Before:** Dev keys were stored in localStorage (`m2s_dev_pubkey`) but never reloaded on boot. Every reload required re-generating a dev key. Multi-browser testing was painful.

**Problem:** Two reviewers specifically mentioned testing was hard because dev sessions didn't survive reloads.

**After:** Boot sequence loads stored dev key on startup. Later refined so **WebLN/Nostr is tried first** — dev key is now the absolute last backup, not the default.

---

## 3. Admin System + Application/Approval Flow

**Before:** Anyone could create a bounty. Anyone could claim a job instantly. No quality gate.

**Problem (reviewer):** "Coordination gets messy and breaks down if there's not a single person who takes ownership of it."

**After:**
- **Only admins can post jobs** — enforced server-side (403) and in UI (FAB hidden for non-admins)
- **Workers must apply** — "Apply" button replaces instant claim
- **Admins approve/reject** — Application card on bounty detail with Approve/Reject buttons
- **Claim requires approval** — `claimBounty` checks for approved application
- **Multi-admin support** — `community_admins` table; creator auto-added; admins can add/remove other admins
- **Manage page** (`/manage`) — list current admins, community members with one-click "Make admin", manual pubkey fallback

---

## 4. Nostr Event Notifications

**Before:** Silent app. No notifications when things happened. Users had to manually check back.

**Problem (reviewer):** "Why require them to interact at different parts of the process, if it can easily be avoided? I'd be more willing to pledge in the former case."

**After:** `postNote()` fires on key events — optimized for Fedi (`window.fedi.postNote`), falls back to generic NIP-07, then dev backend save:
- New bounty posted
- Worker applied
- Worker approved and claimed
- Pledge made
- Proof submitted
- Payment completed

These publish to the user's Nostr feed so they see activity without polling the app.

---

## 5. Community Members (Auto-join)

**Before:** To become admin, you had to paste a raw 64-char hex pubkey manually. No visibility into who had interacted with the community.

**Problem:** Making someone admin required knowing their exact pubkey beforehand.

**After:**
- `community_members` table tracks every pubkey that pledges, applies, or claims
- Visiting the community home page auto-registers you as a member
- Manage page shows all members with display names + "Make admin" button
- Manual pubkey entry preserved as fallback

---

## 6. SPA Fallback Content-Type Fix

**Before:** Clean URLs (`/open`, `/b/<id>`) served `index.html` but sent `Content-Type: application/octet-stream` because the URL had no file extension.

**Problem:** Browser prompted to download a file on every reload.

**After:** SPA fallback explicitly sets `text/html` Content-Type.

---

## 7. SPA Fallback for All Non-API Routes

**Before:** Fallback to `index.html` only happened when `Accept: text/html` header was present. Cloudflared and some browsers sent requests without that header.

**Problem:** `/open` and `/b/<id>` returned 404 for some requests.

**After:** All non-API, non-upload routes unconditionally fall back to `index.html`.

---

## 8. Systemd Auto-Restart

**Before:** Server ran as a background `nohup` process. If it crashed, it stayed down until manually restarted.

**After:** `bounty.service` installed under user systemd with `Restart=always`. Auto-restarts on crash. Logs to journal.

---

## 9. UI Polish: Fonts, Tabs, and Navigation

**Before:** Text felt cramped on mobile. Pill-tabs were uneven. "How it works" was a static card on the home page taking up space.

**After:**
- **Fonts bumped 1-2px** across the board for readability
- **Pill-tabs evened out** with consistent gap, padding, and font size
- **"How it works" moved to its own tab** (`/how`) with three role-specific cards
- **"Why this works" (philosophy) added as its own tab** (`/philosophy`) with the manifesto: old problem, new answer, why Bitcoin, earned trust, and circular economy
- **Card order on How page:** Admin → Worker → Pledger (reversed from initial implementation after Jason's review)

---

## 10. Zap-to-Worker on Completed Jobs

**Before:** No way to tip a worker after a job was done. The only zap option went to the creator.

**After:**
- On settled bounties, a "⚡ Tip the worker" card appears on the detail page
- **Zap always goes to the worker**, not the creator — no prompt for manual entry
- `resolveLightningAddress()` checks stored address → falls back to wallet lookup (for self) → graceful error if none set
- New DB columns: `users.lightning_address` and `users.lnurl`
- New API endpoint: `POST /api/users/:pubkey/lightning-address` for self-reporting

---

## Open Decisions from Reviewer

### Escrow / Lightning Hold Invoices
Reviewer suggested hold invoices to lock pledged funds upfront, eliminating flaky pledgers and two-step UX friction.

**Decision:** Reputation-based for now. If escrow is ever adopted, it must be Lightning hold invoices (no custody). Logged for Phase 2.

### Tendering / Inverted Pricing
Reviewer suggested posting needs without a price, letting workers bid.

**Decision:** Phase 2 or 3 feature. Strong idea but changes the core model significantly.

### Single-Owner Coordination (Implemented)
Reviewer suggested the poster should vet/approve workers and be the final judge.

**Decision:** Implemented as the application/approval flow. All admins can approve, not just the poster — slightly broader but fits the multi-admin model.

---

## Remaining from Feedback
| # | Item | Status |
|---|------|--------|
| Live sync (short polling) | Two browsers don't auto-update | Not implemented |
| Phased bounties | Large projects in stages | Not implemented |
| Tendering | Workers set price | Not implemented |
| Escrow | Lightning hold invoices | Deferred |
