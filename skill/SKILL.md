---
name: mycr
description: Repo-managed MyCR workflow for reviewing and merging ready trpc-agent-go pull requests, maintaining the user's own pull requests without self-review comments, archiving reports, and improving the MyCR skill itself. Use when the user says "执行 mycr", "run mycr", or asks Codex to batch-review open trpc-agent-go GitHub PRs, filter out WIP/draft/unready PRs, directly fix own ready PRs, check CI and previously raised review threads, run one xhigh subagent review per review candidate, post only Flash-LHR style inline comments for real issues, approve perfect external PRs with "LGTM", merge mergeable approved external PRs, write an xhigh-quality Chinese-first standalone engineering report, publish that report under the MyCR archive, and capture concrete self-improvement opportunities for the skill.
---

# MyCR

## Overview

Run the maintainer review loop for `trpc-group/trpc-agent-go` from the
repo-managed MyCR workspace. The canonical workspace is
`/Users/guoqizhou/projects/github/mycr`; it owns this skill, the report
renderer, the report archive, the `/mycr` website, and the self-evolution
records.

Prefer repo-relative paths from the MyCR workspace. Resolve the target
`trpc-agent-go` checkout in this order:

1. `MYCR_TARGET_CHECKOUT`
2. `../trpc-agent-go` relative to the MyCR workspace
3. `/Users/guoqizhou/projects/github/trpc-agent-go` as the local fallback

Prefer `gh` when it is authenticated; otherwise use the GitHub connector tools.

## Workflow

1. Identify the target repo as `trpc-group/trpc-agent-go`, identify the MyCR
   workspace as the current repo when it contains `skill/SKILL.md` and
   `scripts/render_mycr_report.py`, otherwise as
   `/Users/guoqizhou/projects/github/mycr`, and resolve the target checkout
   using the order in the overview.
2. Determine the authenticated reviewer login. Treat PRs authored by that login
   as own PRs. Also treat `WineChord` / `winechord` as own PR authors when they
   appear, because this workflow is run for the repository owner's account.
   Own PRs are not skipped by default. They enter the own-PR maintenance path
   below: review them for real issues, but never post review comments, approve,
   or merge them from this run.
