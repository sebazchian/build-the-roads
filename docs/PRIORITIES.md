# my two sats — Priorities & Guardrails

These keep us from getting sidetracked or crashing and burning. Re-read at the start of every work block.

## Non-Negotiable Priorities (in order)

1. **Don't break the other projects.** Direct Current (3000/3001), Stack Monitor (3002), SCARP (3003), NostrScope (3004), OpenClaw gateway (18789) MUST keep running normally. This project uses a NEW port. Never touch their files, services, ports, or DBs.
2. **Safety & data integrity.** No destructive commands. Use `trash` not `rm`. Never commit secrets or DB files to git (lesson from DC data-loss postmortem 2026-06-01).
3. **Build for Bitcoin Ekasi.** Every design decision: would a township resident with a basic phone, on Fedi, find this usable and exciting? Low data, simple UI, works in their language/currency where possible.
4. **MVP discipline.** Ship the core loop (pitch→pledge→claim→proof→settle→trust) before any Phase-2 polish. No gold-plating.
5. **Document continuously.** Update docs/BUILD_LOG.md as we go so context loss never resets us.

## Port Assignment

- **my two sats dev server: PORT 3005** (unused — verified 2026-06-02). NEVER reuse 3000-3004.

## Hard Rules

- NO pushing to GitHub without Jason's explicit permission. All repos private by default.
- NO sending emails/posts/external messages without approval.
- NO modifying real Direct Current creator accounts or products.
- Secrets/DB files → `.gitignore` from the start. DB files NEVER tracked in git.
- If a subagent is used: give it a tight, well-scoped task AND ensure it has enough context window / low enough token budget to finish. Prefer light-context isolated subagents for self-contained chunks.

## Anti-Derail Checklist (before each session)

- [ ] Are the 5 other services still up? (`ss -tlnp | grep -E ':300[0-4]|:18789'`)
- [ ] Am I working ONLY inside `~/.openclaw/workspace/mytwosats`?
- [ ] Is the current task on the MVP critical path, or am I gold-plating?
- [ ] Did I update BUILD_LOG.md?

## Decision Log Location

`docs/BUILD_LOG.md` — every meaningful decision + timestamp.
