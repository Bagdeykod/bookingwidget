# Инструкция по деплою

## Подготовка к деплою

### 1. Установка Netlify CLI (если ещё не установлен)

```bash
npm install -g netlify-cli
```

### 2. Аутентификация в Netlify

```bash
netlify login
```

Откроется браузер для входа в аккаунт Netlify.

## Деплой проекта

### Первый деплой

```bash
# Инициализация проекта в Netlify
netlify init

# Или прямой деплой
netlify deploy --prod
```

При первом деплое выберите:
- **Create & configure a new site** (создать новый сайт)
- **Team**: выберите вашу команду/аккаунт
- **Site name**: укажите уникальное имя (например, `my-booking-widget`)
- **Publish directory**: `.` (текущая директория)

### Настройка переменных окружения

После создания сайта в Netlify настройте переменные окружения:

#### Через веб-интерфейс:
1. Откройте проект в панели Netlify
2. Перейдите в **Site settings** → **Environment variables**
3. Добавьте три переменные:

```
BOT_TOKEN=<ваш_токен_от_BotFather>
CHAT_ID=<ваш_chat_id>
ADMIN_TOKEN=<сгенерированный_токен>
```

#### Через CLI:

```bash
netlify env:set BOT_TOKEN "ваш_токен_от_BotFather"
netlify env:set CHAT_ID "ваш_chat_id"
netlify env:set ADMIN_TOKEN "сгенерированный_токен"
```

**Генерация ADMIN_TOKEN:**

Linux/macOS:
```bash
openssl rand -hex 32
```

Windows PowerShell:
```powershell
-join ((48..57) + (65..90) + (97..122) | Get-Random -Count 64 | % {[char]$_})
```

### Повторный деплой

После внесения изменений в код:

```bash
# Деплой в продакшен
netlify deploy --prod
```

Или используйте npm-скрипт:

```bash
npm run deploy
```

## Автоматический деплой через Git

### Подключение репозитория

1. Создайте репозиторий на GitHub
2. Запушьте код:

```bash
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/ваш-username/ваш-репо.git
git push -u origin main
```

3. В панели Netlify:
   - **Site settings** → **Build & deploy** → **Link repository**
   - Выберите GitHub и репозиторий
   - Netlify автоматически деплоит при каждом push в `main`

## Проверка деплоя

После успешного деплоя:

1. **Основной виджет**: `https://ваш-сайт.netlify.app/`
2. **Админ-панель**: `https://ваш-сайт.netlify.app/admin.html`

### Тестирование функций

Проверьте работу API:

```bash
# Отправка тестовой записи
curl -X POST https://ваш-сайт.netlify.app/api/send \
  -H "Content-Type: application/json" \
  -d '{
    "service": "Тест",
    "date": "2026-12-31",
    "time": "12:00",
    "name": "Тестовое имя",
    "telegram": "@test"
  }'

# Получение записей (требуется токен)
curl https://ваш-сайт.netlify.app/api/bookings \
  -H "Authorization: Bearer ваш_ADMIN_TOKEN"
```

## Мониторинг и логи

### Просмотр логов функций

```bash
netlify functions:log send
netlify functions:log bookings
```

### Через веб-интерфейс

**Functions** → выберите функцию → **Logs**

## Откат к предыдущей версии

```bash
# Список деплоев
netlify deploy:list

# Откат к конкретному деплою
netlify deploy:rollback --deploy-id <deploy-id>
```

## Устранение неполадок

### Функции не работают

1. Проверьте переменные окружения в Netlify
2. Проверьте логи функций
3. Убедитесь, что `netlify.toml` корректен

### Telegram-бот не отправляет сообщения

1. Проверьте `BOT_TOKEN` (получите у @BotFather)
2. Проверьте `CHAT_ID`:
   - Для личного чата: ваш user ID (узнайте через @userinfobot)
   - Для группы: добавьте бота в группу и получите chat ID
3. Убедитесь, что бот не заблокирован

### Netlify Blobs недоступен

Убедитесь, что:
- Включён **Netlify Blobs** в настройках сайта
- План Netlify поддерживает Blobs (доступно на всех планах)

## Полезные команды

```bash
# Локальная разработка
npm run dev

# Статус сайта
netlify status

# Открыть админ-панель Netlify
netlify open

# Просмотр переменных окружения
netlify env:list
```
