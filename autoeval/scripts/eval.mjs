#!/usr/bin/env node
// Главный оркестратор автопроверки.
// Использование:
//   node scripts/eval.mjs --task 01 --submission ../submissions/anna/task01.md
//
// Что делает:
//   1. Читает submission.md, парсит две секции: ### ФИНАЛ (конфигурация) и ### ЛОГ (процесс).
//   2. Записывает финальную конфигурацию в tasks/NN/_submission_prompt.txt.
//   3. Запускает `promptfoo eval` на tasks/NN/promptfooconfig.yaml → получает % пройденных кейсов → 6 баллов.
//   4. Запускает LLM-судью на лог процесса → 4 балла (4 пункта × 1).
//   5. Печатает итог 10/10 + breakdown.

// Подавим шумные Node deprecation warnings — у нас всё под контролем,
// пользователю не нужно их видеть.
process.env.NODE_NO_WARNINGS = "1";

import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

// ВАЖНО: грузим .env САМИ и ПЕРЕЗАПИСЫВАЕМ process.env.
// Node флаг --env-file ИМЕЕТ ОБРАТНЫЙ приоритет (системная env > файл),
// поэтому если в системе есть OPENROUTER_API_KEY от другого проекта (OpenClaw),
// он перекроет ключ из .env. Это не то что мы хотим — autoeval должен брать СВОЙ ключ.
const envPath = join(ROOT, ".env");
if (existsSync(envPath)) {
  const envText = readFileSync(envPath, "utf8");
  for (const line of envText.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!m) continue;
    if (m[1].startsWith("#")) continue;
    // Снимаем кавычки если есть
    const value = m[2].replace(/^["']|["']$/g, "");
    process.env[m[1]] = value;  // ← перезаписываем, .env имеет приоритет
  }
}

const { judgeLog } = await import("./judge.mjs");

function parseArgs(argv) {
  const args = { task: null, submission: null };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === "--task") args.task = argv[++i];
    else if (argv[i] === "--submission") args.submission = argv[++i];
  }
  if (!args.task || !args.submission) {
    console.error("Usage: node eval.mjs --task <NN> --submission <path-to-submission.md>");
    process.exit(2);
  }
  return args;
}

function parseSubmission(text) {
  // Делим на две секции по заголовкам ### ФИНАЛ / ### FINAL и ### ЛОГ / ### LOG.
  // Не строго к регистру. \b не работает с кириллицей в JS regex — используем negative-lookahead на буквы.
  const finalRe = /^###\s*(финал|final)(?![а-яёa-z])[^\n]*\n/im;
  const logRe = /^###\s*(лог|log)(?![а-яёa-z])[^\n]*\n/im;

  const fmatch = text.match(finalRe);
  const lmatch = text.match(logRe);

  if (!fmatch || !lmatch) {
    return {
      ok: false,
      error:
        "Не нашёл секции '### ФИНАЛ' и '### ЛОГ' в сдаче. Без них автопроверка невозможна.",
    };
  }

  const finalStart = fmatch.index + fmatch[0].length;
  const logStart = lmatch.index + lmatch[0].length;

  let finalText, logText;
  if (fmatch.index < lmatch.index) {
    finalText = text.slice(finalStart, lmatch.index).trim();
    logText = text.slice(logStart).trim();
  } else {
    logText = text.slice(logStart, fmatch.index).trim();
    finalText = text.slice(finalStart).trim();
  }

  return { ok: true, finalText, logText };
}

function resolveTaskDir(taskNum) {
  const padded = String(taskNum).padStart(2, "0");
  const tasksDir = join(ROOT, "tasks");
  const entries = readdirSync(tasksDir, { withFileTypes: true });
  const match = entries.find((e) => e.isDirectory() && e.name.startsWith(padded + "-"));
  if (!match) {
    throw new Error(`Не нашёл папку задачи tasks/${padded}-*`);
  }
  return join(tasksDir, match.name);
}

function substituteEnv(text) {
  // Promptfoo не делает env-substitution в provider.id. Делаем сами:
  // ${VAR} → значение из process.env. Если значения нет — оставляем как было, чтобы promptfoo ругнулся явно.
  return text.replace(/\$\{([A-Z_][A-Z0-9_]*)\}/g, (_, name) => {
    const v = process.env[name];
    return v !== undefined ? v : `\${${name}}`;
  });
}

