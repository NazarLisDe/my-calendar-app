const DAYS = ['Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота', 'Воскресенье'];

const STORAGE_KEY = 'calendar-board-state-v2';
const LEGACY_STORAGE_KEY = 'calendar-board-state-v1';

// ... (выше DAYS и т.д.)

// 1. Инициализация Supabase (убедитесь, что она выше!)
// const supabase = createClient(...) 

// 2. Получаем данные из Telegram, если открыли как Mini App
const tg = window.Telegram?.WebApp;
const telegramUser = tg?.initDataUnsafe?.user;

// 3. Пытаемся взять ID либо из Telegram, либо из памяти браузера
const AUTH_STORAGE_KEYS = ['tg_user_id', 'tg_id'];
const TELEGRAM_INBOX_COLUMN_ID = '228d2d4f-415d-4fbc-b8a2-d1a201938bd9';

function getStoredTelegramUserId() {
  for (const key of AUTH_STORAGE_KEYS) {
    const value = localStorage.getItem(key);
    if (value) return value;
  }
  return null;
}

function isUserAuthenticated() {
  return Boolean(currentUserId || telegramUser?.id || getStoredTelegramUserId());
}

let currentUserId = telegramUser?.id || getStoredTelegramUserId();
let authResolution = null;

// Константы Supabase (должны быть перед checkAuth)
const SUPABASE_URL = window.CALENDAR_CONFIG?.SUPABASE_URL || window.SUPABASE_URL;
const SUPABASE_ANON_KEY = window.CALENDAR_CONFIG?.SUPABASE_ANON_KEY || window.SUPABASE_ANON_KEY;

// 4. Функция самой проверки
async function checkAuth() {
    if (currentUserId) return currentUserId;
    return showLoginModal();
}

// Функция показа модального окна входа
function showLoginModal() {
    if (authResolution?.promise) return authResolution.promise;

    const overlay = document.getElementById('login-overlay');
    authResolution = {};
    authResolution.promise = new Promise((resolve) => { authResolution.resolve = resolve; });
    const form = document.getElementById('loginForm');
    const errorElement = document.getElementById('loginError');
    const submitBtn = form.querySelector('button[type="submit"]');
    
    // Очищаем формь и ошибки
    form.reset();
    errorElement.textContent = '';
    errorElement.classList.add('hidden');
    
    // Показываем overlay
    overlay.classList.add('show');
    
    // Устанавливаем фокус на первое поле
    document.getElementById('telegramIdInput').focus();
    
    // Обработчик отправки формы
    const handleSubmit = async (e) => {
        e.preventDefault();
        
        const telegramId = document.getElementById('telegramIdInput').value.trim();
        const password = document.getElementById('passwordInput').value.trim();
        
        if (!telegramId || !password) {
            showLoginError('Пожалуйста, заполните все поля');
            return;
        }
        
        // Отключаем кнопку во время проверки
        submitBtn.disabled = true;
        submitBtn.textContent = 'Проверка...';
        
        try {
            // Проверяем учетные данные в Supabase
            const supabase = window.supabase && SUPABASE_URL && SUPABASE_ANON_KEY
                ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
                : null;
                
            if (!supabase) {
                showLoginError('Ошибка подключения к Supabase');
                return;
            }
            
            const { data, error } = await supabase
                .from('users_auth')
                .select('telegram_id')
                .eq('telegram_id', telegramId)
                .eq('password_hash', password)
                .single();
            
            if (error || !data) {
                showLoginError('Неверный Telegram ID или пароль');
                submitBtn.disabled = false;
                submitBtn.textContent = 'Войти';
                return;
            }
            
            // Успешный вход
            localStorage.setItem('tg_user_id', telegramId);
            localStorage.setItem('tg_id', telegramId);
            localStorage.setItem('is_auth', 'true');
            currentUserId = telegramId;
            
            // Скрываем модальное окно
            overlay.classList.remove('show');
            form.removeEventListener('submit', handleSubmit);
            submitBtn.textContent = 'Войти';
            submitBtn.disabled = false;
            
            if (authResolution?.resolve) authResolution.resolve(telegramId);
            authResolution = null;
            
        } catch (err) {
            console.error('Login error:', err);
            showLoginError('Ошибка при входе. Проверьте соединение с интернетом');
            submitBtn.disabled = false;
            submitBtn.textContent = 'Войти';
        }
    };
    
    // Функция показа ошибки
    function showLoginError(message) {
        errorElement.textContent = message;
        errorElement.classList.remove('hidden');
    }
    
    form.onsubmit = handleSubmit;
    
    // Настраиваем UI для смены пароля
    setupPasswordResetUI();

    return authResolution.promise;
}

// API эндпоинт для запроса смены пароля (заглушка - вставить реальный адрес)
const PASSWORD_RESET_API_URL = 'https://mexvcooxruzxrntvhzmc.supabase.co/functions/v1/request-password-reset';

