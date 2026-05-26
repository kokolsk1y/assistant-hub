// LLM-судья по логу процесса.
// Дефолтная рубрика (задачи 1, 3, 4, 6, 7, 8): 4 бинарных пункта × 1 балл = 4 балла.
// Бранч «защита одной попытки»: если результат ≥5/6 (т.е. pct ≥ 0.833) — лог не требуется, 4/4.
//
// Особые случаи:
//   - Task 09 (workflow): 2 балла = `interfaces-rubric` по финал-блоку, 2 балла = `weak-link-rubric` по логу.
//   - Task 02 (few-shot): «лог» здесь — это защита выбора (5 выбрано / 5 отвергнуто); тот же 4-пунктовый формат, но критерии другие.
//   - Task 05 (context-pack): обычная 4-пунктовая рубрика + 5-й бонусный пункт «есть ли следы baseline-проверки в логе».

import { spawnSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { resolve, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

const JUDGE_PROMPT = `Ты — судья качества процесса работы кандидата над промпт-инжиниринговой задачей.
Кандидат сдал «лог процесса» — описание того, как он итеративно дорабатывал свою конфигурацию (промпт/правила/контекст-пак).

Оцени лог по 4 бинарным критериям. Каждый = 0 или 1.

ВАЖНЫЙ ПРИОРИТЕТ:
1) Если кандидат показал высокий результат (≥5/6) с ОДНОЙ попытки и приложил обоснование (почему хватило одной попытки) — оценивай ОБОСНОВАНИЕ по той же 4-пунктовой рубрике, где «версии» = «аргументы», «правки» = «контр-примеры», «измеримый критерий» = «убедительность».
2) Если нет ни осмысленного лога ≥3 версий, ни обоснования — все 4 пункта = 0.

Критерии:
1. Есть ≥3 версии конфигурации?
2. Между версиями есть РЕАЛЬНАЯ разница (содержательная, не косметика — переписывание правил, смена примеров, изменение структуры)?
3. У каждой правки названа ПРИЧИНА на основе конкретного замера/наблюдения (а не «улучшил формулировку»)?
4. Финальная версия лучше первой по ИЗМЕРИМОМУ критерию (% кейсов, длина ошибок, конкретный ассерт)?

Верни строгий JSON БЕЗ ОБЁРТКИ в \`\`\`:
{
  "branch": "iterations" | "one-shot-defense" | "no-evidence",
  "items": [
    {"criterion": "≥3 версии", "pass": true|false, "reasoning": "1 предложение"},
    {"criterion": "реальная разница", "pass": true|false, "reasoning": "..."},
    {"criterion": "причина из замера", "pass": true|false, "reasoning": "..."},
    {"criterion": "финал лучше первой", "pass": true|false, "reasoning": "..."}
  ]
}

КОНТЕКСТ:
Результат автопроверки кандидата: {{RESULT_PCT}}% пройденных кейсов.
Если ≥83% — это «успех с одной попытки» при условии что лог короткий, иначе всё равно оцениваем итерации.

ЛОГ КАНДИДАТА:
"""
{{LOG}}
"""`;

function openRouterCall(prompt, opts = {}) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error("OPENROUTER_API_KEY не задан. Скопируй autoeval/.env.example в autoeval/.env и заполни ключ.");
  }
  const model = (process.env.PROMPTFOO_JUDGE_MODEL || "openrouter:anthropic/claude-sonnet-4-6").replace(/^openrouter:/, "");
  const body = {
    model,
    messages: [{ role: "user", content: prompt }],
    temperature: 0,
    max_tokens: opts.maxTokens || 1500,
    ...(opts.json ? { response_format: { type: "json_object" } } : {}),
  };
  return fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://github.com/kokolsk1y/assistant-hub",
      "X-Title": "Assistant Hub Autoeval",
    },
    body: JSON.stringify(body),
  }).then(async (res) => {
    if (!res.ok) {
      const t = await res.text();
      throw new Error(`OpenRouter ошибка ${res.status}: ${t.slice(0, 500)}`);
    }
    const data = await res.json();
    return data?.choices?.[0]?.message?.content || "";
  });
}

