const { Telegraf } = require('telegraf');
const { createClient } = require('@supabase/supabase-js');

const {
  TELEGRAM_BOT_TOKEN,
  SUPABASE_URL,
  SUPABASE_ANON_KEY
} = process.env;

if (!TELEGRAM_BOT_TOKEN || !SUPABASE_URL || !SUPABASE_ANON_KEY) {
  throw new Error('Missing required environment variables: TELEGRAM_BOT_TOKEN, SUPABASE_URL, SUPABASE_ANON_KEY');
}

const bot = new Telegraf(TELEGRAM_BOT_TOKEN);
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const TARGET_MARKERS = {
  notes: '[NOTES]',
  day: '[DAY]',
  board: '[BOARD]'
};

function stripTargetMarker(text = '') {
  return text.replace(/^\[(?:NOTES|DAY|BOARD)\]\s*/i, '').trim();
}

function detectTarget(text = '') {
  if (/^\[DAY\]/i.test(text)) return 'day';
  if (/^\[BOARD\]/i.test(text)) return 'board';
  return 'notes';
}

function withTarget(text, target = 'notes') {
  const cleanText = stripTargetMarker(text);
  return `${TARGET_MARKERS[target] || TARGET_MARKERS.notes} ${cleanText}`.trim();
}

async function insertTask(rawText, target = 'notes') {
  const text = withTarget(rawText, target);
  return supabase
    .from('tasks')
    .insert({ text, is_completed: false })
    .select('id, text, created_at')
    .single();
}

async function updateTaskText(taskId, rawText) {
  const { data: currentTask, error: findError } = await supabase
    .from('tasks')
    .select('id, text')
    .eq('id', taskId)
    .single();

  if (findError) return { error: findError };

  const target = detectTarget(currentTask.text || '');
  const text = withTarget(rawText, target);

  return supabase
    .from('tasks')
    .update({ text })
    .eq('id', taskId)
    .select('id, text, created_at')
    .single();
}

async function moveTask(taskId, target) {
  const { data: currentTask, error: findError } = await supabase
    .from('tasks')
    .select('id, text')
    .eq('id', taskId)
    .single();

  if (findError) return { error: findError };

  const text = withTarget(currentTask.text || '', target);

  return supabase
    .from('tasks')
    .update({ text })
    .eq('id', taskId)
    .select('id, text, created_at')
    .single();
}

bot.start(async (ctx) => {
  await ctx.reply(
    [
      'Привет! Я сохраняю заметки в Supabase.',
      '',
      'Команды:',
      '/note <текст> — создать заметку Telegram',
      '/day <текст> — сразу в список задач дня',
      '/board <текст> — сразу на доску',
      '/edit <id> | <новый текст> — редактировать заметку',
      '/move <id> <notes|day|board> — перенести заметку',
      '/list — показать последние 10 заметок'
    ].join('\n')
  );
});


bot.command('help', async (ctx) => {
  await ctx.reply(
    [
      '🤖 *Справка по командам:*',
      '',
      '/start — запуск и краткое описание',
      '/help — показать это сообщение',
      '/list — последние 10 задач из базы',
      '',
      '📝 *Создание:*',
      'Просто отправьте текст — создастся обычная заметка.',
      '/day <текст> — задача в список дня 📅',
      '/board <текст> — задача на доску 🧩',
      '',
      '⚙️ *Управление:*',
      '/edit <id> | <текст> — изменить текст',
      '/move <id> <target> — перенести (notes, day, board)',
      '',
      '💡 *Подсказка:* Нажмите синюю кнопку «Open» слева, чтобы открыть календарь в браузере!'
    ].join('\n'),
    { parse_mode: 'Markdown' }
  );
});

bot.command('note', async (ctx) => {
  const rawText = ctx.message.text.replace(/^\/note\s*/i, '').trim();
  if (!rawText) {
    await ctx.reply('Использование: /note <текст заметки>');
    return;
  }

  const { data, error } = await insertTask(rawText, 'notes');
  if (error) {
    await ctx.reply(`Ошибка сохранения: ${error.message}`);
    return;
  }

  await ctx.reply(`✅ Сохранено (#${data.id}): ${stripTargetMarker(data.text)}`);
});

