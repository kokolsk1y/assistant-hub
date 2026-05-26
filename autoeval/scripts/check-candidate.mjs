#!/usr/bin/env node
// Проверка целого пакета кандидата.
//
// Использование:
//   node scripts/check-candidate.mjs --folder <путь-к-папке-кандидата>
//   node scripts/check-candidate.mjs --folder C:/submissions/ivan-petrov/
//
// Что делает:
//   1. Сканирует папку, ищет файлы по шаблону task-NN-имя.md / task-NN-... .md
//   2. Прогоняет eval.mjs для каждого найденного файла (по очереди, чтобы не было гонки за API)
//   3. Собирает все баллы в один итоговый отчёт — txt + json + html
//
// Безопасно: каждая задача прогоняется отдельно, при сбое одной — остальные продолжают.

import { existsSync, readdirSync, readFileSync, writeFileSync, statSync, mkdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve, dirname, join, basename } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

// Загружаем .env (приоритет над системой) — как в eval.mjs.
const envPath = join(ROOT, ".env");
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (m && !m[1].startsWith("#")) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

const TASK_TITLES = {
  "01": "Саммари статей",
  "02": "Выбор примеров для обучения ИИ",
  "03": "Системный промпт с правилами",
  "04": "Извлечение данных в JSON (отладка)",
  "05": "Контекст-пак под Анну (карьерный консультант)",
  "06": "Защита от выдумок (отладка)",
  "07": "Уточняющие вопросы перед выполнением",
  "08": "ИИ помогает писать промпты (RICECO)",
  "09": "Сборка воркфлоу (финал)",
};

function parseArgs(argv) {
  const args = { folder: null, name: null };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === "--folder") args.folder = argv[++i];
    else if (argv[i] === "--name") args.name = argv[++i];
  }
  if (!args.folder) {
    console.error("Использование: node scripts/check-candidate.mjs --folder <путь> [--name <имя>]");
    process.exit(2);
  }
  return args;
}

function ruDate() {
  const months = ["января","февраля","марта","апреля","мая","июня","июля","августа","сентября","октября","ноября","декабря"];
  const d = new Date();
  return `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}, ${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`;
}

function line(ch = "─", n = 64) { return ch.repeat(n); }

// Сканирует папку кандидата, ищет файлы по шаблону task-NN-... .md (или task-N-... .md, или taskNN-... .md).
function findCandidateFiles(folder) {
  const found = new Map(); // taskNum (zero-padded "01"..."09") → абсолютный путь
  for (const entry of readdirSync(folder)) {
    const full = join(folder, entry);
    if (!statSync(full).isFile()) continue;
    if (!entry.toLowerCase().endsWith(".md")) continue;
    const m = entry.match(/(?:^|[^0-9])task[\-_]?(\d{1,2})\b/i);
    if (!m) continue;
    const num = String(parseInt(m[1], 10)).padStart(2, "0");
    if (parseInt(num, 10) < 1 || parseInt(num, 10) > 9) continue;
    if (found.has(num)) {
      console.warn(`  Внимание: для задачи ${num} найдено больше одного файла. Беру первый: ${found.get(num)}`);
      continue;
    }
    found.set(num, full);
  }
  return found;
}

function runOneTask(taskNum, submissionPath) {
  const result = spawnSync(
    process.execPath,
    [join(__dirname, "eval.mjs"), "--task", taskNum, "--submission", submissionPath],
    { encoding: "utf8", env: { ...process.env }, cwd: ROOT }
  );
  // Парсим результат из stdout + report.json который eval.mjs пишет рядом со сдачей
  const reportPath = submissionPath.replace(/\.md$/i, "") + ".report.json";
  if (existsSync(reportPath)) {
    try {
      return { ok: true, report: JSON.parse(readFileSync(reportPath, "utf8")), stdout: result.stdout || "", stderr: result.stderr || "" };
    } catch {}
  }
  return { ok: false, error: result.stderr || "Не получилось разобрать результат", stdout: result.stdout || "" };
}

