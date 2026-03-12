const { Telegraf } = require('telegraf');
const { createClient } = require('@supabase/supabase-js');

const {
  TELEGRAM_BOT_TOKEN,
  SUPABASE_URL,
  SUPABASE_ANON_KEY
} = process.env;

const bot = new Telegraf(TELEGRAM_BOT_TOKEN);
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// --- 1. ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ (Логика меток) ---
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

// Функция вставки задачи
async function insertTask(rawText, target = 'notes', userId = null) {
  const text = withTarget(rawText, target);
  return supabase.from('tasks').insert({ 
    text, 
    is_completed: false, 
    user_id: userId 
  }).select().single();
}

// --- 2. АВТОРИЗАЦИЯ И ПАРОЛЬ ---
bot.command('password', async (ctx) => {
  const telegramId = ctx.from.id;
  const password = ctx.message.text.replace('/password', '').trim();
  
  if (!password) {
    return ctx.reply('❌ Укажите пароль после команды. Пример: /password 1234');
  }

  const { error } = await supabase
    .from('users_auth')
    .upsert({ telegram_id: telegramId, password_hash: password }, { onConflict: 'telegram_id' });

  if (error) return ctx.reply('❌ Ошибка сохранения пароля.');
  ctx.reply(`✅ Пароль успешно установлен!\n\nВаш ID: ${telegramId}\nИспользуйте его для входа на сайт.`);
});

bot.start(async (ctx) => {
  const { data: authData } = await supabase
    .from('users_auth')
    .select('telegram_id')
    .eq('telegram_id', ctx.from.id)
    .single();

  if (!authData) {
    return ctx.reply('Привет! 👋 Для начала работы установите пароль командой:\n/password ваш_пароль');
  }
  ctx.reply('С возвращением! ✨\n\nВы можете отправлять заметки прямо сюда или использовать команды:\n/note — в заметки\n/day — в план дня\n/board — на доску\n/list — последние 10 записей');
});

// --- 3. КОМАНДЫ ДЛЯ ЗАМЕТОК ---
bot.command('note', async (ctx) => {
  const text = ctx.message.text.replace(/^\/note\s*/i, '').trim();
  if (!text) return ctx.reply('Введите текст после /note');
  const { data, error } = await insertTask(text, 'notes', ctx.from.id);
  if (!error) ctx.reply(`✅ Сохранено в заметки (#${data.id})`);
});

bot.command('day', async (ctx) => {
  const text = ctx.message.text.replace(/^\/day\s*/i, '').trim();
  if (!text) return ctx.reply('Введите текст после /day');
  const { data, error } = await insertTask(text, 'day', ctx.from.id);
  if (!error) ctx.reply(`📅 Добавлено в план дня (#${data.id})`);
});

bot.command('board', async (ctx) => {
  const text = ctx.message.text.replace(/^\/board\s*/i, '').trim();
  if (!text) return ctx.reply('Введите текст после /board');
  const { data, error } = await insertTask(text, 'board', ctx.from.id);
  if (!error) ctx.reply(`🧩 Добавлено на доску (#${data.id})`);
});

bot.command('list', async (ctx) => {
  const { data, error } = await supabase
    .from('tasks')
    .select('*')
    .eq('user_id', ctx.from.id)
    .order('created_at', { ascending: false })
    .limit(10);

  if (error || !data || data.length === 0) return ctx.reply('Заметок пока нет.');
  
  const lines = data.map(t => {
    const target = detectTarget(t.text);
    const icon = target === 'day' ? '📅' : target === 'board' ? '🧩' : '📝';
    return `${icon} #${t.id} ${stripTargetMarker(t.text)}`;
  });
  ctx.reply(`📋 Последние записи:\n\n${lines.join('\n')}`);
});

// Обработка простого текста (без команд)
bot.on('text', async (ctx) => {
  if (ctx.message.text.startsWith('/')) return;
  const { data, error } = await insertTask(ctx.message.text, 'notes', ctx.from.id);
  if (!error) ctx.reply(`✅ Сохранено (#${data.id})`);
});

// --- 4. ЭКСПОРТ ДЛЯ VERCEL ---
module.exports = async (req, res) => {
  try {
    if (req.method !== 'POST') {
      return res.status(200).send('Бот работает! Отправьте POST запрос из Telegram.');
    }
    const update = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    await bot.handleUpdate(update);
    res.status(200).send('OK');
  } catch (err) {
    console.error('Ошибка Webhook:', err);
    res.status(500).send('Internal Error');
  }
};