bot.command('day', async (ctx) => {
  const rawText = ctx.message.text.replace(/^\/day\s*/i, '').trim();
  if (!rawText) {
    await ctx.reply('Использование: /day <текст задачи>');
    return;
  }

  const { data, error } = await insertTask(rawText, 'day');
  if (error) {
    await ctx.reply(`Ошибка сохранения: ${error.message}`);
    return;
  }

  await ctx.reply(`📅 Перенесено в список дня (#${data.id}): ${stripTargetMarker(data.text)}`);
});

bot.command('board', async (ctx) => {
  const rawText = ctx.message.text.replace(/^\/board\s*/i, '').trim();
  if (!rawText) {
    await ctx.reply('Использование: /board <текст задачи>');
    return;
  }

  const { data, error } = await insertTask(rawText, 'board');
  if (error) {
    await ctx.reply(`Ошибка сохранения: ${error.message}`);
    return;
  }

  await ctx.reply(`🧩 Перенесено на доску (#${data.id}): ${stripTargetMarker(data.text)}`);
});

bot.command('edit', async (ctx) => {
  const payload = ctx.message.text.replace(/^\/edit\s*/i, '').trim();
  const [idPart, ...textParts] = payload.split('|');
  const taskId = Number((idPart || '').trim());
  const nextText = textParts.join('|').trim();

  if (!Number.isInteger(taskId) || taskId <= 0 || !nextText) {
    await ctx.reply('Использование: /edit <id> | <новый текст>');
    return;
  }

  const { data, error } = await updateTaskText(taskId, nextText);
  if (error) {
    await ctx.reply(`Ошибка редактирования: ${error.message}`);
    return;
  }

  await ctx.reply(`✏️ Обновлено (#${data.id}): ${stripTargetMarker(data.text)}`);
});

bot.command('move', async (ctx) => {
  const payload = ctx.message.text.replace(/^\/move\s*/i, '').trim();
  const [taskIdRaw, targetRaw] = payload.split(/\s+/);
  const taskId = Number(taskIdRaw);
  const target = (targetRaw || '').toLowerCase();

  if (!Number.isInteger(taskId) || taskId <= 0 || !['notes', 'day', 'board'].includes(target)) {
    await ctx.reply('Использование: /move <id> <notes|day|board>');
    return;
  }

  const { data, error } = await moveTask(taskId, target);
  if (error) {
    await ctx.reply(`Ошибка переноса: ${error.message}`);
    return;
  }

  const targetLabel = target === 'day' ? 'список дня' : target === 'board' ? 'доску' : 'заметки';
  await ctx.reply(`🔁 Задача #${data.id} перенесена в ${targetLabel}: ${stripTargetMarker(data.text)}`);
});

bot.command('list', async (ctx) => {
  const { data, error } = await supabase
    .from('tasks')
    .select('id, text, created_at, is_completed')
    .order('created_at', { ascending: false })
    .limit(10);

  if (error) {
    await ctx.reply(`Ошибка загрузки: ${error.message}`);
    return;
  }

  if (!data || data.length === 0) {
    await ctx.reply('Пока нет заметок.');
    return;
  }

  const lines = data.map((task) => {
    const target = detectTarget(task.text);
    const icon = target === 'day' ? '📅' : target === 'board' ? '🧩' : '📝';
    const status = task.is_completed ? '✅' : '⬜️';
    return `${status} ${icon} #${task.id} ${stripTargetMarker(task.text)}`;
  });

  await ctx.reply(lines.join('\n'));
});

bot.on('text', async (ctx) => {
  const text = ctx.message?.text?.trim();
  if (!text) {
    await ctx.reply('Текст заметки пустой.');
    return;
  }

  const { data, error } = await insertTask(text, 'notes');
  if (error) {
    await ctx.reply(`Ошибка сохранения: ${error.message}`);
    return;
  }

  await ctx.reply(
    `✅ Заметка сохранена (#${data.id}).\n` +
    'Для переноса используйте: /move <id> <notes|day|board>'
  );
});

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    res.status(405).send('Method Not Allowed');
    return;
  }

  try {
    const update = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;

    if (!update || typeof update !== 'object') {
      res.status(400).send('Invalid webhook payload');
      return;
    }

    await bot.handleUpdate(update);
    res.status(200).send('OK');
  } catch (error) {
    console.error('Telegram webhook error:', error);
    res.status(500).send('Internal Server Error');
  }
};
