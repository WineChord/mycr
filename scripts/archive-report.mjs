import { spawnSync } from "node:child_process";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceReportDir = path.join(repoRoot, "src", "data", "reports");
const publicReportDir = path.join(repoRoot, "public", "reports");
const rendererPath = path.join(repoRoot, "scripts", "render_mycr_report.py");
const qualityPath = path.join(repoRoot, "scripts", "report-quality.mjs");
const jsonExtension = ".json";
const htmlExtension = ".html";
const htmlFlag = "--html";
const privateTopLevelFields = [
  "run_state",
  "incremental_plan",
  "metadata_cache",
  "metadata_cache_key",
  "reviewability_ledger",
];
const privateNestedFields = new Set([
  "comment_only",
  "target_checkout_dirty_preserved",
  "target_worktree_dirty_preserved",
]);

function usage() {
  console.error(
    "usage: node scripts/archive-report.mjs <summary.json> [--html <report.html>]",
  );
}

function parseArgs(argv) {
  const args = [...argv];
  const parsed = {
    summaryPath: "",
    htmlPath: "",
  };

  while (args.length > 0) {
    const arg = args.shift();
    if (arg === htmlFlag) {
      parsed.htmlPath = args.shift() || "";
      continue;
    }
    if (!parsed.summaryPath) {
      parsed.summaryPath = arg || "";
      continue;
    }
    throw new Error(`unexpected argument: ${arg}`);
  }

  if (!parsed.summaryPath) {
    throw new Error("missing summary JSON path");
  }
  if (!parsed.summaryPath.endsWith(jsonExtension)) {
    throw new Error("summary path must end with .json");
  }
  if (parsed.htmlPath && !parsed.htmlPath.endsWith(htmlExtension)) {
    throw new Error("HTML path must end with .html");
  }

  return parsed;
}

async function readJson(filePath) {
  const raw = await readFile(filePath, "utf8");
  return JSON.parse(raw);
}

function publicReportFrom(report) {
  const publicReport = JSON.parse(JSON.stringify(report));
  for (const field of privateTopLevelFields) {
    delete publicReport[field];
  }
  stripPrivateNestedFields(publicReport);
  return publicReport;
}

function stripPrivateNestedFields(value) {
  if (Array.isArray(value)) {
    for (const item of value) {
      stripPrivateNestedFields(item);
    }
    return;
  }
  if (!value || typeof value !== "object") {
    return;
  }
  for (const key of Object.keys(value)) {
    if (privateNestedFields.has(key)) {
      delete value[key];
      continue;
    }
    stripPrivateNestedFields(value[key]);
  }
}

async function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (error) {
    usage();
    throw error;
  }

  const summaryPath = path.resolve(args.summaryPath);
  const reportName = path.basename(summaryPath);
  const htmlName = reportName.replace(/\.json$/u, htmlExtension);
  const sourceJsonPath = path.join(sourceReportDir, reportName);
  const publicJsonPath = path.join(publicReportDir, reportName);
  const publicHtmlPath = path.join(publicReportDir, htmlName);

  await mkdir(sourceReportDir, { recursive: true });
  await mkdir(publicReportDir, { recursive: true });
  await copyFile(summaryPath, sourceJsonPath);

  const quality = spawnSync(
    "node",
    [qualityPath, "--file", sourceJsonPath, "--write", "--check"],
    { stdio: "inherit" },
  );
  if (quality.status !== 0) {
    throw new Error(`report quality check exited with status ${quality.status}`);
  }

  const publicReport = publicReportFrom(await readJson(sourceJsonPath));
  await writeFile(publicJsonPath, `${JSON.stringify(publicReport, null, 2)}\n`, "utf8");

  if (args.htmlPath) {
    console.warn(
      "ignoring --html after report normalization; rendering HTML from JSON",
    );
  }
  const result = spawnSync(
    "python3",
    [rendererPath, publicJsonPath, "--output", publicHtmlPath],
    { stdio: "inherit" },
  );
  if (result.status !== 0) {
    throw new Error(`renderer exited with status ${result.status}`);
  }

  console.log(`archived ${reportName}`);
  console.log(sourceJsonPath);
  console.log(publicJsonPath);
  console.log(publicHtmlPath);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
