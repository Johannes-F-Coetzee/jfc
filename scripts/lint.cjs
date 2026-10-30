// Dependency-free style checks for the rules in .github/copilot-instructions.md that are easy to verify.
// Run with `npm run lint`. Exits non-zero and lists every problem when a rule is broken.
"use strict";

const { readdirSync, readFileSync } = require("node:fs");
const path = require("node:path");

const FITNESS_DIRECTORY = path.join(__dirname, "..", "fitness");
const CHECKED_EXTENSIONS = new Set([".js", ".html", ".css"]);
const BRACELESS_CONTROL_FLOW = /^\s*(?:\}\s*)?(?:if|for|while)\s*\(.*\)\s*[^{\s].*;\s*$|^\s*else\s+[^{i\s].*;\s*$/;

function listFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const fullPath = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      return entry.name === "tests" ? [] : listFiles(fullPath);
    }

    return CHECKED_EXTENSIONS.has(path.extname(entry.name)) ? [fullPath] : [];
  });
}

function checkFile(filePath) {
  const extension = path.extname(filePath);
  const lines = readFileSync(filePath, "utf8").split(/\r?\n/);
  const problems = [];

  lines.forEach((line, index) => {
    const report = message => problems.push(`${path.relative(process.cwd(), filePath)}:${index + 1}: ${message}`);

    if (line.includes("\t")) {
      report("tab character; use two spaces");
    }

    if (/\s+$/.test(line)) {
      report("trailing whitespace");
    }

    if (extension === ".js" && BRACELESS_CONTROL_FLOW.test(line)) {
      report("control-flow body must use braces");
    }

    if (extension === ".js" && /^\s*var\s/.test(line)) {
      report("use const or let instead of var");
    }
  });

  return problems;
}

const problems = listFiles(FITNESS_DIRECTORY).flatMap(checkFile);

if (problems.length) {
  console.error(problems.join("\n"));
  console.error(`\n${problems.length} style problem${problems.length === 1 ? "" : "s"} found.`);
  process.exit(1);
}

console.log("Style checks passed.");
