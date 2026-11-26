"use strict";
const tg = window.Telegram && window.Telegram.WebApp;
if (tg) { tg.ready(); tg.expand(); }
const qs = new URLSearchParams(location.search);
const API = (window.API_BASE || "").replace(/\/$/, "");
const U = (u) => (u ? API + u : "");          // ссылка на фото: сервер отдаёт путь, мы добавляем адрес сервера
const $ = (id) => document.getElementById(id);
// будим сервер сразу при запуске, пока показывается заставка
try { fetch(API + "/healthz", { mode: "no-cors" }); } catch (e) {}
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const dkey = (v) => { const m = String(v == null ? "" : v).match(/\d{4}-\d{2}-\d{2}/); return m ? m[0] : ""; };
const fmtDate = (v) => { const k = dkey(v); return k ? k.split("-").reverse().join(".") : ""; };
const rub = (v) => `${Number(v || 0).toLocaleString("ru-RU")} ₽`;


const I = (p) => `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>`;
const ICON = {
  orders: I('<path d="M12 2.5l8.5 4.5v10L12 21.5 3.5 17V7z"/><path d="M3.5 7L12 11.5 20.5 7M12 11.5v10M7.8 4.8l8.5 4.6"/>'),
  rate: I('<circle cx="12" cy="12" r="9.5"/><path d="M8.5 6.5L12 11.5l3.5-5M8.5 12.5h7M8.5 15.5h7M12 11.5v7"/>'),
  payments: I('<path d="M4 6.5h13.5a2.5 2.5 0 0 1 2.5 2.5v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7.5a1 1 0 0 1 1-1z"/><path d="M4 6.5L15 3v3.5"/><path d="M15.5 11.5H20v5h-4.5a2.5 2.5 0 0 1 0-5z"/>'),
  delivery: I('<path d="M1.4 4.7h13v10.6H1.4zM14.4 8.3h4.7l3.5 3.5v3.5h-8.2"/><circle cx="6.1" cy="17.1" r="2.1"/><circle cx="17.9" cy="17.1" r="2.1"/>'),
  profile: I('<circle cx="12" cy="8" r="4.5"/><path d="M3.5 21.5c.8-5 4.3-8 8.5-8s7.7 3 8.5 8"/>'),
  bell: I('<path d="M6 16V11a6 6 0 0 1 12 0v5l2 2H4z"/><path d="M10 20a2 2 0 0 0 4 0"/>'),
  home: I('<path d="M4 11l8-7 8 7v9H4z"/><path d="M10 20v-5h4v5"/>'),
  back: I('<path d="M15 5l-7 7 7 7"/>'),
  list: I('<path d="M8 6h13M8 12h13M8 18h13"/><path d="M3 6h1M3 12h1M3 18h1"/>'),
  gridv: I('<rect x="3" y="3" width="7.5" height="7.5"/><rect x="13.5" y="3" width="7.5" height="7.5"/><rect x="3" y="13.5" width="7.5" height="7.5"/><rect x="13.5" y="13.5" width="7.5" height="7.5"/>'),
  box: I('<path d="M4 8l8-4 8 4v8l-8 4-8-4z"/><path d="M4 8l8 4 8-4M12 12v8"/>'),
  star: I('<path d="M12 3l2.6 5.6 6 .7-4.5 4.1 1.2 6L12 16.5 6.7 19.4l1.2-6L3.4 9.3l6-.7z"/>'),
  basket: I('<path d="M4 10h16l-2 10H6z"/><path d="M8 10l4-6 4 6"/>'),
};
// 13 статусов заказа (как в таблице админа): цвет плашки + свой значок, смысл не только цветом
// белые — оформление, светло-серые — Китай, чёрные — в дороге, жёлтые — дошло, полосатая — внимание
const TRUCK = '<path d="M1.4 4.7h13v10.6H1.4zM14.4 8.3h4.7l3.5 3.5v3.5h-8.2"/><circle cx="6.1" cy="17.1" r="2.1"/><circle cx="17.9" cy="17.1" r="2.1"/>';
const IS = (p) => I(p).replace('stroke-width="2"', 'stroke-width="2.1"');
const ST = {
  "Предзаказ": ["s-stone", IS('<rect x="4" y="4.5" width="16" height="17.5" rx="2"/><path d="M4 10.5h16M9 2v5M15 2v5"/>')],
  "Мероприятие": ["s-pink", IS('<path d="M12 2l3 6.5 7 .8-5.2 4.8 1.4 7L12 17.6 5.8 21.1l1.4-7L2 9.3l7-.8z"/>')],
  "Оформлен": ["s-rose", IS('<rect x="4.5" y="4" width="15" height="18" rx="1"/><path d="M8.5 4V2h7v2M8 13.5l3 3 5-6"/>')],
  "Выкуплен": ["s-olive", IS('<path d="M3 12.5l6 6L21 5.5"/>').replace('stroke-width="2.1"', 'stroke-width="2.8"')],
  "В пути на кит.склад": ["s-lime", IS(TRUCK)],
  "На кит.складе": ["s-pink", IS('<path d="M2.5 22V8.5L12 2.5l9.5 6V22"/><path d="M6.5 22v-9h11v9M6.5 17.5h11"/>')],
  "Отправлен в РФ": ["s-lime", IS('<path d="M2 11L22 2.5 16 22l-4.5-7.5z"/><path d="M11.5 14.5L22 2.5"/>')],
  "Получен в РФ": ["s-olive", IS('<path d="M3 13v8.5h18V13"/><path d="M12 2v13M7 10l5 5 5-5"/>')],
  "На руках у админа": ["s-dark", IS('<path d="M12 2.5l8.5 4.5v10L12 21.5 3.5 17V7z"/><path d="M3.5 7L12 11.5 20.5 7M12 11.5v10"/>')],
  "Оформлена доставка по РФ": ["s-rose", IS('<path d="M2.5 12.5V2.5h10l9.5 9.5-10 10z"/><circle cx="7.5" cy="7.5" r="1.8"/>')],
  "Отправлена по РФ": ["s-lime", IS('<path d="M5 4.7h10v10.6H5zM15 8.3h3.6l3.4 3.5v3.5h-7"/><circle cx="8.6" cy="17.4" r="2.1"/><circle cx="18.3" cy="17.4" r="2.1"/><path d="M1 8h2.5M1 11.5h2.5"/>')],
  "Отложено": ["s-stone", IS('<circle cx="12" cy="12" r="10"/><path d="M9.5 7.5v9M14.5 7.5v9"/>')],
  "Просрок хранения": ["s-warn", IS('<path d="M12 2L1.5 21h21z"/><path d="M12 9v6M12 18v.5"/>')],
  "Ожидает действия": ["s-olive", IS('<circle cx="12" cy="12" r="10"/><path d="M12 6.5V12l3.5 2.5"/>')],
};
ST["Едет на склад"] = ST["В пути на кит.склад"]; ST["В пути в РФ"] = ST["Отправлен в РФ"]; // старые названия из тестовых данных
const ST0 = I('<circle cx="12" cy="12" r="4"/>');
const chip = (st) => { const v = ST[st] || ["s-stone", ST0]; return `<span class="badge ${v[0]}">${v[1]}<span>${esc(st)}</span></span>`; };

