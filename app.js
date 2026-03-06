const DAYS = ['Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота', 'Воскресенье'];
const SPACES = {
  management: 'Управление',
  notes: 'Заметки'
};

const STORAGE_KEY = 'calendar-board-state-v2';
const LEGACY_STORAGE_KEY = 'calendar-board-state-v1';

const SUPABASE_URL = 'https://mexvcooxruzxrntvhzmc.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_tdIF-2iq8Dx-V5VJx_ATpg_LoeNqQAx';
const supabaseClient = window.supabase
  ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
  : null;

async function loadTelegramTasks() {
  const list = document.getElementById('telegramTasksList');
  if (!list) return;

  if (!supabaseClient) {
    list.innerHTML = '<li>Supabase SDK не загружен.</li>';
    return;
  }

  list.innerHTML = '<li>Загрузка задач...</li>';

  const { data, error } = await supabaseClient
    .from('tasks')
    .select('id, text, is_completed, created_at')
    .order('created_at', { ascending: false });

  if (error) {
    list.innerHTML = `<li>Ошибка загрузки: ${error.message}</li>`;
    return;
  }

  if (!data || data.length === 0) {
    list.innerHTML = '<li>Пока нет задач из Telegram.</li>';
    return;
  }

  list.innerHTML = data.map((task) => {
    const status = task.is_completed ? '✅' : '⬜️';
    return `<li data-task-id="${task.id}">${status} ${task.text}</li>`;
  }).join('');
}


function createSpaceState() {
  return {
    days: Object.fromEntries(DAYS.map((d) => [d, []])),
    dayBackgrounds: Object.fromEntries(DAYS.map((d) => [d, null])),
    dayNotes: Object.fromEntries(DAYS.map((d) => [d, ''])),
    boards: {},
    dockTasks: [],
    taskGroups: [],
    sideNotes: []
  };
}

const defaultState = () => ({
  theme: 'light',
  activeSpace: 'management',
  nextTaskId: 1,
  nextCloudId: 1,
  nextGroupId: 1,
  nextTaskGroupId: 1,
  nextSideNoteId: 1,
  sideNotes: [],
  spaceNames: { ...SPACES },
  spaces: {
    management: createSpaceState(),
    notes: createSpaceState()
  }
});

let state = loadState();
let history = [{ description: 'Старт', snapshot: structuredClone(state), ts: new Date().toISOString() }];
let currentHistoryIndex = 0;
let previewIndex = null;
let currentBoardTaskId = null;
let dragTask = null;
let dragCloud = null;
let dragCloudNote = null;
let dragBackgroundTask = null;
let dragSideNote = null;
let selectedCloudIds = new Set();
let selectedTaskKeys = new Set();
let isHistoryOpen = false;
let isInstructionsOpen = false;
let isSpaceMenuOpen = false;
let isSpaceActionMenuOpen = false;
let spaceActionTargetKey = null;
let selectedSpaceKeys = new Set();
let isTaskContextMenuOpen = false;
let isDockMenuOpen = false;
let isNotesPanelOpen = false;
let taskContextTarget = null;
const LONG_PRESS_MS = 360;
const LONG_PRESS_MOVE_PX = 14;

function attachTouchContextAction(node, onLongPress, shouldStart = () => true) {
  let pressTimer = null;
  let pressPoint = null;
  let longPressTriggered = false;

  const clearPress = () => {
    if (pressTimer) clearTimeout(pressTimer);
    pressTimer = null;
    pressPoint = null;
  };

  node.addEventListener('touchstart', (e) => {
    if (e.touches.length !== 1) return;
    if (!shouldStart(e)) return;
    const touch = e.touches[0];
    longPressTriggered = false;
    pressPoint = { x: touch.clientX, y: touch.clientY };
    pressTimer = setTimeout(() => {
      if (!pressPoint) return;
      longPressTriggered = true;
      onLongPress(pressPoint.x, pressPoint.y, e);
      clearPress();
    }, LONG_PRESS_MS);
  }, { passive: true });

  node.addEventListener('touchmove', (e) => {
    if (!pressTimer || !pressPoint || e.touches.length !== 1) return;
    const touch = e.touches[0];
    const delta = Math.hypot(touch.clientX - pressPoint.x, touch.clientY - pressPoint.y);
    if (delta > LONG_PRESS_MOVE_PX) clearPress();
  }, { passive: true });

  node.addEventListener('touchend', clearPress);
  node.addEventListener('touchcancel', clearPress);

  node.addEventListener('click', (e) => {
    if (!longPressTriggered) return;
    longPressTriggered = false;
    e.preventDefault();
    e.stopPropagation();
  }, true);
}

function loadState() {
  const raw = localStorage.getItem(STORAGE_KEY) ?? localStorage.getItem(LEGACY_STORAGE_KEY);
  if (!raw) return defaultState();
  try {
    const parsed = JSON.parse(raw);
    const base = defaultState();

    if (parsed.spaces) {
      const mergedSpaces = {};
      for (const [key, value] of Object.entries(parsed.spaces)) {
        mergedSpaces[key] = { ...createSpaceState(), ...(value || {}) };
      }
      if (!mergedSpaces.management) mergedSpaces.management = createSpaceState();
      if (!mergedSpaces.notes) mergedSpaces.notes = createSpaceState();

      const mergedSideNotes = Array.isArray(parsed.sideNotes)
        ? parsed.sideNotes
        : Object.values(mergedSpaces).flatMap((space) => Array.isArray(space.sideNotes) ? space.sideNotes : []);

      return {
        ...base,
        ...parsed,
        sideNotes: mergedSideNotes,
        spaceNames: { ...base.spaceNames, ...(parsed.spaceNames || {}) },
        spaces: mergedSpaces
      };
    }

    return {
      ...base,
      ...parsed,
      sideNotes: Array.isArray(parsed.sideNotes) ? parsed.sideNotes : [],
      spaces: {
        management: {
          days: parsed.days || createSpaceState().days,
          dayBackgrounds: parsed.dayBackgrounds || createSpaceState().dayBackgrounds,
          dayNotes: parsed.dayNotes || createSpaceState().dayNotes,
          boards: parsed.boards || {},
          dockTasks: parsed.dockTasks || [],
          taskGroups: parsed.taskGroups || [],
          sideNotes: parsed.sideNotes || []
        },
        notes: createSpaceState()
      }
    };
  } catch {
    return defaultState();
  }
}

function persist() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function getActiveSpace(st = effectiveState()) {
  const key = st.activeSpace in st.spaces ? st.activeSpace : 'management';
  return st.spaces[key] || st.spaces.management;
}

function getGlobalSideNotes(st = effectiveState()) {
  if (!Array.isArray(st.sideNotes)) st.sideNotes = [];
  return st.sideNotes;
}

function getSpaceLabel(key, st = effectiveState()) {
  return st.spaceNames?.[key] || SPACES[key] || key;
}

function getTaskById(taskId, s = state) {
  const space = getActiveSpace(s);
  for (const day of DAYS) {
    const task = space.days[day].find((t) => t.id === taskId);
    if (task) return { task, day };
  }

  const dockTask = space.dockTasks.find((t) => t.id === taskId);
  if (dockTask) return { task: dockTask, day: null };

  return null;
}

function getTaskSelectionKey(day, taskId) {
  return `${day}|${taskId}`;
}

