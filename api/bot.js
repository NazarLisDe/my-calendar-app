const { Telegraf } = require('telegraf');
const { createClient } = require('@supabase/supabase-js');

const {
  TELEGRAM_BOT_TOKEN,
  SUPABASE_URL,
  SUPABASE_ANON_KEY
} = process.env;

if (!TELEGRAM_BOT_TOKEN || !SUPABASE_URL || !SUPABASE_ANON_KEY) {
  throw new Error('Missing environment variables');
}

const bot = new Telegraf(TELEGRAM_BOT_TOKEN);
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const PRIORITY_SPACE_NAME = 'Режим задач';

// --- 1. ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ---
const TARGET_MARKERS = { notes: '[NOTES]', day: '[DAY]', board: '[BOARD]' };

function stripTargetMarker(text = '') {
  return text.replace(/^\[(?:NOTES|DAY|BOARD)\]\s*/i, '').trim();
}

function detectTarget(text = '') {
  if (/^\[DAY\]/i.test(text)) return 'day';
  if (/^\[BOARD\]/i.test(text)) return 'board';
  return 'notes';
}

function withTarget(text, target = 'notes') {
  return `${TARGET_MARKERS[target] || TARGET_MARKERS.notes} ${stripTargetMarker(text)}`.trim();
}

function normalizeUserId(userId) {
  if (typeof userId === 'bigint') return userId.toString();
  if (typeof userId === 'number' && Number.isInteger(userId)) return String(userId);
  if (typeof userId === 'string' && /^\d+$/.test(userId.trim())) return userId.trim();
  throw new Error(`Invalid user_id (expected bigint-compatible value): ${userId}`);
}

async function resolveSpaceUuid(userId) {
  const normalizedUserId = normalizeUserId(userId);

  const { data: prioritySpace, error: priorityError } = await supabase
    .from('user_spaces')
    .select('id, name')
    .eq('user_id', normalizedUserId)
    .eq('name', PRIORITY_SPACE_NAME)
    .limit(1)
    .maybeSingle();

  if (priorityError) {
    console.error('[bot] Failed to fetch priority space UUID:', {
      user_id: normalizedUserId,
      error: priorityError.message
    });
    throw priorityError;
  }

  if (prioritySpace?.id) {
    console.log('[bot] Space UUID found (priority):', {
      user_id: normalizedUserId,
      space_id: prioritySpace.id,
      space_name: prioritySpace.name
    });
    return prioritySpace.id;
  }

  const { data: fallbackSpaces, error: fallbackError } = await supabase
    .from('user_spaces')
    .select('id, name')
    .eq('user_id', normalizedUserId)
    .limit(1);

  if (fallbackError) {
    console.error('[bot] Failed to fetch fallback space UUID:', {
      user_id: normalizedUserId,
      error: fallbackError.message
    });
    throw fallbackError;
  }

  const fallbackSpace = fallbackSpaces?.[0] ?? null;
  if (!fallbackSpace?.id) {
    console.warn('[bot] No space UUID found for user before insert:', {
      user_id: normalizedUserId
    });
    throw new Error(`No rows found in user_spaces for user_id=${normalizedUserId}`);
  }

  console.log('[bot] Space UUID found (fallback):', {
    user_id: normalizedUserId,
    space_id: fallbackSpace.id,
    space_name: fallbackSpace.name
  });

  return fallbackSpace.id;
}

async function insertTask(rawText, userId, target = 'notes') {
  const normalizedUserId = normalizeUserId(userId);
  const columnId = await resolveSpaceUuid(normalizedUserId);
  const text = withTarget(rawText, target);
  return supabase
    .from('tasks')
    .insert({ text, user_id: normalizedUserId, column_id: columnId, is_completed: false })
    .select()
    .single();
}

// --- 2. АВТОРИЗАЦИЯ (ТО, ЧЕГО НЕ ХВАТАЛО) ---
bot.command('password', async (ctx) => {
  const telegramId = ctx.from.id;
  const password = ctx.message.text.replace('/password', '').trim();
  
  if (!password) return ctx.reply('❌ Укажите пароль. Пример: /password 1234');

  const { error } = await supabase
    .from('users_auth')
    .upsert({ telegram_id: telegramId, password_hash: password }, { onConflict: 'telegram_id' });

  if (error) return ctx.reply('❌ Ошибка сохранения пароля.');
  ctx.reply(`✅ Пароль установлен! ID: ${telegramId}\nИспользуйте его для входа на сайт.`);
});

bot.start(async (ctx) => {
  const { data: authData } = await supabase
    .from('users_auth').select('telegram_id').eq('telegram_id', ctx.from.id).single();

  if (!authData) {
    return ctx.reply('Привет! 👋 Для начала работы установите пароль:\n/password ваш_пароль');
  }
  ctx.reply('С возвращением! ✨\nИспользуйте /note, /day, /board или /help для списка всех команд.');
});

// --- 3. УПРАВЛЕНИЕ ЗАДАЧАМИ ---
bot.command('help', async (ctx) => {
  await ctx.reply(
    '🤖 *Справка:*\n\n' +
    '/note — в заметки\n/day — в план дня\n/board — на доску\n' +
    '/edit <id> | <текст> — изменить\n' +
    '/move <id> <target> — перенести\n' +
    '/list — последние 10 записей',
    { parse_mode: 'Markdown' }
  );
});

bot.command('list', async (ctx) => {
  const normalizedUserId = normalizeUserId(ctx.from.id);
  const { data, error } = await supabase
    .from('tasks').select('*').eq('user_id', normalizedUserId)
    .order('created_at', { ascending: false }).limit(10);

  if (error || !data?.length) return ctx.reply('Записей нет.');
  const lines = data.map(t => {
    const icon = detectTarget(t.text) === 'day' ? '📅' : detectTarget(t.text) === 'board' ? '🧩' : '📝';
    return `${icon} #${t.id} ${stripTargetMarker(t.text)}`;
  });
  ctx.reply(`📋 Последние задачи:\n\n${lines.join('\n')}`);
});

// Обработка команд создания через функции (как в твоем коде)
bot.command('note', async (ctx) => {
  const text = ctx.message.text.replace(/^\/note\s*/i, '').trim();
  if (text) {
    const { data } = await insertTask(text, ctx.from.id, 'notes');
    if (data) ctx.reply(`✅ Сохранено (#${data.id})`);
  }
});

bot.command('day', async (ctx) => {
  const text = ctx.message.text.replace(/^\/day\s*/i, '').trim();
  if (text) {
    const { data } = await insertTask(text, ctx.from.id, 'day');
    if (data) ctx.reply(`📅 План дня (#${data.id})`);
  }
});

bot.command('board', async (ctx) => {
  const text = ctx.message.text.replace(/^\/board\s*/i, '').trim();
  if (text) {
    const { data } = await insertTask(text, ctx.from.id, 'board');
    if (data) ctx.reply(`🧩 Доска (#${data.id})`);
  }
});

// Обработка простого текста
bot.on('text', async (ctx) => {
  if (ctx.message.text.startsWith('/')) return;
  const { data } = await insertTask(ctx.message.text, ctx.from.id, 'notes');
  if (data) ctx.reply(`✅ Сохранено (#${data.id})`);
});

// --- 4. ЭКСПОРТ ДЛЯ VERCEL ---
module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(200).send('Bot is running');
  try {
    const update = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    await bot.handleUpdate(update);
    res.status(200).send('OK');
  } catch (err) {
    console.error(err);
    res.status(500).send('Error');
  }
};