function verdictFromTotal(total) {
  if (total >= 7) return { tier: "СИЛЬНАЯ СДАЧА", note: "Рекомендую к следующему этапу." };
  if (total >= 5) return { tier: "СРЕДНЯЯ СДАЧА", note: "На грани. Стоит созвон или дополнительный кейс." };
  if (total > 0) return { tier: "СЛАБАЯ СДАЧА", note: "Не готов к этой роли (или не вложился в задачу)." };
  return { tier: "НЕ ПРОЙДЕНО", note: "Сдача не зачтена или отсутствует." };
}

function overallVerdict(rows) {
  const valid = rows.filter(r => r.total !== null);
  if (valid.length === 0) return { avg: 0, tier: "НЕ ПРОЙДЕНО", note: "Нет ни одной валидной задачи." };
  const sum = valid.reduce((s, r) => s + r.total, 0);
  const avg = sum / valid.length;
  if (avg >= 7) return { avg, tier: "СИЛЬНЫЙ КАНДИДАТ", note: "Рекомендуем к собесу. Уверенно владеет основными приёмами промпт-инжиниринга." };
  if (avg >= 5) return { avg, tier: "СРЕДНИЙ КАНДИДАТ", note: "Есть сильные стороны, но не везде. Стоит созвон чтобы понять профиль." };
  if (avg >= 3) return { avg, tier: "СЛАБЫЙ КАНДИДАТ", note: "Большая часть задач не пройдена. Возможно, не хватает базовых навыков работы с ИИ." };
  return { avg, tier: "НЕ ПРОШЁЛ", note: "Большинство задач провалено. Не рекомендуем." };
}

function buildTxtReport(name, folder, rows, overall) {
  const out = [];
  out.push(line("═"));
  out.push("  ИТОГОВЫЙ ОТЧЁТ ПО КАНДИДАТУ");
  out.push(line("═"));
  out.push("");
  out.push(`  Имя:    ${name || "не указано"}`);
  out.push(`  Папка:  ${folder}`);
  out.push(`  Дата:   ${ruDate()}`);
  out.push("");
  out.push(line());
  out.push("  БАЛЛЫ ПО ЗАДАЧАМ");
  out.push(line());
  out.push("");
  for (const r of rows) {
    const score = r.total === null ? "   — не сдано" : `${r.total.toFixed(1).padStart(4)} / 10`;
    const tier = r.total === null ? "" : `  (${verdictFromTotal(r.total).tier})`;
    out.push(`  Задача ${r.num}  ${r.title.padEnd(46)}  ${score}${tier}`);
  }
  out.push("");
  out.push(line());
  out.push("  ОБЩИЙ ВЕРДИКТ");
  out.push(line());
  out.push("");
  out.push(`  Средний балл:  ${overall.avg.toFixed(2)} / 10`);
  out.push(`  Категория:     ${overall.tier}`);
  out.push("");
  out.push(`  ${overall.note}`);
  out.push("");
  // Профиль сильных/слабых сторон
  const strong = rows.filter(r => r.total !== null && r.total >= 7);
  const weak = rows.filter(r => r.total !== null && r.total < 5);
  if (strong.length) {
    out.push("  Сильные стороны:");
    for (const r of strong) out.push(`    + Задача ${r.num} ${r.title} (${r.total.toFixed(1)}/10)`);
    out.push("");
  }
  if (weak.length) {
    out.push("  Слабые стороны:");
    for (const r of weak) out.push(`    - Задача ${r.num} ${r.title} (${r.total.toFixed(1)}/10)`);
    out.push("");
  }
  const missing = rows.filter(r => r.total === null);
  if (missing.length) {
    out.push(`  Не сдано: ${missing.length} из 9 задач`);
    for (const r of missing) out.push(`    - Задача ${r.num} ${r.title}`);
    out.push("");
  }
  out.push(line("═"));
  return out.join("\n");
}

