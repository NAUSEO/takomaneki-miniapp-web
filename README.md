# takomaneki-miniapp-web — интерфейс мини-приложения

Только внешний вид (index.html, style.css, app.js). Данные берутся с сервера на Render (репозиторий `takomaneki-miniapp`).
Лежит на GitHub Pages: бесплатно и не засыпает, поэтому при открытии сразу видна заставка, а не экран Render.

1. В файле `config.js` впишите адрес сервиса Render: `window.API_BASE = "https://ваш-сервис.onrender.com";`
2. GitHub → Settings → Pages → Source: Deploy from a branch → `main` / `(root)` → Save.
3. Адрес будет вида `https://nauseo.github.io/takomaneki-miniapp-web/` — его вписать в BotFather (Main App / Menu Button).
4. На Render добавить переменную `ALLOWED_ORIGIN=https://nauseo.github.io` (без пути).