function parseTaskSelectionKey(key) {
  const [day, taskIdRaw] = key.split('|');
  return { day, taskId: Number(taskIdRaw) };
}

function getSelectedTaskRefs() {
  return [...selectedTaskKeys].map(parseTaskSelectionKey).filter((item) => item.day && Number.isFinite(item.taskId));
}

function getTaskContextSelection() {
  const picks = getSelectedTaskRefs();
  if (picks.length > 0) return picks;
  if (!taskContextTarget) return [];
  return [{ day: taskContextTarget.day, taskId: taskContextTarget.taskId }];
}

function clearTaskSelection() {
  selectedTaskKeys = new Set();
}

function clearSpaceSelection() {
  selectedSpaceKeys = new Set();
}

function getSpaceActionSelection() {
  if (selectedSpaceKeys.size > 0) {
    return [...selectedSpaceKeys].filter((key) => key in state.spaces);
  }
  return spaceActionTargetKey && (spaceActionTargetKey in state.spaces) ? [spaceActionTargetKey] : [];
}

function ensureBoard(st, taskId) {
  const space = getActiveSpace(st);
  if (!space.boards[taskId]) {
    space.boards[taskId] = { zoom: 1, clouds: [] };
  }
  return space.boards[taskId];
}

function commit(description, mutator) {
  mutator(state);
  persist();
  if (previewIndex !== null) previewIndex = null;
  history = history.slice(0, currentHistoryIndex + 1);
  history.push({ description, snapshot: structuredClone(state), ts: new Date().toISOString() });
  currentHistoryIndex = history.length - 1;
  renderAll();
}

function effectiveState() {
  return previewIndex === null ? state : history[previewIndex].snapshot;
}

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  const toggle = document.getElementById('themeToggle');
  toggle.textContent = theme === 'dark' ? 'Светлая тема' : 'Тёмная тема';
}

function setHistoryOpen(open) {
  isHistoryOpen = open;
  const panel = document.getElementById('historyPanel');
  const toggle = document.getElementById('toggleHistory');
  panel.classList.toggle('open', open);
  toggle.setAttribute('aria-expanded', String(open));
  toggle.textContent = open ? 'Скрыть историю' : 'История';
}

function setInstructionsOpen(open) {
  isInstructionsOpen = open;
  const panel = document.getElementById('instructionsPanel');
  const toggle = document.getElementById('toggleInstructions');
  if (!panel || !toggle) return;
  panel.classList.toggle('open', open);
  panel.setAttribute('aria-hidden', String(!open));
  toggle.setAttribute('aria-expanded', String(open));
  toggle.textContent = open ? 'Скрыть инструкцию' : 'Инструкция';
}

function setDockMenuOpen(open) {
  isDockMenuOpen = open;
  const dock = document.getElementById('taskDock');
  const toggle = document.getElementById('toggleDockMenu');
  if (dock) dock.classList.toggle('hidden', !open);
  if (toggle) toggle.setAttribute('aria-expanded', String(open));
}

function setNotesPanelOpen(open) {
  isNotesPanelOpen = open;
  const panel = document.getElementById('notesPanel');
  const toggle = document.getElementById('toggleNotesPanel');
  if (!panel || !toggle) return;
  panel.classList.toggle('open', open);
  toggle.setAttribute('aria-expanded', String(open));
}

function setSpaceMenuOpen(open) {
  isSpaceMenuOpen = open;
  const menu = document.getElementById('spaceMenu');
  const toggle = document.getElementById('spaceMenuToggle');
  menu.classList.toggle('hidden', !open);
  toggle.setAttribute('aria-expanded', String(open));
}

function updateSpaceButton(spaceKey, st = effectiveState()) {
  const label = getSpaceLabel(spaceKey, st);
  document.getElementById('spaceMenuToggle').textContent = `Пространство: ${label}`;
  const current = document.getElementById('spaceMenuCurrentLabel');
  if (current) current.textContent = label;
}

function renderSpaceOptions(st = effectiveState()) {
  const list = document.querySelector('#spaceMenu .space-list');
  if (!list) return;
  list.innerHTML = '';
  Object.keys(st.spaces || {}).forEach((key) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'space-option';
    btn.dataset.space = key;
    btn.setAttribute('role', 'menuitem');
    btn.textContent = getSpaceLabel(key, st);
    if (selectedSpaceKeys.has(key)) btn.classList.add('selected');
    list.append(btn);
  });
}

function moveTask(st, fromDay, toDay, taskId, targetTaskId = null, placeAfter = false) {
  const space = getActiveSpace(st);
  const source = space.days[fromDay];
  const destination = space.days[toDay];
  const fromIdx = source.findIndex((t) => t.id === taskId);
  if (fromIdx < 0) return;

  const [task] = source.splice(fromIdx, 1);
  if (targetTaskId === null) {
    destination.push(task);
    return;
  }

  const targetIdx = destination.findIndex((t) => t.id === targetTaskId);
  if (targetIdx < 0) {
    destination.push(task);
    return;
  }

  const insertIdx = placeAfter ? targetIdx + 1 : targetIdx;
  destination.splice(insertIdx, 0, task);
}

function extractTaskTitleFromCloudText(text) {
  const firstLine = (text || '')
    .split('\n')
    .map((line) => line.trim())
    .find(Boolean);
  return firstLine || 'Задача из заметки';
}

function moveCloudToDay(st, boardTaskId, cloudId, toDay, targetTaskId = null, placeAfter = false) {
  const active = getActiveSpace(st);
  const board = ensureBoard(st, boardTaskId);
  const cloudIdx = board.clouds.findIndex((c) => c.id === cloudId);
  if (cloudIdx < 0) return;

  const [cloud] = board.clouds.splice(cloudIdx, 1);
  const taskFromCloud = {
    id: st.nextTaskId++,
    title: extractTaskTitleFromCloudText(cloud.text),
    color: null,
    pinned: false,
    createdAt: Date.now(),
    taskGroupId: null
  };

  const destination = active.days[toDay];
  if (targetTaskId === null) {
    destination.push(taskFromCloud);
    return;
  }

  const targetIdx = destination.findIndex((t) => t.id === targetTaskId);
  if (targetIdx < 0) {
    destination.push(taskFromCloud);
    return;
  }

  const insertIdx = placeAfter ? targetIdx + 1 : targetIdx;
  destination.splice(insertIdx, 0, taskFromCloud);
}

function moveSideNoteToDay(st, noteId, toDay, targetTaskId = null, placeAfter = false) {
  const active = getActiveSpace(st);
  const sideNotes = getGlobalSideNotes(st);
  const noteIdx = sideNotes.findIndex((n) => n.id === noteId);
  if (noteIdx < 0) return;

  const [note] = sideNotes.splice(noteIdx, 1);
  const task = {
    id: st.nextTaskId++,
    title: extractTaskTitleFromCloudText(note.text),
    color: null,
    pinned: false,
    createdAt: Date.now(),
    taskGroupId: null
  };

  const destination = active.days[toDay];
  if (targetTaskId === null) {
    destination.push(task);
    return;
  }

  const targetIdx = destination.findIndex((t) => t.id === targetTaskId);
  if (targetIdx < 0) {
    destination.push(task);
    return;
  }

  const insertIdx = placeAfter ? targetIdx + 1 : targetIdx;
  destination.splice(insertIdx, 0, task);
}

