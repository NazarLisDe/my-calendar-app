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
    boards: {},
    dockTasks: []
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
let selectedCloudIds = new Set();
let isHistoryOpen = false;
let isInstructionsOpen = false;
let isSpaceMenuOpen = false;
let isDockMenuOpen = false;

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
          boards: parsed.boards || {},
          dockTasks: parsed.dockTasks || []
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
    tags: ['note'],
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

function renderCalendar() {
  const s = effectiveState();
  const grid = document.getElementById('calendarGrid');
  const space = getActiveSpace(s);
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

    const form = col.querySelector('form');
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const input = form.title;
      const title = input.value.trim();
      if (!title) return;
      commit(`Добавлена задача «${title}»`, (st) => {
        getActiveSpace(st).days[day].push({ id: st.nextTaskId++, title, tags: [], pinned: false, createdAt: Date.now() });
      });
    });

    const list = col.querySelector('.tasks');
    list.addEventListener('dragover', (e) => e.preventDefault());
    list.addEventListener('drop', () => {
      if (dragCloudNote) {
        const { boardTaskId, cloudId } = dragCloudNote;
        commit(`Заметка преобразована в задачу дня «${day}»`, (st) => {
          moveCloudToDay(st, boardTaskId, cloudId, day);
        });
        dragCloudNote = null;
        return;
      }

      if (!dragTask) return;
      if (dragTask.fromDock) {
        commit(`Задача перемещена из поля доски в «${day}»`, (st) => {
          const active = getActiveSpace(st);
          const idx = active.dockTasks.findIndex((t) => t.id === dragTask.taskId);
          if (idx < 0) return;
          const [task] = active.dockTasks.splice(idx, 1);
          active.days[day].push(task);
        });
      } else {
        const { fromDay, taskId } = dragTask;
        commit(`Задача перемещена в «${day}»`, (st) => moveTask(st, fromDay, day, taskId));
      }
      dragTask = null;
    });

    space.days[day].forEach((task) => {
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
          const t = getActiveSpace(st).days[day].find((x) => x.id === task.id);
          if (!t) return;
          t.title = cleanTitle;
          t.tags = nextTags;
        });
      });

      node.querySelector('.delete').addEventListener('click', () => {
        commit(`Удалена задача «${task.title}»`, (st) => {
          const active = getActiveSpace(st);
          active.days[day] = active.days[day].filter((t) => t.id !== task.id);
          delete active.boards[task.id];
        });
      });

      node.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        commit('Изменён статус закрепления', (st) => {
          const t = getActiveSpace(st).days[day].find((x) => x.id === task.id);
          if (t) t.pinned = !t.pinned;
        });
      });

      node.addEventListener('dragstart', () => {
        dragTask = { fromDay: day, taskId: task.id, fromDock: false };
      });

      node.addEventListener('dragover', (e) => e.preventDefault());
      node.addEventListener('drop', (e) => {
        e.preventDefault();
        const rect = node.getBoundingClientRect();
        const placeAfter = e.clientY > rect.top + rect.height / 2;

        if (dragCloudNote) {
          const { boardTaskId, cloudId } = dragCloudNote;
          commit('Заметка преобразована в задачу с позиционированием', (st) => {
            moveCloudToDay(st, boardTaskId, cloudId, day, task.id, placeAfter);
          });
          dragCloudNote = null;
          return;
        }

        if (!dragTask) return;
        const { fromDay, taskId } = dragTask;
        commit('Изменён порядок задач', (st) => {
          moveTask(st, fromDay, day, taskId, task.id, placeAfter);
        });
        dragTask = null;
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
  if (!e.target.closest('.task-dock-menu-wrap')) setDockMenuOpen(false);
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
    if (isDockMenuOpen) setDockMenuOpen(false);
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