3. Start with incremental planning, but keep a lightweight full-open-PR ledger:
   - Collect a cheap index for every open PR before doing any expensive diff,
     thread-body, log, source, or report-writing work. This index is a cache
     invalidation input, not a review artifact. It must include at least title,
     author, labels, draft/WIP state, base branch, head SHA, mergeability,
     review decision, locked state and active lock reason, updated/latest-activity
     time, commit/check fingerprint, review-thread fingerprint, and
     comment/review fingerprint. Build those
     fingerprints from stable IDs, authors, states, timestamps, check names and
     conclusions, head SHAs, close/reopen/lock/unlock timeline events, and
     changed-file path summaries. Do not put full PR bodies, full
     review/comment bodies, diff hunks, source files, workflow logs, or long
     CodeRabbit comments into the cheap index.
   - Compare that index with the latest successful run-state snapshot by using
     `node scripts/mycr-incremental-plan.mjs --current <current-index.json>
     --previous <previous-report-or-state.json> --output <plan.json>` from the
     MyCR workspace when a previous state exists. Use a small overlap window
     instead of a strict timestamp boundary so updates that happen during the
     prior run are not missed. Keep the default
     `--force-full-sweep-action probe`: an old but otherwise unchanged PR
     should enter `refresh_probe`, not `heavy_review`. Use
     `--force-full-sweep-action heavy` only when the user explicitly asks for a
     full code re-review or the metadata looks corrupt. If the previous state
     is missing, unreadable, or does not contain the needed fingerprints, fall
     back to the conservative behavior and treat all open PRs as
     `heavy_review`.
   - After planning, generate a cache manifest with
     `node scripts/mycr-cache-manifest.mjs --plan <plan.json> --output
     <cache-manifest.json>`. For `carry_forward` and `refresh_probe` entries
     whose `metadata_cache_key` matches the previous key, reuse the previous
     full metadata/report-entry cache and do not read diffs, source, full
     comments, full threads, logs, or subagent output. For `refresh_probe`,
     refresh only the cheap index fields; if the probe changes any fingerprint
     or cache key, rerun the planner and promote that PR to `heavy_review`.
     For `heavy_review`, fetch full metadata once and write it under the
     manifest's full-metadata cache path so the next run can reuse it.
   - A PR enters the heavy path when it is new, its head SHA changed, CI/check
     fingerprint changed, review/comment/thread fingerprint changed, readiness
     markers changed, mergeability/base changed, it was previously
     `not_reached`, it has activity after the overlapped watermark that was not
     already seen in the previous snapshot, or a `refresh_probe` discovers a
     changed cache key. Missing required fingerprints must also promote the PR
     to the heavy path. A periodic freshness sweep by itself is only a
     `refresh_probe`; it is not a reason to reread the diff or re-run xhigh
     review. A PR with an unchanged concrete blocker can be carried forward in
     the ledger, but only as a carried-forward blocker with its previous
     evidence and `last_verified_at`; never approve, merge, post comments, or
     mark an own PR maintained from carried-forward data alone.
   - For every PR in the `heavy_review` queue, collect the full metadata needed
     for the existing gates: requested reviewers, review threads, review
     submissions, commit statuses, pull-request workflow runs, mergeability,
     changed files, and diff/source details. For review threads, keep a
     thread-level audit, not only the aggregate GitHub `reviewDecision`: thread
     id or URL, reviewer login, author login, review state, file and line,
     resolved/outdated state, latest author reply, latest reviewer reply,
     whether the thread still maps to the current diff, and the concrete reason
     it is still actionable or no longer actionable.
   - For every candidate that will appear in the reviewed-PR section, also
     build a PR-content summary from the PR description, changed files, and
     diff. This summary must describe what the PR itself changes, not what the
     reviewer did. Capture the original problem or user/developer need, the new
     behavior or API shape, the concrete packages/files/modules touched, the
     important added, modified, or removed code paths, data/control flow
     changes, compatibility impact, docs/examples/tests added, and any design
     tradeoffs visible from the diff. Gather enough source detail to let the
     final report stand alone as an engineering brief; do not rely on vague
     title-level summaries.
   - For every bugfix, behavior fix, compatibility fix, or PR that claims to
     close a linked issue, build a problem-evidence summary before treating it
     as a review candidate. Read the linked issue or source problem report,
     the PR body, maintainer/author discussion, test evidence, logs, payloads,
     and the current base-branch code path needed to judge whether the problem
     still exists on the target base. Classify the premise as
     `confirmed`, `plausible_but_unproven`, `contradicted_or_stale`, or
     `product_decision_needed`. CI green, a plausible diff, generated tests, or
     an implementation that matches the original reporter's proposed fix are
     not enough by themselves to establish necessity.
   - Be adversarial about self-contained problem narratives. A linked issue
     opened by the PR author, an issue that is immediately closed by the same
     author's PR, or a report that can only be reproduced with a private API
     key, rare vendor account, customer tenant, hardware device, private
     dataset, regional endpoint, or other inaccessible environment is not
     independent evidence. Require at least one reviewer-verifiable artifact:
     sanitized raw request/response payloads, provider documentation, public
     protocol behavior, maintainer reproduction on current base, a fake server
     or contract test that demonstrates the base bug without private
     credentials, or an explicit maintainer statement accepting the premise.
     If the PR only proves behavior on its own branch, mocks only the proposed
     behavior, or depends on a provider claim the reviewer cannot inspect, block
     approval and merge as `insufficient_evidence` / `plausible_but_unproven`.
   - Treat source-problem evidence as a first-class gate. A candidate can be
     approved or merged only when the problem premise is confirmed, or when it
     is an explicitly scoped feature/design change whose motivation is clear
     from the PR discussion. If the latest base behavior, authoritative logs,
     maintainer discussion, or upstream/provider behavior contradicts the
     claimed bug, block it as `contradicted_or_stale`. If the issue report lacks
     the raw request/response/event data, base-branch reproduction, or code-path
     link needed to identify the root cause, block it as
     `plausible_but_unproven` and ask for the smallest missing evidence instead
     of approving a speculative fix. If the change is a policy/product decision
     rather than a correctness fix, block or defer it until the intended
     contract is stated.
   - Separate the user's reported pain from any proposed implementation in the
     issue or PR. A linked issue, bot linked-issue check, or author-proposed fix
     can describe a real symptom while still suggesting the wrong control
     surface. Judge whether the submitted solution is a good fit for the
     underlying product/API/runtime contract: does it preserve useful defaults,
     avoid misleading mode switches, keep configuration semantics coherent, and
     solve the pain at the right abstraction layer? If the literal requested
     implementation would make the API less clear or less maintainable, prefer
     a better design such as clearer docs, an explicit narrowly scoped option,
     or a separate contract decision; block the PR as `solution_fit` when the
     mismatch affects merge readiness.
   - Treat manual-review-only merge policy as a first-class gate, separate from
     ordinary code quality and unresolved review threads. Before approving or
     merging a linked-issue PR, inspect issue labels, issue body, PR body,
     maintainer comments, assignees, active competing PRs for the same issue,
     and code owner requests for signals that the final merge decision belongs
     to a human maintainer, mentor, code owner, or product/architecture owner.
     Examples include mentorship or contest tracks such as Rhino Bird issues,
     labels or text saying the issue is exclusive to a program, "students claim
     this task", "mentor selects winners", explicit "manual review required",
     multiple active PRs competing for one issue, security-boundary changes,
     broad public API or architecture decisions, and roadmap/product choices.
     In those cases MyCR may still audit the code and post real review
     findings, but it must not approve with `LGTM` or merge unless a maintainer
     explicitly states that this exact PR is the accepted merge candidate.
     Report the gate as `manual_review` with the concrete label, issue text,
     maintainer statement, or competing PR evidence that made automation unsafe.
   - Maintain a run-level reviewability ledger for every open PR. Each PR must
     end the scan in exactly one auditable bucket: processed, heavy-review
     eligible candidate, carried-forward unchanged blocker, intentionally not
     reached, or blocked by a concrete gate. Do not allow an open PR to
     disappear from the run because of incremental planning, candidate ordering,
     stale aggregate review state, vague soft-CI uncertainty, or a broad skip
     group.
4. Split PRs into two auditable processing paths before applying the candidate
   gates:
   - External PR review path: PRs not authored by an own login. These are the
     only PRs eligible for inline review comments, approval with exactly
     `LGTM`, and merge.
   - Own-PR maintenance path: PRs authored by an own login. For these PRs, do
     the same quality audit you would do for an external PR, but convert valid
     findings into direct branch fixes instead of review comments. Prefer a
     separate `git worktree` for the PR branch so existing local changes in the
     main target checkout are not disturbed. Fetch the PR head, check out the
     contributor branch when it is pushable from the authenticated account, run
     the relevant tests/tooling, commit with project-style commit messages when
     changes are needed, and push back to the PR branch. If the branch is not
     pushable, report the exact blocker instead of posting review comments.
     Do not approve, request changes, submit `LGTM`, merge, or resolve review
     threads on own PRs as if you were a third-party reviewer. The goal is to
     leave each own PR at the quality level where the external PR path would
     have approved it.