function runPromptfoo(taskDir, runId, promptFileBase) {
  const configPath = join(taskDir, "promptfooconfig.yaml");
  if (!existsSync(configPath)) {
    throw new Error(`Нет ${configPath}`);
  }
  // Резолвим env-переменные + подменяем имя промпт-файла на уникальное для этого прогона.
  const rawCfg = readFileSync(configPath, "utf8");
  let resolvedCfg = substituteEnv(rawCfg);
  // Подменяем "_submission_prompt.txt" на наш уникальный файл.
  resolvedCfg = resolvedCfg.replaceAll("_submission_prompt.txt", promptFileBase);
  const tmpConfigPath = join(taskDir, `_resolved_promptfooconfig_${runId}.yaml`);
  writeFileSync(tmpConfigPath, resolvedCfg, "utf8");

  const outJson = join(taskDir, `_eval_result_${runId}.json`);
  const logFile = join(taskDir, `_promptfoo_log_${runId}.txt`);
  const isWin = process.platform === "win32";
  const bin = isWin
    ? join(ROOT, "node_modules", ".bin", "promptfoo.cmd")
    : join(ROOT, "node_modules", ".bin", "promptfoo");
  const result = spawnSync(
    bin,
    [
      "eval",
      "--config",
      tmpConfigPath,
      "--output",
      outJson,
      "--no-progress-bar",
      "--no-cache",
      "--no-table",  // не печатать огромную таблицу с результатами
    ],
    {
      stdio: ["ignore", "pipe", "pipe"],  // не показываем шум, заглушим в файл
      env: { ...process.env },
      cwd: ROOT,
      shell: isWin,
      encoding: "utf8",
    }
  );
  // Сохраним вывод в лог-файл (на случай если упадёт).
  writeFileSync(logFile, (result.stdout || "") + "\n--- STDERR ---\n" + (result.stderr || ""), "utf8");
  // Promptfoo: exit 0 = всё passed, exit 100 = есть failed кейсы (это НЕ ошибка для нас),
  // другие exit-коды = реальный сбой.
  if (result.status !== 0 && result.status !== 100) {
    throw new Error(`Ошибка проверки. Подробности в файле ${logFile}`);
  }
  if (!existsSync(outJson)) {
    throw new Error(`Программа не создала файл результатов ${outJson}. Подробности в ${logFile}`);
  }
  const raw = readFileSync(outJson, "utf8");
  return JSON.parse(raw);
}

