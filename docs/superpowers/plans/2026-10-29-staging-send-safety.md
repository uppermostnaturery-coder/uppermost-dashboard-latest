# Staging deployment safety blockers

User authorizes local code/test fixes and staging-only environment edits. No commits, pushes, deployments, provider calls, financial actions, activation, templates or schedules.

## Decisions
- Keep all existing local work on staging; no checkout/reset or unrelated refactoring.
- Explicit COMMUNICATION_DRY_RUN=true is an unconditional communication send block, even for allowlisted recipients and dedicated template tests. Default/live Production behavior with dry-run unset/false remains unchanged.
- Override inherited allowlists with empty staging-branch Preview values. Explicitly set provider mutations false; never edit a Production or shared inherited record.
- SHIPROCKET_API_ENABLED=false blocks every provider request before env/auth/cache/network. Preview defaults closed without explicit true. Production's existing unset/true behavior is preserved. No fake serviceability data or synthetic shipments.
- Existing deployments retain their old environment/code until a separately authorized deployment; report this boundary.

## Tasks
- [x] Add failing zero-network tests for direct send boundaries, OTP/test/allowlist bypasses, all Shiprocket calls, cached-token and live Production compatibility.
- [x] Implement minimal guards; adjust superseded allowlist exception tests to the new strict policy, retain controlled live-mode provider tests.
- [x] Set and read back staging-only Preview configuration, preserving inherited/Production records.
- [x] Fresh full tests/typecheck/build, independent review, final PASS/FAIL audit. Stop on unresolved safety failure.

Final ledger: 44 files / 303 tests passed; typecheck passed; dummy-credential npm build passed. Stage-specific empty allowlists and explicit false mutation/test flags saved and verified; shared inherited phone entry unchanged. Reviewer identified Production unset-flag compatibility, reproduced and fixed without expanding per-run behavior changes. No commit, push, deployment, provider send or financial operation. See docs/STAGING_DEPLOYMENT_SAFETY_AUDIT.md for the immutable-deployment boundary.
