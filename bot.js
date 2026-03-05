const { Telegraf } = require('telegraf');
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

if (!TELEGRAM_BOT_TOKEN) {
  throw new Error('TELEGRAM_BOT_TOKEN is required');
}

const bot = new Telegraf(TELEGRAM_BOT_TOKEN);
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

bot.start((ctx) => {
  ctx.reply('Привет! Отправь мне текст задачи, и я сохраню его в Supabase.');
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

// ВАЖНО: Этот блок заменяет bot.launch() для работы на Vercel
module.exports = async (req, res) => {
  try {
    if (req.method === 'POST') {
      await bot.handleUpdate(req.body);
      res.status(200).send('OK');
    } else {
      res.status(200).send('Бот активен (используйте POST запросы)');
    }
  } catch (err) {
    console.error(err);
    res.status(500).send('Internal Server Error');
  }
};