// Функция запроса смены пароля
async function requestPasswordReset(tgId, newPassword, submitBtn) {
    return new Promise(async (resolve, reject) => {
        if (!tgId) {
            reject(new Error('tgId не указан'));
            return;
        }
        if (!newPassword) {
            reject(new Error('Новый пароль не указан'));
            return;
        }

        try {
            // Отправляем POST запрос на запрос сброса
            const response = await fetch(PASSWORD_RESET_API_URL, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    telegram_id: tgId,
                    new_password: newPassword
                })
            });

            const data = await response.json();

            if (!response.ok) {
                if (response.status === 404) {
                    reject(new Error('Telegram ID не найден в системе'));
                    return;
                }
                reject(new Error(data?.message || 'Ошибка при отправке запроса'));
                return;
            }

            // Сообщаем пользователю о начале ожидания
            if (submitBtn) {
                submitBtn.disabled = true;
                submitBtn.textContent = 'Ожидание подтверждения в TG...';
            }

            // Polling каждые 3 секунды по check=true
            const intervalId = setInterval(async () => {
                try {
                    const checkResponse = await fetch(`${PASSWORD_RESET_API_URL}?check=true&tgId=${encodeURIComponent(tgId)}`);
                    const checkData = await checkResponse.json();

                    if (checkData?.status === 'approved') {
                        clearInterval(intervalId);
                        resolve({ success: true, message: 'Доступ одобрен!' });
                    } else if (checkData?.status === 'denied') {
                        clearInterval(intervalId);
                        reject(new Error('В доступе отказано'));
                    } else {
                        // pending / неизвестно -> ждём дальше
                        console.info('В ожидании ответа админа', tgId, checkData?.status);
                    }
                } catch (error) {
                    console.error('Polling error:', error);
                }
            }, 3000);

            // Таймаут через 2 минуты
            const timeoutId = setTimeout(() => {
                clearInterval(intervalId);
                reject(new Error('Время ожидания истекло. Попробуйте еще раз.'));
            }, 120000);

            // Очистка, если resolve/reject произойдёт раньше
            const cleanup = () => {
                clearInterval(intervalId);
                clearTimeout(timeoutId);
            };

            const oldResolve = resolve;
            const oldReject = reject;

            resolve = (value) => { cleanup(); oldResolve(value); };
            reject = (err) => { cleanup(); oldReject(err); };

        } catch (error) {
            console.error('Password reset request error:', error);
            reject(new Error(error.message || 'Не удалось отправить запрос. Проверьте соединение с интернетом'));
        }
    });
}

// Настройка UI для переключения между формами входа и смены пароля
function setupPasswordResetUI() {
    const toPasswordResetBtn = document.getElementById('toPasswordResetBtn');
    const backToLoginBtn = document.getElementById('backToLoginBtn');
    const loginSection = document.getElementById('loginSection');
    const passwordResetSection = document.getElementById('passwordResetSection');
    const resetTelegramIdInput = document.getElementById('resetTelegramIdInput');
    const resetNewPasswordInput = document.getElementById('resetNewPasswordInput');
    const telegramIdInput = document.getElementById('telegramIdInput');
    const passwordResetForm = document.getElementById('passwordResetForm');
    const resetSubmitBtn = document.getElementById('resetSubmitBtn');
    const resetError = document.getElementById('resetError');
    const resetSuccess = document.getElementById('resetSuccess');
    
    // Кнопка "Сменить пароль"
    toPasswordResetBtn.addEventListener('click', (e) => {
        e.preventDefault();
        loginSection.classList.add('hidden');
        passwordResetSection.classList.remove('hidden');
        
        // Если Telegram ID уже введен, подставляем его
        if (telegramIdInput.value) {
            resetTelegramIdInput.value = telegramIdInput.value;
        }
        resetTelegramIdInput.focus();
    });
    
    // Кнопка "Вернуться"
    backToLoginBtn.addEventListener('click', (e) => {
        e.preventDefault();
        passwordResetSection.classList.add('hidden');
        loginSection.classList.remove('hidden');
        
        // Очищаем ошибки и сообщения
        resetError.textContent = '';
        resetError.classList.add('hidden');
        resetSuccess.textContent = '';
        resetSuccess.classList.add('hidden');
        resetSubmitBtn.disabled = false;
        resetSubmitBtn.textContent = 'Отправить запрос в бот';
        
        telegramIdInput.focus();
    });
    
    // Обработчик формы смены пароля
    passwordResetForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const tgId = resetTelegramIdInput.value.trim();
        const newPassword = resetNewPasswordInput.value;
        
        if (!tgId) {
            resetError.textContent = 'Пожалуйста, введите ваш Telegram ID';
            resetError.classList.remove('hidden');
            resetSuccess.classList.add('hidden');
            return;
        }
        if (!newPassword) {
            resetError.textContent = 'Пожалуйста, введите новый пароль';
            resetError.classList.remove('hidden');
            resetSuccess.classList.add('hidden');
            return;
        }
        
        // Очищаем предыдущие сообщения
        resetError.classList.add('hidden');
        resetSuccess.classList.add('hidden');
        
        try {
            // Отправляем запрос
            const result = await requestPasswordReset(tgId, newPassword, resetSubmitBtn);
            
            if (result.success) {
                resetSuccess.textContent = result.message;
                resetSuccess.classList.remove('hidden');
                
                // Через 3 секунды закрываем модальное окно автоматически
                setTimeout(() => {
                    document.getElementById('login-overlay').classList.remove('show');
                }, 3000);
            } else {
                resetError.textContent = result.message;
                resetError.classList.remove('hidden');
            }
        } catch (error) {
            resetError.textContent = error.message;
            resetError.classList.remove('hidden');
        }
        
        resetSubmitBtn.disabled = false;
        resetSubmitBtn.textContent = 'Отправить запрос в бот';
    });
}


