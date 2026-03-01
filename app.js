const DAYS = ['Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота', 'Воскресенье'];
const SPACES = {
  management: 'Управление',
  notes: 'Заметки'
};

const STORAGE_KEY = 'calendar-board-state-v2';
const LEGACY_STORAGE_KEY = 'calendar-board-state-v1';

function createSpaceState() {
  return {
    days: Object.fromEntries(DAYS.map((d) => [d, []])),
    dayBackgrounds: Object.fromEntries(DAYS.map((d) => [d, null])),
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
let dragCloudNote = null;
let dragBackgroundTask = null;
let selectedCloudIds = new Set();
let isHistoryOpen = false;
let isInstructionsOpen = false;
let isSpaceMenuOpen = false;
let isTaskContextMenuOpen = false;
let taskContextTarget = null;

function loadState() {
  const raw = localStorage.getItem(STORAGE_KEY) ?? localStorage.getItem(LEGACY_STORAGE_KEY);
  if (!raw) return defaultState();
  try {
    const parsed = JSON.parse(raw);
    const base = defaultState();

    if (parsed.spaces) {
      return {
        ...base,
        ...parsed,
        spaces: {
          management: { ...createSpaceState(), ...(parsed.spaces.management || {}) },
          notes: { ...createSpaceState(), ...(parsed.spaces.notes || {}) }
        }
      };
    }

    return {
      ...base,
      ...parsed,
      spaces: {
        management: {
          days: parsed.days || createSpaceState().days,
          dayBackgrounds: parsed.dayBackgrounds || createSpaceState().dayBackgrounds,
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

function getActiveSpace(st = effectiveState()) {
  const key = st.activeSpace in SPACES ? st.activeSpace : 'management';
  return st.spaces[key];
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

function setSpaceMenuOpen(open) {
  isSpaceMenuOpen = open;
  const menu = document.getElementById('spaceMenu');
  const toggle = document.getElementById('spaceMenuToggle');
  menu.classList.toggle('hidden', !open);
  toggle.setAttribute('aria-expanded', String(open));
}

function setDockMenuOpen(open) {
  isDockMenuOpen = open;
  const menu = document.getElementById('taskDockMenu');
  const toggle = document.getElementById('toggleDockMenu');
  if (!menu || !toggle) return;
  menu.classList.toggle('hidden', !open);
  toggle.setAttribute('aria-expanded', String(open));
}

function updateSpaceButton(spaceKey) {
  document.getElementById('spaceMenuToggle').textContent = `Пространство: ${SPACES[spaceKey]}`;
}

function moveDockTask(st, taskId, targetTaskId = null, placeAfter = false) {
  const space = getActiveSpace(st);
  const list = space.dockTasks;
  const fromIdx = list.findIndex((t) => t.id === taskId);
  if (fromIdx < 0) return;

  const [task] = list.splice(fromIdx, 1);
  if (targetTaskId === null) {
    list.push(task);
    return;
  }

  const targetIdx = list.findIndex((t) => t.id === targetTaskId);
  if (targetIdx < 0) {
    list.push(task);
    return;
  }

  const insertIdx = placeAfter ? targetIdx + 1 : targetIdx;
  list.splice(insertIdx, 0, task);
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
    createdAt: Date.now()
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
  taskContextTarget = { day, taskId: task.id };
  const pinBtn = document.getElementById('ctxPin');
  const colorInput = document.getElementById('ctxColor');
  if (pinBtn) pinBtn.textContent = task.pinned ? 'Открепить' : 'Закрепить';
  if (colorInput) colorInput.value = task.color || '#5a6cff';
  setTaskContextMenuOpen(true, x, y);
}

function renderCalendar() {
  const s = effectiveState();
  const grid = document.getElementById('calendarGrid');
  const space = getActiveSpace(s);
  grid.innerHTML = '';

  DAYS.forEach((day) => {
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
      <ul class="tasks"></ul>
    `;

    const bgLabel = col.querySelector('.day-background-label');
    if (bgLabel && dayBackgroundTitle) {
      bgLabel.textContent = buildDayBackgroundPattern(dayBackgroundTitle);
    }

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
        getActiveSpace(st).days[day].push({ id: st.nextTaskId++, title, color: null, pinned: false, createdAt: Date.now() });
      });
    });

    const clearBg = col.querySelector('.clear-day-bg');
    clearBg.addEventListener('click', () => {
      commit(`Очищен фон дня «${day}»`, (st) => {
        getActiveSpace(st).dayBackgrounds[day] = null;
      });
    });

    const list = col.querySelector('.tasks');
    col.addEventListener('dragover', (e) => {
      if (dragTask || dragCloudNote || dragBackgroundTask) e.preventDefault();
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

    space.days[day].forEach((task) => {
      const tpl = document.getElementById('taskTemplate');
      const node = tpl.content.firstElementChild.cloneNode(true);
      if (task.pinned) node.classList.add('pinned');
      node.querySelector('.open-board').textContent = task.title;
      node.querySelector('.open-board').addEventListener('click', () => openBoard(task.id));
      enableInlineTaskTitleEdit(node, task, day);

      if (task.color) {
        node.style.setProperty('--task-color', task.color);
      }

      node.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        openTaskContextMenu(e.clientX, e.clientY, day, task);
      });

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

      list.append(node);
    });

    grid.append(col);
  });

  renderTaskDock(s);
  updateSpaceButton(s.activeSpace);
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
    currentBoardTaskId = null;
  });
});

document.addEventListener('click', (e) => {
  if (!e.target.closest('.space-menu-wrap')) setSpaceMenuOpen(false);
  if (isTaskContextMenuOpen && !e.target.closest('#taskContextMenu') && !e.target.closest('.task')) setTaskContextMenuOpen(false);
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
    if (isTaskContextMenuOpen) setTaskContextMenuOpen(false);
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

document.getElementById('backToCalendar').addEventListener('click', () => {
  currentBoardTaskId = null;
  selectedCloudIds = new Set();
  renderBoard();
});

const ctxPin = document.getElementById('ctxPin');
const ctxBackground = document.getElementById('ctxBackground');
const ctxDelete = document.getElementById('ctxDelete');
const ctxColor = document.getElementById('ctxColor');

if (ctxPin) {
  ctxPin.addEventListener('click', () => {
    if (!taskContextTarget) return;
    const { day, taskId } = taskContextTarget;
    commit('Изменён статус закрепления', (st) => {
      const t = getActiveSpace(st).days[day].find((x) => x.id === taskId);
      if (t) t.pinned = !t.pinned;
    });
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
    setTaskContextMenuOpen(false);
  });
}

if (ctxDelete) {
  ctxDelete.addEventListener('click', () => {
    if (!taskContextTarget) return;
    const { day, taskId } = taskContextTarget;
    commit('Удалена задача через меню', (st) => {
      const active = getActiveSpace(st);
      active.days[day] = active.days[day].filter((t) => t.id !== taskId);
      delete active.boards[taskId];
      if (currentBoardTaskId === taskId) currentBoardTaskId = null;
    });
    setTaskContextMenuOpen(false);
  });
}

if (ctxColor) {
  ctxColor.addEventListener('change', (e) => {
    if (!taskContextTarget) return;
    const { day, taskId } = taskContextTarget;
    const nextColor = e.target.value;
    commit('Изменён цвет задачи через меню', (st) => {
      const t = getActiveSpace(st).days[day].find((x) => x.id === taskId);
      if (!t) return;
      t.color = nextColor;
    });
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
renderAll();