function headers() {
  const h = { "Content-Type": "application/json" };
  if (tg && tg.initData) h["X-Init-Data"] = tg.initData;
  else if (qs.get("dev_user")) { h["X-Dev-User"] = qs.get("dev_user"); if (qs.get("dev_start")) h["X-Dev-Start"] = qs.get("dev_start"); }
  return h;
}
function toast(msg) { const t = $("toast"); t.textContent = msg; t.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => (t.hidden = true), 3500); }
function cacheGet(k) { try { return JSON.parse(localStorage.getItem("c:" + k)); } catch (e) { return null; } }
function cacheSet(k, v) { try { localStorage.setItem("c:" + k, JSON.stringify(v)); } catch (e) {} }

async function api(path, opts, cacheKey) {
  const slow = setTimeout(() => { toast("Сервер просыпается, подождите немного…"); const lt = $("loadtext"); if (lt) lt.textContent = "Сервер просыпается, подождите немного…"; }, 5000);
  try {
    const r = await fetch(API + path, Object.assign({ headers: headers() }, opts || {}));
    const data = await r.json().catch(() => ({}));
    if (!r.ok) { const e = new Error(data.error || r.status); e.status = r.status; e.data = data; throw e; }
    if (cacheKey) cacheSet(cacheKey, data);
    return data;
  } finally { clearTimeout(slow); }
}
// сначала показываем сохранённое, потом обновляем
async function load(path, cacheKey, render) {
  const cached = cacheGet(cacheKey); if (cached) render(cached, false); else $("screen").innerHTML = `<div class="spin small"></div>`;
  try { render(await api(path, null, cacheKey), true); }
  catch (e) { if (!cached) $("screen").innerHTML = `<p class="muted">Не удалось загрузить. Закройте и откройте заново.</p>`; }
}

/* ---------- навигация: стрелка «назад» + домик ---------- */
let ME = null, DATA = null, PRE_BREAKDOWN = false;
const stack = [];                       // [{view, arg, title}]
function go(view, arg, title) { stack.push({ view, arg, title }); render(); }
function back() { stack.pop(); render(); }
function home() { stack.length = 0; render(); }

function render() {
  const cur = stack[stack.length - 1];
  $("top").hidden = false;                       // шапка есть всегда: слева «назад» (кроме главной), справа колокольчик
  $("back").hidden = !cur;
  $("title").textContent = cur ? cur.title || "" : "";
  window.scrollTo(0, 0);
  if (!cur) return viewHome();
  ({ orders: viewOrders, group: viewGroup, rate: viewRate, payments: viewPayments, delivery: viewDelivery, notifications: viewNotifications, profile: viewProfile }[cur.view])(cur.arg);
}

