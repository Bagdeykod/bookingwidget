const crypto = require('crypto');
const { getStore } = require('@netlify/blobs');

const STORE_NAME = 'bookings';

function jsonResponse(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

/** Безопасное сравнение токена (защита от timing-атак) */
function isAuthorized(event) {
  const adminToken = process.env.ADMIN_TOKEN || '';
  if (!adminToken) return false;

  const authHeader = event.headers.authorization || event.headers.Authorization || '';
  if (!authHeader.startsWith('Bearer ')) return false;

  const token = authHeader.slice(7);
  if (token.length !== adminToken.length) return false;

  try {
    return crypto.timingSafeEqual(Buffer.from(token), Buffer.from(adminToken));
  } catch {
    return false;
  }
}

/** Загрузка всех записей из store */
async function loadAllBookings() {
  const store = getStore(STORE_NAME);
  const { blobs } = await store.list();
  const bookings = [];

  for (const blob of blobs) {
    const booking = await store.get(blob.key, { type: 'json' });
    if (booking) bookings.push(booking);
  }

  return bookings;
}

/** Сортировка по date + time (ближайшие сверху) */
function sortBookings(bookings) {
  return bookings.sort((a, b) => {
    const keyA = `${a.date}T${a.time || '00:00'}`;
    const keyB = `${b.date}T${b.time || '00:00'}`;
    return keyA.localeCompare(keyB);
  });
}

/** Фильтр по диапазону дат ?from=&to= */
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

exports.handler = async (event) => {
  if (!isAuthorized(event)) {
    return jsonResponse(401, { error: 'Unauthorized' });
  }

  const store = getStore(STORE_NAME);

  if (event.httpMethod === 'GET') {
    try {
      const params = event.queryStringParameters || {};
      let bookings = await loadAllBookings();
      bookings = filterByDateRange(bookings, params.from, params.to);
      bookings = sortBookings(bookings);

      return jsonResponse(200, { bookings });
    } catch (err) {
      console.error('Bookings GET error:', err);
      return jsonResponse(500, { error: 'Не удалось загрузить записи' });
    }
  }

  if (event.httpMethod === 'DELETE') {
    const id = (event.queryStringParameters || {}).id;
    if (!id) {
      return jsonResponse(400, { error: 'Укажите id записи' });
    }

    try {
      const booking = await store.get(id, { type: 'json' });
      if (!booking) {
        return jsonResponse(404, { error: 'Запись не найдена' });
      }

      booking.status = 'cancelled';
      await store.setJSON(id, booking);

      return jsonResponse(200, { ok: true, booking });
    } catch (err) {
      console.error('Bookings DELETE error:', err);
      return jsonResponse(500, { error: 'Не удалось отменить запись' });
    }
  }

  return jsonResponse(405, { error: 'Method not allowed' });
};
