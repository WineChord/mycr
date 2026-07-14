import { constants as fsConstants } from "node:fs";
import { access, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceReportDir = path.join(repoRoot, "src", "data", "reports");
const publicReportDir = path.join(repoRoot, "public", "reports");
const jsonExtension = ".json";
const htmlExtension = ".html";

const processedGroups = ["approved", "commented", "maintained", "blocked"];
const allowedStatusByGroup = {
  approved: new Set(["approved", "merged"]),
  commented: new Set(["commented"]),
  maintained: new Set(["maintained"]),
  blocked: new Set(["blocked"]),
};
const renderedDetailFields = [
  "technical_background",
  "problem",
  "necessity_assessment",
  "evidence_checked",
  "reproduction_on_base",
  "issue_evidence_gaps",
  "problem_framing",
  "root_cause",
  "approach",
  "implementation_derivation",
  "solution_fit_assessment",
  "alternative_designs",
  "tradeoffs",
  "design_assessment",
  "modules",
  "api_surface",
  "change_inventory",
  "semantic_changes",
  "module_impact",
  "cross_module_impact",
  "behavior_impact",
  "tests_docs",
  "outcome",
  "ci_state",
  "risk",
  "review_action",
  "merge_policy",
  "self_review_policy",
];

const richReviewedFields = [
  "technical_background",
  "problem",
  "necessity_assessment",
  "evidence_checked",
  "problem_framing",
  "approach",
  "implementation_derivation",
  "solution_fit_assessment",
  "alternative_designs",
  "tradeoffs",
  "design_assessment",
  "modules",
  "api_surface",
  "change_inventory",
  "semantic_changes",
  "module_impact",
  "cross_module_impact",
  "behavior_impact",
  "tests_docs",
  "outcome",
  "ci_state",
];

const richBlockedFields = [
  "technical_background",
  "problem",
  "necessity_assessment",
  "evidence_checked",
  "problem_framing",
  "approach",
  "solution_fit_assessment",
  "design_assessment",
  "modules",
  "api_surface",
  "change_inventory",
  "semantic_changes",
  "module_impact",
  "cross_module_impact",
  "behavior_impact",
  "outcome",
];
const publicForbiddenKeys = new Set([
  "comment_only",
  "run_state",
  "incremental_plan",
  "metadata_cache_key",
  "checks_fingerprint",
  "review_threads_fingerprint",
  "comments_fingerprint",
  "ledger_bucket",
  "planning_reasons",
  "target_checkout",
  "target_checkout_dirty_preserved",
  "target_worktree_dirty_preserved",
]);
const publicForbiddenText = [
  /\/Users\/guoqizhou/u,
  /\.mycr-cache/u,
  /\bheartbeat\b/iu,
  /心跳/u,
  /用户明确要求/u,
  /用户要求/u,
  /用户只允许/u,
  /用户限制/u,
  /只允许 comments/u,
  /运行策略只允许/u,
  /\bsubagent\b/iu,
  /\bxhigh\b/iu,
  /\bfinalizer\b/iu,
  /\bcollector\b/iu,
  /\bplanner\b/iu,
  /clean[-_ ]deferred/iu,
  /previous_reviewed_clean_comment_only/iu,
  /\bnot_reached_status_refresh\b/iu,
  /\bnot_reached_this_run\b/iu,
  /\blate_new_pr_after_initial_scan\b/iu,
  /comment-only run/iu,
  /本轮保持 deferred/u,
  /上轮已复核 clean/u,
  /lightweight state/iu,
  /增量计划/u,
  /历史状态字段/u,
  /轻量索引/u,
  /状态已刷新/u,
  /\bcheap-index\b/iu,
  /持久化状态字段/u,
  /\brenderer\b/iu,
  /reviewed_clean_deferred/iu,
  /reviewed_manual_deferred/iu,
  /status_refreshed_waiting_trigger/iu,
  /fast-forward pull/iu,
  /\bfast-forward\b/iu,
  /origin\/wine\/june/iu,
  /REST fallback/iu,
  /GitHub App/u,
  /目标\s*checkout/u,
  /target\s+checkout/iu,
  /checkout\s+dirty/iu,
  /worktree\s+dirty/iu,
  /未提交改动/u,
  /源报告/u,
  /源 JSON/u,
  /深度复核队列/u,
  /performed_via_github_app/iu,
  /run cache/iu,
  /independent report QA/iu,
  /source ledger/iu,
  /独立报告 QA/u,
  /独立二审/u,
  /cache key/iu,
  /fingerprint/iu,
  /cache\/fingerprint\/planning/iu,
  /计划元数据/u,
  /\brun state\b/iu,
];
const publicJsonOnlyForbiddenText = [
  /\bnot_reached\b/iu,
  /\blate_new_pr_after_initial_scan\b/iu,
];
const publicVisiblePlaceholderText = [
  /\bundefined\b/iu,
  /\bnull\b/iu,
  /\bTODO\b/u,
  /\bplaceholder\b/iu,
  /待补充/u,
];

function usage() {
  console.error(
    "usage: node scripts/report-quality.mjs (--latest | --file <report.json>) [--check] [--write] [--public]",
  );
}

function parseArgs(argv) {
  const parsed = {
    file: "",
    latest: false,
    check: false,
    write: false,
    public: false,
  };
  const args = [...argv];
  while (args.length > 0) {
    const arg = args.shift();
    if (arg === "--latest") {
      parsed.latest = true;
      continue;
    }
    if (arg === "--file") {
      parsed.file = args.shift() || "";
      continue;
    }
    if (arg === "--check") {
      parsed.check = true;
      continue;
    }
    if (arg === "--write") {
      parsed.write = true;
      continue;
    }
    if (arg === "--public") {
      parsed.public = true;
      continue;
    }
    throw new Error(`unexpected argument: ${arg}`);
  }
  if (parsed.latest === Boolean(parsed.file)) {
    throw new Error("pass exactly one of --latest or --file <report.json>");
  }
  if (!parsed.check && !parsed.write) {
    parsed.check = true;
  }
  return parsed;
}

async function exists(filePath) {
  try {
    await access(filePath, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function latestReportPath() {
  const entries = await readdir(sourceReportDir);
  const reports = entries
    .filter((entry) => entry.endsWith(jsonExtension))
    .sort();
  if (reports.length === 0) {
    throw new Error("no report JSON files found");
  }
  return path.join(sourceReportDir, reports.at(-1));
}

async function readReport(reportPath) {
  const raw = await readFile(reportPath, "utf8");
  const data = JSON.parse(raw);
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error(`${reportPath}: report must be a JSON object`);
  }
  return data;
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function text(value) {
  if (typeof value === "string") {
    return value.trim();
  }
  if (Array.isArray(value)) {
    return value.map(text).filter(Boolean).join("; ");
  }
  if (value && typeof value === "object") {
    return text(value.zh || value.en || value.summary || value.body || value.mode || "");
  }
  if (value === undefined || value === null) {
    return "";
  }
  return String(value).trim();
}

function isFilled(value) {
  return text(value) !== "";
}

function nonGreenChecks(state) {
  return asArray(state.checks)
    .filter((check) => {
      const status = String(check.state || check.conclusion || check.bucket || "")
        .toLowerCase();
      return status && !["success", "pass", "passed", "neutral"].includes(status);
    })
    .map((check) => {
      const label = [check.name, check.workflow].filter(Boolean).join("@");
      return `${label || "check"}=${check.state || check.bucket || "unknown"}`;
    });
}

function checkSummary(state) {
  const bad = nonGreenChecks(state);
  if (bad.length === 0) {
    return "Latest lightweight ledger did not record non-green checks.";
  }
  return `Non-green checks in latest lightweight ledger: ${bad.slice(0, 6).join(", ")}${bad.length > 6 ? ", ..." : ""}.`;
}

function skipReason(reason, state) {
  const base = String(reason || "skipped");
  if (base === "draft_or_wip") {
    return `Draft/WIP gate blocked review before code audit (draft=${Boolean(state.is_draft)}, wip=${Boolean(state.is_wip)}).`;
  }
  if (base === "own_pr_no_self_review") {
    return "Own-PR policy blocked GitHub review actions: MyCR must not self-review, self-approve, or self-merge; use the direct maintenance path when ready.";
  }
  if (base === "hard_ci_or_required_check_failure") {
    return `Required check gate blocked review. ${checkSummary(state)}`;
  }
  if (base === "soft_check_or_coverage_gate") {
    return `Soft gate needs explicit audit before merge. ${checkSummary(state)}`;
  }
  if (base === "merge_conflict") {
    return `Mergeability gate blocked automation (mergeable=${state.mergeable || "unknown"}).`;
  }
  if (base === "locked_conversation_comment_delivery_risk") {
    return "Conversation is locked, so review/comment delivery must be verified or temporarily unlocked by policy before posting.";
  }
  if (base === "manual_review_or_existing_actionable_review") {
    return `Manual review or existing actionable review gate blocked LGTM (reviewDecision=${state.review_decision || "unknown"}).`;
  }
  return base.replaceAll("_", " ");
}

function blockerKind(reason) {
  if (reason === "draft_or_wip") {
    return "draft_wip";
  }
  if (reason === "own_pr_no_self_review") {
    return "own_pr";
  }
  if (reason === "hard_ci_or_required_check_failure") {
    return "ci";
  }
  if (reason === "soft_check_or_coverage_gate") {
    return "soft_ci";
  }
  if (reason === "merge_conflict") {
    return "merge_conflict";
  }
  if (reason === "manual_review_or_existing_actionable_review") {
    return "manual_review";
  }
  return "other";
}

function skippedItemFromState(number, group, state) {
  const reason = String(group.reason || "skipped");
  const summary = skipReason(reason, state);
  return {
    number: Number(number),
    title: state.title || `PR #${number}`,
    url: state.url || "",
    author: state.author || "",
    status: "skipped",
    skip_reason: summary,
    readiness_audit: summary,
    ci_state: checkSummary(state),
    blockers: [
      {
        kind: blockerKind(reason),
        summary,
        verification: `Derived from latest run_state lightweight ledger for PR #${number}.`,
      },
    ],
  };
}

function normalizeSkippedGroups(report) {
  const stateByPr = asObject(report.run_state?.pull_requests);
  const processedNumbers = new Set(
    processedGroups.flatMap((group) =>
      asArray(report[group])
        .map((item) => Number(item?.number))
        .filter(Boolean),
    ),
  );
  report.skipped_groups = asArray(report.skipped_groups).map((group) => {
    const normalized = { ...group };
    const numbers = asArray(group.prs).length
      ? asArray(group.prs)
      : asArray(group.items).map((item) => item?.number).filter(Boolean);
    const existingItemsByNumber = new Map(
      asArray(group.items)
        .filter((item) => item?.number)
        .map((item) => [Number(item.number), item]),
    );
    normalized.items = numbers
      .filter((number) => !processedNumbers.has(Number(number)))
      .map((number) => {
        const existing = existingItemsByNumber.get(Number(number)) || {};
        const state = asObject(stateByPr[String(number)]);
        const synthesized = skippedItemFromState(number, group, state);
        return {
          ...synthesized,
          ...existing,
          blockers: asArray(existing.blockers).length
            ? existing.blockers
            : synthesized.blockers,
        };
      });
    normalized.prs = normalized.items.map((item) => item.number);
    normalized.count = normalized.items.length;
    return normalized;
  }).filter((group) => group.items.length > 0);

  if (report.repo_info && typeof report.repo_info === "object") {
    const uniqueSkipped = new Set(
      report.skipped_groups.flatMap((group) =>
        asArray(group.items).map((item) => Number(item?.number)).filter(Boolean),
      ),
    );
    report.repo_info.skipped = uniqueSkipped.size;
  }
}

function normalizeReport(report) {
  normalizeSkippedGroups(report);
  return report;
}

function skippedGroupCount(report, candidates) {
  for (const group of asArray(report.skipped_groups)) {
    const reason = text(group?.reason);
    const label = text(group?.label);
    if (candidates.some((candidate) => candidate === reason || candidate === label)) {
      return Number(group?.count || asArray(group?.items).length || 0);
    }
  }
  return undefined;
}

function validateOverviewCounts(report, problems, reportName) {
  const overview = text(report.overview);
  const checks = [
    {
      label: "required-check blocked",
      count: skippedGroupCount(report, [
        "hard_ci_or_required_check_failure",
        "Required check 未通过",
      ]),
      patterns: [/(\d+)\s*个\s*required checks?\s*未通过/iu],
    },
    {
      label: "human-confirmation deferred",
      count: skippedGroupCount(report, [
        "reviewed_clean_waiting_human_confirmation",
        "已复核待人工确认",
      ]),
      patterns: [/(\d+)\s*个[^，。；;]*人工确认/iu],
    },
  ];
  for (const check of checks) {
    if (check.count === undefined) {
      continue;
    }
    for (const pattern of check.patterns) {
      const match = overview.match(pattern);
      if (match && Number(match[1]) !== check.count) {
        problems.push(
          `${reportName}: overview ${check.label} count ${match[1]} does not match skipped group count ${check.count}`,
        );
      }
    }
  }
}

function validateTopLevel(report, problems, reportName, options = {}) {
  if (text(report.overview).length < 180) {
    problems.push(`${reportName}: overview is too thin for a full-run report`);
  }
  if (asArray(report.timeline).length === 0) {
    problems.push(`${reportName}: timeline is empty`);
  }
  const pullRequests = asObject(report.run_state?.pull_requests);
  if (!options.public && Object.keys(pullRequests).length === 0) {
    problems.push(`${reportName}: run_state.pull_requests is empty`);
  }
  const evolution = asArray(report.skill_evolution);
  if (evolution.length === 0) {
    problems.push(`${reportName}: skill_evolution is empty`);
  }
  evolution.forEach((item, index) => {
    if (!isFilled(item?.area) || !isFilled(item?.note)) {
      problems.push(`${reportName}: skill_evolution[${index}] needs area and note`);
    }
  });
}

function validateEntryFields(entry, group, problems, reportName) {
  const allowedStatuses = allowedStatusByGroup[group] || new Set([group]);
  if (!allowedStatuses.has(entry.status)) {
    problems.push(
      `${reportName}: ${group} PR #${entry.number || "unknown"} has non-canonical display status "${entry.status || ""}"`,
    );
  }

  for (const field of renderedDetailFields) {
    if (Object.hasOwn(entry, field) && entry[field] === "") {
      problems.push(
        `${reportName}: ${group} PR #${entry.number || "unknown"} has empty placeholder "${field}"`,
      );
    }
  }

  const required = group === "blocked" ? richBlockedFields : richReviewedFields;
  for (const field of required) {
    if (!isFilled(entry[field])) {
      problems.push(
        `${reportName}: ${group} PR #${entry.number || "unknown"} missing rich field "${field}"`,
      );
    }
  }

  if (
    isFilled(entry.approach) &&
    /^(approve|approved|submit|submitted|gh pr review|lgtm|merge|merged|no approval|no duplicate comment|不审批|不合并)/iu.test(
      text(entry.approach),
    )
  ) {
    problems.push(
      `${reportName}: ${group} PR #${entry.number || "unknown"} approach describes review action instead of PR implementation`,
    );
  }
  if (
    isFilled(entry.technical_background) &&
    /\bMyCR\b|本轮|确认 PR 当前 head|xhigh|子审查|checked CI|提交 GitHub|LGTM|approve|merge/iu.test(
      text(entry.technical_background),
    )
  ) {
    problems.push(
      `${reportName}: ${group} PR #${entry.number || "unknown"} technical_background describes review process instead of domain background`,
    );
  }

  if (group === "approved" && !isFilled(entry.review_action)) {
    problems.push(`${reportName}: approved PR #${entry.number || "unknown"} missing review_action`);
  }
  if (group === "approved" && entry.status === "merged" && !isFilled(entry.merge_commit)) {
    problems.push(`${reportName}: merged PR #${entry.number || "unknown"} missing merge_commit`);
  }
  if (group === "approved" && entry.status === "merged" && !isFilled(entry.head_sha)) {
    problems.push(`${reportName}: merged PR #${entry.number || "unknown"} missing head_sha`);
  }
  const mergePolicy = text(entry.merge_policy);
  if (
    /human_required/iu.test(mergePolicy) &&
    (entry.status === "merged" || /gh pr merge|squash merge|merged/iu.test(text(entry.review_action)))
  ) {
    problems.push(
      `${reportName}: ${group} PR #${entry.number || "unknown"} is marked human_required but also merged by MyCR`,
    );
  }
  if (group === "maintained" && !isFilled(entry.self_review_policy)) {
    problems.push(`${reportName}: maintained PR #${entry.number || "unknown"} missing self_review_policy`);
  }
  if (group === "blocked") {
    const hasBlocker = asArray(entry.blockers).length > 0 || isFilled(entry.risk);
    if (!hasBlocker) {
      problems.push(`${reportName}: blocked PR #${entry.number || "unknown"} needs blockers or risk`);
    }
  }
}

function hasCiOrSoftCiBlocker(value) {
  return asArray(value).some((blocker) =>
    ["ci", "soft_ci"].includes(String(blocker?.kind || "")) ||
    /codecov|go-apidiff|pending|queued|in[_ -]?progress|failure|failed/iu.test(
      text(blocker?.summary || blocker?.verification),
    ),
  );
}

function validateProcessedRunStateConsistency(report, problems, reportName) {
  const stateByPr = asObject(report.run_state?.pull_requests);
  for (const group of processedGroups) {
    for (const entry of asArray(report[group])) {
      const number = Number(entry?.number);
      if (!number) {
        continue;
      }
      const state = asObject(stateByPr[String(number)]);
      if (
        /all effective checks are green|all checks are green|全部.*通过|全绿/iu.test(
          text(entry?.ci_state),
        ) &&
        hasCiOrSoftCiBlocker(state.blockers)
      ) {
        problems.push(
          `${reportName}: ${group} PR #${number} ci_state says green but run_state still carries CI blockers`,
        );
      }
    }
  }
}

function validateRunStateCompleteness(report, problems, reportName) {
  const stateByPr = asObject(report.run_state?.pull_requests);
  for (const [number, state] of Object.entries(stateByPr)) {
    for (const field of [
      "checks_fingerprint",
      "review_threads_fingerprint",
      "comments_fingerprint",
      "metadata_cache_key",
    ]) {
      if (!isFilled(state?.[field])) {
        problems.push(`${reportName}: run_state PR #${number} missing ${field}`);
      }
    }
    if (!Object.hasOwn(state || {}, "mergeable")) {
      problems.push(`${reportName}: run_state PR #${number} missing mergeable`);
    }
    if (state?.locked && !isFilled(state?.active_lock_reason)) {
      problems.push(`${reportName}: run_state PR #${number} locked without active_lock_reason`);
    }
  }
}

function validateCoverage(report, problems, reportName) {
  const expected = Number(report.repo_info?.open_prs || 0);
  if (!expected) {
    return;
  }
  const represented = new Set();
  for (const group of processedGroups) {
    for (const entry of asArray(report[group])) {
      const number = Number(entry?.number);
      if (number) {
        represented.add(number);
      }
    }
  }
  for (const group of asArray(report.skipped_groups)) {
    for (const item of asArray(group?.items)) {
      const number = Number(item?.number);
      if (number) {
        represented.add(number);
      }
    }
  }
  if (represented.size !== expected) {
    problems.push(
      `${reportName}: represented PR count ${represented.size} does not match repo_info.open_prs ${expected}`,
    );
  }
}

function validateFollowUp(report, problems, reportName) {
  asArray(report.follow_up).forEach((item, index) => {
    if (typeof item === "string") {
      if (!isFilled(item)) {
        problems.push(`${reportName}: follow_up[${index}] is empty`);
      }
      return;
    }
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      problems.push(`${reportName}: follow_up[${index}] must be a string or object`);
      return;
    }
    if (!isFilled(item.reason) && !isFilled(item.next) && !isFilled(item.title)) {
      problems.push(`${reportName}: follow_up[${index}] needs reason, next, or title`);
    }
  });
}

function validateTimeline(report, problems, reportName) {
  asArray(report.timeline).forEach((item, index) => {
    if (typeof item === "string") {
      if (!isFilled(item)) {
        problems.push(`${reportName}: timeline[${index}] is empty`);
      }
      return;
    }
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      problems.push(`${reportName}: timeline[${index}] must be a string or object`);
      return;
    }
    if (
      !isFilled(item.detail) &&
      !isFilled(item.text) &&
      !isFilled(item.label) &&
      !isFilled(item.event)
    ) {
      problems.push(`${reportName}: timeline[${index}] needs detail, text, label, or event`);
    }
  });
}

function publicPath(pathParts) {
  return pathParts.length ? pathParts.join(".") : "<root>";
}

function patternLabel(pattern) {
  return pattern.source.replaceAll("\\", "");
}

function validatePublicValue(value, problems, reportName, pathParts = []) {
  if (Array.isArray(value)) {
    value.forEach((item, index) =>
      validatePublicValue(item, problems, reportName, [...pathParts, String(index)]),
    );
    return;
  }
  if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      const childPath = [...pathParts, key];
      if (publicForbiddenKeys.has(key)) {
        problems.push(
          `${reportName}: public JSON exposes internal key "${publicPath(childPath)}"`,
        );
      }
      validatePublicValue(child, problems, reportName, childPath);
    }
    return;
  }
  if (typeof value !== "string") {
    return;
  }
  for (const pattern of publicForbiddenText) {
    if (pattern.test(value)) {
      problems.push(
        `${reportName}: public JSON ${publicPath(pathParts)} contains internal text /${patternLabel(pattern)}/`,
      );
    }
  }
  for (const pattern of publicJsonOnlyForbiddenText) {
    if (pattern.test(value)) {
      problems.push(
        `${reportName}: public JSON ${publicPath(pathParts)} contains internal text /${patternLabel(pattern)}/`,
      );
    }
  }
}

