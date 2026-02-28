const DAYS = ['Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота', 'Воскресенье'];
const SPACES = {
  management: 'Управление',
  notes: 'Заметки'
};

const STORAGE_KEY = 'calendar-board-state-v3';
const PREVIOUS_STORAGE_KEY = 'calendar-board-state-v2';
const LEGACY_STORAGE_KEY = 'calendar-board-state-v1';

function createSpaceState() {
  return {
    days: Object.fromEntries(DAYS.map((d) => [d, []])),
    boardTasks: [],
    boards: {}
  };
}

const defaultState = () => ({
  theme: 'light',
  activeSpace: 'management',
  nextTaskId: 1,
  nextCloudId: 1,
  nextGroupId: 1,
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
let selectedCloudIds = new Set();
let isHistoryOpen = false;
let isInstructionsOpen = false;
let isSpaceMenuOpen = false;

function normalizeTask(task, fallbackId = null) {
  return {
    id: Number(task.id ?? fallbackId),
    title: String(task.title || '').trim() || 'Без названия',
    tags: Array.isArray(task.tags) ? task.tags : [],
    pinned: Boolean(task.pinned),
    createdAt: Number(task.createdAt || Date.now())
  };
}

function loadState() {
  const raw = localStorage.getItem(STORAGE_KEY)
    ?? localStorage.getItem(PREVIOUS_STORAGE_KEY)
    ?? localStorage.getItem(LEGACY_STORAGE_KEY);

  if (!raw) return defaultState();

  try {
    const parsed = JSON.parse(raw);
    const base = defaultState();

    if (parsed.spaces) {
      const merged = {
        ...base,
        ...parsed,
        spaces: {
          management: { ...createSpaceState(), ...(parsed.spaces.management || {}) },
          notes: { ...createSpaceState(), ...(parsed.spaces.notes || {}) }
        }
      };

      for (const key of Object.keys(merged.spaces)) {
        const sp = merged.spaces[key];
        sp.boardTasks = Array.isArray(sp.boardTasks) ? sp.boardTasks.map((t) => normalizeTask(t, merged.nextTaskId++)) : [];
        for (const day of DAYS) {
          sp.days[day] = Array.isArray(sp.days[day]) ? sp.days[day].map((t) => normalizeTask(t, merged.nextTaskId++)) : [];
        }
      }
      return merged;
    }

    return {
      ...base,
      ...parsed,
      spaces: {
        management: {
          days: parsed.days || createSpaceState().days,
          boardTasks: [],
          boards: parsed.boards || {}
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

function effectiveState() {
  return previewIndex === null ? state : history[previewIndex].snapshot;
}

function getActiveSpace(st = effectiveState()) {
  const key = st.activeSpace in SPACES ? st.activeSpace : 'management';
  return st.spaces[key];
}

function getTaskById(taskId, s = state) {
  const space = getActiveSpace(s);
  const boardTask = space.boardTasks.find((t) => t.id === taskId);
  if (boardTask) return { task: boardTask, location: { type: 'board' } };

  for (const day of DAYS) {
    const task = space.days[day].find((t) => t.id === taskId);
    if (task) return { task, location: { type: 'day', key: day } };
  }
  return null;
}

function ensureBoard(st, taskId) {
  const space = getActiveSpace(st);
  if (!space.boards[taskId]) {
    space.boards[taskId] = { zoom: 1, clouds: [] };
  }
  return space.boards[taskId];
}

function getTaskCollection(space, location) {
  if (location.type === 'board') return space.boardTasks;
  return space.days[location.key];
}

function moveTask(st, from, to, taskId, targetTaskId = null, placeAfter = false) {
  const space = getActiveSpace(st);
  const source = getTaskCollection(space, from);
  const destination = getTaskCollection(space, to);

  const fromIdx = source.findIndex((t) => t.id === taskId);
  if (fromIdx < 0) return;

  const [task] = source.splice(fromIdx, 1);

  if (targetTaskId === null || taskId === targetTaskId) {
    destination.push(task);
    return;
  }

  const targetIdx = destination.findIndex((t) => t.id === targetTaskId);
  if (targetIdx < 0) {
    destination.push(task);
    return;
  }

  destination.splice(placeAfter ? targetIdx + 1 : targetIdx, 0, task);
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

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  document.getElementById('themeToggle').textContent = theme === 'dark' ? 'Светлая тема' : 'Тёмная тема';
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

function setSpaceMenuOpen(open) {
  isSpaceMenuOpen = open;
  const menu = document.getElementById('spaceMenu');
  const toggle = document.getElementById('spaceMenuToggle');
  menu.classList.toggle('hidden', !open);
  toggle.setAttribute('aria-expanded', String(open));
}

function updateSpaceButton(spaceKey) {
  document.getElementById('spaceMenuToggle').textContent = `Пространство: ${SPACES[spaceKey]}`;
}

function renderTaskNode(task, location, dayLabel = '') {
  const tpl = document.getElementById('taskTemplate');
  const node = tpl.content.firstElementChild.cloneNode(true);

  if (task.pinned) node.classList.add('pinned');
  node.querySelector('.open-board').textContent = task.title;
  node.querySelector('.open-board').addEventListener('click', () => openBoard(task.id));

  const tags = task.tags || [];
  node.querySelector('.task-tags').innerHTML = tags.map((tag) => `<span class="tag">#${tag}</span>`).join('');

  node.querySelector('.edit').addEventListener('click', () => {
    const nextTitleRaw = prompt('Название задачи', task.title);
    if (nextTitleRaw === null) return;
    const nextTitle = nextTitleRaw.trim();
    if (!nextTitle) return;

    const nextTagsRaw = prompt('Теги через запятую', (task.tags || []).join(', '));
    if (nextTagsRaw === null) return;
    const nextTags = [...new Set(nextTagsRaw.split(',').map((x) => x.trim()).filter(Boolean))];

    commit(`Задача «${task.title}» изменена`, (st) => {
      const found = getTaskById(task.id, st);
      if (!found) return;
      found.task.title = nextTitle;
      found.task.tags = nextTags;
    });
  });

  node.querySelector('.delete').addEventListener('click', () => {
    commit(`Удалена задача «${task.title}»`, (st) => {
      const space = getActiveSpace(st);
      const collection = getTaskCollection(space, location);
      const idx = collection.findIndex((t) => t.id === task.id);
      if (idx >= 0) collection.splice(idx, 1);
      delete space.boards[task.id];
    });
  });

  node.addEventListener('contextmenu', (e) => {
    if (location.type !== 'day') return;
    e.preventDefault();
    commit('Изменён статус закрепления', (st) => {
      const t = getActiveSpace(st).days[dayLabel].find((x) => x.id === task.id);
      if (t) t.pinned = !t.pinned;
    });
  });

  node.addEventListener('dragstart', () => {
    dragTask = { from: location, taskId: task.id };
  });

  node.addEventListener('dragover', (e) => e.preventDefault());
  node.addEventListener('drop', (e) => {
    e.preventDefault();
    if (!dragTask) return;
    const rect = node.getBoundingClientRect();
    const placeAfter = e.clientY > rect.top + rect.height / 2;
    commit('Изменён порядок задач', (st) => {
      moveTask(st, dragTask.from, location, dragTask.taskId, task.id, placeAfter);
    });
    dragTask = null;
  });

  return node;
}

function setupDropZone(listEl, toLocation, description) {
  listEl.addEventListener('dragover', (e) => e.preventDefault());
  listEl.addEventListener('drop', () => {
    if (!dragTask) return;
    commit(description, (st) => {
      moveTask(st, dragTask.from, toLocation, dragTask.taskId);
    });
    dragTask = null;
  });
}

function renderCalendar() {
  const s = effectiveState();
  const space = getActiveSpace(s);

  const grid = document.getElementById('calendarGrid');
  grid.innerHTML = '';

  DAYS.forEach((day) => {
    const col = document.createElement('div');
    col.className = 'day-column';
    col.dataset.day = day;
    col.innerHTML = `
      <h3 class="day-header">${day}</h3>
      <form class="add-task">
        <input name="title" placeholder="Новая задача" required />
        <button type="submit">+</button>
      </form>
      <ul class="tasks"></ul>
    `;

    const form = col.querySelector('.add-task');
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const title = form.title.value.trim();
      if (!title) return;
      commit(`Добавлена задача «${title}»`, (st) => {
        getActiveSpace(st).days[day].push({ id: st.nextTaskId++, title, tags: [], pinned: false, createdAt: Date.now() });
      });
    });

    const list = col.querySelector('.tasks');
    setupDropZone(list, { type: 'day', key: day }, `Задача перемещена в «${day}»`);

    space.days[day].forEach((task) => {
      list.append(renderTaskNode(task, { type: 'day', key: day }, day));
    });

    grid.append(col);
  });

  const boardTaskList = document.getElementById('boardTaskList');
  boardTaskList.innerHTML = '';
  setupDropZone(boardTaskList, { type: 'board' }, 'Задача перемещена в поле доски');

  space.boardTasks.forEach((task) => {
    boardTaskList.append(renderTaskNode(task, { type: 'board' }));
  });

  const boardTaskForm = document.getElementById('boardTaskForm');
  boardTaskForm.onsubmit = (e) => {
    e.preventDefault();
    const title = boardTaskForm.title.value.trim();
    if (!title) return;
    commit(`Добавлена задача в поле доски «${title}»`, (st) => {
      getActiveSpace(st).boardTasks.push({ id: st.nextTaskId++, title, tags: [], pinned: false, createdAt: Date.now() });
    });
  };

  updateSpaceButton(s.activeSpace);
  applyTheme(s.theme);
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
  location.hash = `board/${taskId}`;
  renderBoard();
}

function renderBoard() {
  if (!location.hash.startsWith('#board/')) {
    document.getElementById('calendarView').classList.remove('hidden');
    document.getElementById('boardView').classList.add('hidden');
    return;
  }

  const taskId = Number(location.hash.split('/')[1]);
  currentBoardTaskId = taskId;
  const taskInfo = getTaskById(taskId, effectiveState());

  if (!taskInfo) {
    location.hash = '';
    return;
  }

  document.getElementById('calendarView').classList.add('hidden');
  document.getElementById('boardView').classList.remove('hidden');
  document.getElementById('boardTitle').textContent = `Доска: ${taskInfo.task.title}`;

  const board = ensureBoard(state, taskId);
  const canvas = document.getElementById('boardCanvas');
  canvas.innerHTML = '';
  canvas.style.transform = `scale(${board.zoom})`;
  document.getElementById('zoomValue').textContent = `${Math.round(board.zoom * 100)}%`;

  board.clouds.forEach((cloud) => {
    const el = document.createElement('div');
    el.className = 'cloud';
    if (cloud.groupId) el.classList.add('grouped');
    if (selectedCloudIds.has(cloud.id)) el.classList.add('selected');
    el.style.left = `${cloud.x}px`;
    el.style.top = `${cloud.y}px`;
    el.innerHTML = `<textarea>${cloud.text || ''}</textarea>`;

    el.querySelector('textarea').addEventListener('change', (e) => {
      commit('Изменён текст заметки', (st) => {
        const b = ensureBoard(st, taskId);
        const c = b.clouds.find((x) => x.id === cloud.id);
        if (c) c.text = e.target.value;
      });
    });

    el.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      if (e.ctrlKey && !e.target.matches('textarea')) {
        if (selectedCloudIds.has(cloud.id)) selectedCloudIds.delete(cloud.id);
        else selectedCloudIds.add(cloud.id);
        renderBoard();
        return;
      }

      if (e.target.matches('textarea')) return;
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

function renderAll() {
  renderCalendar();
  renderHistory();
  renderBoard();
}

document.getElementById('spaceMenuToggle').addEventListener('click', () => {
  setSpaceMenuOpen(!isSpaceMenuOpen);
});

document.querySelectorAll('.space-option').forEach((btn) => {
  btn.addEventListener('click', () => {
    const nextSpace = btn.dataset.space;
    if (!(nextSpace in SPACES)) return;

    commit(`Переключено пространство на «${SPACES[nextSpace]}»`, (st) => {
      st.activeSpace = nextSpace;
    });

    setSpaceMenuOpen(false);
    if (location.hash.startsWith('#board/')) location.hash = '';
  });
});

document.addEventListener('click', (e) => {
  if (!e.target.closest('.space-menu-wrap')) setSpaceMenuOpen(false);
});

document.getElementById('themeToggle').addEventListener('click', () => {
  commit('Смена темы', (st) => {
    st.theme = st.theme === 'dark' ? 'light' : 'dark';
  });
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
  }
});

document.getElementById('clearUnpinned').addEventListener('click', () => {
  commit('Удалены незакреплённые задачи', (st) => {
    const active = getActiveSpace(st);
    for (const day of DAYS) {
      active.days[day] = active.days[day].filter((t) => t.pinned);
    }
    active.boardTasks = active.boardTasks.filter((t) => t.pinned);
  });
});

document.getElementById('exitPreview').addEventListener('click', () => {
  previewIndex = null;
  renderAll();
});

document.getElementById('backToCalendar').addEventListener('click', () => {
  location.hash = '';
  renderBoard();
});

document.getElementById('addCloud').addEventListener('click', () => {
  if (!currentBoardTaskId) return;
  commit('Добавлена заметка', (st) => {
    const b = ensureBoard(st, currentBoardTaskId);
    b.clouds.push({ id: st.nextCloudId++, text: '', x: 50, y: 50, groupId: null });
  });
});

document.getElementById('groupClouds').addEventListener('click', () => {
  if (!currentBoardTaskId || selectedCloudIds.size < 2) return;
  const picks = [...selectedCloudIds];
  commit('Создана группа заметок', (st) => {
    const b = ensureBoard(st, currentBoardTaskId);
    const gid = st.nextGroupId++;
    b.clouds.forEach((c) => {
      if (picks.includes(c.id)) c.groupId = gid;
    });
  });
});

document.addEventListener('keydown', (e) => {
  if (e.key !== 'Delete') return;
  if (e.target.matches('input, textarea, [contenteditable="true"]')) return;
  if (!location.hash.startsWith('#board/') || !currentBoardTaskId || selectedCloudIds.size === 0) return;
  const picks = [...selectedCloudIds];
  commit('Удалены выделенные заметки', (st) => {
    const b = ensureBoard(st, currentBoardTaskId);
    b.clouds = b.clouds.filter((c) => !picks.includes(c.id));
  });
  selectedCloudIds = new Set();
});

document.getElementById('ungroupClouds').addEventListener('click', () => {
  if (!currentBoardTaskId || selectedCloudIds.size === 0) return;
  const picks = [...selectedCloudIds];
  commit('Разгруппировка заметок', (st) => {
    const b = ensureBoard(st, currentBoardTaskId);
    b.clouds.forEach((c) => {
      if (picks.includes(c.id)) c.groupId = null;
    });
  });
});

document.getElementById('zoomIn').addEventListener('click', () => {
  if (!currentBoardTaskId) return;
  commit('Увеличен масштаб доски', (st) => {
    const b = ensureBoard(st, currentBoardTaskId);
    b.zoom = Math.min(2.5, b.zoom + 0.1);
  });
});

document.getElementById('zoomOut').addEventListener('click', () => {
  if (!currentBoardTaskId) return;
  commit('Уменьшен масштаб доски', (st) => {
    const b = ensureBoard(st, currentBoardTaskId);
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

window.addEventListener('hashchange', renderBoard);
setHistoryOpen(false);
setInstructionsOpen(false);
setSpaceMenuOpen(false);
renderAll();
