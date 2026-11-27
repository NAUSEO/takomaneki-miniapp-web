# Takomaneki Mini App (этап 1: шаблон без дизайна)

Render → New Web Service из репозитория `takomaneki-miniapp`.
Python: переменная PYTHON_VERSION=3.11.9 (или файл .python-version).
Build: `pip install -r requirements.txt`
Start: `gunicorn app:app --workers 1 --threads 4 --timeout 120`
Переменные: см. `.env.example` (DATABASE_URL, MINIAPP_BOT_TOKEN, SECRET_KEY, ADMIN_IDS, ALLOWED_ORIGIN). ALLOW_DEV оставьте 0.
ALLOWED_ORIGIN — адрес, где лежит интерфейс (GitHub Pages), только домен: `https://nauseo.github.io`.

Доступ: статус человека на панели «Заказчик» или «Администратор» — доступ открыт; «Архив» — закрыт; остальные — заявка.
Основной магазин / канал определяется полем «Канал» на панели (Пользователи).

Здесь только данные (`/api/*`, фото). Интерфейс и дизайн — в отдельном репозитории `takomaneki-miniapp-web` (GitHub Pages).
