import assert from "node:assert/strict";

import {
  actionCarryForward,
  actionHeavyReview,
  actionRefreshProbe,
  makePlan,
  metadataCacheKey,
  normalizePullRequest,
  reasonChecksChanged,
  reasonForceFullSweep,
  reasonHeadChanged,
  reasonMissingFingerprint,
  reasonNewPr,
  reasonNoPreviousState,
  reasonUnchanged,
  reasonUpdatedAfterWatermark,
} from "./mycr-incremental-plan.mjs";

const repo = "trpc-group/trpc-agent-go";
const generatedAt = "2026-06-01T10:00:00.000Z";
const previousGeneratedAt = "2026-06-01T09:00:00.000Z";

function pr(overrides = {}) {
  return {
    number: 100,
    title: "agent: test incremental planning",
    url: "https://github.com/trpc-group/trpc-agent-go/pull/100",
    author: "reviewer",
    state: "OPEN",
    is_draft: false,
    labels: [],
    base_ref: "main",
    head_ref: "feature",
    head_sha: "head-a",
    updated_at: "2026-06-01T08:55:00.000Z",
    latest_activity_at: "2026-06-01T08:55:00.000Z",
    mergeable: "MERGEABLE",
    review_decision: "",
    checks_fingerprint: "checks-ok",
    review_threads_fingerprint: "threads-none",
    comments_fingerprint: "comments-none",
    ...overrides,
  };
}

function currentSnapshot(pullRequests) {
  return {
    repo,
    generated_at: generatedAt,
    pull_requests: pullRequests,
  };
}

function previousSnapshot(pullRequests, overrides = {}) {
  const pullRequestMap = {};
  for (const pullRequest of pullRequests) {
    pullRequestMap[String(pullRequest.number)] = {
      ...pullRequest,
      ledger_bucket: "blocked",
      last_action: actionCarryForward,
      last_verified_at: previousGeneratedAt,
    };
  }
  return {
    run_state: {
      schema_version: 1,
      repo,
      generated_at: previousGeneratedAt,
      run_started_at: previousGeneratedAt,
      pull_requests: pullRequestMap,
      ...overrides,
    },
  };
}

function queueItem(plan, number = 100) {
  return plan.queue.find((item) => item.number === number);
}

{
  const normalized = normalizePullRequest(
    pr({
      title: "[WIP] model: add option",
      labels: [{ name: "needs-review" }],
    }),
  );
  assert.equal(normalized.is_wip, true);
  assert.deepEqual(normalized.labels, ["needs-review"]);
}

{
  const plan = makePlan(currentSnapshot([pr()]), undefined, {
    overlapMinutes: 10,
    forceFullSweepHours: 24,
  });
  assert.equal(queueItem(plan).action, actionHeavyReview);
  assert.deepEqual(queueItem(plan).reasons, [reasonNoPreviousState]);
}

{
  const plan = makePlan(currentSnapshot([pr({ number: 101 })]), previousSnapshot([pr()]), {
    overlapMinutes: 10,
    forceFullSweepHours: 24,
  });
  assert.equal(queueItem(plan, 101).action, actionHeavyReview);
  assert.deepEqual(queueItem(plan, 101).reasons, [reasonNewPr]);
}

{
  const basePr = pr();
  const plan = makePlan(currentSnapshot([basePr]), previousSnapshot([basePr]), {
    overlapMinutes: 10,
    forceFullSweepHours: 24,
  });
  assert.equal(queueItem(plan).action, actionCarryForward);
  assert.deepEqual(queueItem(plan).reasons, [reasonUnchanged]);
}

{
  const basePr = pr();
  const changed = pr({ head_sha: "head-b" });
  const plan = makePlan(currentSnapshot([changed]), previousSnapshot([basePr]), {
    overlapMinutes: 10,
    forceFullSweepHours: 24,
  });
  assert.equal(queueItem(plan).action, actionHeavyReview);
  assert.ok(queueItem(plan).reasons.includes(reasonHeadChanged));
}

{
  const basePr = pr();
  const changed = pr({ checks_fingerprint: "checks-pending" });
  const plan = makePlan(currentSnapshot([changed]), previousSnapshot([basePr]), {
    overlapMinutes: 10,
    forceFullSweepHours: 24,
  });
  assert.equal(queueItem(plan).action, actionHeavyReview);
  assert.ok(queueItem(plan).reasons.includes(reasonChecksChanged));
}