console.log('Active User ID:', currentUserId);

const TELEGRAM_TARGET = {
  notes: 'notes',
  day: 'day',
  board: 'board'
};

const TELEGRAM_REQUEST_TIMEOUT_MS = 12000;
const TELEGRAM_RETRY_COUNT = 1;
const USER_SETTINGS_TABLE = 'user_settings';
const USER_SPACES_TABLE = 'user_spaces';

function getSupabaseClient() {
  if (!window.supabase || !SUPABASE_URL || !SUPABASE_ANON_KEY) return null;

  return window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: {
      headers: {
        'x-user-id': String(currentUserId || ''),
        'x-tg-id': String(currentUserId || '')
      }
    }
  });
}

function stripTelegramTargetMarker(text = '') {
  return text.replace(/^\[(?:NOTES|DAY|BOARD)\]\s*/i, '').trim();
}

function detectTelegramTarget(text = '') {
  if (/^\[DAY\]/i.test(text)) return TELEGRAM_TARGET.day;
  if (/^\[BOARD\]/i.test(text)) return TELEGRAM_TARGET.board;
  return TELEGRAM_TARGET.notes;
}

function withTelegramTarget(text = '', target = TELEGRAM_TARGET.notes) {
  const clean = stripTelegramTargetMarker(text);
  const marker = target === TELEGRAM_TARGET.day
    ? '[DAY]'
    : target === TELEGRAM_TARGET.board
      ? '[BOARD]'
      : '[NOTES]';
  return `${marker} ${clean}`.trim();
}

function normalizeTelegramError(error, fallbackMessage) {
  const message = error?.message || String(error || fallbackMessage);
  if (/failed to fetch|networkerror|network request failed|load failed|abort/i.test(message)) {
    return new Error('Не удалось подключиться к Supabase. Проверьте интернет, CORS в Supabase и правильность SUPABASE_URL / SUPABASE_ANON_KEY.');
  }
  return new Error(message || fallbackMessage);
}

function escapeHtml(value = '') {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function getBoardTransferTargets() {
  const active = getActiveSpace(effectiveState());
  const targets = [];

  DAYS.forEach((day) => {
    active.days[day].forEach((task) => {
      targets.push({
        taskId: task.id,
        label: `${day}: ${task.title || 'Без названия'}`
      });
    });
  });

  active.dockTasks.forEach((task) => {
    targets.push({
      taskId: task.id,
      label: `Поле доски: ${task.title || 'Без названия'}`
    });
  });

  return targets;
}

async function runTelegramSupabaseRequest(buildRequest, fallbackMessage) {
  let lastError = null;

  for (let attempt = 0; attempt <= TELEGRAM_RETRY_COUNT; attempt += 1) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), TELEGRAM_REQUEST_TIMEOUT_MS);

    try {
      const { data, error } = await buildRequest(controller.signal);
      clearTimeout(timeoutId);

      if (error) {
        lastError = normalizeTelegramError(error, fallbackMessage);
        if (attempt < TELEGRAM_RETRY_COUNT) continue;
        return { data: null, error: lastError };
      }

      return { data, error: null };
    } catch (error) {
      clearTimeout(timeoutId);
      lastError = normalizeTelegramError(error, fallbackMessage);
      if (attempt < TELEGRAM_RETRY_COUNT) continue;
      return { data: null, error: lastError };
    }
  }

  return { data: null, error: lastError || new Error(fallbackMessage) };
}

async function updateTelegramTask(taskId, updates) {
  const supabaseClient = getSupabaseClient();
  if (!supabaseClient) return { error: new Error('Supabase не настроен в CALENDAR_CONFIG или window.') };

  return runTelegramSupabaseRequest(
    (signal) => supabaseClient
      .from('tasks')
      .update(updates)
      .eq('id', taskId)
      .abortSignal(signal),
    'Ошибка обновления задачи в Supabase.'
  );
}

async function deleteTelegramTask(taskId) {
  const supabaseClient = getSupabaseClient();
  if (!supabaseClient) return { error: new Error('Supabase не настроен в CALENDAR_CONFIG или window.') };

  return runTelegramSupabaseRequest(
    (signal) => supabaseClient
      .from('tasks')
      .delete()
      .eq('id', taskId)
      .abortSignal(signal),
    'Ошибка удаления задачи из Supabase.'
  );
}

async function loadCurrentSpacePreference() {
  const supabaseClient = getSupabaseClient();
  if (!supabaseClient || !currentUserId || !isUserAuthenticated()) return null;

  const { data, error } = await runTelegramSupabaseRequest(
    (signal) => supabaseClient
      .from(USER_SETTINGS_TABLE)
      .select('active_space_id')
      .eq('user_id', String(currentUserId))
      .maybeSingle()
      .abortSignal(signal),
    'Ошибка загрузки настроек пользователя.'
  );

  if (error) {
    console.warn('Не удалось загрузить active_space_id из Supabase:', error);
    return null;
  }

  const preferredSpace = data?.active_space_id;
  return typeof preferredSpace === 'string' && preferredSpace.trim() ? preferredSpace.trim() : null;
}