5. Keep external review candidates only when they satisfy every gate:
   - state is open
   - title and labels do not indicate WIP
   - PR is not draft and is ready for review
   - base branch is the repository default branch unless the user said otherwise
   - for bugfixes and linked-issue fixes, the source problem has sufficient
     current evidence on the target base. A PR whose premise is only inferred
     from the diff, copied from a suggested issue fix, or supported only by
     branch-local tests must remain blocked until the current base behavior and
     root-cause path are verified. A stale, non-reproducible, or contradicted
     problem premise is a hard approval and merge blocker even when CI is green.
   - the implementation approach is a reasonable fit for the confirmed problem
     and the repository's public contract. Do not approve a PR merely because it
     satisfies the issue's literal proposed fix or a bot's linked-issue check if
     that fix uses the wrong knob, weakens default behavior, hides a contract
     decision in documentation, or broadens semantics beyond the actual need.
   - the PR is not under a manual-review-only merge gate. If issue labels,
     issue text, maintainer comments, code owner requests, active competing PRs,
     security/architecture scope, or product/roadmap ownership indicate that a
     human maintainer must choose the accepted PR, block approval and merge as
     `manual_review` until that explicit selection exists.
   - all commit statuses and workflow runs for the current head SHA are green
     before starting review, except the soft CI cases described below
   - pending, queued, in-progress, cancelled, timed out, missing required
     checks, or failures outside the soft CI cases mean do not review yet
   - CI readiness must be computed from the current head's effective latest
     checks, not from an undeduplicated `statusCheckRollup` that may include
     historical runs left behind by close/reopen cycles. Prefer `gh pr checks
     --watch=false`, current commit status, or latest check-suite/check-run
     data grouped by check name and workflow for the current head. If
     `statusCheckRollup` contains both an old failure and a newer success for
     the same effective check on the same head, treat the newer effective check
     as authoritative and record the stale rollup discrepancy instead of
     skipping the PR as CI-failed.
   - if the only non-green checks are `go-apidiff` and/or `codecov/patch`,
     do not skip automatically. Inspect the PR diff, PR description, reviewer
     discussion, and the concrete apidiff/codecov information. Treat the PR as
     reviewable when the API break is explicitly acceptable for this change or
     the codecov patch miss is not hiding a correctness risk. Record the
     judgment in the report. If the apidiff/codecov failure exposes a real
     compatibility, test-coverage, or quality blocker, skip or comment as
     appropriate.
   - `codecov/patch` is a review soft gate but still a merge hard gate. A PR
     with a non-green `codecov/patch` may receive inline comments, and may be
     approved with `LGTM` if review is clean, but it must not be merged until
     `codecov/patch` is green or no longer present as a non-green check.
   - human review comments are either resolved, or the PR author has replied
     clearly that they fixed the issue or gave an explanation that we judge
     acceptable after checking the current diff; a forgotten GitHub "Resolve"
     click alone must not block review
   - `reviewDecision=CHANGES_REQUESTED` is not, by itself, a skip reason.
     Treat it as a signal to run the thread-level audit above. If every
     actionable human thread has been resolved, is outdated because the changed
     code moved, or has a clear author `fixed` / `done` / acceptable
     explanation that is verified against the latest diff, the PR remains
     eligible for review. Record the stale aggregate state in the report, but
     do not exclude the PR only because GitHub still displays
     `CHANGES_REQUESTED`.
   - A human-review blocker must name the concrete still-actionable thread or
     review: reviewer login, thread/comment URL, file and line when available,
     the reviewer request, the latest author response if any, and why that
     response or the current diff is insufficient. If this evidence cannot be
     gathered, gather more metadata instead of using a broad reason such as
     "unresolved review", "Changes Requested", or "API discussion".
   - unresolved comments from bots are not hard blockers by themselves; inspect
     whether they describe a concrete current correctness, compatibility, or
     CI risk, and ignore weak, stale, stylistic, or unreasonable bot comments
     after recording that judgment
   - comments previously raised by us, `Flash-LHR`, or on our behalf must be
     verified against the latest head; if fixed, proceed even if the thread was
     not clicked resolved, and resolve our own/on-behalf threads when allowed
   - locked pull-request conversations must be tracked explicitly. A lock that
     limits comments to collaborators is not automatically a review blocker for
     an authenticated maintainer/collaborator, but it is a comment-delivery
     risk and can block bot/non-collaborator comments. Before posting inline
     comments or approving a locked PR, verify the authenticated account's
     repository permission and, after posting, verify the review/comment URLs.
     If GitHub rejects the review because the conversation is locked or
     otherwise write-restricted, report a first-class comment-delivery blocker
     with the attempted target and requeue the PR after unlock; do not let the
     review silently disappear from the report.
   - after the first gate pass, run a second pass over all non-draft, non-WIP
     external PRs. Any PR with green CI or only acceptable soft-CI failures, no
     merge conflict, and no verified live blocker must be either reviewed in
     this run or listed as `not_reached` with a concrete reason why capacity or
     ordering stopped it. It must not be hidden under CI, human review,
     `Changes Requested`, or "needs discussion" unless the exact current
     blocker has been named and verified.
6. For own PRs, apply the same readiness audit, but use own-PR outcomes:
   - If an own PR is draft, WIP, has non-soft failing CI, has a merge conflict,
     or has a live human-review blocker that requires product/design input,
     record the exact blocker. Do not post comments.
   - If an own PR is ready enough to inspect, perform the full review locally.
     Run one xhigh subagent review when the change is non-trivial, verify every
     finding yourself, then fix valid issues directly in the PR branch. Prefer
     creating a dedicated `git worktree` for the target branch and then running
     `gh pr checkout <number> --repo trpc-group/trpc-agent-go` inside that
     worktree, or use explicit fetch/checkouts when that is more reliable.
     Preserve unrelated worktree changes and never reuse a dirty checkout for
     own-PR fixes.
   - After pushing fixes, re-check the PR's CI and latest comments/threads.
     If CI is pending, report it as waiting for CI. If CI is green or only has
     acceptable soft-CI findings, report the PR under `maintained` with the
     commits, tests, and residual risks. Do not self-approve or merge it.
   - If the audit finds no needed code changes, report the PR under
     `maintained` as "no direct fix needed" with the evidence that would have
     made the external PR path approve it. Do not submit an approving review.
