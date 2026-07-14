import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const schemaVersion = 1;
const defaultOverlapMinutes = 10;
const defaultForceFullSweepHours = 24;
const defaultForceFullSweepAction = "probe";
const jsonIndent = 2;
const minuteInMilliseconds = 60 * 1000;
const hourInMilliseconds = 60 * minuteInMilliseconds;

const actionHeavyReview = "heavy_review";
const actionCarryForward = "carry_forward";
const actionRefreshProbe = "refresh_probe";

const cacheModeRefreshFullMetadata = "refresh_full_metadata";
const cacheModeRefreshProbe = "refresh_lightweight_probe";
const cacheModeReusePreviousResult = "reuse_previous_result";

const reasonNoPreviousState = "no_previous_state";
const reasonNewPr = "new_pr";
const reasonForceFullSweep = "force_full_sweep";
const reasonHeadChanged = "head_sha_changed";
const reasonChecksChanged = "checks_changed";
const reasonThreadsChanged = "review_threads_changed";
const reasonCommentsChanged = "comments_changed";
const reasonReviewDecisionChanged = "review_decision_changed";
const reasonMergeabilityChanged = "mergeability_changed";
const reasonReadinessChanged = "readiness_changed";
const reasonBaseChanged = "base_ref_changed";
const reasonUpdatedAfterWatermark = "updated_after_watermark";
const reasonPreviousNotReached = "previous_not_reached";
const reasonMissingFingerprint = "missing_required_fingerprint";
const reasonUnchanged = "unchanged_since_last_run";

const wipLabelPattern = /\bwip\b/iu;
const wipTitlePattern = /(?:^|\W)wip(?:\W|$)/iu;

function usage() {
  console.error(
    [
      "usage: node scripts/mycr-incremental-plan.mjs --current <snapshot.json> [--previous <state-or-report.json>] [--output <plan.json>]",
      "",
      "Options:",
      "  --overlap-minutes <n>          Re-scan activity newer than previous start minus this overlap. Default: 10",
      "  --force-full-sweep-hours <n>   Run stale-state freshness handling when the previous state is older than this. Default: 24",
      "  --force-full-sweep-action <probe|heavy>",
      "                                Use a lightweight refresh probe for stale unchanged PRs, or force heavy review. Default: probe",
    ].join("\n"),
  );
}

function parseArgs(argv) {
  const parsed = {
    currentPath: "",
    previousPath: "",
    outputPath: "",
    overlapMinutes: defaultOverlapMinutes,
    forceFullSweepHours: defaultForceFullSweepHours,
    forceFullSweepAction: defaultForceFullSweepAction,
  };

  const args = [...argv];
  while (args.length > 0) {
    const arg = args.shift();
    if (arg === "--current") {
      parsed.currentPath = args.shift() || "";
      continue;
    }
    if (arg === "--previous") {
      parsed.previousPath = args.shift() || "";
      continue;
    }
    if (arg === "--output") {
      parsed.outputPath = args.shift() || "";
      continue;
    }
    if (arg === "--overlap-minutes") {
      parsed.overlapMinutes = parseNonNegativeNumber(
        args.shift(),
        "--overlap-minutes",
      );
      continue;
    }
    if (arg === "--force-full-sweep-hours") {
      parsed.forceFullSweepHours = parseNonNegativeNumber(
        args.shift(),
        "--force-full-sweep-hours",
      );
      continue;
    }
    if (arg === "--force-full-sweep-action") {
      parsed.forceFullSweepAction = parseForceFullSweepAction(args.shift());
      continue;
    }
    throw new Error(`unexpected argument: ${arg}`);
  }

  if (!parsed.currentPath) {
    throw new Error("missing --current snapshot path");
  }

  return parsed;
}

function parseForceFullSweepAction(value) {
  if (value === "probe" || value === "heavy") {
    return value;
  }
  throw new Error("--force-full-sweep-action must be probe or heavy");
}

function parseNonNegativeNumber(value, flagName) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${flagName} must be a non-negative number`);
  }
  return parsed;
}

async function readJson(filePath) {
  const raw = await readFile(filePath, "utf8");
  return JSON.parse(raw);
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function asString(value) {
  return typeof value === "string" ? value : "";
}

function asNumber(value) {
  return Number.isFinite(value) ? value : 0;
}

function normalizeDate(value) {
  const text = asString(value);
  if (!text) {
    return "";
  }
  const timestamp = Date.parse(text);
  if (Number.isNaN(timestamp)) {
    return text;
  }
  return new Date(timestamp).toISOString();
}

function dateValue(value) {
  const timestamp = Date.parse(asString(value));
  return Number.isNaN(timestamp) ? 0 : timestamp;
}

function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const keys = Object.keys(value).sort();
    const fields = keys.map(
      (key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`,
    );
    return `{${fields.join(",")}}`;
  }
  return JSON.stringify(value);
}

