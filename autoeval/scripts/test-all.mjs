#!/usr/bin/env node
// Smoke-тест: прогоняет все fixture-сдачи через scripts/eval.mjs.
// Использование:  node scripts/test-all.mjs

import { existsSync, readdirSync, statSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const FIXTURES = join(ROOT, "fixtures");
const EVAL = join(__dirname, "eval.mjs");

// Загружаем .env с приоритетом над системой (та же логика что в eval.mjs).
const envPath = join(ROOT, ".env");
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (m && !m[1].startsWith("#")) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

if (!existsSync(FIXTURES)) {
  console.error(`Нет ${FIXTURES} — создай fixtures/taskNN/submission-ok.md`);
  process.exit(2);
}

const entries = readdirSync(FIXTURES, { withFileTypes: true })
  .filter((e) => e.isDirectory() && /^task\d{2}/.test(e.name))
  .sort((a, b) => a.name.localeCompare(b.name));

let pass = 0;
let fail = 0;
const summary = [];

for (const dir of entries) {
  const taskNum = dir.name.match(/^task(\d{2})/)?.[1];
  const subDir = join(FIXTURES, dir.name);
  const subFiles = readdirSync(subDir).filter((f) => f.endsWith(".md") && !f.endsWith(".report.json"));
  for (const f of subFiles) {
    const subPath = join(subDir, f);
    console.log(`\n>>> task ${taskNum} / ${f}\n`);
    const r = spawnSync(
      process.execPath,
      [EVAL, "--task", taskNum, "--submission", subPath],
      { stdio: "inherit", cwd: ROOT }
    );
    const ok = r.status === 0;
    if (ok) pass++; else fail++;
    summary.push({ task: taskNum, fixture: f, ok });
  }
}

console.log("\n========================================");
console.log(`SMOKE: ${pass} ok, ${fail} fail`);
for (const s of summary) console.log(`  ${s.ok ? "✓" : "✗"} task ${s.task} / ${s.fixture}`);
console.log("========================================\n");

process.exit(fail === 0 ? 0 : 1);
