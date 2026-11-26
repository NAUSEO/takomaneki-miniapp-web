/* Админ-раздел: курсы, расчёт цены, заказы (статус, фото, новый заказ), запрет доставки.
   Подгружается только когда админ открывает плитку «Админ». Данные идут через веб-панель (ME.admin_api). */
(function () {
  "use strict";
  const ADM = { tab: "rates", meta: null };
  const TABS = [["rates", "Курс"], ["calc", "Расчёт"], ["orders", "Заказы"], ["deliv", "Доставка"]];

  async function aapi(path, opts) {
    if (!ME || ME.admin_api == null) throw new Error("Админ-раздел не настроен");
    const o = Object.assign({}, opts || {});
    const h = { "X-Init-Data": (tg && tg.initData) || "" };
    if (o.json) { h["Content-Type"] = "application/json"; o.body = JSON.stringify(o.json); delete o.json; }
    o.headers = h;
    const slow = setTimeout(() => toast("Сервер просыпается, подождите немного…"), 5000);
    try {
      const r = await fetch(ME.admin_api + path, o);
      if (o.blob) return r.ok ? r.blob() : null;
      const data = await r.json().catch(() => ({}));
      if (!r.ok) { const e = new Error(data.error || r.status); e.data = data; throw e; }
      return data;
    } finally { clearTimeout(slow); }
  }
  const errText = (e) => (e && e.data && e.data.error) || (e && e.message) || "Ошибка";
  const win = (title, body, extra) => `<div class="card win ${extra || ""}"><div class="bar"><span>${title}</span><span class="x"></span></div><div class="body col">${body}</div></div>`;
  const money = (n) => Number(n).toLocaleString("ru-RU", { maximumFractionDigits: 2 });

  window.viewAdmin = async function () {
    if (!ADM.meta) { $("screen").innerHTML = `<div class="spin small"></div>`; try { ADM.meta = await aapi("/ma/meta"); } catch (e) { $("screen").innerHTML = `<p class="muted">Не удалось открыть админ-раздел: ${esc(errText(e))}</p>`; return; } }
    $("screen").innerHTML = `<div class="tabs atabs">${TABS.map(([k, t]) => `<button class="btn ${ADM.tab === k ? "primary" : ""}" data-t="${k}">${t}</button>`).join("")}</div><div id="atab"></div>`;
    document.querySelectorAll(".atabs .btn").forEach((b) => (b.onclick = () => { ADM.tab = b.dataset.t; window.viewAdmin(); }));
    ({ rates: tabRates, calc: tabCalc, orders: tabOrders, deliv: tabDeliv }[ADM.tab])();
  };

  /* ---------- Курс ---------- */
  async function tabRates() {
    const box = $("atab"); box.innerHTML = `<div class="spin small"></div>`;
    let d; try { d = await aapi("/ma/rates"); } catch (e) { box.innerHTML = `<p class="muted">${esc(errText(e))}</p>`; return; }
    const ch = d.channels[0];
    box.innerHTML = `<div class="duo">
      ${win("Основной", `<div class="muted">Сейчас</div><div class="big">${esc(d.main.rate || "—")}</div><input id="rm" inputmode="decimal" placeholder="Новый курс"><label class="chk"><input type="checkbox" id="nm" checked>Уведомить клиентов</label><button class="btn primary" id="sm">Сохранить</button>`)}
      ${ch ? win(esc(ch.name), `<div class="muted">Сейчас</div><div class="big">${esc(ch.rate || "—")}</div><input id="rc" inputmode="decimal" placeholder="Новый курс"><label class="chk"><input type="checkbox" id="nc" checked>Уведомить клиентов</label><button class="btn primary" id="sc">Сохранить</button>`) : win("Канал", `<div class="muted">Каналов нет</div>`)}
    </div>`;
    const save = (btn, inp, chk, path, extra) => { const el = $(btn); if (!el) return; el.onclick = async () => {
      el.disabled = true;
      try { const r = await aapi(path, { method: "POST", json: Object.assign({ rate: $(inp).value, notify: $(chk).checked }, extra) }); toast(`Курс сохранён${r.notified ? `, уведомлений: ${r.notified}` : ""}`); tabRates(); }
      catch (e) { toast(errText(e)); el.disabled = false; } }; };
    save("sm", "rm", "nm", "/ma/rates/main", {});
    if (ch) save("sc", "rc", "nc", "/ma/rates/channel", { id: ch.id });
  }

  /* ---------- Расчёт цены ---------- */
  async function tabCalc() {
    const box = $("atab"); box.innerHTML = `<div class="spin small"></div>`;
    const channels = ADM.meta.channels.filter((c) => c.rate != null), ch = channels[0];
    const calcWin = (k, title) => win(title, `<input id="p_${k}" inputmode="decimal" placeholder="Цена, ¥"><button class="btn primary" id="b_${k}">Рассчитать</button><div class="cres" id="r_${k}"></div>`);
    box.innerHTML = `<div class="duo">${calcWin("m", "Основной · 10%")}${ch ? calcWin("c", esc(ch.name)) : win("Канал", `<div class="muted">У каналов не задан курс</div>`)}</div>`;
    const bind = (k, channelId) => { const b = $("b_" + k); if (!b) return; b.onclick = async () => {
      try { const r = await aapi("/ma/calc", { method: "POST", json: { price: $("p_" + k).value, channel_id: channelId } });
        $("r_" + k).innerHTML = `<div class="rl"><span>Итог</span><b>${money(r.total)} ₽</b></div><div class="rl"><span>Чистая цена</span><b>${money(r.clean)} ₽</b></div><div class="rl"><span>Комиссия</span><b>${money(r.commission)} ₽</b></div>`; }
      catch (e) { $("r_" + k).textContent = errText(e); } }; };
    bind("m", null); if (ch) bind("c", ch.id);
  }

  /* ---------- Заказы ---------- */
  function tabOrders() {
    $("atab").innerHTML = `<div class="tabs"><input id="oq" placeholder="Номер, название, имя или @ник" style="flex:1;margin:0"><button class="btn primary" id="os">Найти</button></div>
      <button class="btn" id="onew" style="margin-bottom:14px">＋ Новый заказ</button><div id="olist"></div>`;
    const run = async () => {
      $("olist").innerHTML = `<div class="spin small"></div>`;
      try { const d = await aapi("/ma/orders?q=" + encodeURIComponent($("oq").value.trim()));
        $("olist").innerHTML = d.orders.length ? d.orders.map((o) => `<button class="row" data-o="${o.id}"><span class="l"><span class="num">${esc(o.number)}</span> ${esc(o.title)}<span class="cap">${esc(o.client)}</span></span>${chip(o.status)}</button>`).join("") + (d.more ? `<p class="muted">Показаны первые ${d.orders.length}. Уточните поиск.</p>` : "") : `<p class="muted">Ничего не найдено</p>`;
        document.querySelectorAll("#olist [data-o]").forEach((b) => (b.onclick = () => orderSheet(b.dataset.o, run)));
      } catch (e) { $("olist").innerHTML = `<p class="muted">${esc(errText(e))}</p>`; }
    };
    $("os").onclick = run; $("oq").onkeydown = (e) => { if (e.key === "Enter") run(); }; $("onew").onclick = () => newOrderSheet(run); run();
  }

  const statusOptions = (cur) => ADM.meta.statuses.map((s) => `<option ${s === cur ? "selected" : ""}>${esc(s)}</option>`).join("");

  async function orderSheet(id, refresh) {
    let o; try { o = await aapi("/ma/order/" + id); } catch (e) { return toast(errText(e)); }
    const el = sheet(`<h3>${esc(o.number)}</h3><div class="muted">${esc(o.client)}${o.username ? " · @" + esc(o.username) : ""}</div>
      <div class="big" style="font-size:18px;margin:6px 0">${esc(o.title)}</div>${o.deadline ? `<div class="muted">Хранение до ${esc(fmtDate(o.deadline))}</div>` : ""}
      <div id="ph" class="aph">${o.has_photo ? `<div class="spin small"></div>` : `<div class="muted">Фото нет</div>`}</div>
      <label class="muted">Статус</label><select id="os_st">${statusOptions(o.status)}</select>
      <div class="tabs"><button class="btn primary" id="os_save">Сменить статус</button></div>
      <label class="muted">Фото (заменить или добавить)</label><input type="file" id="os_ph" accept="image/*">
      <div class="tabs"><button class="btn" id="os_phb">Загрузить фото</button><button class="btn" id="os_x">Закрыть</button></div>`);
    if (o.has_photo) aapi("/ma/order/" + id + "/photo", { blob: true }).then((b) => { if (b) $("ph").innerHTML = `<img src="${URL.createObjectURL(b)}" alt="">`; });
    $("os_x").onclick = () => el.remove();
    $("os_save").onclick = async () => { try { const r = await aapi("/ma/order/" + id + "/status", { method: "POST", json: { status: $("os_st").value } }); toast("Статус изменён" + (r.old !== r.status ? "; клиент уведомлён по настройкам" : "")); el.remove(); refresh(); } catch (e) { toast(errText(e)); } };
    $("os_phb").onclick = async () => { const f = $("os_ph").files[0]; if (!f) return toast("Выберите фото"); const fd = new FormData(); fd.append("photo", f);
      try { await aapi("/ma/order/" + id + "/photo", { method: "POST", body: fd }); toast("Фото сохранено"); el.remove(); refresh(); } catch (e) { toast(errText(e)); } };
  }

  function newOrderSheet(refresh) {
    let userId = null;
    const el = sheet(`<h3>Новый заказ</h3>
      <label class="muted">Клиент</label><input id="nu" placeholder="Имя, @ник или Telegram ID"><div id="nul"></div><div class="muted" id="nuc"></div>
      <label class="muted">Название</label><input id="nt" placeholder="Что заказали">
      <label class="muted">Источник</label><select id="ns">${ADM.meta.sources.map((s) => `<option>${esc(s)}</option>`).join("")}</select>
      <label class="muted">Статус</label><select id="nst">${statusOptions("Оформлен")}</select>
      <label class="muted">Описание / комментарий</label><input id="nc" placeholder="Необязательно">
      <label class="muted">Фото</label><input type="file" id="np" accept="image/*">
      <div class="tabs"><button class="btn primary" id="nsave">Создать</button><button class="btn" id="nx">Отмена</button></div>`);
    $("nx").onclick = () => el.remove();
    let t; $("nu").oninput = () => { clearTimeout(t); t = setTimeout(async () => { const q = $("nu").value.trim(); if (q.length < 2) { $("nul").innerHTML = ""; return; }
      try { const d = await aapi("/ma/users?q=" + encodeURIComponent(q)); $("nul").innerHTML = d.users.map((u) => `<button class="opt" data-u="${u.id}" data-n="${esc(u.name)}">${esc(u.name)} ${u.username ? "@" + esc(u.username) : ""}${u.nick ? " · " + esc(u.nick) : ""}</button>`).join("") || `<div class="muted">Не найден</div>`;
        document.querySelectorAll("#nul [data-u]").forEach((b) => (b.onclick = () => { userId = b.dataset.u; $("nuc").textContent = "Выбран: " + b.dataset.n; $("nul").innerHTML = ""; })); } catch (e) {} }, 350); };
    $("nsave").onclick = async () => {
      if (!userId) return toast("Выберите клиента из списка");
      const fd = new FormData(); fd.append("user_id", userId); fd.append("title", $("nt").value); fd.append("source", $("ns").value); fd.append("status", $("nst").value); fd.append("comment", $("nc").value);
      if ($("np").files[0]) fd.append("photo", $("np").files[0]);
      $("nsave").disabled = true;
      try { const r = await aapi("/ma/orders/new", { method: "POST", body: fd }); toast("Создан заказ " + r.number); el.remove(); refresh(); } catch (e) { toast(errText(e)); $("nsave").disabled = false; }
    };
  }

  /* ---------- Доставка: запрет и заявки ---------- */
  async function tabDeliv() {
    const box = $("atab"); box.innerHTML = `<div class="spin small"></div>`;
    let b, d; try { [b, d] = await Promise.all([aapi("/ma/blocks"), aapi("/ma/deliveries")]); } catch (e) { box.innerHTML = `<p class="muted">${esc(errText(e))}</p>`; return; }
    box.innerHTML = win("Запрет доставки", `<div class="duo2"><div><div class="muted">С</div><input type="date" id="bf"></div><div><div class="muted">По</div><input type="date" id="bt"></div></div>
      <input id="br" placeholder="Причина (её увидит клиент)"><label class="chk"><input type="checkbox" id="bx" checked>Продлить хранение на эти дни</label><button class="btn primary" id="bs">Включить запрет</button>`)
      + (b.blocks.length ? `<h3>Действующие и будущие</h3>` + b.blocks.map((x) => `<div class="row"><span class="l">${esc(fmtDate(x.from))} – ${esc(fmtDate(x.to))}<span class="cap">${esc(x.reason)}</span></span><button class="btn" data-bd="${x.id}">Снять</button></div>`).join("") : "")
      + `<h3>Заявки на доставку</h3>` + (d.deliveries.length ? d.deliveries.map((x) => `<div class="row"><span class="l">${esc(x.client)}${x.via_app ? " · из приложения" : ""}<span class="cap">${esc(x.carrier)}${x.insurance != null ? " · страховка " + money(x.insurance) : ""}</span></span>${chip(x.status)}</div>`).join("") : `<p class="muted">Активных нет</p>`);
    $("bs").onclick = async () => { try { const r = await aapi("/ma/blocks/new", { method: "POST", json: { from: $("bf").value, to: $("bt").value, reason: $("br").value, extend: $("bx").checked } }); toast(`Запрет включён. Срок хранения продлён у позиций: ${r.extended} (+${r.days} дн.)`); tabDeliv(); } catch (e) { toast(errText(e)); } };
    document.querySelectorAll("[data-bd]").forEach((x) => (x.onclick = async () => { try { await aapi("/ma/blocks/" + x.dataset.bd + "/delete", { method: "POST" }); toast("Запрет снят"); tabDeliv(); } catch (e) { toast(errText(e)); } }));
  }
})();