function shortHash(value) {
  return createHash("sha256").update(value).digest("hex").slice(0, 24);
}

function normalizeLabels(pr) {
  return asArray(pr.labels)
    .map((label) => {
      if (typeof label === "string") {
        return label;
      }
      return asString(label?.name);
    })
    .filter(Boolean)
    .sort((left, right) => left.localeCompare(right));
}

function hasWipMarker(title, labels) {
  return (
    wipTitlePattern.test(asString(title)) ||
    labels.some((label) => wipLabelPattern.test(label))
  );
}

function normalizeFingerprint(pr, explicitField, fallbackFields) {
  if (typeof pr[explicitField] === "string" && pr[explicitField]) {
    return pr[explicitField];
  }

  for (const field of fallbackFields) {
    if (pr[field] !== undefined) {
      return stableStringify(pr[field]);
    }
  }

  return "";
}

function normalizePullRequest(pr) {
  const labels = normalizeLabels(pr);
  const title = asString(pr.title);
  const isDraft = Boolean(pr.is_draft ?? pr.isDraft ?? pr.draft);
  const headSha = asString(pr.head_sha ?? pr.headSha);
  const baseRef = asString(pr.base_ref ?? pr.baseRefName ?? pr.baseRef ?? pr.base);
  const updatedAt = normalizeDate(pr.updated_at ?? pr.updatedAt);
  const latestActivityAt = normalizeDate(
    pr.latest_activity_at ?? pr.latestActivityAt ?? pr.updated_at ?? pr.updatedAt,
  );

  return {
    number: asNumber(pr.number),
    title,
    url: asString(pr.url),
    author: asString(pr.author ?? pr.author_login ?? pr.authorLogin),
    state: asString(pr.state || "OPEN").toUpperCase(),
    is_draft: isDraft,
    is_wip: Boolean(pr.is_wip ?? pr.isWip ?? pr.wip ?? hasWipMarker(title, labels)),
    labels,
    base_ref: baseRef,
    head_ref: asString(pr.head_ref ?? pr.headRefName ?? pr.headRef),
    head_sha: headSha,
    updated_at: updatedAt,
    latest_activity_at: latestActivityAt,
    mergeable: asString(pr.mergeable),
    review_decision: asString(pr.review_decision ?? pr.reviewDecision),
    checks_fingerprint: normalizeFingerprint(pr, "checks_fingerprint", [
      "checks",
      "status_checks",
      "statusChecks",
      "workflow_runs",
      "workflowRuns",
    ]),
    review_threads_fingerprint: normalizeFingerprint(
      pr,
      "review_threads_fingerprint",
      ["review_threads", "reviewThreads"],
    ),
    comments_fingerprint: normalizeFingerprint(pr, "comments_fingerprint", [
      "comments",
      "reviews",
    ]),
    metadata_cache_key: asString(pr.metadata_cache_key ?? pr.metadataCacheKey),
  };
}

function normalizePullRequests(value) {
  const source = value?.pull_requests ?? value?.pullRequests ?? value;
  if (Array.isArray(source)) {
    return source.map(normalizePullRequest).filter((pr) => pr.number > 0);
  }
  if (source && typeof source === "object") {
    return Object.values(source)
      .map(normalizePullRequest)
      .filter((pr) => pr.number > 0);
  }
  return [];
}

function extractRunState(value) {
  if (!value) {
    return {
      generated_at: "",
      run_started_at: "",
      pull_requests: {},
    };
  }

  const state = value.run_state ?? value.runState ?? value;
  const pullRequests = {};
  for (const pr of normalizePullRequests(state)) {
    pullRequests[String(pr.number)] = {
      ...pr,
      metadata_cache_key:
        pr.metadata_cache_key || metadataCacheKey(pr),
      ledger_bucket: asString(pr.ledger_bucket ?? pr.ledgerBucket),
      last_action: asString(pr.last_action ?? pr.lastAction),
      last_heavy_reviewed_head_sha: asString(
        pr.last_heavy_reviewed_head_sha ?? pr.lastHeavyReviewedHeadSha,
      ),
      last_verified_at: normalizeDate(pr.last_verified_at ?? pr.lastVerifiedAt),
      blockers: asArray(pr.blockers),
    };
  }

  mergeReportOutcomes(pullRequests, value);

  return {
    generated_at: normalizeDate(
      state.generated_at ?? state.generatedAt ?? value.generated_at,
    ),
    run_started_at: normalizeDate(
      state.run_started_at ?? state.runStartedAt ?? state.started_at ?? state.startedAt,
    ),
    pull_requests: pullRequests,
  };
}