7. For skipped PRs, record the concrete skip reason for the final report. The
   reason must identify the exact gate that blocked review. Use structured
   `blockers` entries when possible. Do not group PRs under vague combined
   reasons such as "human review thread, Changes Requested, or API discussion"
   unless each item also lists the exact thread/comment/check/conflict that is
   actually blocking it. A manual-review-only gate must name the specific label,
   issue sentence, maintainer statement, code owner decision point, competing PR,
   security/architecture scope, or product/roadmap ownership reason that makes
   MyCR approval or merge unsafe. If a PR is otherwise reviewable but was not
   processed because of time or candidate ordering, say that plainly as "not
   reached this run" and put it in follow-up, not in a blocker group.
   Before processing candidates and again before writing the report, compare
   the reviewability ledger with the processed list. If a PR looks reviewable
   but was not processed, promote it into the candidate queue when practical;
   otherwise report it as `not_reached` and include the specific reason it was
   deferred. The report must make this visible enough that the user can spot
   missed CR opportunities immediately.
8. Process external candidates one at a time. Spawn exactly one subagent per
   candidate with reasoning effort `xhigh`. Give it the PR number, repo, diff
   access instructions, and ask for a code-review result only; do not let the
   subagent post comments, approve, merge, or modify files.
9. Ask the subagent to first assess problem necessity and implementation
   derivation, then code quality. It must state whether the PR's claimed
   problem is confirmed on the current base, what evidence supports or
   contradicts it, which code path explains the root cause, and whether the
   chosen implementation follows from that evidence. Then ask it to focus on
   design, compatibility, likely bugs, cross-module impact, severity, and the
   smallest correct fix. Require code findings to include `path`, changed-side
   `line` or `position`, concise English body, Chinese translation, and why the
   issue matters. Allow a non-inline `necessity` or `implementation_scope`
   blocker when the problem premise or solution path is not sufficiently
   established and no changed line is the right anchor. Allow a `solution_fit`
   blocker when the user pain is real but the chosen API, default, option,
   documentation, or runtime behavior is the wrong abstraction for that pain.
10. Verify each returned finding against the current PR diff. Keep only concrete,
   actionable issues that can be anchored to changed lines. Discard style,
   preference, broad design commentary, or findings outside the diff unless the
   changed line directly creates the risk. Verify each returned necessity or
   implementation-scope blocker against the source issue/report, latest PR
   discussion, and current base code path; keep it only when the missing or
   contradicting evidence would make approval unsafe. Verify each returned
   solution-fit blocker against the intended user pain, public contract,
   alternative designs, and current implementation constraints; keep it when the
   submitted approach would leave a confusing or brittle contract even if the
   original symptom is real.
11. For valid external-PR findings, submit a GitHub review with only inline file comments.
   Use the `flash-lhr-pr-comment` skill shape:
   one or two direct English sentences, then a Chinese translation in
   `<details><summary>中文</summary>...</details>`.
   Do not post a top-level PR comment when inline comments are available.
   If the only valid blocker is a problem-evidence or implementation-scope
   blocker, or a solution-fit blocker that cannot be anchored to a changed line,
   do not invent an inline anchor. Leave one concise top-level PR review comment
   asking for the missing reproduction, raw payload/log, current-base
   verification, better control surface, or contract decision, and report the PR
   as blocked; do not approve or merge.
12. If an external PR has no valid findings, approve it with a GitHub pull-request
    review whose state is approve and whose body is exactly `LGTM`. This must
    be the same visible effect as a human submitting an approving review from
    the GitHub UI, not a standalone issue comment that says `LGTM`.
13. After approval, merge the external PR using the repository-supported merge method
    only when it has no non-green `codecov/patch` check. For this repo, prefer
    squash merge when repository metadata says only squash merge is allowed.
    The merge must preserve GitHub's default squash commit title and body, the
    same as clicking the UI "Squash and merge" button without editing the
    generated message. Do not pass custom merge subjects or bodies. With
    `gh pr merge`, use `--squash` and `--match-head-commit` as needed, but do
    not use `--subject`, `--body`, or `--body-file`. With the GitHub connector
    `_merge_pull_request`, pass `merge_method: "squash"` and
    `expected_head_sha` as needed, but leave `commit_title` and
    `commit_message` unset/null. If a tool path cannot omit custom title/body
    fields, do not use that path. This keeps the PR number suffix generated by
    GitHub, for example `(#1844)`. If `codecov/patch` is still non-green, leave
    the approved PR unmerged and report it as approved but waiting for codecov.
14. Before ending, fetch each processed PR's latest comments and review threads
    again. For external PRs, if new actionable comments appeared and can be
    fixed by the author or require a different outcome, handle them before
    reporting; otherwise include them in the report. For own PRs, convert any
    newly discovered actionable issue into another direct branch fix when
    possible, then re-check CI and threads. If any PR head moved after comments
    or fixes, require CI to be all green again before approving or merging,
    except for documented soft CI failures that were explicitly re-evaluated
    after the head movement. A re-evaluated `codecov/patch` soft failure can
    still allow external review/approval, but never merge while it remains
    non-green.
15. Report all reviewed PRs, maintained own PRs, skipped PRs with reasons,
    comments posted, direct fixes, approvals, merge results, and any blocked
    operations. Generate the
    interactive HTML report described below before sending the final answer.
    Follow the detailed reporting contract below. Treat report writing as an
    xhigh-quality pass, not as a short run log: synthesize the PR content,
    implementation design, review judgment, and follow-up priorities so the
    user can understand the engineering state without opening GitHub or reading
    a diff.