function buildJsonReport(name, folder, rows, overall) {
  return {
    candidate: name || null,
    folder,
    date: new Date().toISOString(),
    tasks: rows,
    overall,
  };
}

function buildHtmlReport(name, folder, rows, overall) {
  const taskRows = rows.map(r => {
    const score = r.total === null
      ? '<td style="color:#999">не сдано</td>'
      : `<td><strong>${r.total.toFixed(1)} / 10</strong></td>`;
    const tier = r.total === null ? "" : verdictFromTotal(r.total).tier;
    const tierColor = r.total === null ? "#999" : r.total >= 7 ? "#2d7a3e" : r.total >= 5 ? "#c4901c" : "#c43e2a";
    return `<tr>
      <td>${r.num}</td>
      <td>${r.title}</td>
      ${score}
      <td style="color:${tierColor}">${tier}</td>
    </tr>`;
  }).join("\n");

  const overallColor = overall.avg >= 7 ? "#2d7a3e" : overall.avg >= 5 ? "#c4901c" : "#c43e2a";

  return `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="UTF-8">
<title>Отчёт по кандидату — ${name || "без имени"}</title>
<style>
  body { font-family: -apple-system, "Segoe UI", Helvetica, Arial, sans-serif; max-width: 720px; margin: 40px auto; padding: 0 24px; color: #222; line-height: 1.6; font-size: 16px; }
  h1 { font-size: 26px; margin: 0 0 4px; }
  .meta { color: #666; font-size: 14px; margin-bottom: 24px; }
  h2 { font-size: 19px; margin-top: 32px; border-bottom: 1px solid #e0e0e0; padding-bottom: 6px; }
  table { width: 100%; border-collapse: collapse; margin: 16px 0; }
  th, td { padding: 10px 8px; border-bottom: 1px solid #eee; text-align: left; }
  th { background: #f5f7fa; font-weight: 600; font-size: 14px; }
  .overall { background: #f8f9fa; padding: 20px 24px; border-radius: 8px; margin: 24px 0; }
  .tier { font-size: 24px; font-weight: 600; color: ${overallColor}; margin: 8px 0; }
  .note { color: #555; }
  ul { padding-left: 20px; }
  li.strong { color: #2d7a3e; }
  li.weak { color: #c43e2a; }
  li.missing { color: #999; }
</style>
</head>
<body>
<h1>Отчёт по кандидату</h1>
<div class="meta">Имя: ${name || "не указано"} · Дата проверки: ${ruDate()} · Папка: ${folder}</div>

<h2>Баллы по задачам</h2>
<table>
  <thead>
    <tr><th>#</th><th>Задача</th><th>Балл</th><th>Категория</th></tr>
  </thead>
  <tbody>
    ${taskRows}
  </tbody>
</table>

<div class="overall">
  <div>Средний балл по 9 задачам</div>
  <div class="tier">${overall.avg.toFixed(2)} / 10 · ${overall.tier}</div>
  <div class="note">${overall.note}</div>
</div>

${rows.some(r => r.total !== null && r.total >= 7) ? `
<h2>Сильные стороны</h2>
<ul>
${rows.filter(r => r.total !== null && r.total >= 7).map(r => `<li class="strong">Задача ${r.num}. ${r.title} — ${r.total.toFixed(1)} из 10</li>`).join("\n")}
</ul>` : ""}

${rows.some(r => r.total !== null && r.total < 5) ? `
<h2>Слабые стороны</h2>
<ul>
${rows.filter(r => r.total !== null && r.total < 5).map(r => `<li class="weak">Задача ${r.num}. ${r.title} — ${r.total.toFixed(1)} из 10</li>`).join("\n")}
</ul>` : ""}

${rows.some(r => r.total === null) ? `
<h2>Не сдано</h2>
<ul>
${rows.filter(r => r.total === null).map(r => `<li class="missing">Задача ${r.num}. ${r.title}</li>`).join("\n")}
</ul>` : ""}

</body>
</html>`;
}

