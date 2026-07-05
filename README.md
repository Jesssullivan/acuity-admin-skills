# acuity-admin-skills

Puppeteer automation of the **Acuity Scheduling admin panel** for **Massage
Ithaca**. Drives the vendor admin UI in a real Chrome/Chromium browser (the
REST API is gated behind the $49/mo Powerhouse plan) to scan/mark unpaid
appointments, run batch checkout, update service prices, and export the client
directory.

Not to be confused with `scheduling-bridge` / `acuity-middleware`
(Linear TIN-1993), which is a separate server-side API integration.

## Quick start

```bash
pnpm install        # deps (pnpm 9.15.9+, Node 20+, CHROME_PATH set)
just --list         # available recipes
just validate       # check saved session cookies
just scan           # dry-run unpaid report (no modifications)
```

All mutating recipes/commands are **dry-run by default** and require an
explicit `--execute` flag. Every run hits **production data for a real
business** — there is no sandbox. Read the safety rules before running
anything with `--execute`.

## Agent harness parity

This repo carries the same operational contract in two harness-specific
surfaces. Use the one for your harness:

- **Claude Code** → `.claude/skills/acuity/SKILL.md` (the `/acuity` skill),
  plus `.claude/commands/*.md`, `.claude/CLAUDE.md`, and
  `.claude/rules/safety.md`.
- **Codex, OMO, and other non-Claude harnesses** → [`AGENTS.md`](AGENTS.md) at
  the repo root — the same command surface, execution-host truth, safety
  rules, and secret-handling guidance expressed as plain CLI invocations.

When the two disagree, `SKILL.md` is the source of truth and `AGENTS.md`
should be reconciled to it.