function enableInlineTaskTitleEdit(node, task, day) {
  const titleButton = node.querySelector('.open-board');
  if (!titleButton) return;

  const input = document.createElement('input');
  input.className = 'task-title-input hidden';
  input.type = 'text';
  input.value = task.title;
  input.maxLength = 200;
  titleButton.insertAdjacentElement('afterend', input);

  let editing = false;
  const startEdit = () => {
    editing = true;
    input.value = task.title;
    titleButton.classList.add('hidden');
    input.classList.remove('hidden');
    input.focus();
    input.select();
  };

  const finishEdit = (save) => {
    if (!editing) return;
    editing = false;
    input.classList.add('hidden');
    titleButton.classList.remove('hidden');

    if (!save) return;
    const cleanTitle = input.value.trim();
    if (!cleanTitle || cleanTitle === task.title) return;
    commit(`Задача «${task.title}» изменена`, (st) => {
      const t = getActiveSpace(st).days[day].find((x) => x.id === task.id);
      if (!t) return;
      t.title = cleanTitle;
    });
  };

  node.querySelector('.edit').addEventListener('click', () => startEdit());
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      finishEdit(true);
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      finishEdit(false);
    }
  });
  input.addEventListener('blur', () => finishEdit(true));
}


function buildDayBackgroundPattern(title) {
  const clean = (title || '').trim();
  if (!clean) return '';
  const chunk = `${clean}   ✦   `;
  const row = chunk.repeat(14).trim();
  return Array.from({ length: 28 }, () => row).join('\n');
}

function setTaskContextMenuOpen(open, x = 0, y = 0) {
  isTaskContextMenuOpen = open;
  const menu = document.getElementById('taskContextMenu');
  if (!menu) return;
  if (!open) {
    menu.classList.add('hidden');
    menu.setAttribute('aria-hidden', 'true');
    taskContextTarget = null;
    return;
  }

  const maxX = window.innerWidth - menu.offsetWidth - 10;
  const maxY = window.innerHeight - menu.offsetHeight - 10;
  menu.style.left = `${Math.max(10, Math.min(x, maxX))}px`;
  menu.style.top = `${Math.max(10, Math.min(y, maxY))}px`;
  menu.classList.remove('hidden');
  menu.setAttribute('aria-hidden', 'false');
}

function openTaskContextMenu(x, y, day, task) {
  const key = getTaskSelectionKey(day, task.id);
  if (!selectedTaskKeys.has(key)) {
    selectedTaskKeys = new Set([key]);
  }
  taskContextTarget = { day, taskId: task.id };
  const selection = getTaskContextSelection();
  const pinBtn = document.getElementById('ctxPin');
  const colorInput = document.getElementById('ctxColor');
  const groupBtn = document.getElementById('ctxCreateGroup');
  if (pinBtn) pinBtn.textContent = task.pinned ? 'Открепить' : 'Закрепить';
  if (colorInput) colorInput.value = task.color || '#5a6cff';
  if (groupBtn) groupBtn.classList.toggle('hidden', selection.length < 2);
  setTaskContextMenuOpen(true, x, y);
  renderCalendar();
}

function setSpaceActionMenuOpen(open, x = 0, y = 0) {
  isSpaceActionMenuOpen = open;
  const menu = document.getElementById('spaceActionMenu');
  if (!menu) return;
  if (!open) {
    menu.classList.add('hidden');
    menu.setAttribute('aria-hidden', 'true');
    spaceActionTargetKey = null;
    return;
  }

  const maxX = window.innerWidth - menu.offsetWidth - 10;
  const maxY = window.innerHeight - menu.offsetHeight - 10;
  menu.style.left = `${Math.max(10, Math.min(x, maxX))}px`;
  menu.style.top = `${Math.max(10, Math.min(y, maxY))}px`;
  menu.classList.remove('hidden');
  menu.setAttribute('aria-hidden', 'false');
}

function normalizeImportedSpaceData(raw) {
  const base = createSpaceState();
  if (!raw || typeof raw !== 'object') return base;
  return {
    days: { ...base.days, ...(raw.days || {}) },
    dayBackgrounds: { ...base.dayBackgrounds, ...(raw.dayBackgrounds || {}) },
    dayNotes: { ...base.dayNotes, ...(raw.dayNotes || {}) },
    boards: { ...base.boards, ...(raw.boards || {}) },
    dockTasks: Array.isArray(raw.dockTasks) ? raw.dockTasks : [],
    taskGroups: Array.isArray(raw.taskGroups) ? raw.taskGroups : []
  };
}

function downloadJson(filename, payload) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function buildTaskNode(task, day, handleDayDrop) {
  const tpl = document.getElementById('taskTemplate');
  const node = tpl.content.firstElementChild.cloneNode(true);
  if (task.pinned) node.classList.add('pinned');
  if (selectedTaskKeys.has(getTaskSelectionKey(day, task.id))) node.classList.add('selected');
  node.querySelector('.open-board').textContent = task.title;
  node.querySelector('.open-board').addEventListener('click', (e) => {
    if (e.ctrlKey) return;
    openBoard(task.id);
  });
  enableInlineTaskTitleEdit(node, task, day);

  if (task.color) {
    node.style.setProperty('--task-color', task.color);
  }

  node.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    if (!e.ctrlKey) return;
    if (e.target.closest('input, textarea')) return;
    e.preventDefault();
    const key = getTaskSelectionKey(day, task.id);
    if (selectedTaskKeys.has(key)) {
      selectedTaskKeys.delete(key);
    } else {
      selectedTaskKeys.add(key);
    }
    renderCalendar();
  });

  node.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    const key = getTaskSelectionKey(day, task.id);
    if (!selectedTaskKeys.has(key)) selectedTaskKeys = new Set([key]);
    openTaskContextMenu(e.clientX, e.clientY, day, task);
  });

  attachTouchContextAction(node, (x, y) => {
    const key = getTaskSelectionKey(day, task.id);
    if (!selectedTaskKeys.has(key)) selectedTaskKeys = new Set([key]);
    openTaskContextMenu(x, y, day, task);
  }, (e) => !e.target.closest('input, textarea, .task-color, .to-background, .edit'));

  node.addEventListener('dragstart', (e) => {
    if (e.target.closest('.to-background')) return;
    dragTask = { fromDay: day, taskId: task.id };
  });

  node.addEventListener('dragover', (e) => e.preventDefault());
  node.addEventListener('drop', (e) => {
    e.preventDefault();
    const rect = node.getBoundingClientRect();
    const placeAfter = e.clientY > rect.top + rect.height / 2;
    handleDayDrop(task.id, placeAfter);
  });

  return node;
}