function findSpaceKeyByName(spaceName, st = state) {
  const expectedName = typeof spaceName === 'string' ? spaceName.trim().toLowerCase() : '';
  if (!expectedName) return null;

  const spaceEntries = Object.entries(st.spaceNames || {});
  const matched = spaceEntries.find(([, name]) => typeof name === 'string' && name.trim().toLowerCase() === expectedName);
  if (matched?.[0]) return matched[0];

  const fallbackEntry = Object.keys(st.spaces || {}).find((key) => key.trim().toLowerCase() === expectedName);
  return fallbackEntry || null;
}

function normalizeUserSpaceRecord(record) {
  if (!record || typeof record !== 'object') return null;

  const rawKey = record.id ?? record.space_id ?? record.space_key ?? record.slug ?? null;
  const key = typeof rawKey === 'string' && rawKey.trim() ? rawKey.trim() : null;
  if (!key) return null;

  const rawName = record.space_name ?? record.name ?? record.title ?? null;
  const name = typeof rawName === 'string' && rawName.trim()
    ? rawName.trim()
    : key;

  return { key, name };
}

function buildAvailableSpacesFromState(st = state) {
  return Object.keys(st.spaces || {}).map((key) => ({
    key,
    name: st.spaceNames?.[key] || key
  }));
}

function syncSpacesWithState(spaces, st = state) {
  const nextSpaces = Array.isArray(spaces) ? spaces.filter((space) => space?.key) : buildAvailableSpacesFromState(st);
  const nextKeys = new Set(nextSpaces.map(({ key }) => key));

  if (!st.spaceNames) st.spaceNames = {};

  Object.keys(st.spaces || {}).forEach((key) => {
    if (!nextKeys.has(key)) delete st.spaces[key];
  });

  Object.keys(st.spaceNames).forEach((key) => {
    if (!nextKeys.has(key)) delete st.spaceNames[key];
  });

  nextSpaces.forEach(({ key, name }) => {
    if (!st.spaces[key]) st.spaces[key] = createSpaceState();
    st.spaceNames[key] = name || key;
  });

  if (!(st.activeSpaceId in st.spaces)) {
    st.activeSpaceId = nextSpaces[0]?.key || null;
  }

  return nextSpaces;
}

let availableSpaces = [];

function resolveSpaceId(spaceKey) {
  const rawKey = typeof spaceKey === 'string' ? spaceKey.trim() : '';
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (rawKey && uuidPattern.test(rawKey)) return rawKey;
  return crypto.randomUUID();
}

async function loadUserSpaces() {
  const supabaseClient = getSupabaseClient();
  if (!supabaseClient || !currentUserId || !isUserAuthenticated()) {
    return buildAvailableSpacesFromState(state);
  }

  const { data, error } = await runTelegramSupabaseRequest(
    (signal) => supabaseClient
      .from(USER_SPACES_TABLE)
      .select('*')
      .eq('user_id', String(currentUserId))
      .abortSignal(signal),
    'Ошибка загрузки пространств пользователя.'
  );

  if (error) {
    console.warn('Не удалось загрузить список пространств из Supabase:', error);
    AUTH_STORAGE_KEYS.forEach((key) => localStorage.removeItem(key));
    localStorage.removeItem('is_auth');
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(LEGACY_STORAGE_KEY);
    currentUserId = null;
    state = defaultState();
    availableSpaces = [];
    syncLogoutButtonVisibility();
    await showLoginModal();
    return buildAvailableSpacesFromState(state);
  }

  const normalizedSpaces = Array.isArray(data)
    ? data.map(normalizeUserSpaceRecord).filter(Boolean)
    : [];

  return normalizedSpaces;
}

async function insertUserSpace(spaceKey, spaceName) {
  const supabaseClient = getSupabaseClient();
  if (!supabaseClient || !isUserAuthenticated()) return null;

  const newId = resolveSpaceId(spaceKey);
  const tg_id = currentUserId;

  if (tg_id == null) {
    alert('Ошибка: Вы не авторизованы. Пожалуйста, введите ID заново');
    return null;
  }

  const payload = {
    id: newId,
    user_id: String(tg_id),
    name: String(spaceName || spaceKey)
  };

  console.log('DEBUG: Твой TG_ID сейчас:', tg_id);
  console.log('DEBUG: Данные для отправки:', { id: newId, user_id: tg_id, name: spaceName });

  const { error } = await runTelegramSupabaseRequest(
    (signal) => supabaseClient
      .from(USER_SPACES_TABLE)
      .insert(payload)
      .abortSignal(signal),
    'Ошибка сохранения пространства пользователя.'
  );

  if (error) {
    console.warn('Не удалось сохранить пространство в Supabase:', error);
    alert(`Не удалось сохранить пространство: ${error.message || 'Неизвестная ошибка сервера.'}`);
    return null;
  }

  return newId;
}

async function deleteUserSpaces(spaceKeys = []) {
  const supabaseClient = getSupabaseClient();
  const keys = Array.isArray(spaceKeys) ? spaceKeys.filter(Boolean) : [];
  if (!supabaseClient || !currentUserId || !isUserAuthenticated() || keys.length === 0) return true;

  const { error } = await runTelegramSupabaseRequest(
    (signal) => supabaseClient
      .from(USER_SPACES_TABLE)
      .delete()
      .eq('user_id', String(currentUserId))
      .in('id', keys.map(String))
      .abortSignal(signal),
    'Ошибка удаления пространства пользователя.'
  );

  if (error) {
    console.warn('Не удалось удалить пространство из Supabase:', error);
    return false;
  }

  return true;
}