function scoreFromResults(promptfooJson) {
  // Promptfoo пишет JSON с массивом results. Различаем pass/fail/error:
  //   pass — все ассерты прошли
  //   fail — какой-то ассерт сломался (это нормальный негативный результат)
  //   error — сбой провайдера (сеть/rate-limit), не вина кандидата → не учитываем в знаменателе.
  const results = promptfooJson?.results?.results || promptfooJson?.results || [];
  if (!Array.isArray(results) || results.length === 0) {
    return { passed: 0, total: 0, errors: 0, pct: 0, raw: promptfooJson };
  }
  let passed = 0;
  let errors = 0;
  for (const r of results) {
    // Сетевая/провайдер-ошибка: только если есть error в gradingResult ИЛИ failureReason === ERROR.
    // r.error поле в promptfoo используется ТАКЖЕ для текста failed assertion (reasoning от llm-rubric),
    // поэтому нельзя считать r.error → провайдер.
    // Provider error: только если gradingResult.error НЕ undefined.
    // r.failureReason: 0=pass, 1=ASSERT_FAILED (это failed кейс, не ошибка провайдера), 2+=другие.
    const isProviderError = !!r?.gradingResult?.error;
    if (isProviderError) {
      errors++;
      continue;
    }
    if (r.success === true || r?.gradingResult?.pass === true) passed++;
  }
  const total = results.length;
  const denominator = total - errors;
  const pct = denominator === 0 ? 0 : passed / denominator;
  return { passed, total, errors, denominator, pct };
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

function ruDate() {
  const months = ["января","февраля","марта","апреля","мая","июня","июля","августа","сентября","октября","ноября","декабря"];
  const d = new Date();
  return `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}, ${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`;
}

function line() { return "─".repeat(60); }

async function main() {
  const { task, submission } = parseArgs(process.argv);
  const subPath = resolve(submission);
  if (!existsSync(subPath)) {
    console.error(`Файл сдачи не найден: ${subPath}`);
    process.exit(2);
  }
  const taskDir = resolveTaskDir(task);
  const taskNum = String(task).padStart(2, "0");
  const title = TASK_TITLES[taskNum] || `Задача ${taskNum}`;
  const subName = subPath.split(/[\\/]/).pop();

  const subText = readFileSync(subPath, "utf8");
  const parsed = parseSubmission(subText);

  console.log("");
  console.log(line());
  console.log("  ПРОВЕРКА СДАЧИ КАНДИДАТА");
  console.log(line());
  console.log("");
  console.log(`  Задача ${taskNum}  —  ${title}`);
  console.log(`  Файл сдачи:  ${subName}`);
  console.log(`  Дата:        ${ruDate()}`);
  console.log("");

  if (!parsed.ok) {
    console.log(line());
    console.log("  СДАЧА НЕ ПРИНЯТА");
    console.log(line());
    console.log("");
    console.log("  " + parsed.error);
    console.log("");
    console.log("  Кандидат должен прислать файл, в котором есть две");
    console.log("  обязательные секции: '### ФИНАЛ' (или '### FINAL')");
    console.log("  с финальным промптом, и '### ЛОГ' (или '### LOG')");
    console.log("  с рассказом про процесс работы.");
    console.log("");
    console.log("  Итоговый балл: 0 из 10");
    console.log("");
    process.exit(1);
  }

  const runId = `${process.pid}-${Date.now()}`;
  const promptFile = join(taskDir, `_submission_prompt_${runId}.txt`);
  writeFileSync(promptFile, parsed.finalText, "utf8");

  // Шаг 1 — автопроверка
  process.stdout.write("  Шаг 1 из 2. Прогон промпта кандидата на контрольных кейсах...\n");
  process.stdout.write("  (займёт 1-2 минуты, идёт обращение к ИИ)\n\n");

  const pfResult = runPromptfoo(taskDir, runId, `_submission_prompt_${runId}.txt`);
  const score = scoreFromResults(pfResult);
  const resultPoints = Math.round((score.pct * 6) * 100) / 100;

  // Шаг 2 — оценка процесса
  process.stdout.write("  Шаг 2 из 2. Оценка процесса работы по логу кандидата...\n\n");
  const judgeRes = await judgeLog({
    taskNum: task,
    logText: parsed.logText,
    finalText: parsed.finalText,
    resultPct: score.pct,
  });
  const processPoints = judgeRes.score;
  const total = Math.round((resultPoints + processPoints) * 100) / 100;

  // Финальный отчёт
  console.log(line());
  console.log("  РЕЗУЛЬТАТ");
  console.log(line());
  console.log("");
  console.log(`  Автопроверка на ${score.denominator} контрольных кейсах`);
  console.log(`  Пройдено правильно: ${score.passed} из ${score.denominator}  (${(score.pct * 100).toFixed(0)}%)`);
  if (score.errors > 0) {
    console.log(`  Ошибок ИИ-провайдера (не учитываются): ${score.errors}`);
  }
  console.log(`  Балл за результат:  ${resultPoints} из 6`);
  console.log("");
  console.log("  " + line().slice(2));
  console.log("");
  console.log(`  Оценка процесса работы кандидата (по логу)`);
  console.log(`  Балл за процесс:    ${processPoints} из 4`);
  console.log("");
  for (const item of judgeRes.breakdown) {
    const mark = item.pass ? "  +  " : "  -  ";
    const reasoning = (item.reasoning || "").slice(0, 200);
    console.log(`${mark}${item.criterion}`);
    if (reasoning && reasoning !== "n/a") {
      console.log(`     ${reasoning}`);
    }
  }
  console.log("");
  console.log(line());
  console.log("");
  console.log(`     ИТОГОВЫЙ БАЛЛ:  ${total} из 10`);
  console.log("");
  console.log(line());
  console.log("");

  const verdict = total >= 7 ? "Сильная сдача. Рекомендую к следующему этапу."
                : total >= 5 ? "Средняя сдача. На грани — стоит созвон или дополнительный кейс."
                : "Слабая сдача. Не готов к этой роли (или не вложился в задачу)."
;
  console.log("  Вердикт:  " + verdict);
  console.log("");

  // Сохраним подробный отчёт рядом со сдачей.
  const reportPath = subPath.replace(/\.md$/, "") + ".report.json";
  writeFileSync(
    reportPath,
    JSON.stringify({
      task: taskNum,
      taskTitle: title,
      submission: subPath,
      date: new Date().toISOString(),
      result: { passed: score.passed, total: score.total, errors: score.errors, denominator: score.denominator, pct: score.pct, points: resultPoints },
      process: { points: processPoints, branch: judgeRes.branch, breakdown: judgeRes.breakdown },
      total,
      verdict,
    }, null, 2),
    "utf8"
  );
  console.log(`  Подробный отчёт сохранён: ${reportPath}`);
  console.log("");
}

main().catch((e) => {
  console.error("Ошибка:", e.message);
  process.exit(1);
});