function visibleHtmlText(rawHtml) {
  return rawHtml
    .replace(/<script[\s\S]*?<\/script>/giu, " ")
    .replace(/<style[\s\S]*?<\/style>/giu, " ")
    .replace(/<[^>]+>/gu, " ")
    .replace(/\s+/gu, " ");
}

function validatePublicHtml(rawHtml, problems, reportName) {
  if (/#\(\\d\(3,\s*6\)\)/u.test(rawHtml)) {
    problems.push(`${reportName}: public HTML contains broken PR reference regex`);
  }

  const rawForbidden = [
    ...publicForbiddenText,
    /\brun_state\b/iu,
    /\bincremental_plan\b/iu,
    /\bmetadata_cache_key\b/iu,
    /\bchecks_fingerprint\b/iu,
    /\breview_threads_fingerprint\b/iu,
    /\bcomments_fingerprint\b/iu,
    /\bplanning_reasons\b/iu,
  ];
  for (const pattern of rawForbidden) {
    if (pattern.test(rawHtml)) {
      problems.push(
        `${reportName}: public HTML contains internal text /${patternLabel(pattern)}/`,
      );
    }
  }

  const visible = visibleHtmlText(rawHtml);
  for (const pattern of publicVisiblePlaceholderText) {
    if (pattern.test(visible)) {
      problems.push(
        `${reportName}: public HTML visible text contains placeholder /${patternLabel(pattern)}/`,
      );
    }
  }
}