function mergeReportOutcomes(pullRequests, source) {
  for (const outcome of collectReportOutcomes(source)) {
    const pr = pullRequests[String(outcome.number)];
    if (!pr) {
      continue;
    }
    pr.ledger_bucket = outcome.ledger_bucket || pr.ledger_bucket;
    pr.last_action = outcome.last_action || pr.last_action;
    pr.last_outcome = outcome.outcome || pr.last_outcome || "";
    pr.last_risk = outcome.risk || pr.last_risk || "";
    if (outcome.blockers.length > 0) {
      pr.blockers = outcome.blockers;
    }
  }
}

function collectReportOutcomes(source) {
  if (!source || typeof source !== "object") {
    return [];
  }

  const outcomes = [];
  for (const item of asArray(source.approved)) {
    outcomes.push(reportOutcome(item, "processed", "approved"));
  }
  for (const item of asArray(source.commented)) {
    outcomes.push(reportOutcome(item, "blocked", "commented"));
  }
  for (const item of asArray(source.maintained)) {
    outcomes.push(reportOutcome(item, "processed", "maintained"));
  }
  for (const item of asArray(source.blocked)) {
    outcomes.push(reportOutcome(item, "blocked", "blocked"));
  }
  for (const item of asArray(source.follow_up)) {
    outcomes.push(reportOutcome(item, "blocked", asString(item.status) || "follow_up"));
  }

  for (const group of asArray(source.skipped_groups)) {
    const groupReason = asString(group.reason);
    for (const item of asArray(group.items)) {
      const skipReason = asString(item.skip_reason);
      const notReached = isNotReachedText(`${groupReason} ${skipReason}`);
      outcomes.push(
        reportOutcome(
          item,
          notReached ? "not_reached" : "blocked",
          notReached ? "not_reached" : "skipped",
        ),
      );
    }
  }

  return outcomes.filter((outcome) => outcome.number > 0);
}

function reportOutcome(item, ledgerBucket, lastAction) {
  return {
    number: asNumber(item?.number),
    ledger_bucket: ledgerBucket,
    last_action: lastAction,
    outcome: asString(item?.outcome),
    risk: asString(item?.risk),
    blockers: normalizeReportBlockers(item),
  };
}

function normalizeReportBlockers(item) {
  const blockers = asArray(item?.blockers);
  if (blockers.length > 0) {
    return blockers;
  }

  return asArray(item?.inline_comments)
    .map((comment) => {
      if (!comment || typeof comment !== "object" || Array.isArray(comment)) {
        return {};
      }
      return {
        kind: "human_review",
        summary: asString(comment.summary || comment.body),
        url: asString(comment.url),
        path: asString(comment.path),
        line: asNumber(comment.line),
      };
    })
    .filter((blocker) => blocker.summary || blocker.url);
}

function isNotReachedText(value) {
  return /not[_ -]?reached|未进入|未处理|未触达/iu.test(asString(value));
}

function readinessFingerprint(pr) {
  return stableStringify({
    state: pr.state,
    is_draft: pr.is_draft,
    is_wip: pr.is_wip,
  });
}

function metadataCacheKey(pr) {
  return shortHash(
    stableStringify({
      number: pr.number,
      base_ref: pr.base_ref,
      head_sha: pr.head_sha,
      mergeable: pr.mergeable,
      review_decision: pr.review_decision,
      readiness: readinessFingerprint(pr),
      checks_fingerprint: pr.checks_fingerprint,
      review_threads_fingerprint: pr.review_threads_fingerprint,
      comments_fingerprint: pr.comments_fingerprint,
    }),
  );
}

function reasonIfChanged(reasons, current, previous, field, reason) {
  if (current[field] !== previous[field]) {
    reasons.push(reason);
  }
}

function hasMissingRequiredFingerprint(current, previous) {
  const requiredFields = [
    "checks_fingerprint",
    "review_threads_fingerprint",
    "comments_fingerprint",
  ];
  return requiredFields.some((field) => !current[field] || !previous[field]);
}

function isPreviouslyNotReached(previous) {
  return (
    previous.ledger_bucket === "not_reached" ||
    previous.last_action === "not_reached"
  );
}

