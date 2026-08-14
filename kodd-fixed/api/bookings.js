const crypto = require('crypto');
const { kv } = require('@vercel/kv');

/** Безопасное сравнение токена */
function isAuthorized(req) {
  const adminToken = process.env.ADMIN_TOKEN || '';
  if (!adminToken) return false;

  const authHeader = req.headers.authorization || '';
  if (!authHeader.startsWith('Bearer ')) return false;

  const token = authHeader.slice(7);
  if (token.length !== adminToken.length) return false;

  try {
    return crypto.timingSafeEqual(Buffer.from(token), Buffer.from(adminToken));
  } catch {
    return false;
  }
}

/** Загрузка всех записей из KV */
async function loadAllBookings() {
  const keys = await kv.keys('booking:*');
  const bookings = [];

  for (const key of keys) {
    const booking = await kv.get(key);
    if (booking) bookings.push(booking);
  }

  return bookings;
}

/** Сортировка по date + time */
function sortBookings(bookings) {
  return bookings.sort((a, b) => {
    const keyA = `${a.date}T${a.time || '00:00'}`;
    const keyB = `${b.date}T${b.time || '00:00'}`;
    return keyA.localeCompare(keyB);
  });
}

/** Фильтр по диапазону дат */
function filterByDateRange(bookings, from, to) {
  let result = bookings;

  if (from && /^\d{4}-\d{2}-\d{2}$/.test(from)) {
    result = result.filter((b) => b.date >= from);
  }

  if (to && /^\d{4}-\d{2}-\d{2}$/.test(to)) {
    result = result.filter((b) => b.date <= to);
  }

  return result;
}

module.exports = async (req, res) => {
  if (!isAuthorized(req)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  if (req.method === 'GET') {
    try {
      const params = req.query || {};
      let bookings = await loadAllBookings();
      bookings = filterByDateRange(bookings, params.from, params.to);
      bookings = sortBookings(bookings);

      return res.status(200).json({ bookings });
    } catch (err) {
      console.error('Bookings GET error:', err);
      return res.status(500).json({ error: 'Не удалось загрузить записи' });
    }
  }

  if (req.method === 'DELETE') {
    const id = req.query.id;
    if (!id) {
      return res.status(400).json({ error: 'Укажите id записи' });
    }

    try {
      const booking = await kv.get(`booking:${id}`);
      if (!booking) {
        return res.status(404).json({ error: 'Запись не найдена' });
      }

      booking.status = 'cancelled';
      await kv.set(`booking:${id}`, booking);

      return res.status(200).json({ ok: true, booking });
    } catch (err) {
      console.error('Bookings DELETE error:', err);
      return res.status(500).json({ error: 'Не удалось отменить запись' });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
};