async function validatePublicArtifacts(reportPath, problems, reportName) {
  const fileName = path.basename(reportPath);
  const publicJsonPath = path.join(publicReportDir, fileName);
  const publicHtmlPath = path.join(
    publicReportDir,
    fileName.replace(/\.json$/u, htmlExtension),
  );

  if (!(await exists(publicJsonPath))) {
    problems.push(`${reportName}: missing public JSON artifact`);
    return;
  }
  if (!(await exists(publicHtmlPath))) {
    problems.push(`${reportName}: missing public HTML artifact`);
    return;
  }

  let publicReport;
  try {
    publicReport = await readReport(publicJsonPath);
  } catch (error) {
    problems.push(`${reportName}: invalid public JSON (${error.message})`);
    return;
  }
  validatePublicValue(publicReport, problems, reportName);
  validatePublicHtml(await readFile(publicHtmlPath, "utf8"), problems, reportName);
}

function validateProcessedEntries(report, problems, reportName) {
  for (const group of processedGroups) {
    for (const entry of asArray(report[group])) {
      validateEntryFields(asObject(entry), group, problems, reportName);
    }
  }
}

function itemHasLockedBlocker(item) {
  return asArray(item?.blockers).some((blocker) =>
    /locked|conversation is locked|conversation locked/iu.test(
      text(blocker?.summary || blocker?.verification),
    ),
  );
}