function renderCalendar() {
  const s = effectiveState();
  const grid = document.getElementById('calendarGrid');
  const space = getActiveSpace(s);
  const taskGroups = Array.isArray(space.taskGroups) ? space.taskGroups : [];
  grid.innerHTML = '';

  DAYS.forEach((day) => {
    const cell = document.createElement('div');
    cell.className = 'day-cell';
    cell.dataset.day = day;
    const col = document.createElement('div');
    col.className = 'day-column';
    col.dataset.day = day;
    const dayBackgroundTitle = space.dayBackgrounds?.[day] || null;
    col.innerHTML = `
      <h3 class="day-header">${day}</h3>
      <button class="clear-day-bg ${dayBackgroundTitle ? '' : 'hidden'}" type="button" title="Убрать фон дня">✕ фон</button>
      <div class="day-background-label ${dayBackgroundTitle ? '' : 'hidden'}"></div>
      <form class="add-task">
        <input name="title" placeholder="Новая задача" required />
        <button type="submit">+</button>
      </form>
      <div class="tasks-area">
        <div class="task-groups"></div>
        <ul class="tasks"></ul>
      </div>
    `;

    const bgLabel = col.querySelector('.day-background-label');
    if (bgLabel && dayBackgroundTitle) {
      bgLabel.textContent = buildDayBackgroundPattern(dayBackgroundTitle);
    }

    const notes = document.createElement('textarea');
    notes.className = 'day-notes';
    notes.placeholder = 'Текстовое поле под блоком дня';
    notes.value = space.dayNotes?.[day] || '';
    notes.addEventListener('change', (e) => {
      const nextValue = e.target.value;
      commit(`Обновлён текст под задачами для дня «${day}»`, (st) => {
        getActiveSpace(st).dayNotes[day] = nextValue;
      });
    });

    const handleDayDrop = (targetTaskId = null, placeAfter = false) => {
      if (dragBackgroundTask) {
        const { fromDay, taskId, title } = dragBackgroundTask;
        commit(`Задача «${title}» перенесена на фон дня «${day}»`, (st) => {
          const active = getActiveSpace(st);
          const source = active.days[fromDay];
          const idx = source.findIndex((t) => t.id === taskId);
          if (idx < 0) return;
          const [task] = source.splice(idx, 1);
          active.dayBackgrounds[day] = task.title;
          delete active.boards[task.id];
          if (currentBoardTaskId === task.id) currentBoardTaskId = null;
        });
        dragBackgroundTask = null;
        return true;
      }

      if (dragCloudNote) {
        const { boardTaskId, cloudId } = dragCloudNote;
        commit(`Заметка преобразована в задачу дня «${day}»`, (st) => {
          moveCloudToDay(st, boardTaskId, cloudId, day, targetTaskId, placeAfter);
        });
        dragCloudNote = null;
        return true;
      }

      if (dragSideNote) {
        const { noteId } = dragSideNote;
        commit(`Заметка бокового меню перенесена в день «${day}»`, (st) => {
          moveSideNoteToDay(st, noteId, day, targetTaskId, placeAfter);
        });
        dragSideNote = null;
        return true;
      }

      if (!dragTask) return false;
      const { fromDay, taskId } = dragTask;
      if (targetTaskId === null) {
        commit(`Задача перемещена в «${day}»`, (st) => moveTask(st, fromDay, day, taskId));
      } else {
        commit('Изменён порядок задач', (st) => {
          moveTask(st, fromDay, day, taskId, targetTaskId, placeAfter);
        });
      }
      dragTask = null;
      return true;
    };

    const form = col.querySelector('form');
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const input = form.title;
      const title = input.value.trim();
      if (!title) return;
      commit(`Добавлена задача «${title}»`, (st) => {
        getActiveSpace(st).days[day].push({ id: st.nextTaskId++, title, color: null, pinned: false, createdAt: Date.now(), taskGroupId: null });
      });
    });

    const clearBg = col.querySelector('.clear-day-bg');
    clearBg.addEventListener('click', () => {
      commit(`Очищен фон дня «${day}»`, (st) => {
        getActiveSpace(st).dayBackgrounds[day] = null;
      });
    });

    const list = col.querySelector('.tasks');
    const groupsWrap = col.querySelector('.task-groups');
    col.addEventListener('dragover', (e) => {
      if (dragTask || dragCloudNote || dragBackgroundTask || dragSideNote) e.preventDefault();
    });
    col.addEventListener('drop', (e) => {
      e.preventDefault();
      handleDayDrop();
    });

    list.addEventListener('dragover', (e) => e.preventDefault());
    list.addEventListener('drop', (e) => {
      e.preventDefault();
      handleDayDrop();
    });

    const dayTasks = space.days[day];
    const groupedTaskIds = new Set(taskGroups.flatMap((group) => group.taskIds || []));
    const groupsForDay = taskGroups.filter((group) => (group.taskIds || []).some((id) => dayTasks.some((task) => task.id === id)));

    groupsForDay.forEach((group) => {
      const groupTasks = dayTasks.filter((task) => (group.taskIds || []).includes(task.id));
      if (groupTasks.length === 0) return;
      const groupEl = document.createElement('section');
      groupEl.className = 'task-group-column';
      const groupColor = group.color || '#8ea1ff';
      groupEl.style.setProperty('--group-color', groupColor);
      groupEl.innerHTML = `
        <div class="task-group-header">
          <h4>${group.name || 'Группа'}</h4>
          <div class="task-group-controls">
            <input class="group-color-input" type="color" value="${groupColor}" title="Цвет группы" />
            <button class="group-rename" type="button" title="Изменить название группы">✎</button>
          </div>
        </div>
        <ul class="tasks"></ul>
      `;
      const groupList = groupEl.querySelector('.tasks');
      groupTasks.forEach((task) => groupList.append(buildTaskNode(task, day, handleDayDrop)));

      const colorInput = groupEl.querySelector('.group-color-input');
      colorInput.addEventListener('change', (e) => {
        const nextColor = e.target.value;
        commit('Изменён цвет группы задач', (st) => {
          const active = getActiveSpace(st);
          const targetGroup = (active.taskGroups || []).find((item) => item.id === group.id);
          if (targetGroup) targetGroup.color = nextColor;
        });
      });

      const renameBtn = groupEl.querySelector('.group-rename');
      renameBtn.addEventListener('click', () => {
        const nextName = prompt('Название группы', group.name || '');
        if (nextName === null) return;
        const cleanName = nextName.trim();
        if (!cleanName) return;
        commit('Изменено название группы задач', (st) => {
          const active = getActiveSpace(st);
          const targetGroup = (active.taskGroups || []).find((item) => item.id === group.id);
          if (targetGroup) targetGroup.name = cleanName;
        });
      });

      groupsWrap.append(groupEl);
    });

    dayTasks
      .filter((task) => !groupedTaskIds.has(task.id))
      .forEach((task) => {
        list.append(buildTaskNode(task, day, handleDayDrop));
      });

    cell.append(col, notes);
    grid.append(cell);
  });

  renderSpaceOptions(s);
  updateSpaceButton(s.activeSpace, s);
  applyTheme(s.theme);
}