function shouldForceFullSweep(previousState, generatedAt, forceFullSweepHours) {
  const previousTime = dateValue(
    previousState.run_started_at || previousState.generated_at,
  );
  const currentTime = dateValue(generatedAt);
  if (previousTime === 0 || currentTime === 0) {
    return false;
  }
  const maxAge = forceFullSweepHours * hourInMilliseconds;
  return maxAge > 0 && currentTime - previousTime >= maxAge;
}

function makeWatermark(previousState, overlapMinutes) {
  const baseTime = dateValue(
    previousState.run_started_at || previousState.generated_at,
  );
  if (baseTime === 0) {
    return "";
  }
  return new Date(baseTime - overlapMinutes * minuteInMilliseconds).toISOString();
}

function updatedAfterWatermark(pr, watermark) {
  const watermarkTime = dateValue(watermark);
  const activityTime = dateValue(pr.latest_activity_at || pr.updated_at);
  return watermarkTime > 0 && activityTime > watermarkTime;
}

function planPullRequest(current, previous, options) {
  const reasons = [];

  if (!previous) {
    reasons.push(options.hasPreviousState ? reasonNewPr : reasonNoPreviousState);
    return {
      action: actionHeavyReview,
      reasons,
    };
  }

  if (hasMissingRequiredFingerprint(current, previous)) {
    reasons.push(reasonMissingFingerprint);
  }

  reasonIfChanged(reasons, current, previous, "head_sha", reasonHeadChanged);
  reasonIfChanged(reasons, current, previous, "checks_fingerprint", reasonChecksChanged);
  reasonIfChanged(
    reasons,
    current,
    previous,
    "review_threads_fingerprint",
    reasonThreadsChanged,
  );
  reasonIfChanged(reasons, current, previous, "comments_fingerprint", reasonCommentsChanged);
  reasonIfChanged(reasons, current, previous, "review_decision", reasonReviewDecisionChanged);
  reasonIfChanged(reasons, current, previous, "mergeable", reasonMergeabilityChanged);
  reasonIfChanged(reasons, current, previous, "base_ref", reasonBaseChanged);

  if (readinessFingerprint(current) !== readinessFingerprint(previous)) {
    reasons.push(reasonReadinessChanged);
  }

  if (isPreviouslyNotReached(previous)) {
    reasons.push(reasonPreviousNotReached);
  }

  if (
    current.latest_activity_at !== previous.latest_activity_at &&
    updatedAfterWatermark(current, options.watermark)
  ) {
    reasons.push(reasonUpdatedAfterWatermark);
  }

  const uniqueReasons = [...new Set(reasons)];
  if (uniqueReasons.length > 0) {
    return {
      action: actionHeavyReview,
      reasons: uniqueReasons,
    };
  }

  if (options.forceFullSweep) {
    return {
      action:
        options.forceFullSweepAction === "heavy"
          ? actionHeavyReview
          : actionRefreshProbe,
      reasons: [reasonForceFullSweep],
    };
  }

  return {
    action: actionCarryForward,
    reasons: [reasonUnchanged],
  };
}

function cacheModeForAction(action) {
  if (action === actionHeavyReview) {
    return cacheModeRefreshFullMetadata;
  }
  if (action === actionRefreshProbe) {
    return cacheModeRefreshProbe;
  }
  return cacheModeReusePreviousResult;
}

