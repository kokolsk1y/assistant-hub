# Research: Pitfalls для Assistant Hub

**Topic:** pitfalls
**Date:** 2026-05-22
**Project:** Assistant Hub

---

## Executive Summary

Проект сочетает четыре зоны повышенного риска: нестабильный на Windows стек (OpenClaw), HR/ПДн-регулирование (152-ФЗ + Трудовой кодекс), высокую частоту фрода в онлайн-тестах (до 40% в 2025 году) и типичные failure modes мульти-агентных систем. MVP на локальном ПК Коли создаёт дополнительный операционный долг при переезде на VPS.

---

## Findings

### 1. OpenClaw на Windows 11

- **PATH mismatch (Issue #19921)** — однострочный установщик ожидает `\bin`, реальный PATH без него
- **Spawn EINVAL** на Windows — `shouldSpawnWithShell` возвращает `false` ошибочно
- **"No file-writing tools available"** после обновлений — нужна явная верификация после `openclaw update`
- **10x I/O penalty** при хранении проекта на `/mnt/c/` в WSL2 — хранить в `~/` внутри WSL
- **Custom agents не распознаются (Issue #17330)** — `sessions_spawn` с кастомным agentId → "forbidden"
- **Subagents всегда используют primary model (Issue #10963)** — budget strategy через нативный механизм ломается
- **Autostart как Windows Service** — `schtasks` отказывает в non-admin PowerShell

**Рекомендация**: WSL2 с Node 24, проект в `~/`, верификация после каждого обновления.

### 2. Telegram-боты в production

- Rate limit: 30 msg/sec на токен, `retry_after` per-chat
- **Webhook timeout 60 сек** vs ИИ 15-40 сек → ИИ-вызов всегда в **background worker** с очередью
- Polling vs webhook: на ПК — polling, на VPS — webhook. Нельзя смешивать.
- `answerCallbackQuery` немедленно (не ждёт ИИ), потом edit message
- Пропущенные updates хранятся 24 часа — игнорировать старше 5 минут при старте

### 3. ИИ-оценка людей — правовые риски РФ

**ТК РФ ст. 86**: «работодатель не вправе основываться на ПДн, полученных исключительно в результате автоматизированной обработки».
→ Автоматический отказ запрещён. Решение по баллу = **рекомендация для Дмитрия**, не финальный отказ.

**152-ФЗ**:
- Neon `eu-central-1` (Frankfurt) — формально нарушение требования локализации
- Требуется согласие на ПДн до начала обработки
- Передача данных в OpenRouter — нужен договор поручения обработки

**Когда ИИ отказывается оценивать**:
- ❌ «Оцени кандидата Иванова» — safety refusal ~70%
- ✓ «Оцени работу по рубрике» — safety refusal ~5%

### 4. Анти-фрод (масштаб 2025)

- Фрод при найме: **16% (2024) → 35% (2025)**
- Entry-level: **15% → 40%**
- ~50% соискателей признают AI-misrepresentation навыков

**Что работает**:
1. Временные метаданные (`started_at`, `submitted_at`) — флаг для ручной проверки
2. **Процесс-вопросы** в задании ("какие промпты использовали? почему?") — детектирует слепой copy-paste
3. **Уникальный seed-параметр** в задании — усложняет шаринг готовых решений
4. AI-watermarking — **не продакшн-ready** (false positives для non-native)

**Преимущество проекта**: разрешено использование ИИ → оценка смещается с "поймать" на "оценить качество взаимодействия".

### 5. OpenRouter — затраты и контроль

**Critical: max_tokens trap**
OpenRouter резервирует **весь max_output** против бюджета, не фактические токены. Sonnet max = 64K → бюджет $10/день может исчерпаться за 10 запросов.
→ **Всегда указывать max_tokens явно**: Sonnet ≤ 2000, Haiku ≤ 500.

**Стратегия моделей**:
| Задача | Модель | $/вызов |
|---|---|---|
| Маршрутизация / FSM | Haiku 4.5 | ~$0.0003 |
| Оценка теста | Sonnet 4.6 | ~$0.015 |
| Edge cases | Opus 4.7 | ~$0.075 |

**Обязательно**: try/catch на все вызовы + fallback статус `evaluation_failed` + уведомление Дмитрию.

### 6. Multi-agent failure modes

- **Cascade Hallucination**: агент A даёт `confidence: 0.6`, B принимает за факт. → Возвращать `requires_confirmation: true` при low confidence
- **Coordinator Deadlock**: → hard timeout 30-60 сек на каждый суб-агент вызов
- **Cost Explosion через рекурсию**: → `MAX_CLARIFICATION_ROUNDS = 2`
- **Schema Drift**: → JSON-схемы в `schemas/agent-contracts.json`, Zod валидация на каждый межагентный обмен

### 7. Локальный hosting → VPS

| Что | Локально | VPS | Риск |
|---|---|---|---|
| Пути | `C:\...` | `/home/...` | Hardcoded paths |
| Кодировка | UTF-16 / 1251 | UTF-8 | Проверить I/O |
| Daemon | Scheduled Task | systemd | Переписать |
| TG | polling | webhook | Переключение |

**Рекомендация**: Neon Postgres с первого дня (не SQLite local), единая схема.

### 8. Команда 1-2 разраба — что критично с первого дня

- Логирование (OpenRouter calls, FSM transitions, errors) — JSON формат
- Бэкап Neon — проверить настройки до первого реального кандидата
- `.env` в `.gitignore`, `.env.example` с заглушками
- **FSM-состояния всегда в Postgres**, не в памяти — рестарт = потеря активных диалогов

---

## Recommendations

### Must Do

1. **WSL2 для OpenClaw** — нативный Windows источник бесконечных проблем
2. **Явный max_tokens во всех OpenRouter вызовах** — без него budget trap
3. **Согласие на ПДн как первый шаг онбординга** — кнопка «Согласен», timestamp в БД
4. **FSM-состояния только в Neon, никогда в памяти**
5. **Ответ 200 в webhook немедленно, ИИ в background queue**
6. **Валидация JSON-схем между агентами через Zod**
7. **Try/catch + fallback status на все OpenRouter вызовы**
8. **Hard timeout (30-60 сек) на каждый суб-агент вызов**

### Should Do

9. Neon с первого дня (не SQLite для dev)
10. Langfuse free tier для мониторинга OpenRouter
11. ИИ-оценщик оценивает "работу", не "человека"
12. `MAX_CLARIFICATION_ROUNDS = 2`
13. Временные метаданные тестов (started_at, submitted_at)
14. `.env.example` + `.gitignore` для `.env` до первого коммита

### Consider

15. `answerCallbackQuery` немедленно, потом edit message
16. Игнорировать updates старше 5 минут при старте
17. GLOSSARY.md для общей терминологии агентов
18. Уникальный seed-параметр в тестовых заданиях
19. Процесс-вопросы в тестах
20. Долгосрочно: Neon в РФ или self-hosted Postgres

---

## Conflicts / Open Questions

**Конфликт 1: Issue #17330 vs мульти-агент через sessions_spawn**
Текущая версия OpenClaw — кастомные агенты через `sessions_spawn` не работают. **Альтернатива**: на v1 реализовать агентов как последовательные прямые вызовы OpenRouter, мигрировать на нативный OpenClaw когда issue будет закрыт.

**Конфликт 2: 152-ФЗ и Neon eu-central-1**
До публичного запуска решить: оговорка в согласии или смена региона.

**Открытые вопросы**:
- Будет ли OpenClaw Issue #10963 закрыт к моменту разработки?
- Subagents через единую глобальную очередь (Issue #10467) — критично при batch 5-10 кандидатов?
- hh.ru ToS запрещают передачу данных кандидатов третьим API (OpenRouter) — нужен юридический анализ

---

## Sources

- [OpenClaw Windows docs](https://docs.openclaw.ai/platforms/windows)
- [GitHub Issue #19921 — PATH mismatch](https://github.com/openclaw/openclaw/issues/19921)
- [GitHub Issue #17330 — Custom agents not recognized](https://github.com/openclaw/openclaw/issues/17330)
- [GitHub Issue #10963 — Subagents ignore model config](https://github.com/openclaw/openclaw/issues/10963)
- [GitHub Issue #10467 — Multi-lane concurrency](https://github.com/openclaw/openclaw/issues/10467)
- [Telegram Bot API Rate Limits](https://core.telegram.org/bots/webhooks)
- [ФЗ-152 Securiti overview](https://securiti.ai/russian-federal-law-no-152-fz/)
- [AI in HR Compliance Risks](https://www.legalnodes.com/article/ai-in-hr-compliance-risks)
- [CodeSignal: Assessment Fraud Doubled in 2025](https://codesignal.com/newsroom/press-releases/codesignal-detection-systems-identify-and-stop-record-high-cheating-attempts-as-assessment-fraud-more-than-doubled-in-2025/)
- [OpenRouter max_tokens budget trap](https://timetobuildbob.com/blog/the-hidden-cost-of-max-tokens-openrouter-budget-trap/)
- [OpenRouter Guardrails](https://openrouter.ai/docs/guides/features/guardrails)
- [Multi-Agent Orchestration Failure Playbook 2026](https://cogentinfo.com/resources/when-ai-agents-collide-multi-agent-orchestration-failure-playbook-for-2026)
- [hh.ru API Developer Agreement](https://dev.hh.ru/admin/developer_agreement)
