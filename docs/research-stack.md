# Research: Stack для Assistant Hub

**Topic:** stack
**Date:** 2026-05-22

---

## Executive Summary

OpenClaw на Windows 11 нативно нестабилен — официальный путь через **WSL2 (Ubuntu)**. Telegram использует long polling (правильный выбор для локальной машины без публичного IP). Neon подключается через `postgres.js` с pooled-строкой. OpenRouter slug: `openrouter/anthropic/claude-sonnet-4.6` (точка вместо дефиса). FSM — в Neon Postgres, не SQLite.

---

## 1. OpenClaw на Windows

- Официально поддерживается **только через WSL2 (Ubuntu 22.04+)**
- Node.js минимум **22.14+**, рекомендуется **24** (через nvm)
- Issue #19921: PATH `\bin` mismatch после установки
- `spawn npm ENOENT` — частый баг, фикс в **2026.2.25+**
- Рабочая директория: `~/.openclaw`. Web dashboard порт: **18789**
- Автостарт: `openclaw onboard --install-daemon` → Windows Scheduled Task или Startup folder
- **Orphaned process bug** до 2026.2.25 — проверить версию

**Установка:**
```bash
# В WSL2 Ubuntu
nvm install 24
nvm use 24
npm install -g openclaw@latest
openclaw onboard --install-daemon
```

---

## 2. Telegram в OpenClaw

| Режим | Для локальной машины |
|---|---|
| **Long polling** (default) | ✅ Работает без публичного IP |
| Webhook | ❌ Требует публичный HTTPS |

```json
{
  "channels": {
    "telegram": {
      "botToken": "${TELEGRAM_BOT_TOKEN}",
      "transport": "polling"
    }
  }
}
```

**Gotcha:** Telegram запрещает два polling-клиента с одним токеном → 409 Conflict. После crash конфликт длится 30-60 сек.

---

## 3. Neon Postgres

**Драйвер:** `postgres.js` (не `@neondatabase/serverless` — он для edge, не для long-running Node).

**Строки подключения:**
- Приложение → **pooled URL** (`-pooler.` в hostname, PgBouncer)
- Миграции → **direct URL** (без pooler, transaction mode ломает миграции)

```typescript
import postgres from 'postgres';

const sql = postgres(process.env.DATABASE_POOLED_URL!, {
  max: 10,
  idle_timeout: 20,
  connect_timeout: 10,
  ssl: 'require'
});
```

**PgBouncer transaction mode**: `SET search_path` не сохраняется между запросами. Использовать schema-qualified имена.

### Схема для онбординга