function renderTaskDock(s) {
  const space = getActiveSpace(s);
  const list = document.getElementById('taskDockList');
  const toggle = document.getElementById('toggleDockMenu');
  if (!list || !toggle) return;
  list.innerHTML = '';
  toggle.textContent = `Задачи поля доски (${space.dockTasks.length})`;

  if (space.dockTasks.length === 0) {
    const empty = document.createElement('li');
    empty.className = 'task-dock-empty';
    empty.textContent = 'Пока нет задач. Добавьте задачу и откройте меню.';
    list.append(empty);
    return;
  }

  space.dockTasks.forEach((task) => {
    const tpl = document.getElementById('taskTemplate');
    const node = tpl.content.firstElementChild.cloneNode(true);
    if (task.pinned) node.classList.add('pinned');
    node.querySelector('.open-board').textContent = task.title;
    node.querySelector('.open-board').addEventListener('click', () => openBoard(task.id));

    const tagWrap = node.querySelector('.task-tags');
    const tags = task.tags || [];
    tagWrap.innerHTML = tags.map((tag) => `<span class="tag">#${tag}</span>`).join('');

    node.querySelector('.edit').addEventListener('click', () => {
      const newTitle = prompt('Название задачи', task.title);
      if (newTitle === null) return;
      const cleanTitle = newTitle.trim();
      if (!cleanTitle) return;
      const tagInput = prompt('Теги через запятую', (task.tags || []).join(', '));
      if (tagInput === null) return;
      const nextTags = [...new Set(tagInput.split(',').map((x) => x.trim()).filter(Boolean))];
      commit(`Задача «${task.title}» изменена`, (st) => {
        const t = getActiveSpace(st).dockTasks.find((x) => x.id === task.id);
        if (!t) return;
        t.title = cleanTitle;
        t.tags = nextTags;
      });
    });

    node.querySelector('.delete').addEventListener('click', () => {
      commit(`Удалена задача «${task.title}»`, (st) => {
        const active = getActiveSpace(st);
        active.dockTasks = active.dockTasks.filter((t) => t.id !== task.id);
        delete active.boards[task.id];
      });
    });

    node.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      commit('Изменён статус закрепления', (st) => {
        const t = getActiveSpace(st).dockTasks.find((x) => x.id === task.id);
        if (t) t.pinned = !t.pinned;
      });
    });

    attachTouchContextAction(node, () => {
      commit('Изменён статус закрепления', (st) => {
        const t = getActiveSpace(st).dockTasks.find((x) => x.id === task.id);
        if (t) t.pinned = !t.pinned;
      });
    }, (e) => !e.target.closest('textarea, input, button.edit, button.delete'));

    node.addEventListener('dragstart', () => {
      dragTask = { fromDay: null, taskId: task.id, fromDock: true };
    });

    node.addEventListener('dragover', (e) => e.preventDefault());
    node.addEventListener('drop', (e) => {
      e.preventDefault();
      if (!dragTask || !dragTask.fromDock) return;
      const rect = node.getBoundingClientRect();
      const placeAfter = e.clientY > rect.top + rect.height / 2;
      const { taskId } = dragTask;
      commit('Изменён порядок задач в поле доски', (st) => {
        moveDockTask(st, taskId, task.id, placeAfter);
      });
      dragTask = null;
    });

    list.append(node);
  });
}

function renderHistory() {
  const list = document.getElementById('historyList');
  list.innerHTML = '';

  history.forEach((entry, i) => {
    const li = document.createElement('li');
    if (i === currentHistoryIndex && previewIndex === null) li.classList.add('active');
    if (i === previewIndex) li.classList.add('active');
    li.innerHTML = `<strong>${entry.description}</strong><br/><small>${new Date(entry.ts).toLocaleString('ru-RU')}</small>`;

    const actions = document.createElement('div');
    const previewBtn = document.createElement('button');
    previewBtn.textContent = 'Просмотр';
    previewBtn.type = 'button';
    previewBtn.onclick = () => {
      previewIndex = i;
      renderAll();
    };

    const rollbackBtn = document.createElement('button');
    rollbackBtn.textContent = 'Откат';
    rollbackBtn.type = 'button';
    rollbackBtn.onclick = () => {
      state = structuredClone(history[i].snapshot);
      history = history.slice(0, i + 1);
      currentHistoryIndex = i;
      previewIndex = null;
      persist();
      renderAll();
    };

    actions.append(previewBtn, rollbackBtn);
    li.append(actions);
    list.append(li);
  });

  const banner = document.getElementById('previewBanner');
  const exit = document.getElementById('exitPreview');
  if (previewIndex !== null) {
    banner.classList.remove('hidden');
    banner.textContent = `Режим просмотра: ${history[previewIndex].description}`;
    exit.classList.remove('hidden');
  } else {
    banner.classList.add('hidden');
    exit.classList.add('hidden');
  }
}

function openBoard(taskId) {
  currentBoardTaskId = taskId;
  selectedCloudIds = new Set();
  renderBoard();
}

function renderBoard() {
  const boardTitle = document.getElementById('boardTitle');
  const canvas = document.getElementById('boardCanvas');
  const zoomValue = document.getElementById('zoomValue');
  if (!boardTitle || !canvas || !zoomValue) return;

  const taskInfo = currentBoardTaskId ? getTaskById(currentBoardTaskId, effectiveState()) : null;
  if (!taskInfo) {
    currentBoardTaskId = null;
    canvas.innerHTML = '<div class="board-placeholder">Выберите задачу в календаре, чтобы открыть её доску.</div>';
    canvas.style.transform = 'scale(1)';
    zoomValue.textContent = '100%';
    boardTitle.textContent = 'Поле доски';
    return;
  }

  boardTitle.textContent = `Доска: ${taskInfo.task.title}`;

  const activeTaskId = taskInfo.task.id;
  const board = ensureBoard(state, activeTaskId);
  canvas.innerHTML = '';
  canvas.style.transform = `scale(${board.zoom})`;
  zoomValue.textContent = `${Math.round(board.zoom * 100)}%`;

  board.clouds.forEach((cloud) => {
    const el = document.createElement('div');
    el.className = 'cloud';
    if (cloud.groupId) el.classList.add('grouped');
    if (selectedCloudIds.has(cloud.id)) el.classList.add('selected');
    el.dataset.id = cloud.id;
    el.style.left = `${cloud.x}px`;
    el.style.top = `${cloud.y}px`;
    el.innerHTML = `
      <div class="cloud-header">
        <button class="cloud-transfer" type="button" draggable="true" title="Перетащите в календарный день">⇢ В день</button>
      </div>
      <textarea>${cloud.text || ''}</textarea>
    `;

    el.querySelector('textarea').addEventListener('change', (e) => {
      commit('Изменён текст заметки', (st) => {
        const b = ensureBoard(st, activeTaskId);
        const c = b.clouds.find((x) => x.id === cloud.id);
        if (c) c.text = e.target.value;
      });
    });

    const transfer = el.querySelector('.cloud-transfer');
    transfer.addEventListener('dragstart', (e) => {
      dragCloudNote = { boardTaskId: activeTaskId, cloudId: cloud.id };
      if (e.dataTransfer) {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', cloud.text || '');
      }
    });

    transfer.addEventListener('dragend', () => {
      dragCloudNote = null;
    });

    el.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      if (e.ctrlKey && !e.target.matches('textarea')) {
        if (selectedCloudIds.has(cloud.id)) {
          selectedCloudIds.delete(cloud.id);
        } else {
          selectedCloudIds.add(cloud.id);
        }
        renderBoard();
        return;
      }

      if (e.target.matches('textarea, .cloud-transfer')) return;
      dragCloud = { id: cloud.id, startX: e.clientX, startY: e.clientY };
    });

    canvas.append(el);
  });
}

