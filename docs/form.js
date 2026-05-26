// form.js — форма ответа кандидата
// Подключается в каждой задаче: <script src="form.js"></script> + <script>initAnswerForm(N);</script>

// ---------- Данные ----------

const TASK_NAMES = {
  '01': 'Саммари статей',
  '02': 'Подбор примеров для few-shot',
  '03': 'Системный промпт',
  '04': 'Отладка JSON-экстрактора',
  '05': 'Контекст-пак под Анну',
  '06': 'Помощник без выдумок',
  '07': 'Уточняющие вопросы',
  '08': 'Промпт-мастер по формуле RICECO',
  '09': 'Сборка воркфлоу. Финал.'
};

const FINAL_PLACEHOLDERS = {
  '01': `Текст промпта (тот, что в итоге используешь):


Формат вывода (TL;DR / тезисы / выводы — опиши или скопируй из правил):


Стоп-лист (что модель НЕ должна делать):


Переменная для статьи (по умолчанию {{input}}):`,

  '02': `Какие 5 пар выбрал (номера через запятую):

Финальный промпт с 5 примерами (правила тона + 5 пар «Черновик → Письмо» + {{input}}):`,

  '03': `Финальный системный промпт (вставь целиком):`,

  '04': `Починенный промпт целиком (один блок, готовый к копированию):`,

  '05': `Готовый контекст-пак (один текстовый блок, подставляется перед каждым {{input}}):


Что включил из материалов (2-4 пункта кратко):


Что выкинул (1-2 пункта):`,

  '06': `Починенный промпт (принимает {{input}} — вопрос пользователя):`,

  '07': `Финальный промпт (задаёт 3-5 уточняющих вопросов перед выполнением):`,

  '08': `Мета-промпт целиком (принимает {{input}} — описание задачи на естественном языке):


Что в нём про каждый элемент RICECO (по одной строке):
- Role:
- Instruction:
- Context:
- Examples:
- Constraints:
- Output:`,

  '09': `Часть А. Архитектура четырёх шагов:

Шаг 1 — классификатор. Вход: ... Выход: ...
Шаг 2 — экстрактор полей. Вход: ... Выход: ...
Шаг 3 — подкладка профиля Анны. Вход: ... Выход: ...
Шаг 4 — переписчик в тон Анны. Вход: ... Выход: ...

Часть Б. Финальный исполняемый промпт (принимает {{input}}, проходит все 4 шага):`
};

const LOG_PLACEHOLDER = `## Версия 1

Что было (промпт или краткое описание):

Что не работало (на каких примерах сломалось, как именно):

Что меняю для версии 2:


## Версия 2

Что было:

Что не работало:

Что меняю для версии 3:


## Версия 3 (финальная)

Что было:

Что получилось (на каких примерах всё прошло):


## Главный инсайт от задачи (1-2 предложения):`;

const LOG_PLACEHOLDER_09 = `## Слабое звено 1

Какой шаг цепочки сломался и как именно:

Причина (механика, не симптом):

Что поменял:

Замер до / после:


## Слабое звено 2 (если было):


## Главный инсайт от задачи:`;

// ---------- Утилиты ----------

function transliterate(name) {
  const map = {
    'а':'a','б':'b','в':'v','г':'g','д':'d','е':'e','ё':'yo','ж':'zh','з':'z',
    'и':'i','й':'y','к':'k','л':'l','м':'m','н':'n','о':'o','п':'p','р':'r',
    'с':'s','т':'t','у':'u','ф':'f','х':'kh','ц':'ts','ч':'ch','ш':'sh',
    'щ':'shch','ъ':'','ы':'y','ь':'','э':'e','ю':'yu','я':'ya',' ':'-'
  };
  return name.toLowerCase()
    .split('').map(c => map[c] !== undefined ? map[c] : c).join('')
    .replace(/[^a-z0-9-]/g, '').replace(/-+/g, '-').replace(/^-|-$/g, '');
}

function generateMd(nn, name, final, log) {
  const today = new Date().toLocaleDateString('ru-RU');
  return `# Задача ${nn}. ${TASK_NAMES[nn]}

Имя: ${name}
Дата сдачи: ${today}
Время потрачено (примерно): ___


### ФИНАЛ

${final || '___'}


### ЛОГ

${log || '___'}


---

Готово. Файл назван task-${nn}-${transliterate(name)}.md.
`;
}