function safeJson(content) {
  try {
    return JSON.parse(content);
  } catch {}
  try {
    const cleaned = content.replace(/^```(json)?/m, "").replace(/```$/m, "").trim();
    return JSON.parse(cleaned);
  } catch {}
  // Последний шанс — вытащить первый {...} блок regexp-ом.
  const m = content.match(/\{[\s\S]*\}/);
  if (m) {
    try { return JSON.parse(m[0]); } catch {}
  }
  return { items: [], _parseError: true, _raw: content.slice(0, 300) };
}

// Универсальная 4-пунктовая рубрика для лога/финала. Возвращает score 0-N (по количеству pass).
async function fourPointRubric({ prompt, header }) {
  const content = await openRouterCall(prompt, { json: true });
  const parsed = safeJson(content);
  const items = Array.isArray(parsed.items) ? parsed.items : [];
  const score = items.reduce((s, it) => s + (it.pass ? 1 : 0), 0);
  return { score, branch: parsed.branch || header, breakdown: items };
}

// Task 09 — двойная рубрика: interfaces (по финал-блоку) + weak-link (по логу). Каждая даёт 0-2 балла.
async function judgeTask09({ finalText, logText, resultPct }) {
  // Бранч «защита одной попытки»: если результат ≥5/6 и финал детально расписан как «один шаг намеренно» — частично.
  // Пока — не упрощаем для task 09, всегда крутим обе рубрики.
  const interfacesPrompt = `Ты — судья качества архитектуры воркфлоу финальной задачи курса промпт-инжиниринга.
Прочитай блок ФИНАЛ кандидата и оцени по 4 БИНАРНЫМ пунктам:

1. Шаги явно перечислены и пронумерованы?
2. У каждого шага явно указан формат входа и выхода?
3. Между шагами нет потерь информации (выход шага N идёт на вход N+1)?
4. Финальный исполняемый промпт согласован с архитектурой?

Защита: ЕСЛИ кандидат сделал ОДИН шаг намеренно (явно объяснил, проверил на входах), пункт 1 засчитывается.

Верни строгий JSON БЕЗ обёрток:
{
  "items": [
    {"criterion": "шаги перечислены", "pass": true|false, "reasoning": "..."},
    {"criterion": "форматы IO", "pass": true|false, "reasoning": "..."},
    {"criterion": "нет потерь", "pass": true|false, "reasoning": "..."},
    {"criterion": "финал согласован", "pass": true|false, "reasoning": "..."}
  ]
}

ФИНАЛ-БЛОК:
"""
${finalText.slice(0, 10000)}
"""`;
  const weakLinkPrompt = `Ты — судья качества лога отладки многошагового воркфлоу.
Прочитай блок ЛОГ кандидата и оцени по 4 БИНАРНЫМ пунктам:

1. В логе явно назван хотя бы один слабый компонент или стык?
2. Указана причина — как МЕХАНИКА (что в промпте не так), а не как симптом?
3. Починка точечная — целит в найденную проблему, а не "переписать всё с нуля"?
4. Есть подтверждение, что починка сработала и не сломала соседей (любой замер до/после)?

Защита: если кандидат получил ≥5/6 за результат с первой версии И в логе явно назвал слабые места — пункты 1-2 засчитываются. Пункты 3-4 засчитываются если обоснование «не трогал намеренно» конкретное и убедительное.
Контекст: результат автопроверки = ${(resultPct * 100).toFixed(1)}%.

Верни строгий JSON БЕЗ обёрток:
{
  "items": [
    {"criterion": "слабое звено назван", "pass": true|false, "reasoning": "..."},
    {"criterion": "причина-механика", "pass": true|false, "reasoning": "..."},
    {"criterion": "починка точечная", "pass": true|false, "reasoning": "..."},
    {"criterion": "проверил результат", "pass": true|false, "reasoning": "..."}
  ]
}

ЛОГ-БЛОК:
"""
${logText.slice(0, 10000)}
"""`;

  // allSettled — чтобы один сбой одной рубрики не убил вторую.
  const settled = await Promise.allSettled([
    fourPointRubric({ prompt: interfacesPrompt, header: "task09-interfaces" }),
    fourPointRubric({ prompt: weakLinkPrompt, header: "task09-weak-link" }),
  ]);
  const fallback = { score: 0, breakdown: [{ criterion: "судья упал", pass: false, reasoning: "OpenRouter ошибка" }] };
  const interfaces = settled[0].status === "fulfilled" ? settled[0].value : fallback;
  const weakLink = settled[1].status === "fulfilled" ? settled[1].value : fallback;
  if (settled[0].status === "rejected") console.warn("⚠ interfaces-rubric не отработал:", settled[0].reason?.message);
  if (settled[1].status === "rejected") console.warn("⚠ weak-link-rubric не отработал:", settled[1].reason?.message);

  // 4 из 4 → 2 балла, 2-3 → 1, 0-1 → 0.
  const toTwoPoints = (n) => (n >= 4 ? 2 : n >= 2 ? 1 : 0);
  const interfacesPoints = toTwoPoints(interfaces.score);
  const weakLinkPoints = toTwoPoints(weakLink.score);

  return {
    score: interfacesPoints + weakLinkPoints,
    branch: "task09-dual-rubric",
    breakdown: [
      { criterion: `interfaces: ${interfacesPoints}/2 (${interfaces.score}/4 пунктов)`, pass: interfacesPoints === 2, reasoning: interfaces.breakdown.map((b) => `${b.pass ? "✓" : "✗"} ${b.criterion}`).join("; ") },
      { criterion: `weak-link: ${weakLinkPoints}/2 (${weakLink.score}/4 пунктов)`, pass: weakLinkPoints === 2, reasoning: weakLink.breakdown.map((b) => `${b.pass ? "✓" : "✗"} ${b.criterion}`).join("; ") },
    ],
  };
}