document.addEventListener('mousemove', (e) => {
  if (!dragCloud || !currentBoardTaskId) return;
  const board = ensureBoard(state, currentBoardTaskId);
  const c = board.clouds.find((x) => x.id === dragCloud.id);
  if (!c) return;

  const dx = (e.clientX - dragCloud.startX) / board.zoom;
  const dy = (e.clientY - dragCloud.startY) / board.zoom;
  dragCloud.startX = e.clientX;
  dragCloud.startY = e.clientY;

  const groupId = c.groupId;
  const targets = groupId ? board.clouds.filter((x) => x.groupId === groupId) : [c];
  targets.forEach((item) => {
    item.x += dx;
    item.y += dy;
  });

  persist();
  renderBoard();
});

document.addEventListener('mouseup', () => {
  if (dragCloud) {
    history.push({ description: 'Перемещение заметки/группы', snapshot: structuredClone(state), ts: new Date().toISOString() });
    currentHistoryIndex = history.length - 1;
    renderHistory();
  }
  dragCloud = null;
});

function renderSideNotes(st = effectiveState()) {
  const list = document.getElementById('sideNotesList');
  if (!list) return;
  const sideNotes = getGlobalSideNotes(st);
  list.innerHTML = '';

  if (sideNotes.length === 0) {
    const empty = document.createElement('li');
    empty.className = 'side-note-empty';
    empty.textContent = 'Пока нет заметок. Добавьте заметку и перетащите её в день.';
    list.append(empty);
    return;
  }

  sideNotes.forEach((note) => {
    const li = document.createElement('li');
    li.className = 'side-note-item';
    li.innerHTML = `
      <textarea>${note.text || ''}</textarea>
      <div class="side-note-actions">
        <button type="button" class="side-note-drag" draggable="true">Перенести в день</button>
        <button type="button" class="side-note-delete">Удалить</button>
      </div>
    `;

    const area = li.querySelector('textarea');
    area.addEventListener('change', (e) => {
      commit('Изменён текст заметки бокового меню', (stateDraft) => {
        const target = getGlobalSideNotes(stateDraft).find((x) => x.id === note.id);
        if (target) target.text = e.target.value;
      });
    });

    const dragBtn = li.querySelector('.side-note-drag');
    dragBtn.addEventListener('dragstart', (e) => {
      dragSideNote = { noteId: note.id };
      if (e.dataTransfer) {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', note.text || '');
      }
    });
    dragBtn.addEventListener('dragend', () => {
      dragSideNote = null;
    });

    li.querySelector('.side-note-delete').addEventListener('click', () => {
      commit('Удалена заметка бокового меню', (stateDraft) => {
        stateDraft.sideNotes = getGlobalSideNotes(stateDraft).filter((x) => x.id !== note.id);
      });
    });

    list.append(li);
  });
}

function renderAll() {
  renderCalendar();
  renderHistory();
  renderBoard();
  renderSideNotes();
}

document.getElementById('spaceMenuToggle').addEventListener('click', () => {
  setSpaceMenuOpen(!isSpaceMenuOpen);
});


function createSpaceKey(name, st = state) {
  const base = name
    .toLowerCase()
    .replace(/[^a-zа-я0-9]+/gi, '-')
    .replace(/^-+|-+$/g, '') || 'space';
  let key = base;
  let index = 2;
  while (key in st.spaces) {
    key = `${base}-${index++}`;
  }
  return key;
}

function switchSpace(nextSpace) {
  if (!(nextSpace in state.spaces)) return;
  commit(`Переключено пространство на «${getSpaceLabel(nextSpace, state)}»`, (st) => {
    st.activeSpace = nextSpace;
  });
  setSpaceMenuOpen(false);
  clearSpaceSelection();
  setSpaceActionMenuOpen(false);
  clearTaskSelection();
  currentBoardTaskId = null;
}

const addSpaceForm = document.getElementById('addSpaceForm');
if (addSpaceForm) {
  addSpaceForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const name = addSpaceForm.spaceName.value.trim();
    if (!name) return;
    const key = createSpaceKey(name);
    commit(`Добавлено пространство «${name}»`, (st) => {
      st.spaces[key] = createSpaceState();
      if (!st.spaceNames) st.spaceNames = { ...SPACES };
      st.spaceNames[key] = name;
      st.activeSpace = key;
    });
    addSpaceForm.reset();
    setSpaceMenuOpen(true);
    currentBoardTaskId = null;
  });
}

const spaceMenuElement = document.getElementById('spaceMenu');
if (spaceMenuElement) {
  spaceMenuElement.addEventListener('click', (e) => {
    const btn = e.target.closest('.space-option');
    if (!btn) return;
    const key = btn.dataset.space;
    if (!(key in state.spaces)) return;

    if (e.ctrlKey) {
      if (selectedSpaceKeys.has(key)) selectedSpaceKeys.delete(key);
      else selectedSpaceKeys.add(key);
      renderSpaceOptions();
      return;
    }

    selectedSpaceKeys = new Set([key]);
    switchSpace(key);
  });

  spaceMenuElement.addEventListener('contextmenu', (e) => {
    const btn = e.target.closest('.space-option');
    if (!btn) return;
    e.preventDefault();
    const key = btn.dataset.space;
    if (!(key in state.spaces)) return;
    if (!selectedSpaceKeys.has(key)) selectedSpaceKeys = new Set([key]);
    spaceActionTargetKey = key;
    renderSpaceOptions();
    setSpaceActionMenuOpen(true, e.clientX, e.clientY);
  });

  attachTouchContextAction(spaceMenuElement, (x, y, event) => {
    const btn = event.target.closest('.space-option');
    if (!btn) return;
    const key = btn.dataset.space;
    if (!(key in state.spaces)) return;
    if (!selectedSpaceKeys.has(key)) selectedSpaceKeys = new Set([key]);
    spaceActionTargetKey = key;
    renderSpaceOptions();
    setSpaceActionMenuOpen(true, x, y);
  }, (e) => Boolean(e.target.closest('.space-option')));
}

document.addEventListener('click', (e) => {
  if (!e.target.closest('.space-menu-wrap')) {
    setSpaceMenuOpen(false);
    if (selectedSpaceKeys.size > 0) {
      clearSpaceSelection();
      renderSpaceOptions();
    }
  }
  if (isNotesPanelOpen && !e.target.closest('#notesPanel') && !e.target.closest('#toggleNotesPanel')) setNotesPanelOpen(false);
  if (isSpaceActionMenuOpen && !e.target.closest('#spaceActionMenu') && !e.target.closest('.space-option')) setSpaceActionMenuOpen(false);
  if (isTaskContextMenuOpen && !e.target.closest('#taskContextMenu') && !e.target.closest('.task')) setTaskContextMenuOpen(false);
  if (!e.target.closest('.task') && !e.ctrlKey && selectedTaskKeys.size > 0) {
    clearTaskSelection();
    renderCalendar();
  }
});

document.getElementById('themeToggle').addEventListener('click', () => {
  commit('Смена темы', (st) => {
    st.theme = st.theme === 'dark' ? 'light' : 'dark';
  });
});

document.getElementById('toggleNotesPanel').addEventListener('click', () => {
  setNotesPanelOpen(!isNotesPanelOpen);
  if (isNotesPanelOpen) setHistoryOpen(false);
});

document.getElementById('toggleHistory').addEventListener('click', () => {
  setHistoryOpen(!isHistoryOpen);
  if (isHistoryOpen) setInstructionsOpen(false);
});

