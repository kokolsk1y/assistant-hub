# Research: Architecture для Assistant Hub

**Topic:** architecture
**Date:** 2026-05-22

---

## Executive Summary

Assistant Hub требует строго детерминированной мультиагентной архитектуры, где FSM кандидата хранится в Neon Postgres, каждый ИИ-агент получает узкий контракт в виде Zod-схемы, а оркестрация пайплайна оценки теста реализуется через OpenClaw `sessions_spawn` + `sessions_yield` с **Lobster** (YAML-workflow для OpenClaw). Нативного барьера fan-in в OpenClaw нет (Issue #38433 открыт, март 2026) — рабочий обход: последовательный запуск субагентов.

Каждой роли — своя модель: **Haiku 4.5** для маршрутизации, **Sonnet 4.6** для основных задач, **Opus 4.6** только для спорных случаев Decision Maker.

---

## 1. OpenClaw subagents — fan-out/fan-in

### `sessions_spawn` + `sessions_yield`

- `sessions_spawn` — создаёт изолированную сессию субагента, неблокирующий, возвращает `runId`
- `sessions_yield` — завершает текущий ход модели, ждёт runtime-события (правильный примитив, **НЕ polling**)
- Документация явно запрещает polling-loops с `sessions_list`/`sessions_history`/`sleep`

### Issue #38433 — нет нативного fan-in барьера (открыт, март 2026)

При параллельном spawn N субагентов оркестратор может не продолжить детерминированно. **Workaround:** запускать субагентов последовательно — добавляет ~8-12 сек wall time, полностью устраняет зависание. Для онбординга latency не критична.

### Декомпозиция «оценить тест» на 4 узкие задачи

```
Текст теста кандидата
    ↓
[1] Direction Classifier (Haiku 4.5)
    Output: { confirmed_direction, confidence, reasoning }
    ↓
[2] AI-Tooling Evaluator (Sonnet 4.6)
    Output: { prompt_quality, ai_critique, iteration_depth, understanding, evidence[], score }
    ↓
[3] Copypaste Detector (Sonnet 4.6)
    Output: { is_suspicious, suspicion_level, evidence[], explanation }
    ↓
[4] Summary Builder (Sonnet 4.6)
    Output: { total_score, verdict, strengths[], weaknesses[], verdict_reason }
```

Оркестрирует **Test Evaluator** как Lobster-workflow.

---

## 2. JSON-схемы (Zod v3)

### Три уровня защиты output LLM

1. **`response_format: { type: "json_schema", json_schema: zodToJsonSchema(Schema) }`** в каждом OpenRouter-запросе
2. **Response Healing plugin** (`plugins: [{ id: "response-healing" }]`) — автоматически чинит trailing commas, markdown-обёртки. Снижает дефекты на 80-99%. Только для non-streaming.
3. **`z.safeParse()`** на стороне получателя — последний рубеж

### Retry pattern

```
Attempt 1: запрос с json_schema + response-healing → safeParse → success?
Attempt 2 (failed): reprompt с описанием ошибки → safeParse → success?
Attempt 3 (failed): structured fallback { success: false, raw: response }
  → Decision Maker получает флаг, решает без этого субагента
  → лог в Neon
```

Claude + OpenRouter + response-healing = >99.9% валидных, attempt 3 редок.

---

## 3. Multi-brain паттерны

### Master-Worker в OpenClaw

- `maxSpawnDepth: 1` (default) — субагенты не спавнят детей
- `maxSpawnDepth: 2` — Coordinator → Orchestrator → Workers
- **Для Assistant Hub: `maxSpawnDepth: 2`.** Onboarding Coordinator (depth-0) → Test Evaluator orchestrator (depth-1) → 4 воркера (depth-2)

### Lobster — детерминированный оркестратор пайплайна

Lobster — typed local-first YAML workflow shell для OpenClaw. **LLM не принимает решения о порядке шагов.**

```yaml
# test-evaluation.lobster
steps:
  - name: classify_direction
    skill: direction-classifier
    input: "{{ candidate.test_text }}"
  - name: evaluate_ai_tooling
    skill: ai-tooling-evaluator
    input: "{{ candidate.test_text }}"
  - name: detect_copypaste
    skill: copypaste-detector
    input: "{{ candidate.test_text }}"
  - name: build_summary
    skill: summary-builder
    input: "{{ steps.* }}"
  - name: decision
    skill: decision-maker
    approval_gate: "{{ steps.build_summary.output.verdict == 'call_needed' }}"
```

Свойства Lobster:
- Детерминированный порядок шагов
- `approval_gate` — остановка до явного подтверждения
- Sub-workflows (PR #20, февраль 2026)
- Resumable по token

### Persistent vs One-shot agents

| Тип | Когда | Реализация |
|---|---|---|
| **Persistent** | Coordinator, Anketa Bot — долгоживущие, помнят кандидата | `system-prompt.md` + memory scope `agent:<role>` |
| **One-shot** | Test Evaluator воркеры — раз запустились, JSON, умерли | `sessions_spawn` с полным контекстом |

---

## 4. Memory разделение

### L1 OpenClaw SQLite — сессионная

Кратковременная в рамках текущей сессии. **НЕ хранить FSM-state.**

### L2 Neon Postgres — FSM-state и факты

| Таблица | Содержимое |
|---|---|
| `candidates` | telegram_id, fsm_state, created_at, updated_at |
| `anketa` | candidate_id, direction, level, ai_experience, about |
| `tests` | id, title, text, direction, level (тест-библиотека) |
| `test_assignments` | candidate_id, test_id, assigned_at, submitted_text, submitted_at |
| `evaluations` | classifier_output, ai_tooling_output, copypaste_output, summary, total_score, verdict |
| `audit_log` | candidate_id, action, actor, payload, created_at |

### L3 LanceDB (memory-lancedb-pro) — семантическая

Multi-Scope Isolation: `agent:<id>`, `user:<id>`, `project:<id>`.

| Агент | Scope | Что хранит |
|---|---|---|
| Onboarding Coordinator | `agent:coordinator` | Паттерны поведения кандидатов |
| Test Evaluator | `agent:test-evaluator` | Примеры хороших/плохих тестов для калибровки |
| Decision Maker | `agent:decision-maker` | Прецеденты спорных решений |
| Manager Digester | `agent:manager-digester` | Предпочтения Дмитрия по формату |
| Кандидат | `user:<telegram_id>` | Семантика разговоров, контекст |

**Правило:** Postgres = факты и статусы. LanceDB = семантика.

---

## 5. OpenClaw MCP vs Skills

| Сценарий | Инструмент |
|---|---|
| Коля смотрит/меняет данные в Neon | **MCP + Claude Code** (прямой SQL) |
| Отладка зависшего FSM | **MCP + Claude Code** |
| Разработка скилла-оценщика | **OpenClaw skill напрямую** |
| Продакшн: тест → оценка → решение | **OpenClaw + Lobster pipeline** |
| Дмитрий запрашивает дайджест | **OpenClaw TG Bot команда** |

---

## 6. Дизайн ролей агентов

### Матрица

| Роль | Модель | Тип | Инициация |
|---|---|---|---|
| Onboarding Coordinator | Sonnet 4.6 | Persistent | `/start` в TG |
| Anketa Bot | Haiku 4.5 | Persistent в сессии | После `/start` |
| Test Selector | Haiku 4.5 | One-shot | После анкеты |
| Test Evaluator (orchestrator) | Sonnet 4.6 | depth-1 | После сдачи теста |
| ↳ Direction Classifier | Haiku 4.5 | One-shot (depth-2) | от Test Evaluator |
| ↳ AI-Tooling Evaluator | Sonnet 4.6 | One-shot (depth-2) | от Test Evaluator |
| ↳ Copypaste Detector | Sonnet 4.6 | One-shot (depth-2) | от Test Evaluator |
| ↳ Summary Builder | Sonnet 4.6 | One-shot (depth-2) | от Test Evaluator |
| Decision Maker | Sonnet 4.6 / Opus 4.6* | One-shot | После Summary |
| Communicator Notifier | Haiku 4.5 | One-shot | verdict == call_needed |
| Manager Digester | Sonnet 4.6 | Scheduled / on-demand | По расписанию |

*Decision Maker — **детерминированная логика как первый слой**. Opus 4.6 только при `score 30-70` или `suspicion_level == "high"`. Снижает расход Opus до 5-10% вызовов.

### Zod-контракты (выдержки, полный список в коде)

**EvaluationSummary:**
```typescript
const EvaluationSummary = z.object({
  candidate_id: z.string().uuid(),
  total_score: z.number().min(0).max(100),
  direction_match: z.boolean(),
  ai_tooling_score: z.number().min(0).max(100),
  copypaste_flag: z.boolean(),
  verdict: z.enum(["approved","call_needed","rejected"]),
  verdict_reason: z.string().max(500),
  strengths: z.array(z.string()).max(5),
  weaknesses: z.array(z.string()).max(5),
  evaluated_at: z.string().datetime()
});
```

**AIToolingOutput:**
```typescript
const AIToolingOutput = z.object({
  prompt_quality: z.number().int().min(1).max(5),
  ai_critique: z.number().int().min(1).max(5),
  iteration_depth: z.number().int().min(1).max(5),
  understanding: z.number().int().min(1).max(5),
  evidence: z.array(z.string()).max(5),
  score: z.number().min(0).max(100)
});
```

Полный набор Zod-схем для всех 11 ролей — см. раздел "Дизайн ролей" в исходнике; разместим в `schemas/agent-contracts.ts` при реализации Phase 2.

---

## Recommendations

### Must Do

1. **Lobster YAML-workflow** для всего пайплайна оценки. LLM не управляет порядком шагов.
2. **Zod-схемы как единственный контракт** между агентами. Одна схема дважды: `json_schema` для OpenRouter + `safeParse` для получателя.
3. **Response Healing plugin** во все OpenRouter-запросы с `response_format`. Одна строка, 80-99% дефектов уходят.
4. **FSM-state исключительно в Neon Postgres.**
5. **`maxSpawnDepth: 2`.** Coordinator → Test Evaluator → 4 воркера.
6. **Последовательный запуск 4 воркеров** до закрытия Issue #38433.

### Should Do

7. **memory-lancedb-pro** с per-agent scoping для каждого персистентного агента.
8. **Decision Maker детерминированная логика как первый слой.** Opus только при score 30-70 или high suspicion.
9. **Retry с reprompting максимум 2 раза.** Третий — structured error.
10. **MCP-сервер Neon в Claude Code** для прямого SQL при разработке.

### Consider

11. **HiClaw в v2** при появлении командной работы (несколько ассистентов + менеджеры).
12. **Параллельный fan-out** 4 воркеров после закрытия #38433 (~12 сек → ~4 сек).

---

## Конфликты / Открытые вопросы

| # | Вопрос | Влияние |
|---|---|---|
| 1 | Issue #38433 открыт | Serial workaround, пересмотр при закрытии |
| 2 | OpenClaw не запускался у Коли | Boot-фаза обязательна |
| 3 | Рубрики оценки от Дмитрия | Веса AIToolingOutput пока заглушки |
| 4 | Библиотека тестов не написана | Phase 1 включает её создание |
| 5 | Точные FSM-состояния | 7 состояний — рабочая гипотеза |
| 6 | Коммуникатор: тот же бот или отдельный | Влияет на способ нотификации |
| 7 | Structured outputs Claude через OpenRouter | Верифицировать на первом прогоне |

---

## Sources

- [Sub-agents — OpenClaw](https://docs.openclaw.ai/tools/subagents)
- [Session tools — OpenClaw](https://docs.openclaw.ai/concepts/session-tool)
- [Issue #38433 — missing fan-in barrier](https://github.com/openclaw/openclaw/issues/38433)
- [Deterministic multi-agent pipeline via Lobster](https://dev.to/ggondim/how-i-built-a-deterministic-multi-agent-dev-pipeline-inside-openclaw-and-contributed-a-missing-4ool)
- [lobster GitHub](https://github.com/openclaw/lobster)
- [lobster PR #20 sub-workflows](https://github.com/openclaw/lobster/pull/20)
- [OpenRouter Structured Outputs](https://openrouter.ai/docs/guides/features/structured-outputs)
- [OpenRouter Response Healing](https://openrouter.ai/docs/guides/features/plugins/response-healing)
- [Response Healing — 80-99% defect reduction](https://openrouter.ai/announcements/response-healing-reduce-json-defects-by-80percent)
- [Claude Agent SDK structured outputs](https://platform.claude.com/docs/en/agent-sdk/structured-outputs)
- [Zod docs](https://zod.dev/)
- [memory-lancedb-pro](https://github.com/CortexReach/memory-lancedb-pro)
- [Issue #15325 per-agent memory](https://github.com/openclaw/openclaw/issues/15325)
- [MCP docs — OpenClaw](https://docs.openclaw.ai/cli/mcp)
- [Claude model pricing 2026](https://devtk.ai/en/blog/claude-api-pricing-guide-2026/)
- [HiClaw](https://github.com/agentscope-ai/hiclaw)