async function main() {
  const { folder, name } = parseArgs(process.argv);
  const folderPath = resolve(folder);
  if (!existsSync(folderPath) || !statSync(folderPath).isDirectory()) {
    console.error(`Папка не найдена: ${folderPath}`);
    process.exit(2);
  }

  // Имя кандидата — берём из --name или из имени папки
  const candidateName = name || basename(folderPath);

  console.log("");
  console.log(line("═"));
  console.log("  ПРОВЕРКА ПАКЕТА КАНДИДАТА");
  console.log(line("═"));
  console.log("");
  console.log(`  Имя:    ${candidateName}`);
  console.log(`  Папка:  ${folderPath}`);
  console.log(`  Дата:   ${ruDate()}`);
  console.log("");

  const files = findCandidateFiles(folderPath);
  if (files.size === 0) {
    console.error("В папке не найдено ни одного файла task-NN-*.md");
    console.error("Кандидат должен прислать файлы task-01-*.md, task-02-*.md, ... task-09-*.md");
    process.exit(1);
  }
  console.log(`  Найдено файлов задач: ${files.size} из 9`);
  console.log("");

  const rows = [];
  for (let i = 1; i <= 9; i++) {
    const num = String(i).padStart(2, "0");
    const title = TASK_TITLES[num];
    const submissionPath = files.get(num);
    if (!submissionPath) {
      console.log(`  Задача ${num}  ${title.padEnd(46)}    не сдано`);
      rows.push({ num, title, file: null, total: null, result: null, process: null });
      continue;
    }
    process.stdout.write(`  Задача ${num}  ${title.padEnd(46)}  проверяю...`);
    const res = runOneTask(num, submissionPath);
    if (res.ok && res.report) {
      const r = res.report;
      const total = r.total;
      const resPts = r.result?.points ?? 0;
      const prcPts = r.process?.points ?? 0;
      process.stdout.write("\r");
      console.log(`  Задача ${num}  ${title.padEnd(46)}  ${total.toFixed(1).padStart(4)} / 10   (резлт ${resPts}/6 · процесс ${prcPts}/4)`);
      rows.push({ num, title, file: basename(submissionPath), total, result: r.result, process: r.process });
    } else {
      process.stdout.write("\r");
      console.log(`  Задача ${num}  ${title.padEnd(46)}    ошибка: ${(res.error || "неизвестно").slice(0, 50)}`);
      rows.push({ num, title, file: basename(submissionPath), total: null, error: res.error });
    }
  }

  console.log("");
  const overall = overallVerdict(rows);
  console.log(line());
  console.log("  ИТОГ");
  console.log(line());
  console.log("");
  console.log(`  Средний балл:  ${overall.avg.toFixed(2)} / 10`);
  console.log(`  Категория:     ${overall.tier}`);
  console.log("");
  console.log(`  ${overall.note}`);
  console.log("");

  // Сохраняем отчёты в папку с кандидатом
  const txtPath = join(folderPath, "_итоговый-отчёт.txt");
  const jsonPath = join(folderPath, "_итоговый-отчёт.json");
  const htmlPath = join(folderPath, "_итоговый-отчёт.html");
  writeFileSync(txtPath, buildTxtReport(candidateName, folderPath, rows, overall), "utf8");
  writeFileSync(jsonPath, JSON.stringify(buildJsonReport(candidateName, folderPath, rows, overall), null, 2), "utf8");
  writeFileSync(htmlPath, buildHtmlReport(candidateName, folderPath, rows, overall), "utf8");

  console.log("  Отчёты сохранены в папке кандидата:");
  console.log(`    ${txtPath}`);
  console.log(`    ${htmlPath}  (открыть в браузере для красивой версии)`);
  console.log(`    ${jsonPath}  (для программной обработки)`);
  console.log("");
}

main().catch((e) => {
  console.error("Ошибка:", e.message);
  process.exit(1);
});
