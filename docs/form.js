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

// Структурированные поля формы — один вопрос = одно поле.
// Заполняется по задачам. Сейчас задано для '01' как пилот.
// Если для задачи нет TASK_FIELDS — используется fallback на старую структуру с двумя textarea.
const TASK_FIELDS = {
  '01': {
    final: [
      {
        id: 'prompt',
        label: 'Сама инструкция для ИИ',
        hint: 'Текст промпта, который ты в итоге используешь. Внутри обязательно оставь маркер {{input}} — туда подставится статья на проверке.',
        placeholder: 'Например:\n\nТы — помощник, который из статьи делает короткое саммари по правилам ниже.\n\n[здесь твои правила длины]\n[здесь твои правила структуры]\n[здесь стоп-лист — что НЕ упоминать]\n\nСтатья для обработки: {{input}}',
        rows: 14
      },
      {
        id: 'format',
        label: 'Формат итогового ответа ИИ',
        hint: 'Как должен выглядеть готовый ответ (TL;DR, тезисы, выводы). Можно скопировать из правил материалов и подправить.',
        placeholder: 'TL;DR (≤30 слов): [главная мысль одной фразой]\n\nТезисы:\n1. ...\n2. ...\n3. ...\n\nВыводы:\n1. ...\n2. ...\n3. ...',
        rows: 8
      },
      {
        id: 'stoplist',
        label: 'Стоп-лист — чего НЕ должно быть в саммари',
        hint: 'Перечисли то, что ИИ должен исключить (имена авторов, эмодзи, маркетинговые слова и т.д.).',
        placeholder: '- имена авторов и названия изданий\n- эмодзи\n- маркетинговые слова: революционный, уникальный...\n- свои рекомендации, которых нет в статье',
        rows: 5
      }
    ],
    log: makeStandardLogFields()
  }
};

// Стандартный набор полей лога — 3 версии × 3 вопроса + общий инсайт.
function makeStandardLogFields() {
  const fields = [];
  for (let v = 1; v <= 3; v++) {
    const label = v === 3 ? `Версия ${v} (финальная)` : `Версия ${v}`;
    fields.push({
      id: `v${v}_was`,
      label: `${label}: что было`,
      hint: 'Кратко: какая была инструкция в этой версии (можно своими словами).',
      placeholder: '',
      rows: 3
    });
    fields.push({
      id: `v${v}_observed`,
      label: `${label}: что заметил при прогоне`,
      hint: v === 3
        ? 'На каких примерах всё прошло хорошо — и почему получилось.'
        : 'На каких примерах сломалось и как именно (длина, эмодзи, выдумки, тон).',
      placeholder: '',
      rows: 3
    });
    if (v < 3) {
      fields.push({
        id: `v${v}_change`,
        label: `${label}: что меняю для следующей версии`,
        hint: 'Какая правка и почему (из конкретного наблюдения выше).',
        placeholder: '',
        rows: 3
      });
    }
  }
  fields.push({
    id: 'insight',
    label: 'Главный инсайт от задачи',
    hint: '1–2 предложения. Что понял про работу с ИИ-инструкциями именно здесь?',
    placeholder: '',
    rows: 3
  });
  return fields;
}

// ---------- Старые placeholder-заготовки (fallback для задач без TASK_FIELDS) ----------