## Reporting Contract

In the final report:

- Use Chinese as the primary reporting and analysis language. When writing
  Chinese sections, summaries, skip reasons, follow-up judgments, timelines,
  and plain-text final answers, make them as fully Chinese as practical.
  Preserve original English only for source material that should stay exact,
  such as PR titles, code identifiers, file paths, check names, branch names,
  commit messages, quoted review bodies, and GitHub UI/status literals.
- Create a structured JSON summary of the run and render it with
  `scripts/render_mycr_report.py`. The HTML report must be default Chinese,
  switchable to English, and include visual/interactive UI for status totals,
  reviewed PRs, skipped PR groups, comment details, CI/thread state, search,
  and status filtering.
- Include the incremental planner result or equivalent fields in the JSON
  summary as `incremental_plan`, and include the next run-state snapshot as
  `run_state`. These fields are the workflow's memory: they should record the
  lightweight open-PR index, planning reasons such as `head_sha_changed` or
  `checks_changed`, carried-forward blockers, and the latest successful
  verification time. The public report renderer may ignore these fields, but
  future MyCR runs must be able to use them to avoid repeating expensive work.
- The HTML report should feel like a polished engineering dashboard, inspired
  by high-quality developer tools such as GitHub/Graphite review timelines,
  Linear-style dense status lists, Vercel-style deployment/status cards, and
  Raycast-style detail panes. Keep it self-contained, fast, responsive, and
  readable: clear hierarchy, restrained color, strong scanability, sticky
  search/filter controls, status dots, compact metrics, readable long-form PR
  details, and obvious reviewed / commented / maintained / skipped / follow-up
  sections.
  Avoid decorative clutter, marketing-page layout, or generic blog styling.
- The report must be a self-contained engineering brief, not merely an action
  log. A reader should be able to understand, from the report alone, what each
  reviewed PR changes, why the change exists, which modules and code paths are
  affected, how the implementation works, what behavior/API/docs/tests changed,
  why the review outcome was chosen, and which items still deserve attention.
  If this cannot be understood without opening the PR diff, the report is not
  good enough.
- Every reviewed PR entry must include beginner-friendly technical background
  for all important modules and concepts touched by the PR, not just the PR's
  immediate motivation. Explain the underlying technical principles from zero:
  what the module is responsible for, how it fits into the agent runtime, what
  data flows through it, which lifecycle/callback/tool/session/model concepts
  matter, and why those concepts make the PR's change non-trivial. When a PR
  touches multiple modules, explain each module's role and how they cooperate.
  The goal is that a reader unfamiliar with this area of the codebase can first
  learn the relevant domain model, then understand the PR.
- Use xhigh-level care when writing the report. Before rendering, make one
  dedicated pass over every reviewed PR entry and ask whether a maintainer who
  has not read the code could still explain the PR's goal, implementation,
  touched modules, behavior impact, test/docs coverage, and review risk. Expand
  any entry that fails that check.
- The overall report must include a rich top-level narrative: how many PRs were
  considered, how they were partitioned, which PRs changed code versus docs or
  examples, which areas of the repository were touched, what was merged, what
  was blocked by real findings, what was blocked by readiness gates, and what
  the maintainer should look at next. Avoid presenting only counters.
- In the structured JSON summary, fields named `problem`, `approach`, or shown
  as "解决的问题" / "实现方式" must describe the PR itself. Never fill these
  fields with review-process narration such as "ran a subagent", "checked CI",
  "reviewed the diff", "posted comments", or "resolved a thread". Put review
  actions only in `outcome`, `ci_state`, `risk`, `inline_comments`, timeline,
  or the final plain-text summary.
- For each reviewed PR, include `technical_background` (shown as "技术背景").
  This field is not a PR summary. It should teach the reader the module-level
  and concept-level background needed to understand the PR: core abstractions,
  responsibilities, request/response or control flow, state/session model,
  callback/lifecycle model, storage/runtime model, security boundary,
  serialization format, graph/query model, or any other domain knowledge the
  PR depends on. Write it for an absolute beginner, but keep it directly tied
  to the touched code so it stays useful to maintainers.
- For "解决的问题", explain the concrete product, developer, API, runtime,
  compatibility, correctness, performance, or documentation gap the PR is
  trying to address. Include the old behavior or missing capability, why it
  matters, and the intended user-visible or maintainer-visible result. If the
  PR description does not state the problem directly, infer it from the diff
  and say that it is inferred. Do not treat an inferred problem statement as
  sufficient approval evidence by itself; separately record whether the source
  problem is confirmed, unproven, contradicted, stale, or awaiting a product or
  contract decision.
- For every reviewed PR, add a problem-framing and root-cause analysis before
  or near the implementation discussion. Explain what the PR appears to treat
  as the underlying problem, what deeper root cause may be driving that problem,
  and whether the same user/developer pain might be better understood from a
  different angle. If there is a more fundamental architecture, API,
  lifecycle, observability, compatibility, or product-model issue underneath
  the immediate bug or feature request, say so plainly.
- For every bugfix, behavior fix, compatibility fix, or linked-issue fix, add a
  problem-evidence section. Record what source problem report, PR discussion,
  logs, raw payloads, reproduction steps, base-branch behavior, tests, docs, or
  maintainer statements were checked. State whether the issue reproduces or is
  otherwise confirmed on the current target base. If evidence is missing,
  stale, contradictory, or only proves behavior on the PR branch, say that
  plainly and make it a blocker unless the PR is explicitly reframed as a
  design/product change.
