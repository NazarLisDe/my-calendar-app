const { Telegraf } = require('telegraf');
const { createClient } = require('@supabase/supabase-js');

const { SUPABASE_URL, SUPABASE_ANON_KEY, TELEGRAM_TOKEN } = process.env;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !TELEGRAM_TOKEN) {
  throw new Error('SUPABASE_URL, SUPABASE_ANON_KEY and TELEGRAM_TOKEN are required');
}

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const bot = new Telegraf(TELEGRAM_TOKEN);

bot.start(async (ctx) => {
  await ctx.reply('Привет! Отправь мне текст задачи, и я сохраню его в Supabase.');
});

bot.on('text', async (ctx) => {
  const text = ctx.message?.text?.trim();

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

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).send('Method Not Allowed');
  }

  try {
    const update = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    await bot.handleUpdate(update);
    return res.status(200).send('OK');
  } catch (error) {
    console.error('Webhook error:', error);
    return res.status(500).send('Internal Server Error');
  }
};