export async function judgeLog({ taskNum, logText, finalText, resultPct }) {
  // Task 09 — двойная рубрика.
  if (String(taskNum) === "09" || String(taskNum) === "9") {
    return judgeTask09({ finalText: finalText || "", logText, resultPct });
  }

  const apiKey = process.env.OPENROUTER_API_KEY;
  const model = (process.env.PROMPTFOO_JUDGE_MODEL || "openrouter:anthropic/claude-sonnet-4-6").replace(/^openrouter:/, "");

  // Ранний бранч: если pct ≥ 0.833 (5/6) и лог тривиальный (<200 симв) — автоматически 4/4.
  if (resultPct >= 5 / 6 && logText.trim().length < 200) {
    return {
      score: 4,
      branch: "one-shot-auto",
      breakdown: [
        { criterion: "≥3 версии", pass: true, reasoning: "Защита одной попытки: результат ≥5/6, лог не требуется." },
        { criterion: "реальная разница", pass: true, reasoning: "n/a" },
        { criterion: "причина из замера", pass: true, reasoning: "n/a" },
        { criterion: "финал лучше первой", pass: true, reasoning: "n/a" },
      ],
    };
  }

  if (!apiKey) {
    throw new Error(
      "OPENROUTER_API_KEY не задан. Скопируй autoeval/.env.example в autoeval/.env и заполни ключ."
    );
  }

  const prompt = JUDGE_PROMPT.replaceAll("{{LOG}}", logText.slice(0, 12000)) // защита от слишком длинного лога
    .replaceAll("{{RESULT_PCT}}", (resultPct * 100).toFixed(1));

  const body = {
    model,
    messages: [{ role: "user", content: prompt }],
    temperature: 0,
    max_tokens: 1500,
    response_format: { type: "json_object" },
  };

  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://github.com/kokolsk1y/assistant-hub",
      "X-Title": "Assistant Hub Autoeval",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OpenRouter ошибка ${res.status}: ${text.slice(0, 500)}`);
  }
  const data = await res.json();
  const content = data?.choices?.[0]?.message?.content || "{}";
  const parsed = safeJson(content);
  const items = Array.isArray(parsed.items) ? parsed.items : [];
  const score = items.reduce((s, it) => s + (it.pass ? 1 : 0), 0);
  return {
    score,
    branch: parsed.branch || (parsed._parseError ? "parse-error" : "unknown"),
    breakdown: items,
  };
}

// CLI-режим: `node judge.mjs <log-file>` — для отладки.
if (import.meta.url === `file://${process.argv[1].replace(/\\/g, "/")}` ||
    process.argv[1]?.endsWith("judge.mjs")) {
  const logFile = process.argv[2];
  if (logFile) {
    const { readFileSync } = await import("node:fs");
    const log = readFileSync(logFile, "utf8");
    const pct = parseFloat(process.argv[3] || "0.5");
    const res = await judgeLog({ taskNum: "?", logText: log, resultPct: pct });
    console.log(JSON.stringify(res, null, 2));
  }
}