{
  const basePr = pr();
  const missing = pr({ review_threads_fingerprint: "" });
  const plan = makePlan(currentSnapshot([missing]), previousSnapshot([basePr]), {
    overlapMinutes: 10,
    forceFullSweepHours: 24,
  });
  assert.equal(queueItem(plan).action, actionHeavyReview);
  assert.ok(queueItem(plan).reasons.includes(reasonMissingFingerprint));
}

{
  const basePr = pr();
  const changed = pr({
    updated_at: "2026-06-01T09:55:00.000Z",
    latest_activity_at: "2026-06-01T09:55:00.000Z",
  });
  const plan = makePlan(currentSnapshot([changed]), previousSnapshot([basePr]), {
    overlapMinutes: 10,
    forceFullSweepHours: 24,
  });
  assert.equal(queueItem(plan).action, actionHeavyReview);
  assert.ok(queueItem(plan).reasons.includes(reasonUpdatedAfterWatermark));
}

{
  const basePr = pr();
  const plan = makePlan(
    currentSnapshot([basePr]),
    previousSnapshot([basePr], {
      generated_at: "2026-05-31T08:00:00.000Z",
      run_started_at: "2026-05-31T08:00:00.000Z",
    }),
    {
      overlapMinutes: 10,
      forceFullSweepHours: 24,
    },
  );
  assert.equal(plan.force_full_sweep, true);
  assert.equal(plan.force_full_sweep_action, "probe");
  assert.equal(queueItem(plan).action, actionRefreshProbe);
  assert.equal(queueItem(plan).cache_mode, "refresh_lightweight_probe");
  assert.ok(queueItem(plan).reasons.includes(reasonForceFullSweep));
  assert.equal(plan.totals.refresh_probe, 1);
}

{
  const current = pr({
    labels: ["needs-review"],
  });
  const legacy = pr();
  legacy.base = legacy.base_ref;
  legacy.draft = legacy.is_draft;
  legacy.wip = legacy.is_wip;
  delete legacy.base_ref;
  delete legacy.is_draft;
  delete legacy.is_wip;
  delete legacy.labels;

  const plan = makePlan(currentSnapshot([current]), previousSnapshot([legacy]), {
    overlapMinutes: 10,
    forceFullSweepHours: 24,
  });
  assert.equal(queueItem(plan).action, actionCarryForward);
  assert.deepEqual(queueItem(plan).reasons, [reasonUnchanged]);
}

{
  const basePr = pr();
  const plan = makePlan(
    currentSnapshot([basePr]),
    previousSnapshot([basePr], {
      generated_at: "2026-05-31T08:00:00.000Z",
      run_started_at: "2026-05-31T08:00:00.000Z",
    }),
    {
      overlapMinutes: 10,
      forceFullSweepHours: 24,
      forceFullSweepAction: "heavy",
    },
  );
  assert.equal(plan.force_full_sweep, true);
  assert.equal(plan.force_full_sweep_action, "heavy");
  assert.equal(queueItem(plan).action, actionHeavyReview);
  assert.ok(queueItem(plan).reasons.includes(reasonForceFullSweep));
}

{
  const basePr = pr();
  const normalized = normalizePullRequest(basePr);
  const plan = makePlan(currentSnapshot([basePr]), previousSnapshot([basePr]), {
    overlapMinutes: 10,
    forceFullSweepHours: 24,
  });
  assert.equal(queueItem(plan).metadata_cache_key, metadataCacheKey(normalized));
  assert.equal(
    plan.run_state.pull_requests["100"].metadata_cache_key,
    metadataCacheKey(normalized),
  );
}

{
  const basePr = pr();
  const report = {
    run_state: previousSnapshot([basePr]).run_state,
    skipped_groups: [
      {
        reason: "Existing unresolved human review threads",
        items: [
          {
            number: 100,
            title: basePr.title,
            blockers: [
              {
                kind: "human_review",
                summary: "Reviewer asked for a current-line fix.",
                url: "https://github.com/trpc-group/trpc-agent-go/pull/100#discussion",
              },
            ],
          },
        ],
      },
    ],
  };
  const plan = makePlan(currentSnapshot([basePr]), report, {
    overlapMinutes: 10,
    forceFullSweepHours: 24,
  });
  assert.equal(queueItem(plan).action, actionCarryForward);
  assert.deepEqual(plan.run_state.pull_requests["100"].blockers, [
    {
      kind: "human_review",
      summary: "Reviewer asked for a current-line fix.",
      url: "https://github.com/trpc-group/trpc-agent-go/pull/100#discussion",
    },
  ]);
}

console.log("validated incremental planner behavior");