function viewHome() {
  const tiles = [["orders", "Заказы"], ["rate", "Курс"]]; const CAP={orders:"SEC.01",rate:"SEC.02",payments:"SEC.03",delivery:"SEC.04",profile:"SEC.05"};
  tiles.push(["payments", "Оплаты"]);
  tiles.push(["delivery", "Доставка"]);
  tiles.push(["profile", "Профиль"]);
  $("screen").innerHTML = `<div class="banner" id="banner"></div><div class="tiles">${tiles.map(([k, t]) => `<button class="tile t-${k}" data-cap="${CAP[k]}" data-k="${k}" data-t="${t}"><span class="bar"><span class="tl">${t}</span><span class="x"></span></span><span class="ico">${ICON[k]}</span></button>`).join("")}</div>`;
  document.querySelectorAll(".tile").forEach((b) => (b.onclick = () => go(b.dataset.k, null, b.dataset.t)));
  setBadges(cacheGet("badges"));
  api("/api/badges", null, "badges").then(setBadges).catch(() => {});
}

// маркер «!» на плитках «Оплаты» и «Доставка»
function setBadges(b) {
  const bell = $("bell"); if (bell) { const on = !!(b && b.notifications), d = bell.querySelector(".dot"); if (on && !d) bell.insertAdjacentHTML("beforeend", `<span class="dot sm"></span>`); else if (!on && d) d.remove(); }
  document.querySelectorAll(".tile").forEach((t) => {
    const on = !!(b && b[t.dataset.k]), d = t.querySelector(".dot");
    if (on && !d) t.insertAdjacentHTML("beforeend", `<span class="dot">!</span>`);
    else if (!on && d) d.remove();
  });
}
function clearBadge(k) { const b = cacheGet("badges") || {}; b[k] = false; cacheSet("badges", b); }

/* ---------- заказы ---------- */
function orderCard(o) {
  const ph = o.photo ? `<img class="ph" loading="lazy" src="${U(o.photo)}" alt="">` : `<div class="ph empty">${ICON.orders}</div>`;
  const lines = [];
  if (!o.merged) {
    if (o.items) lines.push(`Описание: ${esc(o.items)}`);
    if (o.source) lines.push(`Источник: ${esc(o.source)}`);
  }
  lines.push(`Добавлен: ${fmtDate(o.added)}`);
  if (o.preorder_date) lines.push(`Предполагаемая дата рассылки: ${fmtDate(o.preorder_date)}`);
  if (o.ship_date) lines.push(`Дата отправки посылки: ${fmtDate(o.ship_date)}`);
  if (o.delivery_deadline) lines.push(`Дедлайн: ${fmtDate(o.delivery_deadline)}`);
  if (o.delay_until) lines.push(`Отложено до: ${fmtDate(o.delay_until)}`);
  if (o.delay_reason) lines.push(`Причина: ${esc(o.delay_reason)}`);
  if (o.event_name) lines.push(`Мероприятие: ${esc(o.event_name)}${o.event_date ? ", " + fmtDate(o.event_date) : ""}\nЭтап: ${esc(o.event_state)}`);
  const parts = o.merged ? `<div class="parts">${o.parts.map((p) => `<div class="card">${p.photo ? `<img class="ph" loading="lazy" src="${U(p.photo)}" alt="">` : `<div class="ph empty">${ICON.orders}</div>`}<div><div class="t">${esc(p.number)}</div><div class="m">${esc(p.title)}</div></div></div>`).join("")}</div>` : "";
  return `<div class="card win" onclick="const d=this.querySelector('.detail');d.hidden=!d.hidden"><div class="bar"><span>${esc(o.number)}</span><span class="x"></span></div><div class="body">${o.merged ? `<div class="ph empty">${ICON.basket}</div>` : ph}
    <div style="flex:1"><div class="t">${esc(o.title)}</div>
    <div>${chip(o.status)}</div>
    ${o.merged ? `<div class="cap">Нажмите, чтобы увидеть позиции (${o.parts.length})</div>` : ""}
    <div class="detail" hidden>${lines.join("\n")}${parts}</div></div></div></div>`;
}

const today = () => new Date().toISOString().slice(0, 10);
// ближайшие даты сверху (сначала будущие, затем прошедшие), без даты — в самом низу
function dateRank(d) { const s = dkey(d); if (!s) return [2, ""]; return [s >= today() ? 0 : 1, s]; }
function byDate(field) { return (a, b) => { const x = dateRank(a[field]), y = dateRank(b[field]); return x[0] - y[0] || (x[1] < y[1] ? -1 : x[1] > y[1] ? 1 : a.id - b.id); }; }

function viewOrders() {
  load("/api/orders", "orders", (d) => {
    DATA = d;
    $("screen").innerHTML = d.groups.map((g) => `<div class="row" data-g="${g.key}"><span class="l">${esc(g.label)}</span><b class="cnt">${g.count}</b></div>`).join("");
    document.querySelectorAll("[data-g]").forEach((el) => (el.onclick = () => openGroup(el.dataset.g)));
  });
}
function openGroup(key) {
  PRE_BREAKDOWN = false;
  const g = DATA.groups.find((x) => x.key === key);
  go("group", { key }, g.label);
}

