const DAYS = ['Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота', 'Воскресенье'];

const STORAGE_KEY = 'calendar-board-state-v2';

const defaultState = () => ({
  theme: 'light',
  nextTaskId: 1,
  nextCloudId: 1,
  nextGroupId: 1,
  days: Object.fromEntries(DAYS.map((d) => [d, []])),
  boards: {}
});

let state = loadState();
let history = [{ description: 'Начальное состояние', snapshot: structuredClone(state), ts: new Date().toISOString() }];
let currentHistoryIndex = 0;
let previewIndex = null;
let currentBoardTaskId = null;
let dragTask = null;
let dragCloud = null;
let selectedCloudIds = new Set();

function loadState() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return defaultState();
  try {
    return { ...defaultState(), ...JSON.parse(raw) };
  } catch {
    return defaultState();
  }
}

function persist() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function applyTheme() {
  document.body.classList.toggle('dark', state.theme === 'dark');
  document.getElementById('themeToggle').textContent = state.theme === 'dark' ? 'Светлая тема' : 'Тёмная тема';
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

function renderCalendar() {
  const s = effectiveState();
  const grid = document.getElementById('calendarGrid');
  grid.innerHTML = '';

  DAYS.forEach((day) => {
    const col = document.createElement('div');
    col.className = 'day-column';
    col.dataset.day = day;
    col.innerHTML = `
      <h3 class="day-header">${day}</h3>
      <form class="add-task">
        <input name="title" placeholder="Добавить задачу" required />
        <button>+</button>
      </form>
      <ul class="tasks"></ul>
    `;

    const form = col.querySelector('form');
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const title = form.title.value.trim();
      if (!title) return;
      commit(`Добавлена задача «${title}» в ${day}`, (st) => {
        st.days[day].push({ id: st.nextTaskId++, title, pinned: false, createdAt: Date.now() });
      });
    });

    col.addEventListener('dragover', (e) => e.preventDefault());
    col.addEventListener('drop', () => {
      if (!dragTask) return;
      const { fromDay, taskId } = dragTask;
      if (fromDay === day) return;
      commit(`Задача перенесена из ${fromDay} в ${day}`, (st) => {
        const idx = st.days[fromDay].findIndex((t) => t.id === taskId);
        if (idx < 0) return;
        const [task] = st.days[fromDay].splice(idx, 1);
        st.days[day].push(task);
      });
      dragTask = null;
    });

    const list = col.querySelector('.tasks');
    const tasks = [...s.days[day]].sort((a, b) => (a.pinned === b.pinned ? a.createdAt - b.createdAt : (a.pinned ? -1 : 1)));

    tasks.forEach((task) => {
      const tpl = document.getElementById('taskTemplate');
      const node = tpl.content.firstElementChild.cloneNode(true);
      if (task.pinned) node.classList.add('pinned');
      node.querySelector('.open-board').textContent = task.title;
      node.querySelector('.open-board').addEventListener('click', () => openBoard(task.id));
      node.querySelector('.delete').addEventListener('click', () => {
        commit(`Удалена задача «${task.title}»`, (st) => {
          st.days[day] = st.days[day].filter((t) => t.id !== task.id);
          delete st.boards[task.id];
        });
      });
      node.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        commit(`Переключено закрепление «${task.title}»`, (st) => {
          const t = st.days[day].find((x) => x.id === task.id);
          if (t) t.pinned = !t.pinned;
        });
      });
      node.addEventListener('dragstart', () => {
        dragTask = { fromDay: day, taskId: task.id };
      });
      list.append(node);
    });

    grid.append(col);
  });
}