function ciStateNonGreenCount(item) {
  const match = text(item?.ci_state).match(/\bnon[_-]?green=(\d+)/iu);
  return match ? Number(match[1]) : 0;
}

function hasConcreteCiBlocker(item) {
  return asArray(item?.blockers).some((blocker) =>
    ["ci", "soft_ci", "CI 检查", "非阻断检查"].includes(String(blocker?.kind || "")),
  );
}

function hasVagueOrClippedBlockerText(value) {
  const summary = text(value);
  if (!summary) {
    return false;
  }
  if (/\bBlocking issues found\.?$/iu.test(summary)) {
    return true;
  }
  if (/review[：:]\s*[A-Za-z0-9_-]+$/iu.test(summary)) {
    return true;
  }
  if (summary.includes("…")) {
    return true;
  }
  return summary.length > 160 && /[A-Za-z][A-Za-z_-]{3,}$/.test(summary);
}

function validateSkippedGroups(report, problems, reportName) {
  const seenSkipped = new Set();
  for (const [index, group] of asArray(report.skipped_groups).entries()) {
    if (!isFilled(group.reason)) {
      problems.push(`${reportName}: skipped_groups[${index}] missing reason`);
    }
    const items = asArray(group.items);
    if (items.length === 0) {
      problems.push(`${reportName}: skipped group "${group.reason || index}" has no item details`);
      continue;
    }
    if (Number(group.count) !== items.length) {
      problems.push(`${reportName}: skipped group "${group.reason}" count does not match items`);
    }
    for (const item of items) {
      const prefix = `${reportName}: skipped group "${group.reason}" PR #${item?.number || "unknown"}`;
      for (const field of ["number", "title", "url", "author", "skip_reason", "readiness_audit"]) {
        if (!isFilled(item?.[field])) {
          problems.push(`${prefix} missing ${field}`);
        }
      }
      if (asArray(item?.blockers).length === 0) {
        problems.push(`${prefix} missing blockers`);
      }
      const hasManualReviewBlocker = asArray(item?.blockers).some((blocker) =>
        ["human_review", "manual_review", "人工确认"].includes(String(blocker?.kind || "")),
      );
      if (hasManualReviewBlocker) {
        for (const field of ["skip_reason", "readiness_audit"]) {
          if (hasVagueOrClippedBlockerText(item?.[field])) {
            problems.push(`${prefix} has vague or clipped ${field}`);
          }
        }
      }
      const number = Number(item?.number);
      if (number) {
        if (seenSkipped.has(number)) {
          problems.push(`${reportName}: skipped PR #${number} appears in more than one group`);
        }
        seenSkipped.add(number);
      }
      for (const blocker of asArray(item?.blockers)) {
        const kind = String(blocker?.kind || "");
        const reviewer = text(blocker?.reviewer);
        for (const optionalField of ["reviewer", "url", "path", "line", "latest_response"]) {
          if (Object.hasOwn(blocker || {}, optionalField) && !isFilled(blocker?.[optionalField])) {
            problems.push(`${prefix} blocker has empty optional field "${optionalField}"`);
          }
        }
        if (
          ["human_review", "manual_review", "人工确认"].includes(kind) &&
          reviewer &&
          (reviewer === text(item?.author) || /bot|coderabbit/iu.test(reviewer))
        ) {
          problems.push(
            `${prefix} uses ${kind} blocker from non-reviewer "${reviewer}"`,
          );
        }
        if (
          ["soft_ci", "非阻断检查"].includes(kind) &&
          /pending|queued|in[_ -]?progress/iu.test(text(blocker?.summary))
        ) {
          problems.push(`${prefix} classifies pending check as soft_ci`);
        }
        if (
          ["human_review", "manual_review", "人工确认"].includes(kind) &&
          hasVagueOrClippedBlockerText(blocker?.summary)
        ) {
          problems.push(`${prefix} blocker summary is vague or clipped`);
        }
      }
      if (
        asArray(item?.blockers).some((blocker) =>
          /reviewDecision=APPROVED/iu.test(
            text([blocker?.summary, blocker?.verification]),
          ),
        )
      ) {
        const explanation = text([
          item?.skip_reason,
          item?.readiness_audit,
          ...asArray(item?.blockers).map((blocker) => [
            blocker?.summary,
            blocker?.verification,
          ]),
        ]);
        if (
          !/pre-existing|previous|existing|did not submit an approval|no .*approval|既有|本轮.*(未|没有).*(approval|审批|批准)/iu.test(
            explanation,
          )
        ) {
          problems.push(
            `${prefix} shows APPROVED reviewDecision without explaining it is pre-existing and no MyCR approval was submitted`,
          );
        }
      }
      if (
        itemHasLockedBlocker(item) &&
        ciStateNonGreenCount(item) > 0 &&
        !hasConcreteCiBlocker(item)
      ) {
        problems.push(`${prefix} is locked but omits concrete CI blockers`);
      }
      const blockingKinds = new Set([
        "ci",
        "manual_review",
        "merge_conflict",
        "CI 检查",
        "人工确认",
        "合并冲突",
      ]);
      const hasHardBlocker = asArray(item?.blockers).some((blocker) =>
        blockingKinds.has(String(blocker?.kind || "")),
      );
      if (
        hasHardBlocker &&
        /clean deferred|no new blocker|no blocker|未发现新 blocker/iu.test(
          text([item?.skip_reason, item?.readiness_audit, item?.review_summary]),
        )
      ) {
        problems.push(`${prefix} has contradictory clean/deferred wording with a hard blocker`);
      }
    }
  }
}

