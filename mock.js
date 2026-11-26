/* Тестовый режим для дизайнера: открывается только по ?mock=1. В бою ничего не делает.
   Подменяет запросы к серверу выдуманными данными. Сценарии: &scenario=empty|ban|slow|error|channel|long */
(function () {
  "use strict";
  var qs = new URLSearchParams(location.search);
  if (!qs.get("mock")) return;
  var sc = qs.get("scenario") || "";
  window.API_BASE = "";                                   // фото и запросы остаются внутри страницы

  function ph(color, label) {                              // фото-заглушка (квадрат), без внешних файлов
    var svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 192 192"><rect width="192" height="192" fill="' + color +
      '"/><text x="96" y="108" font-size="40" text-anchor="middle" fill="#fff" font-family="sans-serif">' + label + '</text></svg>';
    return "data:image/svg+xml;utf8," + encodeURIComponent(svg);
  }
  var P = [ph("#d98c6f", "A1"), ph("#6f9fd9", "B2"), ph("#8cc07a", "C3"), ph("#b08cd9", "D4")];
  function day(n) { var d = new Date(Date.now() + n * 864e5); return d.toISOString().slice(0, 10); }
  var LONG = "Очень длинное название позиции из каталога с несколькими словами и Суперпредлинноеслововбезпробеловкоторое_должно_переноситься";
  function order(id, group, status, emoji, title, extra) {
    var o = { id: id, group: group, number: "№" + (1000 + id), title: sc === "long" ? LONG : title, status: status, emoji: emoji,
      photo: P[id % 4], added: day(-10 - id), items: "Описание позиции", source: "Taobao" };
    for (var k in extra || {}) o[k] = extra[k];
    return o;
  }
  var orders = sc === "empty" ? [] : [
    order(1, "china", "Выкуплен", "🛒", "Фигурка коллекционная", {}),
    order(2, "china", "Едет на склад", "🚚", "Постер A3", {}),
    order(3, "transit", "В пути в РФ", "✈️", "Альбом с карточками", { package: { id: 7, name: "Посылка №7", ship_date: day(-6) } }),
    order(4, "transit", "В пути в РФ", "✈️", "Брелок", { package: { id: 7, name: "Посылка №7", ship_date: day(-6) } }),
    order(5, "onhand", "На руках у админа", "📦", "Набор значков", { delivery_deadline: day(20) }),
    order(6, "preorder", "Предзаказ", "📅", "Лимитированный бокс", { preorder_date: day(40) }),
    order(7, "other", "Мероприятие", "🎪", "Билет на фестиваль", { event_name: "Фестиваль", event_date: day(30), event_state: "Ждём" }),
    order(8, "onhand", "На руках у админа", "📦", "Плюшевая игрушка", { delivery_deadline: day(3) })
  ];
  var LBL = { china: "В Китае", transit: "В пути в РФ", onhand: "На руках админа", preorder: "Предзаказ", other: "Другое" };
  var groups = Object.keys(LBL).map(function (k) { return { key: k, label: LBL[k], count: orders.filter(function (o) { return o.group === k; }).length }; })
    .filter(function (g) { return g.count > 0 || sc === "empty"; });

  var onhand = orders.filter(function (o) { return o.group === "onhand"; });
  var deliv = {
    items: onhand.map(function (o) { return { number: o.number, title: o.title, photo: o.photo, ready_date: day(-2), storage_until: o.delivery_deadline, status: "Ожидает действия" }; }),
    waiting: onhand.length, can_request: true, can_defer: true, defer_used: false, packed_block: false,
    carriers: ["СДЭК", "Яндекс", "Самовывоз, Москва", "Другое"], pickup: "Самовывоз, Москва", pickup_address: "Москва, ул. Примерная, 1\nпн–пт 12:00–20:00", pack_notice: false, added_notice: false
  };
  if (sc === "ban") { deliv.block = { from: day(3), to: day(17), reason: "Новогодние праздники, посылки не отправляются" }; deliv.can_request = false; deliv.can_defer = false; }
  if (sc === "empty") { deliv.items = []; deliv.waiting = 0; }

  var pays = sc === "empty" ? [] : [
    { reason: "Оплата позиций", status: "Ожидает оплаты", deadline: day(4), total: 5400, paid: 0 },
    { reason: "Доставка №7", status: "Просрочен", deadline: day(-2), total: 900, paid: 0 },
    { reason: "Доп. платёж", status: "Частично оплачен", deadline: day(10), total: 1500, paid: 500 }
  ];
  var notes = sc === "empty" ? [] : [
    { created: day(0), text: "Ваша посылка №7 прибыла на склад.", unread: true },
    { created: day(-2), text: "Рассылка: в праздники доставка приостановлена.", unread: false, general: true }
  ];
  var routes = {
    "/healthz": {},
    "/api/me": { access: sc === "pending" ? "pending" : "ok", channel: sc === "channel", name: "Тест", is_admin: sc === "admin", admin_api: sc === "admin" ? "" : null },
    "/api/badges": sc === "empty" ? { payments: false, delivery: false, notifications: false } : { payments: true, delivery: true, notifications: true },
    "/api/orders": { groups: groups, orders: orders },
    "/api/rate": { text: "🖤 Текущий курс: 13.2 руб. Курс указан без учета комиссии.", rate_set: true },
    "/api/calc": { amount: 1452, text: "Ориентировочная стоимость: 1452." },
    "/api/profile": { name: "Тестовый клиент", photo: P[0], stats: { total: orders.length, china: 2, in_transit_rf: 2, on_hand_admin: 2 },
      spending: { deposit_amount: 1000, deposit_comment: "аванс", total_sum: 42000, positions_sum: 36000, delivery_sum: 4000, extra_sum: 2000, since: day(-200) } },
    "/api/profile/detail": { rows: [{ number: "№1001", title: "Фигурка", paid: 3200 }, { number: "№1003", title: "Альбом", paid: 2100 }] },
    "/api/payments": { payments: pays, channel: sc === "channel" },
    "/api/notifications": { items: notes },
    "/api/delivery": deliv,
    "/api/delivery/request": { ok: true }, "/api/delivery/defer": { ok: true }, "/api/delivery/ack": { ok: true }
  };
  // ---- админ-раздел (сценарий &scenario=admin): выдуманные ответы веб-панели ----
  var A = { main: "13.2", ch: "15.5", blocks: [{ id: 1, from: day(20), to: day(34), reason: "Новогодние праздники" }] };
  var AORD = [{ id: 11, number: "№1011", title: "Фигурка коллекционная", status: "Оформлен", client: "Анна", username: "anna", has_photo: false },
              { id: 12, number: "№1012", title: "Плюшевая игрушка", status: "На руках у админа", client: "Игорь", username: "igor", has_photo: true }];
  var STATUSES = ["Предзаказ", "Мероприятие", "Оформлен", "Выкуплен", "В пути на кит.склад", "На кит.складе", "Отправлен в РФ", "Получен в РФ", "На руках у админа", "Оформлена доставка по РФ", "Отправлена по РФ", "Отложено", "Просрок хранения"];
  function adminMock(path, body) {
    var p = path.split("?")[0], m;
    if (p === "/ma/meta") return { statuses: STATUSES, sources: ["Taobao", "Goofish", "Weidian", "Rednote", "Другое"], channels: [{ id: 1, name: "Цу", rate: Number(A.ch) }] };
    if (p === "/ma/rates") return { main: { rate: A.main, multiplier: 1.1 }, channels: [{ id: 1, name: "Цу", rate: A.ch }] };
    if (p === "/ma/rates/main") { A.main = String(body.rate).replace(",", "."); return { ok: true, rate: A.main, notified: 3 }; }
    if (p === "/ma/rates/channel") { A.ch = String(body.rate).replace(",", "."); return { ok: true, rate: A.ch, notified: 2 }; }
    if (p === "/ma/calc") {
      var price = Number(String(body.price).replace(",", ".")); if (!(price > 0)) return { __err: "Цена: введите число" };
      var clean = price * Number(A.main), total = Math.ceil(body.channel_id ? price * Number(A.ch) : clean * 1.1);
      return { total: total, clean: Math.round(clean * 100) / 100, commission: Math.round((total - clean) * 100) / 100 };
    }
    if (p === "/ma/orders") return { orders: AORD, more: false };
    if ((m = p.match(/^\/ma\/order\/(\d+)\/status$/))) { return { ok: true, old: "Оформлен", status: body.status }; }
    if ((m = p.match(/^\/ma\/order\/(\d+)\/photo$/))) return { ok: true };
    if ((m = p.match(/^\/ma\/order\/(\d+)$/))) { var o = AORD.filter(function (x) { return x.id == m[1]; })[0]; return Object.assign({ items: "", comment: "", source: "Taobao", deadline: o.status === "На руках у админа" ? day(12) : null }, o); }
    if (p === "/ma/users") return { users: [{ id: 5, name: "Анна", username: "anna", telegram_id: 1, nick: "", status: "Заказчик" }, { id: 6, name: "Игорь", username: "igor", telegram_id: 2, nick: "И.", status: "Заказчик" }] };
    if (p === "/ma/orders/new") return { ok: true, id: 99, number: "№1099" };
    if (p === "/ma/blocks") return { blocks: A.blocks };
    if (p === "/ma/blocks/new") { A.blocks.push({ id: 7, from: body.from, to: body.to, reason: body.reason }); return { ok: true, extended: 4, days: 14 }; }
    if (/^\/ma\/blocks\/\d+\/delete$/.test(p)) { A.blocks = []; return { ok: true }; }
    if (p === "/ma/deliveries") return { deliveries: [{ id: 1, client: "Анна", status: "Ждет данные", carrier: "СДЭК", via_app: true, insurance: 5000 }, { id: 2, client: "Игорь", status: "Упаковано", carrier: "Самовывоз, Москва", via_app: true, insurance: null }] };
    return null;
  }
  var realFetch = window.fetch;
  window.fetch = function (url, opts) {
    var p = String(url).split("?")[0];
    if (p.indexOf("/ma/") === 0) {
      var body = {}; try { body = opts && typeof opts.body === "string" ? JSON.parse(opts.body) : {}; } catch (e) {}
      var res = adminMock(String(url), body);
      if (/\/photo$/.test(p) && !(opts && opts.method === "POST")) return Promise.resolve(new Response('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10" fill="#6f9fd9"/></svg>', { headers: { "Content-Type": "image/svg+xml" } }));
      return new Promise(function (ok) { setTimeout(function () { ok(res && res.__err ? new Response(JSON.stringify({ error: res.__err }), { status: 400 }) : res ? new Response(JSON.stringify(res), { status: 200, headers: { "Content-Type": "application/json" } }) : new Response("{}", { status: 404 })); }, 200); });
    }
    if (!(p in routes)) return realFetch.apply(this, arguments);
    var delay = sc === "slow" ? 8000 : 250;
    return new Promise(function (res, rej) {
      setTimeout(function () {
        if (sc === "error" && p === "/api/me") return rej(new Error("offline"));
        res(new Response(JSON.stringify(routes[p]), { status: 200, headers: { "Content-Type": "application/json" } }));
      }, delay);
    });
  };
  try { localStorage.clear(); } catch (e) {}              // каждый раз «холодный» запуск
})();