function renderHistory() {
  const list = document.getElementById('historyList');
  list.innerHTML = '';

  history.forEach((entry, i) => {
    const li = document.createElement('li');
    if ((i === currentHistoryIndex && previewIndex === null) || i === previewIndex) li.classList.add('active');
    li.innerHTML = `<strong>${entry.description}</strong><br/><small>${new Date(entry.ts).toLocaleString('ru-RU')}</small>`;

    const actions = document.createElement('div');
    const previewBtn = document.createElement('button');
    previewBtn.textContent = 'Предпросмотр';
    previewBtn.onclick = () => {
      previewIndex = i;
      renderAll();
    };

    const rollbackBtn = document.createElement('button');
    rollbackBtn.textContent = 'Откат';
    rollbackBtn.onclick = () => {
      state = structuredClone(history[i].snapshot);
      history = history.slice(0, i + 1);
      currentHistoryIndex = i;
      previewIndex = null;
      persist();
      selectedCloudIds.clear();
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
    banner.textContent = `Предпросмотр: ${history[previewIndex].description}`;
    exit.classList.remove('hidden');
  } else {
    banner.classList.add('hidden');
    exit.classList.add('hidden');
  }
}

function getTaskById(taskId, s = state) {
  for (const day of DAYS) {
    const task = s.days[day].find((t) => t.id === taskId);
    if (task) return { task, day };
  }
  return null;
}

function ensureBoard(taskId, targetState = state) {
  if (!targetState.boards[taskId]) targetState.boards[taskId] = { zoom: 1, clouds: [] };
  return targetState.boards[taskId];
}

function openBoard(taskId) {
  currentBoardTaskId = taskId;
  selectedCloudIds.clear();
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
  const s = effectiveState();
  const taskInfo = getTaskById(taskId, s);
  if (!taskInfo) {
    location.hash = '';
    return;
  }

  document.getElementById('calendarView').classList.add('hidden');
  document.getElementById('boardView').classList.remove('hidden');
  document.getElementById('boardTitle').textContent = `Доска: ${taskInfo.task.title}`;

  const board = s.boards[taskId] || { zoom: 1, clouds: [] };
  const canvas = document.getElementById('boardCanvas');
  canvas.innerHTML = '';
  canvas.style.transform = `scale(${board.zoom})`;
  document.getElementById('zoomValue').textContent = `${Math.round(board.zoom * 100)}%`;

  board.clouds.forEach((cloud) => {
    const el = document.createElement('div');
    el.className = 'cloud';
    if (cloud.groupId) el.classList.add('grouped');
    if (selectedCloudIds.has(cloud.id)) el.classList.add('selected');
    el.dataset.id = cloud.id;
    el.style.left = `${cloud.x}px`;
    el.style.top = `${cloud.y}px`;
    el.innerHTML = `<textarea placeholder="Текст...">${cloud.text || ''}</textarea>`;

    el.querySelector('textarea').addEventListener('change', (e) => {
      commit('Изменен текст облака', (st) => {
        const b = ensureBoard(taskId, st);
        const c = b.clouds.find((x) => x.id === cloud.id);
        if (c) c.text = e.target.value;
      });
    });

    el.addEventListener('mousedown', (e) => {
      if (e.ctrlKey && e.button === 0) {
        e.preventDefault();
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
  const board = ensureBoard(currentBoardTaskId, state);
  const current = board.clouds.find((x) => x.id === dragCloud.id);
  if (!current) return;

  const dx = (e.clientX - dragCloud.startX) / board.zoom;
  const dy = (e.clientY - dragCloud.startY) / board.zoom;
  dragCloud.startX = e.clientX;
  dragCloud.startY = e.clientY;

  const targets = current.groupId ? board.clouds.filter((x) => x.groupId === current.groupId) : [current];
  targets.forEach((item) => {
    item.x += dx;
    item.y += dy;
  });
  persist();
  renderBoard();
});

document.addEventListener('mouseup', () => {
  if (dragCloud) {
    history.push({ description: 'Перемещение облака/группы', snapshot: structuredClone(state), ts: new Date().toISOString() });
    currentHistoryIndex = history.length - 1;
    renderHistory();
  }
  dragCloud = null;
});

function renderAll() {
  applyTheme();
  renderCalendar();
  renderHistory();
  renderBoard();
}

document.getElementById('themeToggle').addEventListener('click', () => {
  commit('Переключена тема', (st) => {
    st.theme = st.theme === 'dark' ? 'light' : 'dark';
  });
});

document.getElementById('clearUnpinned').addEventListener('click', () => {
  commit('Удалены все незакреплённые задачи', (st) => {
    DAYS.forEach((day) => {
      st.days[day] = st.days[day].filter((task) => task.pinned);
    });
  });
});

document.getElementById('exitPreview').addEventListener('click', () => {
  previewIndex = null;
  renderAll();
});

document.getElementById('backToCalendar').addEventListener('click', () => {
  location.hash = '';
  selectedCloudIds.clear();
  renderBoard();
});

document.getElementById('addCloud').addEventListener('click', () => {
  if (!currentBoardTaskId) return;
  commit('Добавлено текстовое облако', (st) => {
    const b = ensureBoard(currentBoardTaskId, st);
    b.clouds.push({ id: st.nextCloudId++, text: '', x: 50, y: 50, groupId: null });
  });
});

document.getElementById('groupClouds').addEventListener('click', () => {
  if (!currentBoardTaskId || selectedCloudIds.size < 2) return;
  const picks = [...selectedCloudIds];
  commit('Создана группа облаков', (st) => {
    const b = ensureBoard(currentBoardTaskId, st);
    const gid = st.nextGroupId++;
    b.clouds.forEach((cloud) => {
      if (picks.includes(cloud.id)) cloud.groupId = gid;
    });
  });
});

document.getElementById('ungroupClouds').addEventListener('click', () => {
  if (!currentBoardTaskId || selectedCloudIds.size === 0) return;
  const picks = [...selectedCloudIds];
  commit('Разгруппировка облаков', (st) => {
    const b = ensureBoard(currentBoardTaskId, st);
    b.clouds.forEach((cloud) => {
      if (picks.includes(cloud.id)) cloud.groupId = null;
    });
  });
});

document.getElementById('zoomIn').addEventListener('click', () => {
  if (!currentBoardTaskId) return;
  commit('Увеличен масштаб доски', (st) => {
    const b = ensureBoard(currentBoardTaskId, st);
    b.zoom = Math.min(2.5, b.zoom + 0.1);
  });
});

document.getElementById('zoomOut').addEventListener('click', () => {
  if (!currentBoardTaskId) return;
  commit('Уменьшен масштаб доски', (st) => {
    const b = ensureBoard(currentBoardTaskId, st);
    b.zoom = Math.max(0.4, b.zoom - 0.1);
  });
});

document.addEventListener('keydown', (e) => {
  if (!(e.ctrlKey && e.key.toLowerCase() === 'z')) return;
  e.preventDefault();
  if (currentHistoryIndex <= 0) return;
  currentHistoryIndex -= 1;
  state = structuredClone(history[currentHistoryIndex].snapshot);
  previewIndex = null;
  persist();
  renderAll();
});

window.addEventListener('hashchange', renderBoard);
renderAll();
