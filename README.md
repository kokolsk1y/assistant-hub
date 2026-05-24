# Assistant Hub

> Telegram-платформа для координации команды ассистентов EdTech-стартапа.
> Замена ручной работы менеджера: онбординг, распределение задач, ревью, метрики, оплата.

## 🎬 Интерактивная презентация (для созвона с Дмитрием)

**🔗 https://assistant-hub-7k9p2x.vercel.app**

16 слайдов с поэтапным нарративом, диаграммами и темами для обсуждения.
Защищён Vercel Authentication — открывается только владельцу. На созвоне показываем через screen share.

## 📚 Документы

| Файл | Описание |
|------|----------|
| [PROJECT.md](PROJECT.md) | Концепция проекта v0.1 |
| [docs/IMPLEMENTATION_PLAN.md](docs/IMPLEMENTATION_PLAN.md) | План реализации MVP (100-150 часов, 12+ фаз) |
| [docs/IMPROVEMENTS.md](docs/IMPROVEMENTS.md) | 15+ идей улучшений + аудит слабых мест |
| [docs/ARCHITECTURE_AND_QUESTIONS.md](docs/ARCHITECTURE_AND_QUESTIONS.md) | Старая версия диаграмм + вопросов (для разработчиков) |
| [docs/V2_FEATURES.md](docs/V2_FEATURES.md) | Буфер идей для v2 после MVP |
| [ACCESS_REQUESTS.md](ACCESS_REQUESTS.md) | Что нужно получить от Дмитрия (доступы, материалы) |
| [docs/research-stack.md](docs/research-stack.md) | Research: OpenClaw + Neon + OpenRouter setup |
| [docs/research-features.md](docs/research-features.md) | Research: TG-бот UX, FSM, LLM-as-judge |
| [docs/research-architecture.md](docs/research-architecture.md) | Research: multi-brain, Zod-контракты, роли агентов |
| [docs/research-pitfalls.md](docs/research-pitfalls.md) | Research: подводные камни, ФЗ-152, ТК РФ ст.86, фрод |

## 🛠 Стек

- **OpenClaw** — мульти-агентный фреймворк (gateway на ПК)
- **Neon Postgres** — данные, FSM, история, метрики
- **OpenRouter** — Claude Sonnet 4.6 / Haiku 4.5 / Opus 4.7
- **Python aiogram 3** — Telegram-бот
- **Vercel** — хостинг презентации (автодеплой при push)

## 🚀 Команды

```bash
# Локально открыть презентацию
start site/index.html

# Обновить презентацию на Vercel — просто пуш, автодеплой
git add . && git commit -m "..." && git push
```

## 📝 Статус

- ✅ Концепция документирована
- ✅ Research проведён (4 параллельных агента)
- ✅ План реализации составлен (100-150ч)
- ✅ Презентация для созвона готова (16 слайдов)
- ⏳ **Ждём созвона с Дмитрием** для финального согласования
- ⏳ После согласования — старт Фазы 0 (установка WSL2)

## 👥 Команда

- **Коля** — основной разработчик
- **Дмитрий** — партнёр, владелец продукта
- **Коммуникатор** — проводит созвоны с кандидатами (имя уточняется)
- (опционально) Тех-помощник

## 🔒 Приватность

- GitHub репо: **приватный**
- Vercel: **Vercel Authentication** (открывается только владельцу)
- Документы Дмитрия (`dmitry-docs/`) — в .gitignore, только локально
- Любые ключи / токены / реквизиты — никогда в git