function validateReport(report, reportName, options = {}) {
  const problems = [];
  validateTopLevel(report, problems, reportName, {
    public: Boolean(options.publicArtifact),
  });
  validateOverviewCounts(report, problems, reportName);
  validateProcessedEntries(report, problems, reportName);
  validateProcessedRunStateConsistency(report, problems, reportName);
  validateRunStateCompleteness(report, problems, reportName);
  validateCoverage(report, problems, reportName);
  validateSkippedGroups(report, problems, reportName);
  validateFollowUp(report, problems, reportName);
  validateTimeline(report, problems, reportName);
  return problems;
}

async function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (error) {
    usage();
    throw error;
  }

  const reportPath = args.latest ? await latestReportPath() : path.resolve(args.file);
  if (!(await exists(reportPath))) {
    throw new Error(`report not found: ${reportPath}`);
  }

  const report = normalizeReport(await readReport(reportPath));
  const reportName = path.basename(reportPath);
  const publicRelativePath = path.relative(publicReportDir, reportPath);
  const isPublicArtifact =
    publicRelativePath &&
    !publicRelativePath.startsWith("..") &&
    !path.isAbsolute(publicRelativePath);

  if (args.write) {
    await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  }

  if (args.check) {
    const problems = validateReport(report, reportName, {
      publicArtifact: args.public && isPublicArtifact,
    });
    if (args.public) {
      await validatePublicArtifacts(reportPath, problems, reportName);
    }
    if (problems.length > 0) {
      for (const problem of problems) {
        console.error(problem);
      }
      process.exit(1);
    }
    console.log(`quality checked ${reportName}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
