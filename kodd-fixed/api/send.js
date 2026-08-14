const crypto = require('crypto');
const { kv } = require('@vercel/kv');

// In-memory rate limit: IP → { start, count }
const rateLimitMap = new Map();
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX = 5;

/** IP клиента из заголовков Vercel */
function getClientIp(req) {
  return (
    req.headers['x-real-ip'] ||
    req.headers['x-forwarded-for']?.split(',')[0].trim() ||
    'unknown'
  );
}

/** Простой rate limit по IP */
function isRateLimited(ip) {
  const now = Date.now();
  const entry = rateLimitMap.get(ip);

  if (!entry || now - entry.start > RATE_LIMIT_WINDOW_MS) {
    rateLimitMap.set(ip, { start: now, count: 1 });
    return false;
  }

  entry.count += 1;

  if (rateLimitMap.size > 500) {
    for (const [key, val] of rateLimitMap) {
      if (now - val.start > RATE_LIMIT_WINDOW_MS) rateLimitMap.delete(key);
    }
  }

  return entry.count > RATE_LIMIT_MAX;
}

/** Удаление HTML-тегов из имени */
function sanitizeName(name) {
  return name.replace(/<[^>]*>/g, '').trim();
}

/** Дата не раньше сегодня */
function isValidDate(dateStr) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return false;

  const date = new Date(`${dateStr}T00:00:00`);
  if (Number.isNaN(date.getTime())) return false;

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  return date >= today;
}

/** Формат времени HH:MM */
function isValidTime(timeStr) {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(timeStr);
}

/** Нормализация и проверка Telegram username */
function normalizeTelegram(raw) {
  let value = raw.trim();
  if (!value.startsWith('@')) value = `@${value}`;

  const username = value.slice(1);
  if (!/^[a-zA-Z0-9_]{5,32}$/.test(username)) return null;

  return value;
}

/** Форматирование даты для сообщения */
function formatDate(dateStr) {
  const date = new Date(`${dateStr}T00:00:00`);
  return date.toLocaleDateString('ru-RU', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

/** Проверка доступности слота времени */
async function checkSlotAvailability(date, time) {
  const keys = await kv.keys('booking:*');

  for (const key of keys) {
    const booking = await kv.get(key);
    if (
      booking &&
      booking.date === date &&
      booking.time === time &&
      booking.status !== 'cancelled'
    ) {
      return false;
    }
  }

  return true;
}

/** Текст уведомления */
function buildMessage({ service, date, time, name, telegram }) {
  return [
    '🚨 Новая запись на услугу!',
    '',
    `📌 Услуга: ${service}`,
    `📅 Дата и время: ${formatDate(date)}, ${time}`,
    `👤 Имя: ${name}`,
    `💬 Telegram: ${telegram}`,
  ].join('\n');
}

/** Серверная валидация всех полей */
function validatePayload(body) {
  const service = (body.service || '').trim();
  const date = (body.date || '').trim();
  const time = (body.time || '').trim();
  const name = sanitizeName(body.name || '');
  const telegramRaw = (body.telegram || '').trim();

  if (!service) return { error: 'Укажите услугу' };
  if (!date) return { error: 'Укажите дату' };
  if (!isValidDate(date)) return { error: 'Дата должна быть сегодня или позже' };
  if (!time) return { error: 'Укажите время' };
  if (!isValidTime(time)) return { error: 'Некорректный формат времени (HH:MM)' };
  if (!name) return { error: 'Укажите имя' };
  if (name.length > 100) return { error: 'Имя не должно превышать 100 символов' };

  const telegram = normalizeTelegram(telegramRaw);
  if (!telegram) {
    return {
      error: 'Некорректный Telegram: используйте @username (5–32 символа, буквы, цифры, _)',
    };
  }

  return { service, date, time, name, telegram };
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const body = req.body;

  // Honeypot: бот заполнил скрытое поле — тихий «успех»
  if ((body.website || '').trim()) {
    return res.status(200).json({ ok: true });
  }

  const clientIp = getClientIp(req);
  if (isRateLimited(clientIp)) {
    return res.status(429).json({ error: 'Слишком много запросов, попробуйте позже' });
  }

  const validated = validatePayload(body);
  if (validated.error) {
    return res.status(400).json({ error: validated.error });
  }

  // Проверка доступности слота времени
  try {
    const isAvailable = await checkSlotAvailability(validated.date, validated.time);
    if (!isAvailable) {
      return res.status(409).json({
        error: 'Это время уже занято. Пожалуйста, выберите другое время.',
      });
    }
  } catch (checkErr) {
    console.error('Slot availability check error:', checkErr);
    return res.status(500).json({ error: 'Ошибка проверки доступности времени' });
  }

  const botToken = process.env.BOT_TOKEN;
  const chatId = process.env.CHAT_ID;

  if (!botToken || !chatId) {
    console.error('Отсутствуют переменные окружения BOT_TOKEN или CHAT_ID');
    return res.status(500).json({ error: 'Ошибка конфигурации сервера' });
  }

  try {
    const response = await fetch(
      `https://api.telegram.org/bot${botToken}/sendMessage`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text: buildMessage(validated),
        }),
      }
    );

    const result = await response.json();

    if (!response.ok || !result.ok) {
      console.error('Telegram API error:', result.description || response.status);
      return res.status(502).json({
        error: 'Не удалось отправить уведомление в Telegram',
      });
    }

    try {
      const id = crypto.randomUUID();
      await kv.set(`booking:${id}`, {
        id,
        service: validated.service,
        date: validated.date,
        time: validated.time,
        name: validated.name,
        telegram: validated.telegram,
        createdAt: new Date().toISOString(),
        status: 'new',
      });
    } catch (kvErr) {
      console.error('Failed to save booking to KV:', kvErr);
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('Send function error:', err);
    return res.status(500).json({ error: 'Внутренняя ошибка сервера' });
  }
};