- For "实现方式", describe the PR's design and implementation in enough detail
  that the user can understand the change without opening the PR diff. Mention
  the main packages/files touched, new public APIs or options, changed defaults,
  important algorithms or control flow, persistence/session/streaming behavior,
  error handling, compatibility behavior, docs/examples, and test coverage when
  relevant. The goal is for the report reader to judge whether the PR's design
  and implementation direction look reasonable before reading code.
- For every reviewed PR, analyze the solution space, not only the submitted
  implementation. Describe the design approach the PR chose, other plausible
  approaches the author could have taken, and the tradeoffs among them. Discuss
  dimensions such as API simplicity, backward compatibility, correctness,
  safety, maintainability, extensibility, observability, runtime cost, test
  scope, migration cost, and how much complexity is pushed onto users.
- For every reviewed PR, include a solution-fit assessment. Distinguish the
  user pain or product need from any implementation suggested by the issue,
  bot, or author. State whether the PR chose the right control surface: code
  behavior, public API, option, default, documentation, example, migration note,
  or a separate design decision. If the PR satisfies the literal issue request
  but would create a confusing mode switch, misleading option semantics,
  weaker default, hidden behavior change, or inappropriate operational
  guarantee, treat that as a blocker or explicit residual risk.
- For every reviewed PR, explain implementation derivation: why the chosen code
  path is the right place to solve the confirmed problem, why the patch scope is
  neither too broad nor too narrow, and which evidence connects the observed
  symptom to this implementation. If the PR appears to patch a guessed cause,
  broadens semantics beyond the reported scenario, or masks an upstream/proxy
  contract violation without a stated compatibility policy, treat that as a
  design blocker or follow-up risk depending on severity.
- For every reviewed PR, include a design assessment. State whether the PR's
  chosen design is a good fit for the root problem, whether it reaches a
  reasonable local optimum across the relevant tradeoffs, and whether there may
  be a better architecture or simpler solution. If a better approach exists,
  explain it concretely enough for the maintainer to judge whether to ask the
  author for redesign, a follow-up PR, or no change.
- For each reviewed PR, include a concrete change inventory in the report body.
  Cover newly added symbols/options/files, modified behavior, removed or renamed
  behavior, updated docs/examples, and tests that prove the change. When the PR
  touches multiple modules, group the explanation by module or execution path
  instead of collapsing everything into one generic sentence.
- For each reviewed PR, explicitly describe the exported API surface change.
  List newly added, modified, renamed, or removed exported variables,
  constants, functions, methods, interfaces, structs, struct fields, types,
  options, constructors, tool names, config keys, environment variables, command
  names, JSON fields, document sections, and examples when they are part of the
  user-facing or maintainer-facing contract. If no exported/user-visible API
  changed, say that explicitly and explain why the change is internal.
- For each reviewed PR, explicitly describe semantic changes and module impact.
  Explain behavior changes, default changes, compatibility or migration impact,
  error-handling changes, lifecycle/session/streaming/persistence changes,
  concurrency or ordering changes, and performance or resource-use implications.
  Also explain which modules are directly affected and which other modules may
  be indirectly affected through shared interfaces, callbacks, tools, runtime
  contracts, docs/examples, or tests.
- Explain behavior from first principles. Prefer before/after descriptions,
  request/response or call-flow narratives, and small concrete examples when
  they make the change easier to understand. Define local concepts briefly when
  they are not obvious from the PR title.
- Make attention points explicit. Separate "must fix before merge" findings
  from "watch this later" residual risks, soft-CI judgments, compatibility
  notes, migration concerns, and reviewer assumptions. Do not hide these only
  inside inline comment text.
- Avoid low-information phrases such as "updates logic", "improves handling",
  "adds support", "refactors code", or "reviewed implementation" unless they
  are immediately followed by the concrete modules, code paths, data structures,
  or behaviors involved.
- Separate PR-content summary from review judgment. Design concerns found by
  the reviewer belong in `risk` or `inline_comments`; the `problem` and
  `approach` fields should remain a faithful explanation of the author's PR.
- In the HTML report, PRs that were not reviewed must be shown in a grouped
  section by exclusion reason, not only as a flat list. Each group should show
  the group reason, count, PR links, authors, concrete blockers, CI state, and
  any follow-up judgment.
- Store generated run reports under the MyCR repository so every run is
  traceable through Git and visible on the public archive. Write the canonical
  structured JSON summary to `src/data/reports/mycr-YYYYmmdd-HHMMSS.json`, and
  write public copies to `public/reports/mycr-YYYYmmdd-HHMMSS.json` and
  `public/reports/mycr-YYYYmmdd-HHMMSS.html`. Prefer
  `node scripts/archive-report.mjs <summary.json>` to copy the JSON and render
  the HTML through `scripts/render_mycr_report.py`.
- Treat meaningful report artifacts as website history. After a completed MyCR
  run, run `npm run verify` from the MyCR workspace and commit/push the new
  report files to `main` unless the user explicitly asks to keep the run local
  or the run failed before producing a useful report. Do not write new reports
  into the target checkout's `.vscode/mycr-reports` directory.
- Include the absolute HTML report path under the MyCR repo as a clickable
  Markdown link in the final answer. After the report archive is pushed, also
  include the public URL under `https://www.wineandchord.com/mycr/reports/`.
  The plain Markdown answer should summarize the result, while the HTML file is
  the rich auditable report.
- Every PR reference must be a clickable Markdown link whose visible text is the
  PR number, for example `[#123](https://github.com/owner/repo/pull/123)`.
  Do not leave bare `#123` text anywhere in the report.
- Present the final report in this order:
  1. PRs approved with `LGTM` first, including merge result when merged, or the
     explicit `codecov/patch` blocker when approved but intentionally not
     merged.
  2. PRs that received inline comments second.
  3. Own PRs maintained directly without self-review comments, including commits
     pushed, tests run, CI state, and remaining external-review expectations.
  4. PRs that were not reviewed, grouped by the reason they were excluded.
