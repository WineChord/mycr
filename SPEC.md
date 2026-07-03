# MyCR Repository Spec

## Goals

MyCR must be easy to run, audit, and improve:

- The skill instructions are versioned in Git.
- Every run can publish structured JSON and a self-contained HTML report.
- The `/mycr` site shows all historical runs without needing local files.
- Improvements discovered during real runs are captured and can become tracked
  skill, script, or UI changes.

## Non-Goals

- This repo does not vendor `trpc-agent-go`.
- This repo does not replace GitHub PR review state. It summarizes and links to
  the source PRs.
- This repo does not store private credentials.

## Report Artifact Contract

Each run uses a timestamped basename:

```text
mycr-YYYYmmdd-HHMMSS
```

Required tracked files:

- `src/data/reports/<basename>.json`
- `public/reports/<basename>.json`
- `public/reports/<basename>.html`

The source JSON is the durable data model for the archive page. The public JSON
and HTML files are served as direct artifacts for inspection and sharing.

Skipped PR entries must be auditable. A report may group skipped PRs for
scanability, but each item still needs a concrete `skip_reason` and should use
structured `blockers` when the blocker is a discrete fact such as a CI check,
merge conflict, unresolved human thread, or stale `Changes Requested` state.
Never use aggregate GitHub states as the whole explanation when the exact
thread, check, or conflict can be named.

Bugfix and linked-problem PR entries must also be auditable for necessity. When
the source problem is unverified, stale, contradicted by current base behavior,
or missing the payload/log/reproduction evidence needed to locate the root
cause, the report should use structured blocker kinds such as `necessity`,
`insufficient_evidence`, `stale_issue`, `implementation_scope`, or
`solution_fit` instead of letting a green CI run, plausible diff, or literal
implementation of a requested fix imply merge readiness.

Linked issues should not be treated as independent evidence merely because they
are detailed. If the issue is self-authored by the PR author, immediately closed
by that author's PR, or depends on an inaccessible vendor account, private API
key, tenant, hardware device, dataset, regional endpoint, or customer-only log,
the report must require reviewer-verifiable evidence before approval. Acceptable
evidence can include sanitized raw payloads, public provider documentation,
maintainer reproduction on current base, or a contract/fake-server test that
demonstrates the current-base bug without private credentials. Branch-local
tests that only encode the submitted behavior should be reported as
`insufficient_evidence`, not merge readiness.

Some PRs can be technically reviewable but still not appropriate for automated
approval or merge. When labels, linked issue text, maintainer discussion,
multiple active PRs for the same issue, security-boundary scope, public API or
architecture impact, or product/roadmap ownership show that a human maintainer,
mentor, code owner, or product owner must choose the accepted change, the report
should use a `manual_review` blocker. MyCR may still post concrete code review
findings, but it must not submit `LGTM` or merge until a human explicitly
selects that PR as merge-ready.

Reports may include `incremental_plan` and `run_state` fields. These fields are
machine-readable workflow memory and may be ignored by the visual renderer, but
they must remain safe to publish: no credentials, private local paths, raw model
prompts, or temporary workspace details.

## Incremental Planning Contract

Incremental planning may reduce repeated heavy work, but it must not reduce
review coverage:

- Every run still builds a lightweight ledger for every open PR.
- Changed, new, previously not-reached, or stale PRs are promoted into the
  heavy-review path.
- Unchanged PRs may be carried forward only as unchanged concrete blockers.
- Any action that affects GitHub state still requires fresh head, CI, comment,
  and review-thread metadata immediately before the action.
- Missing or unreliable previous state falls back to a full heavy scan.

## Report UI Contract

Self-contained HTML reports must be readable in a narrow editor preview as well
as a normal browser:

- The report should feel like a polished review dashboard, not a dumped table.
  Use clear hierarchy, calm status color, generous spacing, rounded surfaces,
  and compact scan rows before exposing long-form detail.
- PR detail cards are collapsed by default. The collapsed row must still show a
  short outcome/problem summary so users can scan without opening every card.
- Expanding a card must not create horizontal overflow. Long PR titles, paths,
  SHA values, commands, and CI strings must wrap inside their cards.
- Dense review facts may be grouped visually, but they should not be placed in a
  sticky side rail that becomes the dominant content in narrow previews.
- Dashboard panels should size to their content. A short status panel must not be
  stretched to match a long timeline panel and leave a large blank white block.
- "Expand all" and "Collapse all" controls must keep each card's visible toggle
  label and `aria-expanded` state in sync.

## Website Contract

The site is a static Astro build with:

- public base path `/mycr`
- report list sorted by `generated_at` descending
- filters for merged, approved, commented, skipped, and follow-up runs
- links to each self-contained HTML report and raw JSON
- no dependency on runtime APIs

The archive page should share the same visual system as generated reports:

- Latest and historical runs should scan as product cards with clear primary
  actions and status counts.
- Navigation, search, filters, and cards must wrap gracefully in narrow editor
  previews without horizontal scrolling.
- Timeline entries should read both `label` and `text` fields so older reports
  do not render blank details.

## Skill Contract

`skill/SKILL.md` is the canonical instruction file. The installed Codex skill
must read this file first and follow it.

The skill must use repo-relative paths wherever possible. Absolute local paths
are allowed only as documented fallbacks for bootstrap compatibility.

## Evolution Contract

Self-evolution is deliberate and auditable:

1. Capture improvement candidates in `data/evolution/backlog.md`.
2. Promote stable decisions into dated files under `data/evolution/`.
3. Update `skill/SKILL.md`, scripts, specs, or the site in this repo.
4. Run `npm run verify`.
5. Commit and push to `main`.