async function persistCurrentSpacePreference(spaceId) {
  const supabaseClient = getSupabaseClient();
  if (!supabaseClient || !currentUserId || !isUserAuthenticated() || !spaceId) return;

  const { error } = await runTelegramSupabaseRequest(
    (signal) => supabaseClient
      .from(USER_SETTINGS_TABLE)
      .upsert(
        {
          user_id: String(currentUserId),
          active_space_id: String(spaceId)
        },
        { onConflict: 'user_id' }
      )
      .abortSignal(signal),
    'Ошибка сохранения настроек пользователя.'
  );

  if (error) {
    console.warn('Не удалось сохранить active_space_id в Supabase:', error);
  }
}

async function fetchTasks() {
  const list = document.getElementById('telegramTasksList');
  if (!list) return;

  if (!currentUserId || !isUserAuthenticated()) {
    list.innerHTML = '<li>Войдите, чтобы увидеть личные задачи из Telegram.</li>';
    return;
  }

  if (!window.supabase) {
    list.innerHTML = '<li>Supabase SDK не загружен.</li>';
    return;
  }

  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    list.innerHTML = '<li>Добавьте SUPABASE_URL и SUPABASE_ANON_KEY в window.CALENDAR_CONFIG.</li>';
    return;
  }

  list.innerHTML = '<li>Загрузка задач...</li>';

  const supabaseClient = getSupabaseClient();
  const { data, error } = await runTelegramSupabaseRequest(
    (signal) => supabaseClient
      .from('tasks')
      .select('*')
      .eq('column_id', TELEGRAM_INBOX_COLUMN_ID)
      .order('created_at', { ascending: false })
      .abortSignal(signal),
    'Ошибка загрузки задач из Supabase.'
  );

  if (error) {
    list.innerHTML = `<li>Ошибка загрузки: ${error.message}</li>`;
    return;
  }

  if (!data || data.length === 0) {
    list.innerHTML = '<li>Пока нет задач из Telegram.</li>';
    return;
  }

  list.innerHTML = '';

  data.forEach((task) => {
    const li = document.createElement('li');
    li.className = 'telegram-task-item';
    li.dataset.taskId = String(task.id);

    const text = stripTelegramTargetMarker(task.text || '');
    const target = detectTelegramTarget(task.text || '');
    const targetLabel = target === TELEGRAM_TARGET.day ? 'день' : target === TELEGRAM_TARGET.board ? 'доска' : 'заметки';
    const status = task.is_completed ? '✅' : '⬜️';

    li.innerHTML = `
      <div class="telegram-task-row">
        <span class="telegram-task-title">${status} ${escapeHtml(text)}</span>
        <small class="telegram-task-target">${targetLabel}</small>
      </div>
      <div class="telegram-task-actions">
        <button type="button" data-action="edit" class="telegram-task-edit">✏️</button>
        <button type="button" data-action="to-day">В день</button>
        <button type="button" data-action="delete">Удалить</button>
      </div>
      <div class="telegram-transfer-menu hidden" data-menu="day"></div>
      <div class="telegram-transfer-menu hidden" data-menu="board"></div>
    `;

    const dayMenu = li.querySelector('[data-menu="day"]');
    const boardMenu = li.querySelector('[data-menu="board"]');

    dayMenu.innerHTML = DAYS.map((day) => `<button type="button" data-day="${day}">${day}</button>`).join('');

    const closeMenus = () => {
      dayMenu.classList.add('hidden');
      boardMenu.classList.add('hidden');
    };

    li.addEventListener('click', async (event) => {
      const action = event.target?.dataset?.action;
      const day = event.target?.dataset?.day;
      const boardTaskIdRaw = event.target?.dataset?.boardTaskId;

      if (action === 'edit') {
        const titleSpan = li.querySelector('.telegram-task-title');
        const originalHTML = titleSpan.innerHTML;
        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'telegram-task-input';
        input.value = text;
        titleSpan.replaceWith(input);
        input.focus();
        input.select();

        let saved = false;

        const save = async () => {
          if (saved) return;
          saved = true;
          const newText = input.value.trim();
          if (!newText) {
            input.replaceWith(titleSpan);
            return;
          }
          const { error: updErr } = await updateTelegramTask(task.id, { text: withTelegramTarget(newText, target) });
          if (updErr) {
            alert(`Ошибка редактирования: ${updErr.message}`);
            input.replaceWith(titleSpan);
            return;
          }
          await fetchTasks();
        };

        const cancel = () => {
          if (saved) return;
          saved = true;
          input.replaceWith(titleSpan);
        };

        input.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            save();
          } else if (e.key === 'Escape') {
            e.preventDefault();
            cancel();
          }
        });

        input.addEventListener('blur', () => save());
        return;
      }

      if (action === 'delete') {
        if (!confirm('Удалить задачу из Telegram списка?')) return;
        const { error: delErr } = await deleteTelegramTask(task.id);
        if (delErr) {
          alert(`Ошибка удаления: ${delErr.message}`);
          return;
        }
        await fetchTasks();
        return;
      }

      if (action === 'to-day') {
        const shouldOpen = dayMenu.classList.contains('hidden');
        closeMenus();
        if (shouldOpen) dayMenu.classList.remove('hidden');
        return;
      }

      if (action === 'to-board') {
        const targets = getBoardTransferTargets();
        if (targets.length === 0) {
          alert('Нет доступных досок. Сначала создайте хотя бы одну задачу в календаре или в поле доски.');
          return;
        }

        boardMenu.innerHTML = targets
          .map((item) => `<button type="button" data-board-task-id="${item.taskId}">${escapeHtml(item.label)}</button>`)
          .join('');

        const shouldOpen = boardMenu.classList.contains('hidden');
        closeMenus();
        if (shouldOpen) boardMenu.classList.remove('hidden');
        return;
      }

      if (day) {
        closeMenus();

        commit(`Telegram-задача перенесена в день «${day}»`, (st) => {
          getActiveSpace(st).days[day].push({
            id: st.nextTaskId++,
            title: text,
            color: null,
            pinned: false,
            createdAt: Date.now(),
            taskGroupId: null
          });
        });

        const { error: mvErr } = await updateTelegramTask(task.id, { text: withTelegramTarget(text, TELEGRAM_TARGET.day) });
        if (mvErr) alert(`Задача добавлена в день, но не обновлён тип в Supabase: ${mvErr.message}`);
        await fetchTasks();
        return;
      }

      if (boardTaskIdRaw) {
        closeMenus();

        const boardTaskId = Number(boardTaskIdRaw);
        if (!Number.isInteger(boardTaskId)) {
          alert('Некорректная доска.');
          return;
        }

        commit('Telegram-задача перенесена на выбранную доску', (st) => {
          const board = ensureBoard(st, boardTaskId);
          board.clouds.push({
            id: st.nextCloudId++,
            text,
            x: 80,
            y: 80,
            width: 220,
            height: 140,
            groupId: null,
            createdAt: Date.now()
          });
        });

        currentBoardTaskId = boardTaskId;
        selectedCloudIds = new Set();
        renderBoard();

        const { error: mvErr } = await updateTelegramTask(task.id, { text: withTelegramTarget(text, TELEGRAM_TARGET.board) });
        if (mvErr) alert(`Задача добавлена на доску, но не обновлён тип в Supabase: ${mvErr.message}`);
        await fetchTasks();
      }
    });

    list.append(li);
  });
}