const FINAL_PLACEHOLDERS = {
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

function generateMd(nn, name, finalText, logText) {
  const today = new Date().toLocaleDateString('ru-RU');
  return `# Задача ${nn}. ${TASK_NAMES[nn]}

Имя: ${name}
Дата сдачи: ${today}
Время потрачено (примерно): ___


### ФИНАЛ

${finalText || '___'}


### ЛОГ

${logText || '___'}


---

Готово. Файл назван task-${nn}-${transliterate(name)}.md.
`;
}

// Собирает финал/лог из структурированных полей в один блок текста.
function assembleStructured(fields, values) {
  return fields.map(f => {
    const val = (values[f.id] || '').trim();
    if (!val) return `**${f.label}**\n(не заполнено)\n`;
    return `**${f.label}**\n${val}\n`;
  }).join('\n');
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
    .answer-form h2 { margin: 0 0 8px; font-size: 22px; color: #1a1a1a; }
    .answer-form .form-intro { font-size: 14px; color: #666; margin: 0 0 20px; }
    .name-row { display: flex; align-items: center; gap: 12px; margin-bottom: 24px; flex-wrap: wrap; }
    .name-row label { font-weight: 600; font-size: 14px; white-space: nowrap; }
    .name-input {
      flex: 1; min-width: 200px; padding: 9px 13px;
      border: 1px solid #c8c4bc; border-radius: 5px;
      font-size: 15px; font-family: inherit; background: #fff;
    }
    .name-input:focus { outline: none; border-color: #4a8a5a; box-shadow: 0 0 0 3px rgba(74,138,90,0.12); }
    .form-section-title {
      font-weight: 700; font-size: 16px; color: #1a4480;
      margin: 24px 0 4px; padding-top: 16px;
      border-top: 1px dashed #d8d4ca;
    }
    .form-section-title:first-of-type { border-top: none; padding-top: 0; }
    .field-group { margin: 18px 0; }
    .field-label {
      display: block; font-weight: 600; font-size: 15px;
      color: #1a1a1a; margin-bottom: 4px;
    }
    .field-hint {
      display: block; font-size: 13px; color: #666;
      margin-bottom: 8px; line-height: 1.45;
    }
    .answer-textarea {
      width: 100%; padding: 11px 14px;
      border: 1px solid #c8c4bc; border-radius: 5px;
      font-size: 14px; line-height: 1.6; font-family: inherit;
      resize: vertical; background: #fff; min-height: 80px;
      transition: border-color 0.15s;
    }
    .answer-textarea:focus { outline: none; border-color: #4a8a5a; box-shadow: 0 0 0 3px rgba(74,138,90,0.12); }
    .answer-textarea::placeholder { color: #b5b1a8; font-style: italic; }
    .form-actions { display: flex; align-items: center; gap: 16px; margin-top: 28px; flex-wrap: wrap; }
    .save-btn {
      background: #4a8a5a; color: #fff; border: none;
      padding: 14px 28px; border-radius: 6px;
      font-size: 15px; font-weight: 600; cursor: pointer;
      transition: background 0.15s;
    }
    .save-btn:hover { background: #3d7a4d; }
    .save-msg { font-size: 14px; }
    .save-msg.ok { color: #4a8a5a; font-weight: 600; }
    .save-msg.err { color: #c0392b; }
    .autosave-hint { font-size: 12px; color: #aaa; margin-top: 10px; }
  `;
  document.head.appendChild(s);
}

// ---------- Инициализация формы ----------

function initAnswerForm(taskNum) {
  injectFormStyles();
  const nn = String(taskNum).padStart(2, '0');
  const key = `task_${nn}`;
  const savedName = localStorage.getItem('candidate_name') || '';

  const html = TASK_FIELDS[nn]
    ? renderStructuredForm(nn, key, savedName)
    : renderLegacyForm(nn, key, savedName);

  const footer = document.querySelector('.footer-nav');
  if (footer) footer.insertAdjacentHTML('beforebegin', html);
  else document.body.insertAdjacentHTML('beforeend', html);

  bindFormEvents(nn, key);
  markStarted(nn); // открыта = жёлтая на главной
}

function renderStructuredForm(nn, key, savedName) {
  const cfg = TASK_FIELDS[nn];
  const finalFieldsHtml = cfg.final.map(f => renderField(key, 'final', f)).join('');
  const logFieldsHtml = cfg.log.map(f => renderField(key, 'log', f)).join('');

  return `
<div class="answer-form" id="answer-form">
  <h2>Твой ответ на эту задачу</h2>
  <p class="form-intro">Заполни поля ниже — по одному вопросу за раз. Все ответы сохраняются автоматически. Когда закончишь, нажми «Завершить и скачать ответ» внизу.</p>
  <div class="name-row">
    <label for="cand-name">Имя и фамилия (по-русски):</label>
    <input class="name-input" type="text" id="cand-name"
      placeholder="Иван Петров" value="${esc(savedName)}" autocomplete="name">
  </div>

  <div class="form-section-title">ФИНАЛ — твоё итоговое решение</div>
  ${finalFieldsHtml}

  <div class="form-section-title">ЛОГ — как ты пришёл к этому решению</div>
  ${logFieldsHtml}

  <div class="form-actions">
    <button class="save-btn" onclick="saveAndDownloadStructured('${nn}')">Завершить и скачать ответ →</button>
    <span class="save-msg" id="save-msg"></span>
  </div>
  <div class="autosave-hint">Текст сохраняется автоматически — ничего не потеряется при закрытии вкладки.</div>
</div>`;
}

function renderField(key, group, f) {
  const fullId = `${key}_${group}_${f.id}`;
  const saved = localStorage.getItem(fullId) || '';
  return `
<div class="field-group">
  <label class="field-label" for="${fullId}">${esc(f.label)}</label>
  ${f.hint ? `<span class="field-hint">${esc(f.hint)}</span>` : ''}
  <textarea class="answer-textarea" id="${fullId}" rows="${f.rows || 4}"
    data-group="${group}" data-field-id="${f.id}"
    placeholder="${esc(f.placeholder || '')}">${esc(saved)}</textarea>
</div>`;
}

function renderLegacyForm(nn, key, savedName) {
  const savedFinal = localStorage.getItem(`${key}_final`) || '';
  const savedLog   = localStorage.getItem(`${key}_log`)   || '';
  const finalPh = FINAL_PLACEHOLDERS[nn] || '';
  const logPh   = nn === '09' ? LOG_PLACEHOLDER_09 : LOG_PLACEHOLDER;

  return `
<div class="answer-form" id="answer-form">
  <h2>Твой ответ на эту задачу</h2>
  <div class="name-row">
    <label for="cand-name">Имя и фамилия (по-русски):</label>
    <input class="name-input" type="text" id="cand-name"
      placeholder="Иван Петров" value="${esc(savedName)}" autocomplete="name">
  </div>
  <div class="field-group">
    <label class="field-label" for="ans-final">ФИНАЛ</label>
    <textarea class="answer-textarea" id="ans-final" rows="20"
      data-template="${esc(finalPh)}">${esc(savedFinal || finalPh)}</textarea>
  </div>
  <div class="field-group">
    <label class="field-label" for="ans-log">ЛОГ</label>
    <textarea class="answer-textarea" id="ans-log" rows="24"
      data-template="${esc(logPh)}">${esc(savedLog || logPh)}</textarea>
  </div>
  <div class="form-actions">
    <button class="save-btn" onclick="saveAndDownloadLegacy('${nn}')">Завершить и скачать ответ →</button>
    <span class="save-msg" id="save-msg">${savedFinal || savedLog ? 'Черновик восстановлен.' : ''}</span>
  </div>
  <div class="autosave-hint">Текст сохраняется автоматически — ничего не потеряется при закрытии вкладки.</div>
</div>`;
}

function bindFormEvents(nn, key) {
  const nameEl = document.getElementById('cand-name');
  if (nameEl) nameEl.addEventListener('input', () => localStorage.setItem('candidate_name', nameEl.value));

  // Структурированные поля
  document.querySelectorAll('.answer-textarea[data-field-id]').forEach(el => {
    const group = el.getAttribute('data-group');
    const fieldId = el.getAttribute('data-field-id');
    el.addEventListener('input', () => {
      localStorage.setItem(`${key}_${group}_${fieldId}`, el.value);
      markStarted(nn);
    });
  });

  // Legacy fallback поля
  const finalEl = document.getElementById('ans-final');
  const logEl = document.getElementById('ans-log');
  if (finalEl) finalEl.addEventListener('input', () => { localStorage.setItem(`${key}_final`, finalEl.value); markStarted(nn); });
  if (logEl)   logEl.addEventListener('input',   () => { localStorage.setItem(`${key}_log`,   logEl.value);   markStarted(nn); });
}

function markStarted(nn) {
  localStorage.setItem(`task_${nn}_started`, '1');
}

function esc(str) {
  return (str || '').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// ---------- Сохранение и скачивание ----------

function readNameAndValidate() {
  const nameEl = document.getElementById('cand-name');
  const msgEl  = document.getElementById('save-msg');
  const name   = (nameEl.value || '').trim();
  if (!name) {
    msgEl.className = 'save-msg err';
    msgEl.textContent = 'Введи имя и фамилию — это нужно для имени файла.';
    nameEl.focus();
    return null;
  }
  return { name, msgEl };
}

function saveAndDownloadStructured(nn) {
  const v = readNameAndValidate();
  if (!v) return;
  const cfg = TASK_FIELDS[nn];
  const key = `task_${nn}`;

  const finalValues = {};
  cfg.final.forEach(f => { finalValues[f.id] = localStorage.getItem(`${key}_final_${f.id}`) || ''; });
  const logValues = {};
  cfg.log.forEach(f => { logValues[f.id] = localStorage.getItem(`${key}_log_${f.id}`) || ''; });

  const finalText = assembleStructured(cfg.final, finalValues);
  const logText   = assembleStructured(cfg.log,   logValues);

  const slug  = transliterate(v.name);
  const fname = `task-${nn}-${slug}.md`;
  const content = generateMd(nn, v.name, finalText, logText);

  downloadFile(fname, content);
  localStorage.setItem(`task_${nn}_saved`, '1');
  localStorage.setItem('candidate_name', v.name);

  v.msgEl.className = 'save-msg ok';
  v.msgEl.textContent = `Сохранено: ${fname}`;
}

function saveAndDownloadLegacy(nn) {
  const v = readNameAndValidate();
  if (!v) return;
  const finalEl = document.getElementById('ans-final');
  const logEl   = document.getElementById('ans-log');
  const finalText = (finalEl.value || '').trim();
  const logText   = (logEl.value || '').trim();
  const slug  = transliterate(v.name);
  const fname = `task-${nn}-${slug}.md`;
  const content = generateMd(nn, v.name, finalText, logText);

  downloadFile(fname, content);
  localStorage.setItem(`task_${nn}_saved`, '1');
  localStorage.setItem('candidate_name', v.name);

  v.msgEl.className = 'save-msg ok';
  v.msgEl.textContent = `Сохранено: ${fname}`;
}

// Алиас на случай если в task-* HTML вызывается старое имя.
function saveAndDownload(nn) {
  if (TASK_FIELDS[nn]) saveAndDownloadStructured(nn);
  else saveAndDownloadLegacy(nn);
}
