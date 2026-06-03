# build the roads — Project Goals

## What this is

A community bounty board where neighbors pledge sats toward shared needs, workers claim and complete them, and pledgers pay out via Lightning. The trust score makes sure everyone knows who shows up and who pays up.

## Core principle

No admin gatekeepers. The preimage is the proof. The community self-polices through flags and transparent scores.

## Current state (2026-06-03)

- ✅ Full loop: pitch → pledge → claim → proof → payment → trust score
- ✅ Fedi mini app (WebLN + Nostr)
- ✅ Auto-expiry for abandoned bounties/claims
- ✅ Leaderboards from first participation
- ✅ Payment status badges (paid/pending/reneged)
- ✅ Cloudflare tunnel: buildtheroads.sebaszchian.xyz

## What's working

- Worker submits proof + Lightning address
- Pledger pays via WebLN, preimage stored
- All paid → auto-settle
- Trust scores update immediately
- Flags for disputes

## Known limitations

- Copy-paste payments: no auto-verification without Lightning node
- Mobile: some spacing still tight
- No push notifications

## Future directions

1. **Lightning node integration** — auto-verify copy-paste payments
2. **Push notifications** — when proof submitted, when payment due
3. **Multi-community federation** — communities discover each other
4. **Nostr integration** — bounties as Nostr events, wider discovery
5. **Mobile app** — PWA or native wrapper
6. **Escrow** — hold funds in contract until proof verified

## Values

- Bitcoin-native
- No KYC, no accounts, no passwords
- Transparent, auditable trust
- Works on low-end phones
- Free to use, open source