// вид «плитка фото»: облачко с информацией рядом с фото, сами фото не сдвигаются
// на плитке: фото (или значок), уголок со значком статуса, у сборного — число позиций
function cellHtml(o, i) {
  const many = o.merged ? o.parts.length : o.parts ? o.parts.length : 0;
  const v = ST[o.status] || ["s-stone", ST0];
  return `<button class="cell${o.photo ? "" : " nophoto"}${many ? " multi" : ""}" data-i="${i}" aria-label="${esc(o.number)}, ${esc(o.status)}">${o.photo && !many ? `<img loading="lazy" src="${U(o.photo)}" alt="">` : `<span class="ico">${many ? ICON.basket : ICON.orders}</span>`}<span class="cst badge ${v[0]}">${v[1]}</span>${many ? `<span class="cn">×${many}</span>` : ""}</button>`;
}
function layHtml(list, card) {
  return `<div class="vsw" role="group" aria-label="Вид списка"><button class="btn" data-lay="list" aria-label="Списком">${ICON.list}</button><button class="btn" data-lay="grid" aria-label="Плиткой">${ICON.gridv}</button></div><div class="olist">${list.map(card).join("")}</div><div class="grid">${list.map(cellHtml).join("")}<div class="pop" hidden></div></div>`;
}
function bindGrid(list, cardFn) {
  const sc = $("screen"), g = sc.querySelector(".grid"), pop = g.querySelector(".pop");
  const setLay = (v) => { sc.classList.toggle("lay-grid", v === "grid"); sc.querySelectorAll("[data-lay]").forEach((b) => b.classList.toggle("primary", b.dataset.lay === v)); pop.hidden = true; };
  sc.querySelectorAll("[data-lay]").forEach((b) => (b.onclick = () => { cacheSet("lay", b.dataset.lay); setLay(b.dataset.lay); }));
  setLay(cacheGet("lay") || "list");
  const close = () => { pop.hidden = true; g.querySelectorAll(".cell.on").forEach((c) => c.classList.remove("on")); };
  g.querySelectorAll(".cell").forEach((c) => (c.onclick = (e) => {
    e.stopPropagation();
    const was = c.classList.contains("on"); close(); if (was) return;
    pop.innerHTML = cardFn(list[c.dataset.i]);
    const card = pop.querySelector(".card"), det = card.querySelector(".detail"); card.removeAttribute("onclick"); if (det) det.hidden = false;
    c.classList.add("on"); pop.hidden = false;
    const gw = g.clientWidth, pw = pop.offsetWidth, cx = c.offsetLeft + c.offsetWidth / 2;
    const l = Math.max(0, Math.min(gw - pw, cx - pw / 2));
    pop.style.left = l + "px"; pop.style.top = c.offsetTop + c.offsetHeight + 12 + "px"; pop.style.setProperty("--ax", cx - l + "px");
  }));
  pop.onclick = (e) => e.stopPropagation();
  if (!bindGrid.doc) { bindGrid.doc = true; document.addEventListener("click", () => { const p = document.querySelector("#screen .pop"); if (p && !p.hidden) { p.hidden = true; document.querySelectorAll("#screen .cell.on").forEach((c) => c.classList.remove("on")); } }); }
}

