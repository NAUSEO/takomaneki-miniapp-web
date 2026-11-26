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
    "/api/me": { access: sc === "pending" ? "pending" : "ok", channel: sc === "channel", name: "Тест" },
    "/api/badges": sc === "empty" ? { payments: false, delivery: false, notifications: false } : { payments: true, delivery: true, notifications: true },
    "/api/orders": { groups: groups, orders: orders },
    "/api/rate": { text: "Курс юаня: 12,5 ₽", rate_set: true },
    "/api/calc": { text: "250 ¥ ≈ 3 125 ₽" },
    "/api/profile": { name: "Тестовый клиент", photo: P[0], stats: { total: orders.length, china: 2, in_transit_rf: 2, on_hand_admin: 2 },
      spending: { deposit_amount: 1000, deposit_comment: "аванс", total_sum: 42000, positions_sum: 36000, delivery_sum: 4000, extra_sum: 2000, since: day(-200) } },
    "/api/profile/detail": { rows: [{ number: "№1001", title: "Фигурка", paid: 3200 }, { number: "№1003", title: "Альбом", paid: 2100 }] },
    "/api/payments": { payments: pays, channel: sc === "channel" },
    "/api/notifications": { items: notes },
    "/api/delivery": deliv,
    "/api/delivery/request": { ok: true }, "/api/delivery/defer": { ok: true }, "/api/delivery/ack": { ok: true }
  };
  var realFetch = window.fetch;
  window.fetch = function (url, opts) {
    var p = String(url).split("?")[0];
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