function downloadFile(filename, content) {
  const blob = new Blob(['﻿' + content], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ---------- Стили формы ----------

function injectFormStyles() {
  if (document.getElementById('form-styles')) return;
  const s = document.createElement('style');
  s.id = 'form-styles';
  s.textContent = `
    .answer-form {
      background: #f7f6f2; border: 1px solid #e0ddd6;
      border-radius: 8px; padding: 28px 32px; margin: 36px 0;
    }
    .answer-form h2 { margin: 0 0 20px; font-size: 20px; color: #1a1a1a; }
    .name-row { display: flex; align-items: center; gap: 12px; margin-bottom: 20px; flex-wrap: wrap; }
    .name-row label { font-weight: 600; font-size: 14px; white-space: nowrap; }
    .name-input {
      flex: 1; min-width: 200px; padding: 9px 13px;
      border: 1px solid #c8c4bc; border-radius: 5px;
      font-size: 15px; font-family: inherit; background: #fff;
    }
    .name-input:focus { outline: none; border-color: #4a8a5a; box-shadow: 0 0 0 3px rgba(74,138,90,0.12); }
    .form-section { margin-top: 18px; }
    .form-label {
      font-weight: 600; font-size: 13px; text-transform: uppercase;
      letter-spacing: 0.5px; color: #555; margin-bottom: 6px;
    }
    .answer-textarea {
      width: 100%; padding: 11px 14px;
      border: 1px solid #c8c4bc; border-radius: 5px;
      font-size: 14px; line-height: 1.65; font-family: inherit;
      resize: vertical; background: #fff; min-height: 160px;
      transition: border-color 0.15s;
    }
    .answer-textarea:focus { outline: none; border-color: #4a8a5a; box-shadow: 0 0 0 3px rgba(74,138,90,0.12); }
    .form-actions { display: flex; align-items: center; gap: 16px; margin-top: 18px; flex-wrap: wrap; }
    .save-btn {
      background: #4a8a5a; color: #fff; border: none;
      padding: 13px 26px; border-radius: 6px;
      font-size: 15px; font-weight: 600; cursor: pointer;
      transition: background 0.15s;
    }
    .save-btn:hover { background: #3d7a4d; }
    .save-msg { font-size: 14px; }
    .save-msg.ok { color: #4a8a5a; font-weight: 600; }
    .save-msg.err { color: #c0392b; }
    .autosave-hint { font-size: 12px; color: #aaa; margin-top: 8px; }
  `;
  document.head.appendChild(s);
}

// ---------- Инициализация формы ----------

function initAnswerForm(taskNum) {
  injectFormStyles();
  const nn = String(taskNum).padStart(2, '0');
  const key = `task_${nn}`;

  const savedName  = localStorage.getItem('candidate_name') || '';
  const savedFinal = localStorage.getItem(`${key}_final`)   || '';
  const savedLog   = localStorage.getItem(`${key}_log`)     || '';
  const logPh      = nn === '09' ? LOG_PLACEHOLDER_09 : LOG_PLACEHOLDER;

  const html = `
<div class="answer-form" id="answer-form">
  <h2>Твой ответ на эту задачу</h2>
  <div class="name-row">
    <label for="cand-name">Имя и фамилия (по-русски):</label>
    <input class="name-input" type="text" id="cand-name"
      placeholder="Иван Петров" value="${esc(savedName)}"
      autocomplete="name">
  </div>
  <div class="form-section">
    <div class="form-label">ФИНАЛ</div>
    <textarea class="answer-textarea" id="ans-final" rows="14"
      placeholder="${esc(FINAL_PLACEHOLDERS[nn] || '')}">${esc(savedFinal)}</textarea>
  </div>
  <div class="form-section">
    <div class="form-label">ЛОГ</div>
    <textarea class="answer-textarea" id="ans-log" rows="20"
      placeholder="${esc(logPh)}">${esc(savedLog)}</textarea>
  </div>
  <div class="form-actions">
    <button class="save-btn" onclick="saveAndDownload('${nn}')">Сохранить ответ →</button>
    <span class="save-msg" id="save-msg">${savedFinal || savedLog ? 'Черновик восстановлен.' : ''}</span>
  </div>
  <div class="autosave-hint">Текст сохраняется автоматически — не потеряется при закрытии вкладки.</div>
</div>`;

  const footer = document.querySelector('.footer-nav');
  if (footer) footer.insertAdjacentHTML('beforebegin', html);
  else document.body.insertAdjacentHTML('beforeend', html);

  const nameEl  = document.getElementById('cand-name');
  const finalEl = document.getElementById('ans-final');
  const logEl   = document.getElementById('ans-log');

  nameEl.addEventListener('input',  () => localStorage.setItem('candidate_name', nameEl.value));
  finalEl.addEventListener('input', () => { localStorage.setItem(`${key}_final`, finalEl.value); markStarted(nn); });
  logEl.addEventListener('input',   () => { localStorage.setItem(`${key}_log`,   logEl.value);   markStarted(nn); });
}

function markStarted(nn) {
  localStorage.setItem(`task_${nn}_started`, '1');
}

function esc(str) {
  return (str || '').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// ---------- Сохранение и скачивание ----------

function saveAndDownload(nn) {
  const nameEl  = document.getElementById('cand-name');
  const finalEl = document.getElementById('ans-final');
  const logEl   = document.getElementById('ans-log');
  const msgEl   = document.getElementById('save-msg');

  const name  = nameEl.value.trim();
  if (!name) {
    msgEl.className = 'save-msg err';
    msgEl.textContent = 'Введи имя и фамилию — это нужно для имени файла.';
    nameEl.focus();
    return;
  }

  const final  = finalEl.value.trim();
  const log    = logEl.value.trim();
  const slug   = transliterate(name);
  const fname  = `task-${nn}-${slug}.md`;
  const content = generateMd(nn, name, final, log);

  downloadFile(fname, content);

  localStorage.setItem(`task_${nn}_saved`, '1');
  localStorage.setItem('candidate_name', name);

  msgEl.className = 'save-msg ok';
  msgEl.textContent = `Сохранено: ${fname}`;
}
