const { Telegraf } = require('telegraf');
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://mexvcooxruzxrntvhzmc.supabase.co';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'sb_publishable_tdIF-2iq8Dx-V5VJx_ATpg_LoeNqQAx';
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN || '8662569579:AAGMbNe6xkNdzpthh6FYgc2gesPiurB47LY';

if (!TELEGRAM_TOKEN) {
  throw new Error('TELEGRAM_TOKEN is required');
}

const bot = new Telegraf(TELEGRAM_TOKEN);
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

bot.launch();

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