document.getElementById('toggleInstructions').addEventListener('click', () => {
  setInstructionsOpen(!isInstructionsOpen);
  if (isInstructionsOpen) setHistoryOpen(false);
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (isHistoryOpen) setHistoryOpen(false);
    if (isInstructionsOpen) setInstructionsOpen(false);
    if (isSpaceMenuOpen) setSpaceMenuOpen(false);
    if (isSpaceActionMenuOpen) setSpaceActionMenuOpen(false);
    if (selectedSpaceKeys.size > 0) { clearSpaceSelection(); renderSpaceOptions(); }
    if (isTaskContextMenuOpen) setTaskContextMenuOpen(false);
    if (isNotesPanelOpen) setNotesPanelOpen(false);
  }
});

document.getElementById('clearUnpinned').addEventListener('click', () => {
  commit('Удалены незакреплённые задачи', (st) => {
    const active = getActiveSpace(st);
    for (const day of DAYS) {
      active.days[day] = active.days[day].filter((t) => t.pinned);
    }
    active.dockTasks = active.dockTasks.filter((t) => t.pinned);
  });
});

document.getElementById('exitPreview').addEventListener('click', () => {
  previewIndex = null;
  renderAll();
});

const toggleDockMenuButton = document.getElementById('toggleDockMenu');
if (toggleDockMenuButton) {
  toggleDockMenuButton.addEventListener('click', () => {
    setDockMenuOpen(!isDockMenuOpen);
  });
}

const dockTaskForm = document.getElementById('dockTaskForm');
if (dockTaskForm) {
  dockTaskForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const input = dockTaskForm.title;
    const title = input.value.trim();
    if (!title) return;
    commit(`Добавлена задача в поле доски «${title}»`, (st) => {
      getActiveSpace(st).dockTasks.push({ id: st.nextTaskId++, title, tags: [], pinned: false, createdAt: Date.now() });
    });
    dockTaskForm.reset();
  });

  const dockList = document.getElementById('taskDockList');
  if (dockList) {
    dockList.addEventListener('dragover', (e) => e.preventDefault());
    dockList.addEventListener('drop', () => {
      if (!dragTask) return;
      if (dragTask.fromDock) {
        commit('Изменён порядок задач в поле доски', (st) => {
          moveDockTask(st, dragTask.taskId);
        });
      } else {
        const { fromDay, taskId } = dragTask;
        commit('Задача перемещена в поле доски', (st) => {
          const active = getActiveSpace(st);
          const source = active.days[fromDay];
          const idx = source.findIndex((t) => t.id === taskId);
          if (idx < 0) return;
          const [task] = source.splice(idx, 1);
          active.dockTasks.push(task);
        });
      }
      dragTask = null;
    });
  }
}

const addSideNoteForm = document.getElementById('addSideNoteForm');
if (addSideNoteForm) {
  addSideNoteForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = addSideNoteForm.text.value.trim();
    if (!text) return;
    commit('Добавлена заметка в боковое меню', (st) => {
      getGlobalSideNotes(st).push({ id: st.nextSideNoteId++, text, createdAt: Date.now() });
    });
    addSideNoteForm.reset();
  });
}

document.getElementById('backToCalendar').addEventListener('click', () => {
  currentBoardTaskId = null;
  selectedCloudIds = new Set();
  renderBoard();
});

const spaceActionCopy = document.getElementById('spaceActionCopy');
const spaceActionExport = document.getElementById('spaceActionExport');
const spaceActionDelete = document.getElementById('spaceActionDelete');
const importSpaceBtn = document.getElementById('importSpaceBtn');
const importSpaceInput = document.getElementById('importSpaceInput');

if (spaceActionCopy) {
  spaceActionCopy.addEventListener('click', async () => {
    if (!spaceActionTargetKey) return;
    const payload = {
      name: getSpaceLabel(spaceActionTargetKey, state),
      spaceKey: spaceActionTargetKey,
      data: normalizeImportedSpaceData(getActiveSpace({ ...state, activeSpace: spaceActionTargetKey }))
    };
    const text = JSON.stringify(payload, null, 2);
    try {
      await navigator.clipboard.writeText(text);
      alert('Пространство скопировано в буфер обмена.');
    } catch {
      alert('Не удалось скопировать автоматически.');
    }
    setSpaceActionMenuOpen(false);
  });
}

if (spaceActionExport) {
  spaceActionExport.addEventListener('click', () => {
    if (!spaceActionTargetKey) return;
    const payload = {
      name: getSpaceLabel(spaceActionTargetKey, state),
      spaceKey: spaceActionTargetKey,
      exportedAt: new Date().toISOString(),
      data: normalizeImportedSpaceData(getActiveSpace({ ...state, activeSpace: spaceActionTargetKey }))
    };
    downloadJson(`space-${spaceActionTargetKey}.json`, payload);
    setSpaceActionMenuOpen(false);
  });
}

if (spaceActionDelete) {
  spaceActionDelete.addEventListener('click', () => {
    const targets = getSpaceActionSelection();
    if (targets.length === 0) {
      setSpaceActionMenuOpen(false);
      return;
    }

    commit(targets.length > 1 ? `Удалено/очищено пространств: ${targets.length}` : (targets[0] === 'management' || targets[0] === 'notes') ? `Очищено пространство «${getSpaceLabel(targets[0], state)}»` : `Удалено пространство «${getSpaceLabel(targets[0], state)}»`, (st) => {
      if (!st.spaceNames) st.spaceNames = { ...SPACES };

      targets.forEach((target) => {
        if (!(target in st.spaces)) return;
        delete st.spaces[target];
        delete st.spaceNames[target];
      });

      if (Object.keys(st.spaces).length === 0) {
        st.spaces.management = createSpaceState();
        st.spaceNames.management = SPACES.management;
      }

      if (!(st.activeSpace in st.spaces)) {
        st.activeSpace = st.spaces.management ? 'management' : Object.keys(st.spaces)[0];
      }

      currentBoardTaskId = null;
    });
    clearSpaceSelection();
    setSpaceActionMenuOpen(false);
  });
}

if (importSpaceBtn && importSpaceInput) {
  importSpaceBtn.addEventListener('click', () => importSpaceInput.click());
  importSpaceInput.addEventListener('change', async () => {
    const file = importSpaceInput.files?.[0];
    if (!file) return;
    const text = await file.text();
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      alert('Файл импорта не является корректным JSON.');
      importSpaceInput.value = '';
      return;
    }

    const imported = normalizeImportedSpaceData(parsed.data || parsed);
    const fallbackKey = parsed.name ? `import-${Date.now()}` : state.activeSpace;
    const target = typeof parsed.spaceKey === 'string' && parsed.spaceKey.trim() ? parsed.spaceKey.trim() : fallbackKey;
    const label = typeof parsed.name === 'string' && parsed.name.trim() ? parsed.name.trim() : (SPACES[target] || target);

    if (target in state.spaces) {
      alert('Импортированное пространство не будет импортировано, если оно уже существует в списке.');
      importSpaceInput.value = '';
      return;
    }

    commit(`Импортировано пространство в «${label}»`, (st) => {
      if (!st.spaceNames) st.spaceNames = { ...SPACES };
      st.spaceNames[target] = label;
      st.spaces[target] = imported;
    });
    importSpaceInput.value = '';
  });
}

