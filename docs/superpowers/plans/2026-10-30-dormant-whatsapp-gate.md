# Dormant WhatsApp gate implementation ledger

Spec: user-approved local-only scope and docs/WHATSAPP_ONE_MESSAGE_APPROVAL_PLAN.md.
No commits, remote writes, deployments or provider calls. Existing dirty staging
workspace retained at the user's request; no worktree/branch changes.

- [x] Database: test first; service-only authorization, immutable bindings, <=15m
  expiry, atomic permanently consumed attempt, revocation; ordered local migration.
- [x] Application: service-only typed adapter, exact environment/build/provider
  identity, no caller-provided environment authority; no sender/bypass integration.
- [x] Lint: pinned noninteractive CLI; report unrelated pre-existing findings.
- [x] Full local tests, typecheck, dummy-credential build, lint and independent review.

Ruling: reservation is a dormant primitive, not a send capability. Existing sender
and dispatcher stay untouched. No environment flag can enable a bypass. A future
approval must integrate the one-time reservation at the final provider boundary.
Consent must include a positive transactional preference and explicit consent
history scoped to this test approval; payment or marketing consent is insufficient.
Service-role is trusted infrastructure; context claims cannot attest deployment
identity by themselves. Application derives these from server environment.

Verification: 81 focused gate tests pass; full npm test 430 tests / 48 files pass;
typecheck passes; new-file lint passes. Full lint fails on 84 existing errors and
47 warnings. Full build compiles then fails on pre-existing application ESLint
errors now exposed by the configured lint setup. No lint rules weakened or broad
source fixes made. Independent review findings were reproduced and addressed:
canonical message/run identity, locks/rechecks, ECMAScript trim equivalence and
inherited service-role TRUNCATE privileges. Final review: no Important issues.