- For every reviewed or maintained candidate PR, include:
  - author
  - title
  - beginner-friendly technical background for every important module and
    concept touched by the PR, including how those modules work and cooperate
  - what problem the PR tries to solve
  - necessity assessment: whether the source problem is confirmed on the
    current target base, plausible but unproven, contradicted/stale, or waiting
    on a product or contract decision
  - evidence checked: linked problem reports, discussion, logs, raw payloads,
    reproduction steps, current-base behavior, tests, docs, or maintainer
    statements used to validate the premise
  - reproduction on base: whether the problem was reproduced or otherwise
    verified against the latest target base, and any reason reproduction was not
    practical
  - evidence gaps: missing data that prevents a confident approval, such as raw
    event payloads, authoritative provider behavior, or a minimal current-base
    reproduction
  - the problem framing: what root cause the PR is addressing and whether the
    problem should be viewed from another angle
  - the implementation approach used by the PR
  - implementation derivation: why the edited code path and patch scope follow
    from the confirmed problem evidence
  - solution-fit assessment: whether the chosen API/default/config/docs/control
    surface is the right way to address the underlying user pain, not just the
    literal requested fix
  - plausible alternative designs or implementation strategies
  - the key tradeoffs between the PR's design and those alternatives
  - a design assessment: whether the PR's chosen approach is close to optimal,
    merely acceptable, over-engineered, under-designed, or likely needs a
    different architecture
  - the main modules, packages, files, or code paths changed by the PR
  - exported API surface changes: exported vars, consts, funcs, methods,
    interfaces, structs, fields, types, options, constructors, tool names,
    config keys, env vars, JSON fields, docs/examples, or explicit "none"
  - the specific APIs, options, data structures, behavior, docs, examples, or
    tests added, modified, or removed by the PR
  - semantic changes: defaults, runtime behavior, compatibility, migration,
    errors, lifecycle/session/streaming/persistence, concurrency, ordering,
    performance, or resource use
  - module impact and cross-module impact: direct package changes and indirect
    effects on callers, adapters, tools, examples, docs, tests, and shared
    contracts
  - the expected before/after behavior from the user's or maintainer's point of
    view
  - review outcome: commented, approved, merged, maintained, skipped after
    recheck, or blocked
  - possible remaining issues or compatibility risks
  - if approved, why it is acceptable to approve and whether any residual risk
    remains
  - if approved while `codecov/patch` is non-green, state that it was not merged
    because codecov is still a merge blocker
  - if maintained as an own PR, state explicitly that no self-review comment,
    self-approval, or self-merge was submitted; list the branch/commits pushed
    or say that no direct fix was needed
  - if comments were posted, the exact inline comment bodies, the review focus,
    severity, and whether the user should pay extra attention
  - latest CI and review-thread state when it affects the outcome
- For PRs that were not reviewed, group them by skip reason and still use
  clickable PR links. For each PR, include the author, title, concrete blocker,
  and whether the blocker is CI, draft/WIP/own PR state, unresolved human review,
  a still-valid bot finding, or another readiness issue.
- For each not-reviewed PR, include `blockers` when there is any blocker that
  can be described as a discrete fact. Each blocker should have `kind`
  (`ci`, `human_review`, `bot_review`, `merge_conflict`, `draft_wip`,
  `own_pr`, `soft_ci`, `necessity`, `insufficient_evidence`, `stale_issue`,
  `implementation_scope`, `solution_fit`, `manual_review`, `not_reached`, or
  `other`),
  `summary`, and, when applicable, `reviewer`, `url`, `path`, `line`,
  `latest_response`, and `verification`. A skipped item with
  `reviewDecision=CHANGES_REQUESTED` but no live human-review blocker must say
  that explicitly, then list the real remaining gate, such as `go-apidiff`
  soft-CI inspection, `codecov/patch` merge blocker, missing source-problem
  evidence, wrong solution/control surface, manual maintainer selection
  required, CI pending, or "not reached this run".
- If a skipped group is about human review, each item in that group must name
  the exact unresolved human thread. If no exact still-actionable human thread
  is found, the PR does not belong in that group.
- After the not-reviewed section, call out which not-reviewed PRs may need
  follow-up attention and why, such as flaky/failing CI, unresolved review
  threads from important reviewers, long-stale high-impact changes, or blocked
  PRs that look close to ready.
- Keep the report readable, but prefer useful detail over brevity. The report is
  allowed to be long when the PRs are substantial. The quality bar is that the
  user can understand the relevant code-related information, implementation
  direction, and review outcome without opening GitHub or reading the PR code
  first.

## Self-Evolution Loop

- Treat the MyCR repo as the skill's long-term memory and implementation home.
  The installed `~/.codex/skills/mycr` copy should stay a bootstrap that points
  back to this repo.
- At the end of each real MyCR run, capture concrete friction, repeated manual
  work, missed edge cases, brittle path assumptions, weak report fields,
  confusing UI, or unclear review gates in `data/evolution/backlog.md`.
- When the user asks for MyCR maintenance, or when a low-risk improvement is
  clearly local to this repo, update the relevant canonical files here:
  `skill/SKILL.md`, `scripts/`, `src/`, `data/specs/`, or `data/evolution/`.
  Then run `npm run verify`, commit, and push to `main`.
- Prefer environment overrides and repo-relative paths. Document the rare
  absolute fallback in `README.md`, `AGENTS.md`, or this skill instead of
  scattering hardcoded paths through scripts.
- Keep self-evolution changes separate from target PR review judgments. Do not
  let a MyCR skill improvement modify `trpc-agent-go` unless the user asked for
  that target-repo change.
- For durable design decisions, add a dated note under `data/evolution/` so
  future runs can explain why the skill or report workflow changed.