const ctxPin = document.getElementById('ctxPin');
const ctxBackground = document.getElementById('ctxBackground');
const ctxDelete = document.getElementById('ctxDelete');
const ctxColor = document.getElementById('ctxColor');
const ctxCreateGroup = document.getElementById('ctxCreateGroup');

if (ctxPin) {
  ctxPin.addEventListener('click', () => {
    const picks = getTaskContextSelection();
    if (picks.length === 0) return;
    commit('Изменён статус закрепления', (st) => {
      const active = getActiveSpace(st);
      picks.forEach(({ day, taskId }) => {
        const t = active.days[day].find((x) => x.id === taskId);
        if (t) t.pinned = !t.pinned;
      });
    });
    clearTaskSelection();
    setTaskContextMenuOpen(false);
  });
}

if (ctxBackground) {
  ctxBackground.addEventListener('click', () => {
    if (!taskContextTarget) return;
    const { day, taskId } = taskContextTarget;
    commit(`Задача перенесена на фон дня «${day}»`, (st) => {
      const active = getActiveSpace(st);
      const source = active.days[day];
      const idx = source.findIndex((t) => t.id === taskId);
      if (idx < 0) return;
      const [task] = source.splice(idx, 1);
      active.dayBackgrounds[day] = task.title;
      delete active.boards[task.id];
      if (currentBoardTaskId === task.id) currentBoardTaskId = null;
    });
    clearTaskSelection();
    setTaskContextMenuOpen(false);
  });
}

if (ctxDelete) {
  ctxDelete.addEventListener('click', () => {
    const picks = getTaskContextSelection();
    if (picks.length === 0) return;
    commit('Удалена задача через меню', (st) => {
      const active = getActiveSpace(st);
      picks.forEach(({ day, taskId }) => {
        active.days[day] = active.days[day].filter((t) => t.id !== taskId);
        delete active.boards[taskId];
        if (currentBoardTaskId === taskId) currentBoardTaskId = null;
      });
      active.taskGroups = (active.taskGroups || []).map((group) => ({
        ...group,
        taskIds: (group.taskIds || []).filter((id) => !picks.some((pick) => pick.taskId === id))
      })).filter((group) => group.taskIds.length > 1);
    });
    clearTaskSelection();
    setTaskContextMenuOpen(false);
  });
}

if (ctxColor) {
  ctxColor.addEventListener('change', (e) => {
    const picks = getTaskContextSelection();
    if (picks.length === 0) return;
    const nextColor = e.target.value;
    commit('Изменён цвет задачи через меню', (st) => {
      const active = getActiveSpace(st);
      picks.forEach(({ day, taskId }) => {
        const t = active.days[day].find((x) => x.id === taskId);
        if (t) t.color = nextColor;
      });
    });
  });
}


if (ctxCreateGroup) {
  ctxCreateGroup.addEventListener('click', () => {
    const picks = getTaskContextSelection();
    if (picks.length < 2) return;
    commit('Создана группа задач календаря', (st) => {
      const active = getActiveSpace(st);
      if (!Array.isArray(active.taskGroups)) active.taskGroups = [];
      const groupId = st.nextTaskGroupId++;
      const taskIds = [...new Set(picks.map((pick) => pick.taskId))];
      active.taskGroups.push({ id: groupId, name: `Группа ${groupId}`, color: '#8ea1ff', taskIds });
    });
    clearTaskSelection();
    setTaskContextMenuOpen(false);
  });
}

document.getElementById('addCloud').addEventListener('click', () => {
  const taskId = currentBoardTaskId;
  if (!taskId) return;
  commit('Добавлена заметка', (st) => {
    const b = ensureBoard(st, taskId);
    b.clouds.push({ id: st.nextCloudId++, text: '', x: 50, y: 50, groupId: null });
  });
});

document.getElementById('groupClouds').addEventListener('click', () => {
  const taskId = currentBoardTaskId;
  if (!taskId || selectedCloudIds.size < 2) return;
  const picks = [...selectedCloudIds];
  commit('Создана группа заметок', (st) => {
    const b = ensureBoard(st, taskId);
    const gid = st.nextGroupId++;
    b.clouds.forEach((c) => {
      if (picks.includes(c.id)) c.groupId = gid;
    });
  });
});

document.addEventListener('keydown', (e) => {
  if (e.key !== 'Delete') return;
  if (e.target.matches('input, textarea, [contenteditable="true"]')) return;
  if (!currentBoardTaskId || selectedCloudIds.size === 0) return;
  const picks = [...selectedCloudIds];
  commit('Удалены выделенные заметки', (st) => {
    const b = ensureBoard(st, currentBoardTaskId);
    b.clouds = b.clouds.filter((c) => !picks.includes(c.id));
  });
  selectedCloudIds = new Set();
});

document.addEventListener('keydown', (e) => {
  if (e.key !== 'Delete') return;
  if (e.target.matches('input, textarea, [contenteditable="true"]')) return;
  if (selectedTaskKeys.size === 0) return;
  const picks = getSelectedTaskRefs();
  commit('Удалены выделенные задачи', (st) => {
    const active = getActiveSpace(st);
    picks.forEach(({ day, taskId }) => {
      active.days[day] = active.days[day].filter((t) => t.id !== taskId);
      delete active.boards[taskId];
      if (currentBoardTaskId === taskId) currentBoardTaskId = null;
    });
    active.taskGroups = (active.taskGroups || []).map((group) => ({
      ...group,
      taskIds: (group.taskIds || []).filter((id) => !picks.some((pick) => pick.taskId === id))
    })).filter((group) => group.taskIds.length > 1);
  });
  clearTaskSelection();
});

document.getElementById('ungroupClouds').addEventListener('click', () => {
  const taskId = currentBoardTaskId;
  if (!taskId || selectedCloudIds.size === 0) return;
  const picks = [...selectedCloudIds];
  commit('Разгруппировка заметок', (st) => {
    const b = ensureBoard(st, taskId);
    b.clouds.forEach((c) => {
      if (picks.includes(c.id)) c.groupId = null;
    });
  });
});

document.getElementById('zoomIn').addEventListener('click', () => {
  const taskId = currentBoardTaskId;
  if (!taskId) return;
  commit('Увеличен масштаб доски', (st) => {
    const b = ensureBoard(st, taskId);
    b.zoom = Math.min(2.5, b.zoom + 0.1);
  });
});

document.getElementById('zoomOut').addEventListener('click', () => {
  const taskId = currentBoardTaskId;
  if (!taskId) return;
  commit('Уменьшен масштаб доски', (st) => {
    const b = ensureBoard(st, taskId);
    b.zoom = Math.max(0.4, b.zoom - 0.1);
  });
});

document.addEventListener('keydown', (e) => {
  if (e.ctrlKey && e.key.toLowerCase() === 'z') {
    e.preventDefault();
    if (currentHistoryIndex > 0) {
      currentHistoryIndex -= 1;
      state = structuredClone(history[currentHistoryIndex].snapshot);
      previewIndex = null;
      persist();
      renderAll();
    }
  }
});

setHistoryOpen(false);
setInstructionsOpen(false);
setSpaceMenuOpen(false);
setDockMenuOpen(false);
setNotesPanelOpen(false);
renderAll();
loadTelegramTasks();
