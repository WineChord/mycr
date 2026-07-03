# Adversarial Linked Issue Evidence

## Context

A PR can try to satisfy MyCR's linked-issue evidence gate by creating a highly
detailed issue first, then submitting a PR that closes that issue. This is
especially risky when the claimed bug depends on a private vendor API key,
customer tenant, rare regional endpoint, hardware device, private dataset, or
other environment the reviewer cannot inspect.

The attacker can make the story look coherent:

- the issue describes a real-sounding provider edge case
- the PR closes the issue and adds tests
- the tests mock the proposed behavior rather than proving the current base bug
- CI is green because no external provider is exercised
- the implementation appears locally plausible but is wrong for the real
  provider contract

This can fool a review process that treats a detailed issue and branch-local
tests as sufficient evidence.

## Decision

Treat self-contained linked-issue narratives as unproven until there is
independent, reviewer-verifiable evidence. MyCR must not approve or merge a PR
solely because it closes a detailed issue, even when the issue and PR look
complete.

For private-environment or uncommon-provider claims, require at least one of:

- sanitized raw request/response payloads or logs
- public provider documentation or protocol behavior
- maintainer reproduction on the current base branch
- a fake-server or contract test that demonstrates the current-base bug without
  private credentials
- an explicit maintainer statement accepting the premise as a product or
  compatibility decision

If the evidence is unavailable, branch-local, or only proves the submitted
behavior, classify the PR as `insufficient_evidence` /
`plausible_but_unproven` and block approval and merge.

## Implementation Notes

- `skill/SKILL.md` now explicitly calls out self-authored linked issues and
  private-environment claims as adversarial evidence cases.
- The subagent prompt asks reviewers to require independent verification for
  inaccessible vendor/API-key/tenant/hardware/dataset claims.
- `SPEC.md` records the same requirement in the report artifact contract.