let tasksRealtimeChannel = null;

function unsubscribeFromTasksRealtime() {
  const supabaseClient = getSupabaseClient();

  if (tasksRealtimeChannel && supabaseClient) {
    supabaseClient.removeChannel(tasksRealtimeChannel);
  }

  tasksRealtimeChannel = null;
}

function subscribeToTasksRealtime() {
  unsubscribeFromTasksRealtime();

  const supabaseClient = getSupabaseClient();
  if (!supabaseClient || !currentUserId || !isUserAuthenticated()) return;

  tasksRealtimeChannel = supabaseClient
    .channel(`tasks-realtime-${String(currentUserId)}`)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'tasks',
        filter: `user_id=eq.${String(currentUserId)}`
      },
      async () => {
        await fetchTasks();
      }
    )
    .subscribe();
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
  activeSpaceId: null,
  nextTaskId: 1,
  nextCloudId: 1,
  nextGroupId: 1,
  nextTaskGroupId: 1,
  nextSideNoteId: 1,
  sideNotes: [],
  spaceNames: {},
  spaces: {}
});

let state = loadState();
availableSpaces = syncSpacesWithState(buildAvailableSpacesFromState(state), state);
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
      const mergedSideNotes = Array.isArray(parsed.sideNotes)
        ? parsed.sideNotes
        : Object.values(mergedSpaces).flatMap((space) => Array.isArray(space.sideNotes) ? space.sideNotes : []);

      return {
        ...base,
        ...parsed,
        sideNotes: mergedSideNotes,
        activeSpaceId: parsed.activeSpaceId ?? parsed.activeSpace ?? base.activeSpaceId,
        spaceNames: { ...base.spaceNames, ...(parsed.spaceNames || {}) },
        spaces: mergedSpaces
      };
    }

    return {
      ...base,
      ...parsed,
      sideNotes: Array.isArray(parsed.sideNotes) ? parsed.sideNotes : [],
      activeSpaceId: parsed.activeSpaceId ?? parsed.activeSpace ?? null,
      spaces: {}
    };
  } catch {
    return defaultState();
  }
}

function persist() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function getActiveSpace(st = effectiveState()) {
  const fallbackKey = Object.keys(st.spaces || {})[0] || null;
  const key = st.activeSpaceId in st.spaces ? st.activeSpaceId : fallbackKey;
  return (key && st.spaces[key]) || createSpaceState();
}

function getGlobalSideNotes(st = effectiveState()) {
  if (!Array.isArray(st.sideNotes)) st.sideNotes = [];
  return st.sideNotes;
}

