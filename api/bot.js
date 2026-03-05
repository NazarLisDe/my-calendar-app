const { Telegraf } = require('telegraf');
const { createClient } = require('@supabase/supabase-js');

// Берем переменные окружения, которые вы настроили в Vercel
const { SUPABASE_URL, SUPABASE_ANON_KEY, TELEGRAM_BOT_TOKEN } = process.env;

// Проверка наличия ключей
if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !TELEGRAM_BOT_TOKEN) {
  throw new Error('SUPABASE_URL, SUPABASE_ANON_KEY and TELEGRAM_BOT_TOKEN are required');
}

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const bot = new Telegraf(TELEGRAM_BOT_TOKEN);

bot.start(async (ctx) => {
  await ctx.reply('Привет! Отправь мне текст задачи, и я сохраню его в Supabase.');
});

bot.on('text', async (ctx) => {
  const text = ctx.message.text.trim();

  if (!text) {
    await ctx.reply('Текст задачи пустой.');
    return;
  }

  const { error } = await supabase.from('tasks').insert({
    text,
    is_completed: false
  });

  if (error) {
    await ctx.reply(`Не удалось сохранить задачу: ${error.message}`);
    return;
  }

  await ctx.reply(`✅ Задача сохранена: ${text}`);
});

// Экспортируем функцию для Vercel
module.exports = async (req, res) => {
  try {
    if (req.method === 'POST') {
      await bot.handleUpdate(req.body);
      res.status(200).send('OK');
    } else {
      res.status(200).send('Бот работает! Отправь POST запрос от Telegram.');
    }
  } catch (err) {
    console.error(err);
    res.status(500).send('Internal Server Error');
  }
};