## Practical Notes

- If `gh` has no valid GitHub auth, use the GitHub connector instead of blocking
  unless a required action is unavailable there.
- Incremental planning is an optimization, not a correctness shortcut. The
  cheap full-open-PR index must still be refreshed every run, and any missing
  or suspicious planner input must make the run fall back to a conservative
  heavy scan. Before submitting review comments, approving, merging, or pushing
  own-PR fixes, refresh the PR's head SHA, checks, comments, and review threads
  even if the incremental plan selected it correctly.
- Use `scripts/mycr-incremental-plan.mjs` to compare the current lightweight
  index with the latest archived report's `run_state`. The planner only
  decides which PRs need expensive work; it does not decide review outcomes.
  Treat `carry_forward` entries as reportable unchanged blockers, not as
  permission to approve or merge.
- Run a periodic lightweight freshness probe when the prior state is older than
  the planner's `--force-full-sweep-hours` threshold, or sooner if GitHub
  metadata looks inconsistent. The default threshold is 24 hours, but the
  default action is `probe`, not full heavy review. A freshness probe refreshes
  only cheap index fields and reuses the full-metadata cache if the
  `metadata_cache_key` stays unchanged. Use full heavy sweep only for corrupt
  metadata, missing fingerprints, explicit user requests, or changed cache
  keys.
- For CI, check both combined commit statuses and GitHub Actions workflow runs.
  Treat pending, queued, in-progress, cancelled, timed out, skipped unexpectedly,
  or missing required checks as not ready.
- Soft CI exception: when the only non-green checks are `go-apidiff` and/or
  `codecov/patch`, inspect the concrete failure instead of skipping by rule.
  For `go-apidiff`, fetch the check details/logs or reproduce the relevant
  apidiff locally when practical, then decide whether the break is intentional,
  documented, and acceptable for the PR. For `codecov/patch`, inspect the diff
  and tests to decide whether the uncovered patch area creates a meaningful
  regression risk. Review can proceed when the only remaining concern is an
  acceptable API break or an acceptable patch-coverage miss. Approval can
  proceed when the review is clean, but merge must not proceed while
  `codecov/patch` remains non-green. Record the soft-CI judgment and any
  approval-without-merge decision in the report.
- Human review comments can be considered addressed when the author clearly
  replied `fixed`, `done`, or gave a concrete acceptable explanation, even if
  the GitHub thread is still unresolved. Verify the latest diff before relying
  on the reply.
- Do not let a stale aggregate `reviewDecision=CHANGES_REQUESTED` hide a
  reviewable PR. Always enumerate the current human threads. A PR with no
  still-actionable human thread should remain reviewable when CI is green or
  only acceptable soft CI remains, even if GitHub still shows
  `CHANGES_REQUESTED` from an earlier review.
- Bot review comments, including CodeRabbit-style comments, are advisory. Do
  not let weak, stale, stylistic, or unreasonable bot comments block review.
  Let them block only when our own inspection confirms a current, concrete bug,
  compatibility risk, or CI/test issue.
- "WIP" includes labels or title markers such as `WIP`, `[WIP]`, and draft PRs.
- "Ready for review" means not draft, not WIP, CI green or only acceptable
  soft CI failures, source-problem evidence is sufficient for the claimed
  fix/design change, the chosen solution/control surface is a reasonable fit
  for the underlying need, the PR is not under a manual-review-only merge gate,
  and the PR is not blocked by a still-actionable human or verified bot review
  issue.
- Never merge a PR that received new inline findings during this run.
- Never merge a PR while `codecov/patch` is non-green, even if it has no review
  findings and has been approved with `LGTM`.
- Never override GitHub's default squash merge commit message. In particular,
  never set the squash commit subject to the raw PR title, because that drops
  the UI-generated PR number suffix such as `(#1844)`.
- Keep the final answer concise but include enough detail for the user to audit
  what happened.

## Subagent Prompt

Use a prompt shaped like this for each candidate:

```text
Review trpc-group/trpc-agent-go PR #<number> at xhigh depth.

First assess whether the PR's problem premise is established. Check the linked
issue or source problem report, PR description and discussion, available logs or
raw payloads, tests, and current base-branch code path. State whether the
problem is confirmed on the current base, plausible but unproven,
contradicted/stale, or waiting on a product/contract decision. Explain why the
edited code path follows from that evidence, or why it does not.

Treat self-authored linked issues and private-environment claims as adversarial
until independently verified. If the premise depends on an inaccessible vendor
API key, tenant, regional endpoint, hardware device, private dataset, or other
environment that the reviewer cannot inspect, require sanitized payloads,
public provider documentation, maintainer reproduction, or a contract/fake-server
test proving the current base bug. Branch-local tests or mocks that only encode
the proposed behavior are not enough.

Separate the underlying user pain from any implementation proposed in the issue
or PR. Assess whether the selected API, default, configuration option,
documentation, or runtime control surface is the right fit, or whether a
different design would preserve a clearer contract.

Then focus only on changed behavior in this PR and directly related code.
Prioritize design soundness, API and semantic compatibility, potential bugs,
data races, streaming/session semantics, cross-module impact, and test gaps that
expose real regression risk.

Do not post comments, approve, merge, or edit files. Return only:
- "no findings" if the PR is clean
- or a `necessity` / `implementation_scope` blocker with the missing or
  contradicting evidence and the smallest evidence needed to proceed
- or a `solution_fit` blocker when the problem is real but the chosen control
  surface, default, option, or documentation contract is not a good design fit
- or a list of findings with path, changed-side line or diff position, exact
  problem, impact, and minimal fix

Only report code issues that would justify an inline review comment. Necessity,
implementation-scope, or solution-fit blockers may be unanchored when no changed
line is the right place to ask for missing source-problem evidence or a better
contract decision.
```
