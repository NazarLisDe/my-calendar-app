const { Telegraf } = require('telegraf');
const { createClient } = require('@supabase/supabase-js');

const {
  TELEGRAM_BOT_TOKEN,
  SUPABASE_URL,
  SUPABASE_ANON_KEY
} = process.env;

const bot = new Telegraf(TELEGRAM_BOT_TOKEN);
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// --- 1. ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ (Сохраняем логику меток) ---
const TARGET_MARKERS = { notes: '[NOTES]', day: '[DAY]', board: '[BOARD]' };
function stripTargetMarker(text = '') { return text.replace(/^\[(?:NOTES|DAY|BOARD)\]\s*/i, '').trim(); }
function detectTarget(text = '') {
  if (/^\[DAY\]/i.test(text)) return 'day';
  if (/^\[BOARD\]/i.test(text)) return 'board';
  return 'notes';
}
function withTarget(text, target = 'notes') {
  return `${TARGET_MARKERS[target] || TARGET_MARKERS.notes} ${stripTargetMarker(text)}`.trim();
}

// Универсальная функция вставки (из твоего прошлого кода)
async function insertTask(rawText, target = 'notes', userId = null) {
  const text = withTarget(rawText, target);
  return supabase.from('tasks').insert({ text, is_completed: false, user_id: userId }).select().single();
}

// --- 2. АВТОРИЗАЦИЯ И ПАРОЛЬ ---
bot.command('password', async (ctx) => {
  const telegramId = ctx.from.id;
  const password = ctx.message.text.replace('/password', '').trim();
  if (!password) return ctx.reply('Пожалуйста, укажите пароль. Пример: /password 1234');

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
  ctx.reply('С возвращением! ✨\nИспользуйте /note, /day, /board или просто пишите текст.');
});

// --- 3. ВСЕ ТВОИ КОМАНДЫ (Сохраняем функционал) ---

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
    .from('tasks').select('*').eq('user_id', ctx.from.id)
    .order('created_at', { ascending: false }).limit(10);

  if (error || !data.length) return ctx.reply('Заметок пока нет.');
  const lines = data.map(t => {
    const target = detectTarget(t.text);
    const icon = target === 'day' ? '📅' : target === '