function makePlan(currentSnapshot, previousSnapshot, options = {}) {
  const generatedAt = normalizeDate(
    currentSnapshot.generated_at ?? currentSnapshot.generatedAt ?? new Date().toISOString(),
  );
  const previousState = extractRunState(previousSnapshot);
  const hasPreviousState = Object.keys(previousState.pull_requests).length > 0;
  const overlapMinutes = options.overlapMinutes ?? defaultOverlapMinutes;
  const forceFullSweepHours =
    options.forceFullSweepHours ?? defaultForceFullSweepHours;
  const forceFullSweepAction =
    options.forceFullSweepAction ?? defaultForceFullSweepAction;
  const watermark = makeWatermark(previousState, overlapMinutes);
  const forceFullSweep = shouldForceFullSweep(
    previousState,
    generatedAt,
    forceFullSweepHours,
  );

  const queue = normalizePullRequests(currentSnapshot).map((current) => {
    const previous = previousState.pull_requests[String(current.number)];
    const planned = planPullRequest(current, previous, {
      forceFullSweep,
      forceFullSweepAction,
      hasPreviousState,
      watermark,
    });
    const currentCacheKey = current.metadata_cache_key || metadataCacheKey(current);
    const previousCacheKey =
      previous?.metadata_cache_key || (previous ? metadataCacheKey(previous) : "");
    return {
      number: current.number,
      title: current.title,
      url: current.url,
      author: current.author,
      action: planned.action,
      cache_mode: cacheModeForAction(planned.action),
      metadata_cache_key: currentCacheKey,
      previous_metadata_cache_key: previousCacheKey,
      reasons: planned.reasons,
      head_sha: current.head_sha,
      previous_head_sha: previous?.head_sha || "",
      previous_bucket: previous?.ledger_bucket || "",
      previous_last_action: previous?.last_action || "",
      latest_activity_at: current.latest_activity_at,
    };
  });

  const heavyReview = queue.filter((item) => item.action === actionHeavyReview);
  const refreshProbe = queue.filter((item) => item.action === actionRefreshProbe);
  const carryForward = queue.filter((item) => item.action === actionCarryForward);
  const currentByNumber = new Set(queue.map((item) => String(item.number)));
  const closedOrMissing = Object.values(previousState.pull_requests)
    .filter((previous) => !currentByNumber.has(String(previous.number)))
    .map((previous) => ({
      number: previous.number,
      title: previous.title,
      url: previous.url,
      author: previous.author,
      previous_bucket: previous.ledger_bucket || "",
      previous_last_action: previous.last_action || "",
    }));

  const runStatePullRequests = {};
  for (const current of normalizePullRequests(currentSnapshot)) {
    const queueItem = queue.find((item) => item.number === current.number);
    const previous = previousState.pull_requests[String(current.number)];
    runStatePullRequests[String(current.number)] = {
      ...current,
      metadata_cache_key: current.metadata_cache_key || metadataCacheKey(current),
      ledger_bucket:
        queueItem.action === actionHeavyReview
          ? "eligible_candidate"
          : queueItem.action === actionRefreshProbe
            ? "refresh_probe"
          : "carried_forward",
      last_action: queueItem.action,
      last_heavy_reviewed_head_sha:
        queueItem.action === actionHeavyReview
          ? current.head_sha
          : previous?.last_heavy_reviewed_head_sha || previous?.head_sha || "",
      last_verified_at: generatedAt,
      planning_reasons: queueItem.reasons,
      blockers: previous?.blockers || [],
    };
  }

  return {
    schema_version: schemaVersion,
    generated_at: generatedAt,
    repo: asString(currentSnapshot.repo),
    previous_generated_at: previousState.generated_at,
    overlap_watermark: watermark,
    force_full_sweep: forceFullSweep,
    force_full_sweep_action: forceFullSweepAction,
    totals: {
      open: queue.length,
      heavy_review: heavyReview.length,
      refresh_probe: refreshProbe.length,
      carry_forward: carryForward.length,
      closed_or_missing: closedOrMissing.length,
    },
    queue,
    heavy_review: heavyReview,
    refresh_probe: refreshProbe,
    carry_forward: carryForward,
    closed_or_missing: closedOrMissing,
    run_state: {
      schema_version: schemaVersion,
      generated_at: generatedAt,
      run_started_at: generatedAt,
      repo: asString(currentSnapshot.repo),
      overlap_watermark: watermark,
      pull_requests: runStatePullRequests,
    },
  };
}

async function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (error) {
    usage();
    throw error;
  }

  const currentSnapshot = await readJson(path.resolve(args.currentPath));
  const previousSnapshot = args.previousPath
    ? await readJson(path.resolve(args.previousPath))
    : undefined;
  const plan = makePlan(currentSnapshot, previousSnapshot, {
    overlapMinutes: args.overlapMinutes,
    forceFullSweepHours: args.forceFullSweepHours,
    forceFullSweepAction: args.forceFullSweepAction,
  });
  const output = `${JSON.stringify(plan, null, jsonIndent)}\n`;

  if (args.outputPath) {
    await writeFile(path.resolve(args.outputPath), output, "utf8");
  } else {
    process.stdout.write(output);
  }
}

const currentFileUrl = pathToFileURL(fileURLToPath(import.meta.url)).href;
if (
  process.argv[1] &&
  pathToFileURL(path.resolve(process.argv[1])).href === currentFileUrl
) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

export {
  actionCarryForward,
  actionHeavyReview,
  actionRefreshProbe,
  makePlan,
  metadataCacheKey,
  normalizePullRequest,
  reasonChecksChanged,
  reasonForceFullSweep,
  reasonHeadChanged,
  reasonNewPr,
  reasonNoPreviousState,
  reasonMissingFingerprint,
  reasonUnchanged,
  reasonUpdatedAfterWatermark,
};