function viewGroup(arg) {
  const render1 = (d) => {
    DATA = d;
    const label = (d.groups.find((g) => g.key === arg.key) || {}).label || "";
    let list = d.orders.filter((o) => o.group === arg.key);
    if (arg.key === "preorder") {
      const all = list;
      const isDate = arg.date !== undefined;
      if (isDate) list = list.filter((o) => dkey(o.preorder_date) === arg.date);
      list.sort(byDate("preorder_date"));
      show(`${esc(arg.label || label)} — ${list.length}`, list);
      if (isDate) return;
      // «Разбивка по релизам»: вместо списка показываем только даты (ближайшие сверху, без даты внизу)
      const h = document.querySelector("#screen h3");
      h.insertAdjacentHTML("afterend", `<div class="tabs"><button class="btn" id="relbtn">Разбивка по релизам</button></div><div id="rel"></div>`);
      const paint = () => {
        const cards = document.querySelectorAll("#screen .card, #screen > p");
        cards.forEach((c) => (c.hidden = PRE_BREAKDOWN));
        $("relbtn").classList.toggle("primary", PRE_BREAKDOWN);
        const box = $("rel");
        if (!PRE_BREAKDOWN) { box.innerHTML = ""; return; }
        const dates = {}; all.forEach((o) => { const k = dkey(o.preorder_date); dates[k] = (dates[k] || 0) + 1; });
        const keys = Object.keys(dates).sort((a, b) => { const x = dateRank(a), y = dateRank(b); return x[0] - y[0] || (x[1] < y[1] ? -1 : 1); });
        box.innerHTML = keys.map((k) => `<div class="row sub" data-d="${k}"><span class="l">${k ? fmtDate(k) : "Дата не указана"}</span><b class="cnt">${dates[k]}</b></div>`).join("");
        box.querySelectorAll("[data-d]").forEach((r) => (r.onclick = () => go("group", { key: "preorder", date: r.dataset.d, label: r.dataset.d ? fmtDate(r.dataset.d) : "Дата не указана" }, "Предзаказ")));
      };
      $("relbtn").onclick = () => { PRE_BREAKDOWN = !PRE_BREAKDOWN; paint(); };
      paint();
      return;
    }
    if (arg.key === "transit" && arg.pkg === undefined) return viewBoxes(list);
    if (arg.key === "transit") list = list.filter((o) => String((o.package && o.package.id) || "") === arg.pkg);
    if (arg.key === "other" && arg.sub === undefined) return viewOther(list);
    if (arg.key === "other") list = list.filter((o) => subKey(o) === arg.sub);
    return show(`${esc(arg.label || label)} — ${list.length}`, list);
  };
  const show = (head, list) => {
    $("screen").innerHTML = `<h3>${head}</h3>` + (list.length ? `${layHtml(list, orderCard)}` : `<p class="muted">В этом разделе пока нет заказов.</p>`);
    if (list.length) bindGrid(list, orderCard);
  };
  const subKey = (o) => (o.status === "Мероприятие" ? `e:${o.event_name || ""}|${dkey(o.event_date)}` : "other");
  // «В пути в РФ»: сначала коробки (название + дата отправки), внутри — состав
  const viewBoxes = (list) => {
    const boxes = {};
    list.forEach((o) => { const p = o.package; const k = p ? String(p.id) : ""; (boxes[k] = boxes[k] || { key: k, name: p ? p.name : "Без посылки", date: p ? dkey(p.ship_date) : "", n: 0 }).n++; });
    const arr = Object.values(boxes).sort((a, b) => (a.date ? 0 : 1) - (b.date ? 0 : 1) || (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
    $("screen").innerHTML = arr.map((b) => `<div class="row" data-p="${esc(b.key)}" data-n="${esc(b.name)}"><span class="l"><span class="ri">${ICON.box}</span>${esc(b.name)}${b.date ? `<div class="cap">Отправка: ${fmtDate(b.date)}</div>` : ""}</span><b class="cnt">${b.n}</b></div>`).join("") || `<p class="muted">В этом разделе пока нет заказов.</p>`;
    document.querySelectorAll("[data-p]").forEach((r) => (r.onclick = () => go("group", { key: "transit", pkg: r.dataset.p, label: r.dataset.n }, r.dataset.n)));
  };
  const viewOther = (list) => {
    const subs = {};
    list.forEach((o) => { const k = subKey(o); (subs[k] = subs[k] || { key: k, list: [], event: o.status === "Мероприятие", name: o.event_name, date: o.event_date, id: o.id }).list.push(o); });
    const arr = Object.values(subs);
    const ev = arr.filter((s) => s.event).sort(byDate("date"));
    const other = arr.filter((s) => !s.event);
    const rows = [...ev, ...other].map((s) => {
      const name = s.event ? `${esc(s.name || "Мероприятие")}${s.date ? ", " + fmtDate(s.date) : ""}` : "Другое";
      return `<div class="row" data-s="${esc(s.key)}" data-n="${esc(name)}"><span class="l">${s.event ? `<span class="ri">${ICON.star}</span>` : ""}${name}</span><b class="cnt">${s.list.length}</b></div>`;
    }).join("");
    $("screen").innerHTML = rows || `<p class="muted">В этом разделе пока нет заказов.</p>`;
    document.querySelectorAll("[data-s]").forEach((r) => (r.onclick = () => go("group", { key: "other", sub: r.dataset.s, label: r.dataset.n }, r.dataset.n)));
  };
  if (DATA) render1(DATA); else load("/api/orders", "orders", render1);
}

/* ---------- курс ---------- */
function viewRate() {
  load("/api/rate", "rate", (data) => {
    $("screen").innerHTML = `<div class="card win"><div class="bar"><span>Курс</span><span class="x"></span></div><div class="body"><div class="big rate">${esc(data.text)}</div></div></div>` + (data.rate_set ? `
      <div class="card win"><div class="bar"><span>Расчёт стоимости</span><span class="x"></span></div><div class="body col"><div class="muted">Введите цену товара в юанях</div>
      <input id="price" inputmode="decimal" placeholder="Например, 250">
      <button class="btn primary" id="calc">Рассчитать</button><div class="big res" id="calcres"></div></div></div>` : "");
    if (!data.rate_set) return;
    $("calc").onclick = async () => {
      try { const r = await api("/api/calc", { method: "POST", body: JSON.stringify({ price: $("price").value }) }); $("calcres").textContent = r.text; }
      catch (e) { $("calcres").textContent = (e.data && e.data.error) || "Ошибка расчёта"; }
    };
  });
}

/* ---------- профиль ---------- */
function viewProfile() {
  load("/api/profile", "profile", (d) => {
    const s = d.stats, sp = d.spending;
    $("screen").innerHTML = `<div class="card win"><div class="bar"><span>Профиль</span><span class="x"></span></div><div class="body prof">${d.photo ? `<img class="ph ava" src="${U(d.photo)}" alt="">` : `<div class="ph ava empty">${ICON.profile}</div>`}
      <div class="pname">${esc(d.name || "Профиль")}</div></div>
      <div class="kv"><div><span>Текущих заказов</span><b>${s.total}</b></div>
      ${s.china ? `<div><span>В Китае</span><b>${s.china}</b></div>` : ""}${s.in_transit_rf ? `<div><span>В пути в РФ</span><b>${s.in_transit_rf}</b></div>` : ""}${s.on_hand_admin ? `<div><span>На руках админа</span><b>${s.on_hand_admin}</b></div>` : ""}</div></div>
      ${sp.deposit_amount ? `<div class="card win"><div class="bar"><span>Депозит</span><span class="x"></span></div><div class="body col"><div class="big">${rub(sp.deposit_amount)}</div>${sp.deposit_comment ? `<div class="m">${esc(sp.deposit_comment)}</div>` : ""}</div></div>` : ""}
      <div class="tabs"><button class="btn" id="spoiler">Спойлер: траты</button></div>
      <div id="spend" hidden><div class="card win"><div class="bar"><span>Траты</span><span class="x"></span></div><div class="kv"><div class="tot"><span>Общая сумма</span><b>${rub(sp.total_sum)}</b></div><div><span>Позиции</span><b>${rub(sp.positions_sum)}</b></div>
      <div><span>Доставки</span><b>${rub(sp.delivery_sum)}</b></div><div><span>Дополнительное</span><b>${rub(sp.extra_sum)}</b></div></div>
      ${sp.since ? `<div class="cap pad">Учёт ведётся с ${fmtDate(sp.since)}</div>` : ""}</div><div class="tabs"><button class="btn" id="detail">Детализация</button></div><div id="detailbox"></div></div>`;
    $("spoiler").onclick = () => ($("spend").hidden = !$("spend").hidden);
    $("detail").onclick = async () => {
      const r = await api("/api/profile/detail");
      $("detailbox").innerHTML = r.rows.length ? r.rows.map((x) => `<div class="row"><span class="l"><span class="num">${esc(x.number)}</span> ${esc(x.title)}</span><b class="amt">${rub(x.paid)}</b></div>`).join("") : `<p class="muted">Пока нет оплаченных позиций.</p>`;
    };
  });
}

/* ---------- оплаты ---------- */
function viewPayments() {
  load("/api/payments", "payments", (d) => {
    clearBadge("payments");
    if (!d.payments.length) { $("screen").innerHTML = `<p class="muted">Выставленных счетов нет.</p>`; return; }
    $("screen").innerHTML = d.payments.map((p) => `<div class="row pay"><div class="l"><div class="t">${esc(p.reason)}</div>
      <div class="m"><span class="badge ${({"Просрочен":"s-lime","Ожидает оплаты":"s-olive"})[p.status] || "s-stone"}"><span>${esc(p.status)}</span></span>${p.deadline ? ` <span class="due">до ${fmtDate(p.deadline)}</span>` : ""}</div></div><b class="amt">${rub(Number(p.total) - Number(p.paid || 0))}</b></div>`).join("") +
      (d.channel ? `<p class="muted">Для оплаты свяжитесь с администратором в личных сообщениях канала.</p>` : `<p class="muted">Оплата прямо в приложении появится на следующем этапе. Пока оплачивайте через финансового бота.</p>`);
  });
}

/* ---------- уведомления (колокольчик) ---------- */
function viewNotifications() {
  load("/api/notifications", "notifications", (d, fresh) => {
    if (fresh) { clearBadge("notifications"); const dot = $("bell").querySelector(".dot"); if (dot) dot.remove(); }
    if (!d.items.length) { $("screen").innerHTML = `<p class="muted">Уведомлений пока нет.</p>`; return; }
    $("screen").innerHTML = d.items.map((n) => `<div class="card note ${n.unread ? "unread" : ""}"><div style="flex:1">
      <div class="m">${esc(fmtDate(n.created))}${n.general ? " · общее" : ""}</div><div class="detail" style="margin-top:2px">${esc(n.text)}</div></div></div>`).join("");
  });
}

/* ---------- доставка ---------- */
function sheet(html) {
  const old = document.querySelector(".sheet"); if (old) old.remove();
  const el = document.createElement("div"); el.className = "sheet";
  el.innerHTML = `<div class="sheetbox">${html}</div>`;
  el.onclick = (e) => { if (e.target === el) el.remove(); };
  document.body.appendChild(el); return el;
}
function delivCard(i) {
  const ph = i.photo ? `<img class="ph" loading="lazy" src="${U(i.photo)}" alt="">` : `<div class="ph empty">${ICON.orders}</div>`;
  const lines = [];
  if (i.ready_date) lines.push(`Готов к доставке с ${fmtDate(i.ready_date)}`);
  if (i.storage_until) lines.push(`Хранение до ${fmtDate(i.storage_until)}`);
  const parts = i.parts ? `<div class="parts">${i.parts.map((p) => `<div class="card">${p.photo ? `<img class="ph" loading="lazy" src="${U(p.photo)}" alt="">` : `<div class="ph empty">${ICON.orders}</div>`}<div><div class="t">${esc(p.number)}</div><div class="m">${esc(p.title)}</div></div></div>`).join("")}</div>` : "";
  return `<div class="card win"><div class="bar"><span>${esc(i.number)}</span><span class="x"></span></div><div class="body">${i.parts ? `<div class="ph empty">${ICON.basket}</div>` : ph}<div style="flex:1">
    <div class="t">${esc(i.title)}</div>
    ${lines.map((l) => `<div class="m">${esc(l)}</div>`).join("")}
    <div>${chip(i.status)}</div>
    ${i.note ? `<div class="m">${esc(i.note)}</div>` : ""}${i.tag ? `<div class="cap">${esc(i.tag)}</div>` : ""}${parts}</div></div></div>`;
}
function viewDelivery() {
  load("/api/delivery", "delivery", (d, fresh) => {
    if (fresh && (d.pack_notice || d.added_notice)) noticeSheet(d);
    if (!d.items.length) { $("screen").innerHTML = `<p class="muted">Позиций для доставки пока нет.</p>`; return; }
    let top = "";
    if (d.block) top += `<div class="card warn" style="display:block"><b>Запись на доставку недоступна</b><div class="m">с ${fmtDate(d.block.from)} по ${fmtDate(d.block.to)}</div><div class="detail">Причина: ${esc(d.block.reason)}</div></div>`;
    if (d.waiting > 0) {
      top += `<div class="tabs"><button class="btn primary" id="dreq" ${d.can_request ? "" : "disabled"}>Запись на доставку</button>
        <button class="btn" id="ddef" ${d.can_defer ? "" : "disabled"}>Отложить</button></div>`;
      if (d.packed_block && !d.block) top += `<p class="muted">Текущая посылка уже упакована — новые позиции можно будет записать после её отправки.</p>`;
      else if (d.defer_used) top += `<p class="muted">Отсрочка уже использована.</p>`;
    }
    $("screen").innerHTML = top + layHtml(d.items, delivCard);
    bindGrid(d.items, delivCard);
    if ($("dreq")) $("dreq").onclick = () => requestSheet(d);
    if ($("ddef")) $("ddef").onclick = () => deferSheet();
  });
}
// плашки: «записаться пока нельзя» и «админ добавил позиции в посылку»; «Ознакомлен» гасит маркер «!»
function noticeSheet(d) {
  const text = [d.added_notice ? d.added_notice_text : "", d.pack_notice ? d.pack_notice_text : ""].filter(Boolean);
  const el = sheet(`<h3>Обратите внимание</h3>${text.map((t) => `<p>${esc(t)}</p>`).join("")}
    <div class="tabs"><button class="btn primary" id="ok">Ознакомлен</button></div>`);
  el.querySelector("#ok").onclick = async () => {
    el.remove(); clearBadge("delivery");
    if (d.pack_notice) { try { await api("/api/delivery/ack", { method: "POST", headers: headers(), body: "{}" }); } catch (e) {} }
  };
}
function afterAction(msg) {
  const el = document.querySelector(".sheet"); if (el) el.remove();
  try { localStorage.removeItem("c:delivery"); } catch (e) {}
  toast(msg); viewDelivery();
}
function requestSheet(d) {
  const el = sheet(`<h3>Запись на доставку</h3>
    <div class="muted">Служба доставки</div>
    ${d.carriers.map((c) => `<label class="opt"><input type="radio" name="carrier" value="${esc(c)}"> ${esc(c)}</label>`).join("")}
    <input id="cname" placeholder="Название службы доставки" maxlength="40" hidden>
    <div id="pickbox" class="card" style="display:block" hidden><b>${esc(d.pickup)}</b><div class="detail">${esc(d.pickup_address)}</div></div>
    <div id="insblock"><div class="muted" style="margin-top:12px">Страховка</div>
    <label class="opt"><input type="radio" name="ins" value="1"> Да</label>
    <label class="opt"><input type="radio" name="ins" value="0"> Нет</label></div>
    <div id="insbox" hidden><div class="muted">Укажите сумму страховки. Если хотите уточнить при оформлении, укажите 0</div>
    <input id="insamt" inputmode="numeric" placeholder="0"></div>
    <div class="tabs" style="margin-top:12px"><button class="btn primary" id="send">Отправить</button><button class="btn" id="cancel">Отмена</button></div>`);
  const val = (n) => { const r = el.querySelector(`input[name=${n}]:checked`); return r ? r.value : null; };
  el.querySelectorAll("input[name=carrier]").forEach((r) => (r.onchange = () => {
    const pick = val("carrier") === d.pickup;
    el.querySelector("#cname").hidden = val("carrier") !== "Другое";
    el.querySelector("#pickbox").hidden = !pick; el.querySelector("#insblock").hidden = pick;
    if (pick) el.querySelector("#insbox").hidden = true; else el.querySelector("#insbox").hidden = val("ins") !== "1";
  }));
  el.querySelectorAll("input[name=ins]").forEach((r) => (r.onchange = () => (el.querySelector("#insbox").hidden = val("ins") !== "1")));
  el.querySelector("#cancel").onclick = () => el.remove();
  const btn = el.querySelector("#send");
  btn.onclick = async () => {
    const carrier = val("carrier"), ins = val("ins");
    if (!carrier) return toast("Выберите службу доставки");
    if (carrier === "Другое" && !el.querySelector("#cname").value.trim()) return toast("Укажите название службы доставки");
    const pick = carrier === d.pickup;
    if (!pick && ins === null) return toast("Укажите, нужна ли страховка");
    btn.disabled = true;
    try {
      await api("/api/delivery/request", { method: "POST", headers: headers(), body: JSON.stringify({
        carrier, carrier_name: el.querySelector("#cname").value, insurance: pick ? false : ins === "1", insurance_amount: el.querySelector("#insamt").value || "0" }) });
      clearBadge("delivery");
      if (pick) { pickupDone(); } else afterAction("Ваша заявка на доставку отправлена");
    } catch (e) { btn.disabled = false; toast(e.message || "Не удалось отправить"); }
  };
}
function pickupDone() {
  const old = document.querySelector(".sheet"); if (old) old.remove();
  try { localStorage.removeItem("c:delivery"); } catch (e) {}
  const el = sheet(`<h3>Заявка отправлена</h3><p>Ждите, с вами свяжется администратор, либо можете самостоятельно связаться через личные сообщения.</p>
    <div class="tabs"><button class="btn primary" id="ok">Понятно</button></div>`);
  el.querySelector("#ok").onclick = () => { el.remove(); viewDelivery(); };
}
function deferSheet() {
  const el = sheet(`<h3>Отложить</h3>
    <label class="opt"><input type="radio" name="mode" value="2weeks"> На 2 недели</label>
    <label class="opt"><input type="radio" name="mode" value="next"> До приезда следующей посылки</label>
    <p class="muted" id="defnote">Выберите вариант.</p>
    <div class="tabs"><button class="btn primary" id="send">Отправить</button><button class="btn" id="cancel">Отмена</button></div>`);
  const val = () => { const r = el.querySelector("input[name=mode]:checked"); return r ? r.value : null; };
  el.querySelectorAll("input[name=mode]").forEach((r) => (r.onchange = () => {
    el.querySelector("#defnote").textContent = val() === "2weeks" ? "Отсрочка оформляется только один раз."
      : "Отсрочка оформляется только один раз. Отложить следующую посылку будет нельзя.";
  }));
  el.querySelector("#cancel").onclick = () => el.remove();
  const btn = el.querySelector("#send");
  btn.onclick = async () => {
    if (!val()) return toast("Выберите вариант");
    btn.disabled = true;
    try {
      await api("/api/delivery/defer", { method: "POST", headers: headers(), body: JSON.stringify({ mode: val() }) });
      clearBadge("delivery"); afterAction("Запись на доставку отложена");
    } catch (e) { btn.disabled = false; toast(e.message || "Не удалось отправить"); }
  };
}

function hideLoader() { const l = $("loader"); if (l) l.hidden = true; }
function boot() {
  hideLoader(); $("gate").hidden = true; $("screen").hidden = false; $("nav").hidden = false;
  $("back").onclick = back; $("home").onclick = home;
  $("bell").onclick = () => { const c = stack[stack.length - 1]; if (!c || c.view !== "notifications") go("notifications", null, "Уведомления"); };
  if (tg && tg.BackButton) { tg.BackButton.onClick(back); }
  if (location.hash === "#payments") go("payments", null, "Оплаты"); else render();   // кнопка «Оплатить» из уведомления
}
function applyMe(me) {
  ME = me;
  if (me.access === "pending") return gate("✅ Заявка отправлена.<br>Когда администратор откроет доступ, приложение заработает — загляните позже.");
  if (me.access === "denied") return gate("Доступ закрыт. Напишите администратору.");
  return true;
}
async function start() {
  const saved = cacheGet("me");
  let booted = false;
  if (saved && saved.access === "ok") { ME = saved; boot(); booted = true; }     // приложение открывается сразу
  let fresh;
  try { fresh = await api("/api/me", null, "me"); }
  catch (e) { if (booted) return; return gate("Откройте приложение из Телеграма."); }
  if (applyMe(fresh) !== true) { $("screen").hidden = true; $("nav").hidden = true; $("top").hidden = true; return; }
  ME = fresh;
  if (!booted) boot(); else if (!stack.length) render();
}
function gate(html) { hideLoader(); const g = $("gate"); g.innerHTML = html; g.hidden = false; }
start();