function getSpaceLabel(key, st = effectiveState()) {
  const availableLabel = availableSpaces.find((space) => space.key === key)?.name;
  return availableLabel || st.spaceNames?.[key] || key;
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
  const previousActiveSpace = state.activeSpaceId;
  mutator(state);
  persist();
  if (previousActiveSpace !== state.activeSpaceId) {
    void persistCurrentSpacePreference(state.activeSpaceId);
    void fetchTasks();
  }
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

function syncLogoutButtonVisibility() {
  const logoutButton = document.getElementById('logout-btn');
  if (!logoutButton) return;
  logoutButton.classList.toggle('hidden', !isUserAuthenticated());
}

function handleLogout() {
  const confirmed = window.confirm('Вы уверены, что хотите выйти ?');
  if (!confirmed) return;

  AUTH_STORAGE_KEYS.forEach((key) => localStorage.removeItem(key));
  localStorage.removeItem('is_auth');
  localStorage.removeItem(STORAGE_KEY);
  localStorage.removeItem(LEGACY_STORAGE_KEY);
  location.reload();
}

function updateSpaceButton(spaceKey, st = effectiveState()) {
  const label = getSpaceLabel(spaceKey, st);
  document.getElementById('spaceMenuToggle').textContent = `Пространство: ${label}`;
  const current = document.getElementById('spaceMenuCurrentLabel');
  if (current) current.textContent = label;
  document.title = label ? `${label} — Календарь` : 'Календарь';
}

function renderSpaceOptions(st = effectiveState()) {
  const list = document.querySelector('#spaceMenu .space-list');
  if (!list) return;
  list.innerHTML = '';
  const spaceItems = Array.isArray(availableSpaces) && availableSpaces.length > 0
    ? availableSpaces
    : buildAvailableSpacesFromState(st);
  spaceItems.forEach(({ key, name }) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'space-option';
    btn.dataset.space = key;
    btn.setAttribute('role', 'menuitem');
    btn.textContent = name || getSpaceLabel(key, st);
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
  const source = raw && typeof raw === 'object' && raw.data && typeof raw.data === 'object' ? raw.data : raw;
  const base = createSpaceState();
  if (!source || typeof source !== 'object') return base;
  return {
    days: { ...base.days, ...(source.days || {}) },
    dayBackgrounds: { ...base.dayBackgrounds, ...(source.dayBackgrounds || {}) },
    dayNotes: { ...base.dayNotes, ...(source.dayNotes || {}) },
    boards: { ...base.boards, ...(source.boards || {}) },
    dockTasks: Array.isArray(source.dockTasks) ? source.dockTasks : [],
    taskGroups: Array.isArray(source.taskGroups) ? source.taskGroups : [],
    sideNotes: Array.isArray(source.sideNotes) ? source.sideNotes : []
  };
}

function extractImportedSpaces(payload) {
  if (!payload || typeof payload !== 'object') return [];

  const normalizeEntry = (entry, fallbackId = null) => {
    if (!entry || typeof entry !== 'object') return null;
    const importedIdCandidates = [entry.id, entry.spaceId, entry.spaceKey, entry.data?.id, entry.data?.spaceId, entry.data?.spaceKey, fallbackId];
    const key = importedIdCandidates.find((value) => typeof value === 'string' && value.trim())?.trim();
    if (!key) return null;

    const label = typeof entry.name === 'string' && entry.name.trim() ? entry.name.trim() : key;
    return {
      key,
      name: label,
      data: normalizeImportedSpaceData(entry)
    };
  };

  if (Array.isArray(payload.spaces)) {
    return payload.spaces.map((entry) => normalizeEntry(entry)).filter(Boolean);
  }

  if (payload.spaces && typeof payload.spaces === 'object') {
    return Object.entries(payload.spaces).map(([spaceId, entry]) => normalizeEntry(entry, spaceId)).filter(Boolean);
  }

  const singleEntry = normalizeEntry(payload);
  return singleEntry ? [singleEntry] : [];
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
  updateSpaceButton(s.activeSpaceId, s);
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

  const startSideNoteDrag = (note, e) => {
    dragSideNote = { noteId: note.id };
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', note.text || '');
    }
  };

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
    li.draggable = true;
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

    li.addEventListener('dragstart', (e) => {
      if (e.target.closest('textarea, .side-note-delete')) {
        e.preventDefault();
        return;
      }
      startSideNoteDrag(note, e);
    });
    li.addEventListener('dragend', () => {
      dragSideNote = null;
    });

    const dragBtn = li.querySelector('.side-note-drag');
    dragBtn.addEventListener('dragstart', (e) => {
      startSideNoteDrag(note, e);
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


function switchSpace(nextSpace) {
  if (!(nextSpace in state.spaces)) return;
  commit(`Переключено пространство на «${getSpaceLabel(nextSpace, state)}»`, (st) => {
    st.activeSpaceId = nextSpace;
  });
  void persistCurrentSpacePreference(nextSpace);
  setSpaceMenuOpen(false);
  clearSpaceSelection();
  setSpaceActionMenuOpen(false);
  clearTaskSelection();
  currentBoardTaskId = null;
}

const addSpaceForm = document.getElementById('addSpaceForm');
if (addSpaceForm) {
  addSpaceForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = addSpaceForm.spaceName.value.trim();
    if (!name) return;
    const key = await insertUserSpace(crypto.randomUUID(), name);
    if (!key) {
      return;
    }

    commit(`Добавлено пространство «${name}»`, (st) => {
      st.spaces[key] = createSpaceState();
      if (!st.spaceNames) st.spaceNames = {};
      st.spaceNames[key] = name;
      st.activeSpaceId = key;
    });
    availableSpaces = syncSpacesWithState([
      ...availableSpaces.filter((space) => space.key !== key),
      { key, name }
    ], state);
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

const logoutButton = document.getElementById('logout-btn');
if (logoutButton) {
  logoutButton.addEventListener('click', handleLogout);
}

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
      data: normalizeImportedSpaceData(getActiveSpace({ ...state, activeSpaceId: spaceActionTargetKey }))
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
      data: normalizeImportedSpaceData(getActiveSpace({ ...state, activeSpaceId: spaceActionTargetKey }))
    };
    downloadJson(`space-${spaceActionTargetKey}.json`, payload);
    setSpaceActionMenuOpen(false);
  });
}

if (spaceActionDelete) {
  spaceActionDelete.addEventListener('click', async () => {
    const targets = getSpaceActionSelection();
    if (targets.length === 0) {
      setSpaceActionMenuOpen(false);
      return;
    }

    const removedFromSupabase = await deleteUserSpaces(targets);
    if (!removedFromSupabase) {
      alert('Не удалось удалить пространство из Supabase.');
      return;
    }

    commit(targets.length > 1 ? `Удалено/очищено пространств: ${targets.length}` : (targets[0] === 'management' || targets[0] === 'notes') ? `Очищено пространство «${getSpaceLabel(targets[0], state)}»` : `Удалено пространство «${getSpaceLabel(targets[0], state)}»`, (st) => {
      if (!st.spaceNames) st.spaceNames = {};

      targets.forEach((target) => {
        if (!(target in st.spaces)) return;
        delete st.spaces[target];
        delete st.spaceNames[target];
      });

      if (Object.keys(st.spaces).length === 0) {
      }

      if (!(st.activeSpaceId in st.spaces)) {
        st.activeSpaceId = Object.keys(st.spaces)[0] || null;
      }

      currentBoardTaskId = null;
    });
    availableSpaces = syncSpacesWithState(
      availableSpaces.filter((space) => !targets.includes(space.key)),
      state
    );
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

    const importedSpaces = extractImportedSpaces(parsed);

    if (importedSpaces.length === 0) {
      alert('В файле не найдено ни одного пространства для импорта.');
      importSpaceInput.value = '';
      return;
    }

    const remappedImportedSpaces = importedSpaces.map((space) => ({
      ...space,
      key: resolveSpaceId(space.key)
    }));
    const duplicateSpace = remappedImportedSpaces.find(({ key }) => key in state.spaces);
    if (duplicateSpace) {
      alert(`Пространство с ID ${duplicateSpace.key} уже существует и не будет импортировано.`);
      importSpaceInput.value = '';
      return;
    }

    for (const importedSpace of remappedImportedSpaces) {
      const savedKey = await insertUserSpace(importedSpace.key, importedSpace.name);
      if (!savedKey) {
        importSpaceInput.value = '';
        return;
      }
      importedSpace.key = savedKey;
    }

    commit(
      remappedImportedSpaces.length > 1
        ? `Импортировано пространств: ${remappedImportedSpaces.length}`
        : `Импортировано пространство в «${remappedImportedSpaces[0].name}»`,
      (st) => {
        if (!st.spaceNames) st.spaceNames = {};
        remappedImportedSpaces.forEach(({ key, name, data }) => {
          st.spaceNames[key] = name;
          st.spaces[key] = data;
        });
      }
    );
    availableSpaces = syncSpacesWithState([
      ...availableSpaces.filter((space) => !remappedImportedSpaces.some((item) => item.key === space.key)),
      ...remappedImportedSpaces.map(({ key, name }) => ({ key, name }))
    ], state);
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
syncLogoutButtonVisibility();

async function ensureTelegramUserId() {
  currentUserId = telegramUser?.id || getStoredTelegramUserId() || null;
  if (currentUserId) {
    localStorage.setItem('tg_user_id', String(currentUserId));
    localStorage.setItem('tg_id', String(currentUserId));
    return currentUserId;
  }

  return checkAuth();
}

async function initializeApp() {
  const resolvedUserId = await ensureTelegramUserId();
  if (!resolvedUserId) {
    return;
  }

  availableSpaces = syncSpacesWithState(await loadUserSpaces(), state);
  const supabasePreferredSpace = await loadCurrentSpacePreference();
  const defaultTasksSpace = findSpaceKeyByName('Режим задач', state) || TELEGRAM_INBOX_COLUMN_ID;
  const initialSpace = supabasePreferredSpace && supabasePreferredSpace in state.spaces
    ? supabasePreferredSpace
    : defaultTasksSpace && defaultTasksSpace in state.spaces
      ? defaultTasksSpace
      : availableSpaces[0]?.key && availableSpaces[0].key in state.spaces
        ? availableSpaces[0].key
        : null;

  if (state.activeSpaceId !== initialSpace) {
    state.activeSpaceId = initialSpace;
    persist();
    history = [{ description: 'Старт', snapshot: structuredClone(state), ts: new Date().toISOString() }];
    currentHistoryIndex = 0;
    previewIndex = null;
  }

  renderAll();
  fetchTasks();
  subscribeToTasksRealtime();
}

initializeApp();