```sql
CREATE TABLE candidates (
  id          SERIAL PRIMARY KEY,
  tg_user_id  BIGINT UNIQUE NOT NULL,
  tg_username TEXT,
  fsm_state   TEXT NOT NULL DEFAULT 'new',
  -- new → survey_started → survey_done → test_assigned
  -- → test_submitted → evaluated → approved | borderline | rejected | abandoned
  direction   TEXT,
  level       TEXT,
  ai_exp      TEXT,
  source      TEXT,
  pdn_consent_at TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE test_submissions (
  id           SERIAL PRIMARY KEY,
  candidate_id INT REFERENCES candidates(id),
  task_id      TEXT NOT NULL,
  submission   TEXT,
  prompt_history TEXT,
  score        INT,
  eval_json    JSONB,
  started_at   TIMESTAMPTZ,
  submitted_at TIMESTAMPTZ,
  evaluated_at TIMESTAMPTZ
);

CREATE TABLE fsm_transitions (
  id           SERIAL PRIMARY KEY,
  candidate_id INT REFERENCES candidates(id),
  from_state   TEXT,
  to_state     TEXT,
  trigger      TEXT,
  metadata     JSONB,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

---

## 4. OpenRouter

**Формат моделей — точка, не дефис:**

| Модель | Slug | Назначение |
|---|---|---|
| Claude Sonnet 4.6 | `openrouter/anthropic/claude-sonnet-4.6` | Основной |
| Claude Opus 4.7 | `openrouter/anthropic/claude-opus-4.7` | Сложные решения |
| Claude Haiku 4.5 | `openrouter/anthropic/claude-haiku-4.5` | Маршрутизация |

```json
{
  "models": {
    "providers": {
      "openrouter": {
        "apiKey": "${OPENROUTER_API_KEY}",
        "params": {
          "provider": {
            "sort": "latency",
            "require_parameters": true,
            "data_collection": "deny",
            "allow_fallbacks": true
          }
        }
      }
    },
    "defaults": {
      "primary": "openrouter/anthropic/claude-sonnet-4.6",
      "fallbackModels": ["openrouter/anthropic/claude-haiku-4.5"]
    }
  }
}
```

**Thinking:** включать на Sonnet для оценки тестов. Haiku — без thinking.

---

## 5. Dev/prod изоляция

**`openclaw --dev` флаг:**
- Состояние в `~/.openclaw-dev`
- Gateway порт **19001** (вместо 18789)
- `agent.skipBootstrap=true` для быстрого старта

**Два TG-бота обязательно:**
```
Prod: @AssistantHubBot      → .env.production
Dev:  @AssistantHubDevBot   → .env.development
```

**Neon database branches** для dev/prod БД.

---

## 6. Память для FSM кандидатов

**Вывод: Neon Postgres, без SQLite.**

| Критерий | SQLite | Neon Postgres |
|---|---|---|
| Доступ из subagents | Нет (file lock) | Да |
| Переезд dev → VPS | Миграция нужна | Уже cloud |
| Уже в стеке | Нет | Да |
| ACID транзакции | Ограниченные | Полные |

**Два слоя памяти:**
- **FSM состояния** → Neon Postgres
- **Семантическая агент-память** (v1.5+) → LanceDB

В v1 LanceDB не нужен.

---

## Recommendations

### Must Do

1. **WSL2 (Ubuntu 22.04)** до первого запуска OpenClaw. Не нативно в PowerShell.
2. **Node.js 24** через nvm в WSL2.
3. **Два TG-токена** — dev и prod. Без этого 409 Conflict при перезапуске.
4. **Neon database branch `dev`** для разработки.
5. **Pooled URL для runtime, direct URL для миграций.**
6. **`openclaw onboard --install-daemon`** после установки.
7. **Формат моделей с точкой:** `openrouter/anthropic/claude-sonnet-4.6`.

### Should Do

8. **FSM audit log** — `fsm_transitions` с каждым переходом, для дебага.
9. **`postgres.js`**, не `pg`. Pool max 10-20.
10. **`openclaw --dev`** для разработки.
11. **`allow_fallbacks: true`** + Haiku как fallback.
12. **`maxSpawnDepth: 2`** в subagents.
13. **Скелет без ИИ первым** — FSM работает с hardcoded ответами до подключения LLM.

### Consider

14. Проверить актуальность OpenClaw версии через `npm info openclaw version`.
15. LanceDB только в v1.5+.
16. `data_collection: "deny"` для совместимости с ПДн (152-ФЗ).

---

## Conflicts / Открытые вопросы

- **OpenRouter ключ отсутствует** — без него нельзя протестировать. Заблокировано.
- **Neon строки подключения отсутствуют** — схема готова, накатить нельзя.
- **TG Bot tokens отсутствуют** — нужно ДВА (dev + prod). От @BotFather или Дмитрия.
- **WSL2 у Ильи установлен?** — первый вопрос перед boot OpenClaw.

---

## Sources

- [OpenClaw Windows docs](https://docs.openclaw.ai/platforms/windows)
- [OpenClaw Installer internals](https://docs.openclaw.ai/install/installer)
- [Issue #19921 PATH mismatch](https://github.com/openclaw/openclaw/issues/19921)
- [OpenClaw Telegram channel docs](https://docs.openclaw.ai/channels/telegram)
- [OpenClaw debugging](https://docs.openclaw.ai/help/debugging)
- [OpenRouter OpenClaw integration](https://openrouter.ai/docs/guides/coding-agents/openclaw-integration)
- [OpenRouter Claude Sonnet 4.6](https://openrouter.ai/anthropic/claude-sonnet-4.6)
- [OpenClaw OpenRouter provider](https://docs.openclaw.ai/providers/openrouter)
- [Neon connection pooling](https://neon.com/docs/connect/connection-pooling)
- [Neon connection methods](https://neon.com/docs/connect/choose-connection)
- [postgres.js vs pg vs neon-serverless](https://www.pkgpulse.com/guides/pg-vs-postgres-js-vs-neon-serverless-postgresql-drivers-2026)
- [WSL2 OpenClaw daemon setup](https://docs.bswen.com/blog/2026-03-25-openclaw-wsl2-daemon-setup/)
- [Issue #65679 Dual-Brain Memory](https://github.com/openclaw/openclaw/issues/65679)
