import { Telegraf } from 'telegraf';
import { createClient } from '@supabase/supabase-js';

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
const FIXED_COLUMN_ID = '228d2d4f-415d-4fbc-b8a2-d1a201938bd9';
const FIXED_USER_ID = 1364822438n;
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

async function insertTask(rawText, target = 'notes') {
  const text = withTarget(rawText, target);
  return supabase
    .from('tasks')
    .insert({
      text,
      user_id: Number(FIXED_USER_ID),
      column_id: FIXED_COLUMN_ID,
      is_completed: false
    })
    .select()
    .single();
}

bot.command('password', async (ctx) => {
  const telegramId = ctx.from.id;
  const password = ctx.message.text.replace('/password', '').trim();

  if (!password) return ctx.reply('❌ Укажите пароль. Пример: /password 1234');

  const { error } = await supabase
    .from('users_auth')
    .upsert({ telegram_id: telegramId, password_hash: password }, { onConflict: 'telegram_id' });

  if (error) return ctx.reply('❌ Ошибка сохранения пароля.');
  return ctx.reply(`✅ Пароль установлен! ID: ${telegramId}\nИспользуйте его для входа на сайт.`);
});

bot.start(async (ctx) => {
  const { data: authData } = await supabase
    .from('users_auth')
    .select('telegram_id')
    .eq('telegram_id', ctx.from.id)
    .single();

  if (!authData) {
    return ctx.reply('Привет! 👋 Для начала работы установите пароль:\n/password ваш_пароль');
  }

  return ctx.reply('С возвращением! ✨\nИспользуйте /note, /day, /board или /help для списка всех команд.');
});

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
  const { data, error } = await supabase
    .from('tasks')
    .select('*')
    .eq('user_id', Number(FIXED_USER_ID))
    .order('created_at', { ascending: false })
    .limit(10);

  if (error || !data?.length) return ctx.reply('Записей нет.');

  const lines = data.map((task) => {
    const icon = detectTarget(task.text) === 'day' ? '📅' : detectTarget(task.text) === 'board' ? '🧩' : '📝';
    return `${icon} #${task.id} ${stripTargetMarker(task.text)}`;
  });

  return ctx.reply(`📋 Последние задачи:\n\n${lines.join('\n')}`);
});

bot.command('note', async (ctx) => {
  const text = ctx.message.text.replace(/^\/note\s*/i, '').trim();
  if (!text) return;

  const { data } = await insertTask(text, 'notes');
  if (data) return ctx.reply(`✅ Сохранено (#${data.id})`);
});

bot.command('day', async (ctx) => {
  const text = ctx.message.text.replace(/^\/day\s*/i, '').trim();
  if (!text) return;

  const { data } = await insertTask(text, 'day');
  if (data) return ctx.reply(`📅 План дня (#${data.id})`);
});

bot.command('board', async (ctx) => {
  const text = ctx.message.text.replace(/^\/board\s*/i, '').trim();
  if (!text) return;

  const { data } = await insertTask(text, 'board');
  if (data) return ctx.reply(`🧩 Доска (#${data.id})`);
});

bot.on('text', async (ctx) => {
  if (ctx.message.text.startsWith('/')) return;

  const { data } = await insertTask(ctx.message.text, 'notes');
  if (data) return ctx.reply(`✅ Сохранено (#${data.id})`);
});

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(200).send('Bot is running');
  }

  try {
    const update = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    await bot.handleUpdate(update);
    return res.status(200).send('OK');
  } catch (error) {
    console.error('[bot] webhook error', error);
    return res.status(500).send('Error');
  }
}
