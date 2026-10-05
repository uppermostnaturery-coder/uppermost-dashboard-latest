# AI coding tools: setup and use

Start here after cloning this repository. This document describes optional **user-level** Codex extensions; installing them does not change the application or deploy anything. The repository's commerce rules still come from [`AGENTS.md`](../AGENTS.md) and [`UPPERMOST_COMMERCE_ARCHITECTURE.md`](UPPERMOST_COMMERCE_ARCHITECTURE.md). A skill or plugin must never override those rules, bypass tests, expose secrets, or silently change the frozen architecture.

## New-contributor setup

1. Install and sign in to Codex. From `project/`, open a **new** Codex session after installing plugins or skills so the session discovers them.
2. Install the two workflow plugins:

   ```sh
   codex plugin add superpowers@openai-curated-remote
   codex plugin add codex-security@openai-curated-remote
   ```

   Alternatively, search for **Superpowers** and **Codex Security** in Codex's `/plugins` browser. These are local Codex plugins; Codex Security Cloud is a separate GitHub-connected product. Check status with `codex plugin list --json`.
3. Install the four standalone skills with Codex's built-in `$skill-installer`, or its installer script:

   ```sh
   python3 "${CODEX_HOME:-$HOME/.codex}/skills/.system/skill-installer/scripts/install-skill-from-github.py" --repo openai/skills --path skills/.curated/gh-fix-ci skills/.curated/gh-address-comments
   python3 "${CODEX_HOME:-$HOME/.codex}/skills/.system/skill-installer/scripts/install-skill-from-github.py" --repo vipulgupta2048/codex-skills --ref master --path skills/frontend-design
   python3 "${CODEX_HOME:-$HOME/.codex}/skills/.system/skill-installer/scripts/install-skill-from-github.py" --repo hardikpandya/stop-slop --path . --name stop-slop
   ```

   Review third-party skill sources before installation. The installer stops if a destination already exists; do not overwrite a contributor's customized copy blindly.
4. Optional research connector: `codex mcp add valyu --url https://mcp.valyu.ai/mcp`, then `codex mcp login valyu` and complete OAuth in your browser. Check the endpoint with `codex mcp get valyu`. This is configured per user, not by this repository.
5. Optional code-search connector: [WarpGrep](https://docs.morphllm.com/sdk/components/warp-grep) requires a Morph account/API key. Follow Morph's current MCP instructions and provide `MORPH_API_KEY` through the user's secret environment, never in this repository, a prompt, or a checked-in config. For exact symbols and paths, use `rg` first.

No provider token, OAuth credential, or MCP server configuration belongs in `.env.local.example` unless the application itself actually uses it. Do not copy a personal Codex config into the repository.

## Which workflow to use

| Tool | Purpose and trigger |
| --- | --- |
| Superpowers `using-superpowers` | At the start of a coding task, route to the applicable process workflow. Read that workflow's current `SKILL.md` in full before applying it. |
| `brainstorming` | New feature, UI, or behavior design; establish scope and obtain the design approval required by the workflow. |
| `writing-plans`, `executing-plans` | Plan and carry out an approved multi-step implementation. This replaces the article's unavailable `create-plan` skill. |
| `systematic-debugging`, `test-driven-development`, `verification-before-completion` | Reproduce and trace bugs, write regression tests before fixes, and verify claims with actual command output. |
| `requesting-code-review`, `receiving-code-review`, `finishing-a-development-branch` | Review substantial changes, evaluate feedback, then decide integration with the user. |
| `using-git-worktrees`, `dispatching-parallel-agents`, `subagent-driven-development` | Isolation or independent parallel work **only when the current user request and execution environment permit it**. Never assume every task needs agents or a new branch. |
| `diagnosing-superpowers`, `writing-skills` | Diagnose a failed workflow or author/test a new skill when specifically relevant. |
| `gh-fix-ci` | Investigate failing GitHub Actions PR checks; inspect logs and obtain approval before implementing a fix. |
| `gh-address-comments` | Address comments on the current GitHub PR after checking GitHub authentication. |
| `frontend-design` | Design or refine accessible, production-quality web UI; for Uppermost, preserve Framer ownership of storefront UI and avoid unrelated dashboard refactors. |
| `stop-slop` | Edit human-facing prose to remove formulaic AI wording. |
| Valyu MCP | Research when external sources are needed; cite authoritative sources and verify time-sensitive facts. |
| WarpGrep MCP | Semantic navigation of an unfamiliar codebase after the contributor configures Morph; it does not replace exact-text `rg` searches. |
| Codex Security | Use a standard read-only repository scan, security diff scan, threat model, finding validation, or remediation workflow **only when its specific trigger applies**. Review findings before changing code. |

Superpowers also includes specialized review, worktree, and skill-authoring workflows. Codex Security includes standard/deep scans, diff scanning, threat modeling, validation, attack-path analysis, triage, patch-risk assessment, remediation, and finding tracking. These are **different routes**, not steps to run indiscriminately on every change. The installed plugin's own `SKILL.md` is authoritative for each route. A normal correctness bug does not automatically authorize a security scan or a security fix.

## Uppermost task routing

- **Commerce behavior, payments, renewals, or webhooks:** read the frozen architecture, relevant code and migrations, and [`RAZORPAY_LIVE_RUNBOOK.md`](RAZORPAY_LIVE_RUNBOOK.md); use systematic debugging and regression tests for bugs. Keep state machines, idempotency, money units, and secrets within the documented constraints.
- **Framer/front-end integration:** use the live API contract in [`FRAMER_COMMERCE_CONTRACT.md`](FRAMER_COMMERCE_CONTRACT.md), not an older intended contract. Use frontend design only for UI work within the requested scope.
- **Security-sensitive review:** use Codex Security's scan/diff route after installation and review its source-backed report. A scan is diagnostic; it does not authorize automatic fixes or deployment.
- **Before saying a change is complete:** run the focused tests plus `npm run typecheck`, `npm test`, and `npm run build` from `project/` when required by `AGENTS.md`. Report any command not run or failing.

## Claude Code and model choice

These Codex installations do **not** install skills into Claude Code. If a contributor uses Claude Code, install [Superpowers for Claude Code](https://github.com/obra/superpowers#claude-code) separately with `/plugin install superpowers@claude-plugins-official`; review any other Claude-compatible extension independently. The [article that inspired this setup](https://medium.com/@unicodeveloper/9-must-have-skills-for-codex-in-2026-b5124b375eec) suggests Claude for exploratory planning/debugging and Codex for repository and terminal-heavy implementation, with cross-review for consequential work. Treat this as a team workflow suggestion, **not** a benchmark guarantee or a reason to skip evidence, tests, or human approval.

## Current-machine note (5 October 2026)

On the original contributor's machine, the four standalone skills and both plugins above were installed. Valyu's hosted MCP endpoint was configured; its login was reported completed by the user but was not independently exercised in this repository. WarpGrep remains unconfigured without a Morph key. The article's named `create-plan` skill was not available from the then-current OpenAI skill catalog; use Superpowers `writing-plans` or Codex Plan mode. Each new contributor must perform their own user-level installation and sign-in.
