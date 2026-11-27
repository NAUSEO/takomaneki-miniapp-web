/* Админ-раздел: курсы, расчёт цены, заказы (статус, фото, новый заказ), запрет доставки.
   Подгружается только когда админ открывает плитку «Админ». Данные идут через веб-панель (ME.admin_api). */
(function () {
  "use strict";
  const ADM = { tab: "rates", meta: null };
  const TABS = [["rates", "Курс"], ["calc", "Расчёт"], ["orders", "Заказы"], ["deliv", "Доставка"], ["people", "Клиенты"], ["fin", "Финансы"]];

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
    ({ rates: tabRates, calc: tabCalc, orders: tabOrders, deliv: tabDeliv, people: tabPeople, fin: tabFin }[ADM.tab])();
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
      <label class="muted">Клиент</label><input id="nu" placeholder="Поиск по списку: имя, @ник или ID"><select id="nsel"><option value="">Загрузка…</option></select><div class="muted" id="nuc"></div>
      <label class="muted">Название</label><input id="nt" placeholder="Что заказали">
      <label class="muted">Источник</label><select id="ns">${ADM.meta.sources.map((s) => `<option>${esc(s)}</option>`).join("")}</select>
      <label class="muted">Статус</label><select id="nst">${statusOptions("Оформлен")}</select>
      <label class="muted">Описание / комментарий</label><input id="nc" placeholder="Необязательно">
      <label class="muted">Фото</label><input type="file" id="np" accept="image/*">
      <div class="tabs"><button class="btn primary" id="nsave">Создать</button><button class="btn" id="nx">Отмена</button></div>`);
    $("nx").onclick = () => el.remove();
    let all = [];
    const label = (u) => (u.name + (u.username ? " @" + u.username : "") + (u.nick && u.nick !== u.name ? " · " + u.nick : ""));
    const fill = (q) => {
      const f = (q || "").toLowerCase();
      const list = all.filter((u) => !f || (label(u) + " " + (u.telegram_id || "")).toLowerCase().includes(f));
      $("nsel").innerHTML = `<option value="">— выберите клиента (${list.length}) —</option>` + list.map((u) => `<option value="${u.id}">${esc(label(u))}</option>`).join("");
      if (userId && list.some((u) => String(u.id) === String(userId))) $("nsel").value = userId;
    };
    aapi("/ma/users?all=1").then((d) => { all = d.users; fill(""); }).catch((e) => { $("nuc").textContent = errText(e); });
    $("nu").oninput = () => fill($("nu").value.trim());
    $("nsel").onchange = () => { userId = $("nsel").value || null; $("nuc").textContent = userId ? "Выбран: " + $("nsel").selectedOptions[0].textContent : ""; };
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

  /* ---------- Клиенты: профиль, ручные карточки, права, архив ---------- */
  function tabPeople() {
    let arch = false;
    $("atab").innerHTML = `<div class="tabs"><input id="uq" placeholder="Имя, @ник, ID, метка" style="flex:1;margin:0"><button class="btn primary" id="us">Найти</button></div>
      <div class="tabs"><button class="btn" id="unew">＋ Ручная карточка</button><button class="btn" id="uarch">Архив</button></div><div id="ulist"></div>`;
    const run = async () => {
      $("ulist").innerHTML = `<div class="spin small"></div>`;
      try { const d = await aapi("/ma/people?archived=" + (arch ? 1 : 0) + "&q=" + encodeURIComponent($("uq").value.trim()));
        $("ulist").innerHTML = (arch ? `<p class="muted">Показан архив</p>` : "") + (d.users.length ? d.users.map((u) => `<button class="row" data-u="${u.id}"><span class="l">${esc(u.name)}${u.username ? " @" + esc(u.username) : ""}<span class="cap">${u.manual ? "ручная карточка" : "Telegram"}${u.tags ? " · " + esc(u.tags) : ""}</span></span><span class="chip">${esc(u.status)}</span></button>`).join("") + (d.more ? `<p class="muted">Показаны первые 100. Уточните поиск.</p>` : "") : `<p class="muted">Никого не найдено</p>`);
        document.querySelectorAll("#ulist [data-u]").forEach((b) => (b.onclick = () => userSheet(d.users.find((x) => String(x.id) === b.dataset.u), run)));
      } catch (e) { $("ulist").innerHTML = `<p class="muted">${esc(errText(e))}</p>`; }
    };
    $("us").onclick = run; $("uq").onkeydown = (e) => { if (e.key === "Enter") run(); };
    $("uarch").onclick = () => { arch = !arch; $("uarch").textContent = arch ? "← Активные" : "Архив"; run(); };
    $("unew").onclick = () => newUserSheet(run); run();
  }

  const userStatusOpts = (cur) => ADM.meta.user_statuses.map((s) => `<option ${s === cur ? "selected" : ""}>${esc(s)}</option>`).join("");
  const channelOpts = (cur) => `<option value="">Основной</option>` + ADM.meta.channels.map((c) => `<option value="${c.id}" ${String(c.id) === String(cur) ? "selected" : ""}>${esc(c.name)}</option>`).join("");

  function userSheet(u, refresh) {
    const el = sheet(`<h3>${esc(u.name)}</h3><div class="muted">${u.manual ? "Ручная карточка" : "Telegram"}${u.username ? " · @" + esc(u.username) : ""}</div>
      <label class="muted">Ник (как вы его видите)</label><input id="un" value="${esc(u.nick)}">
      <label class="muted">Метки</label><input id="ut" value="${esc(u.tags)}">
      <label class="muted">Комментарий</label><input id="uc" value="${esc(u.comment)}">
      <label class="muted">Канал</label><select id="uch">${channelOpts(u.channel_id)}</select>
      <div class="tabs"><button class="btn primary" id="usave">Сохранить профиль</button></div>
      <label class="muted">Права / статус</label><select id="ust">${userStatusOpts(u.status)}</select>
      <div class="tabs"><button class="btn primary" id="ustb">Сменить статус</button>${u.status === "Архив" ? `<button class="btn" id="uun">Вернуть из архива</button>` : `<button class="btn" id="uar">В архив</button>`}</div>
      <div class="tabs"><button class="btn" id="udep">Депозит</button><button class="btn" id="ux">Закрыть</button></div>`);
    $("udep").onclick = () => depositSheet(u);
    const post = async (path, json, msg) => { try { await aapi(path, { method: "POST", json }); toast(msg); el.remove(); refresh(); } catch (e) { toast(errText(e)); } };
    $("ux").onclick = () => el.remove();
    $("usave").onclick = () => post("/ma/people/" + u.id + "/edit", { nickname: $("un").value, tags: $("ut").value, comment: $("uc").value, channel_id: $("uch").value }, "Профиль сохранён");
    $("ustb").onclick = () => { const st = $("ust").value; if ((st === "Администратор" || u.status === "Администратор") && st !== u.status && !confirm("Изменить права администратора?")) return; post("/ma/people/" + u.id + "/status", { status: st }, "Статус изменён"); };
    if ($("uar")) $("uar").onclick = () => { if (confirm("Отправить в архив?")) post("/ma/people/" + u.id + "/status", { status: "Архив" }, "Отправлен в архив"); };
    if ($("uun")) $("uun").onclick = () => post("/ma/people/" + u.id + "/status", { status: "Заказчик" }, "Возвращён из архива");
  }

  function newUserSheet(refresh) {
    const el = sheet(`<h3>Новая ручная карточка</h3>
      <label class="muted">Ник</label><input id="nn" placeholder="Как её называть">
      <label class="muted">Метки</label><input id="nt2" placeholder="Необязательно">
      <label class="muted">Комментарий</label><input id="nc2" placeholder="Необязательно">
      <label class="muted">Статус</label><select id="ns2">${userStatusOpts("Заказчик")}</select>
      <div class="tabs"><button class="btn primary" id="nsv">Создать</button><button class="btn" id="nxx">Отмена</button></div>`);
    $("nxx").onclick = () => el.remove();
    $("nsv").onclick = async () => { try { await aapi("/ma/people/new", { method: "POST", json: { nickname: $("nn").value, tags: $("nt2").value, comment: $("nc2").value, status: $("ns2").value } }); toast("Карточка создана"); el.remove(); refresh(); } catch (e) { toast(errText(e)); } };
  }

  /* ---------- Финансы: платежи на проверке, счета, отсрочки, депозит ---------- */
  const FIN_TABS = [["review", "Проверка"], ["issued", "Счета"], ["deferred", "Отсрочки"]];
  function tabFin(sub) {
    sub = sub || tabFin.sub || "review"; tabFin.sub = sub;
    $("atab").innerHTML = `<div class="tabs"><button class="btn primary" id="fissue">＋ Выставить счёт</button></div><div class="tabs">${FIN_TABS.map(([k, t]) => `<button class="btn ${k === sub ? "primary" : ""}" data-f="${k}">${t}</button>`).join("")}</div><div id="flist"><div class="spin small"></div></div>`;
    $("fissue").onclick = () => issueSheet(() => tabFin(sub));
    document.querySelectorAll("[data-f]").forEach((b) => (b.onclick = () => tabFin(b.dataset.f)));
    aapi("/ma/fin?tab=" + sub).then((d) => {
      $("flist").innerHTML = d.payments.length ? d.payments.map((x) => `<button class="row" data-p="${x.id}"><span class="l">${esc(x.client)} · ${esc(x.reason)}<span class="cap">${esc(x.positions)}${x.deadline ? " · до " + esc(fmtDate(x.deadline)) : ""}${x.response ? " · «" + esc(x.response) + "»" : ""}</span></span><b>${money(x.left || x.total)} ₽</b></button>`).join("") + (d.more ? `<p class="muted">Показаны первые 60.</p>` : "") : `<p class="muted">${sub === "review" ? "Нет платежей, ждущих проверки" : "Пусто"}</p>`;
      document.querySelectorAll("#flist [data-p]").forEach((b) => (b.onclick = () => paySheet(d.payments.find((x) => String(x.id) === b.dataset.p), sub)));
    }).catch((e) => { $("flist").innerHTML = `<p class="muted">${esc(errText(e))}</p>`; });
  }

  function paySheet(x, sub) {
    const rows = `<div class="rl"><span>Сумма</span><b>${money(x.total)} ₽</b></div><div class="rl"><span>Оплачено</span><b>${money(x.paid)} ₽</b></div><div class="rl"><span>Осталось</span><b>${money(x.left)} ₽</b></div>`;
    const el = sheet(`<h3>${esc(x.client)}${x.channel ? " · канал" : ""}</h3><div class="muted">${esc(x.reason)} · ${esc(x.status)}</div>
      <div class="muted">${esc(x.positions)}</div>${x.response ? `<div class="rnote">Ответ клиента: «${esc(x.response)}»</div>` : ""}${x.note ? `<div class="rnote">Заметка: ${esc(x.note)}</div>` : ""}
      <div class="cres" style="margin:10px 0">${rows}</div>
      ${x.channel ? "" : `<div class="muted">Клиент получит то же сообщение, что из панели</div>`}
      <div class="tabs"><button class="btn primary" id="pf">${x.channel ? "Оплачено" : "Подтвердить полностью"}</button></div>
      ${x.channel ? "" : `<input id="pa" inputmode="decimal" placeholder="Сумма частичной оплаты"><div class="tabs"><button class="btn" id="pp">Подтвердить часть</button></div>`}
      <div class="tabs">${sub === "review" ? `<button class="btn" id="pr">Отклонить</button><button class="btn" id="pv">Вернуть в статус</button>` : ""}<button class="btn" id="pz">В архив</button><button class="btn" id="px">Закрыть</button></div>`);
    const act = async (path, json, msg, ask) => { if (ask && !confirm(ask)) return; try { const r = await aapi("/ma/fin/" + x.id + path, { method: "POST", json: json || {} }); toast(msg(r)); el.remove(); tabFin(sub); } catch (e) { toast(errText(e)); } };
    $("px").onclick = () => el.remove();
    $("pf").onclick = () => act(x.channel ? "/channel-paid" : "/confirm-full", {}, (r) => x.channel ? "Отмечено оплаченным, счёт в архиве" : "Платёж подтверждён" + (r.notified ? ", клиент уведомлён" : ""), "Подтвердить оплату?");
    if ($("pp")) $("pp").onclick = () => act("/confirm-partial", { amount: $("pa").value }, (r) => r.fully_paid ? "Оплачено полностью" : "Частично, осталось " + money(r.remaining) + " ₽");
    if ($("pr")) $("pr").onclick = () => act("/reject", {}, (r) => "Отклонено" + (r.notified ? ", клиент уведомлён" : ""), "Отклонить платёж? Клиент получит уведомление.");
    if ($("pv")) $("pv").onclick = () => act("/revert", {}, () => "Возвращено в исходный статус");
    $("pz").onclick = () => act("/archive", {}, () => "Отправлено в архив", "Отправить в архив?");
  }

  async function depositSheet(u) {
    let d; try { d = await aapi("/ma/people/" + u.id + "/deposit"); } catch (e) { return toast(errText(e)); }
    const el = sheet(`<h3>Депозит · ${esc(u.name)}</h3>
      <div class="cres" style="margin:8px 0"><div class="rl"><span>Оплачено за позиции</span><b>${money(d.stats.positions_sum)} ₽</b></div><div class="rl"><span>Оплачено за доставку</span><b>${money(d.stats.delivery_sum)} ₽</b></div><div class="rl"><span>Всего</span><b>${money(d.stats.total_sum)} ₽</b></div></div>
      <label class="muted">Сумма депозита, ₽</label><input id="dm" inputmode="decimal" value="${esc(String(d.amount))}">
      <label class="muted">Комментарий</label><input id="dc" value="${esc(d.comment)}">
      <div class="tabs"><button class="btn primary" id="ds">Сохранить</button><button class="btn" id="dx">Закрыть</button></div>`);
    $("dx").onclick = () => el.remove();
    $("ds").onclick = async () => { try { await aapi("/ma/people/" + u.id + "/deposit", { method: "POST", json: { amount: $("dm").value, comment: $("dc").value } }); toast("Депозит сохранён"); el.remove(); } catch (e) { toast(errText(e)); } };
  }

  async function issueSheet(refresh) {
    let meta, users; try { [meta, users] = await Promise.all([aapi("/ma/fin/issue-meta"), aapi("/ma/users?all=1")]); } catch (e) { return toast(errText(e)); }
    const all = users.users; let positions = [];
    const label = (u) => (u.name + (u.username ? " @" + u.username : "") + (u.nick && u.nick !== u.name ? " · " + u.nick : ""));
    const el = sheet(`<h3>Выставить счёт</h3>
      <label class="muted">Клиент</label><input id="iq" placeholder="Поиск: имя, @ник или ID"><select id="iu"></select>
      <label class="muted">Причина</label><select id="ir">${meta.reasons.map((r) => `<option>${esc(r)}</option>`).join("")}</select>
      <div id="ipkw" hidden><label class="muted">Посылка</label><select id="ipk"><option value="">— выберите посылку —</option>${meta.packages.map((p) => `<option value="${p.id}">${esc(p.name)}</option>`).join("")}</select></div>
      <div id="ipos"></div>
      <div class="tabs"><button class="btn" id="iadd">＋ Своя строка (без привязки к заказу)</button></div>
      <div id="icust"></div>
      <label class="muted">Срок оплаты</label><input id="id" type="date" value="${esc(meta.default_deadline)}">
      <label class="muted">Комментарий (необязательно)</label><input id="ic">
      <label class="chk"><input type="checkbox" id="in" checked> Отправить клиенту уведомление</label>
      <div class="cres" id="itot" style="margin:8px 0">Итого: 0 ₽</div>
      <div class="tabs"><button class="btn primary" id="isave">Выставить счёт</button><button class="btn" id="ix">Отмена</button></div>`);
    const fill = (q) => { const f = (q || "").toLowerCase(); const keep = $("iu").value;
      $("iu").innerHTML = `<option value="">— выберите клиента —</option>` + all.filter((u) => !f || (label(u) + " " + (u.telegram_id || "")).toLowerCase().includes(f)).map((u) => `<option value="${u.id}">${esc(label(u))}</option>`).join(""); if (keep) $("iu").value = keep; };
    fill(""); $("iq").oninput = () => fill($("iq").value.trim());
    const isPkg = () => meta.package_reasons.includes($("ir").value);
    const total = () => { let t = 0; el.querySelectorAll(".iamt").forEach((i) => { const row = i.closest(".irow"); if (row.querySelector(".ion") && !row.querySelector(".ion").checked) return; const n = parseFloat(String(i.value).replace(",", ".").replace(/\s/g, "")); if (n > 0) t += n; }); $("itot").textContent = "Итого: " + money(t) + " ₽"; };
    const loadPos = async () => {
      $("ipkw").hidden = !isPkg(); $("ipos").innerHTML = "";
      const u = $("iu").value, pk = $("ipk").value; if (!u || (isPkg() && !pk)) { positions = []; total(); return; }
      try { positions = (await aapi("/ma/fin/positions?user_id=" + u + "&reason=" + encodeURIComponent($("ir").value) + "&package_id=" + pk)).positions; } catch (e) { return toast(errText(e)); }
      $("ipos").innerHTML = positions.length ? `<div class="muted">Позиции клиента — отметьте и впишите сумму:</div>` + positions.map((p) => `<div class="irow" data-o="${p.id}"><label class="chk"><input type="checkbox" class="ion" ${isPkg() ? "checked" : ""}> ${esc(p.number)} ${esc(p.title)} <span class="muted">(${esc(p.status)})</span></label><input class="iamt" inputmode="decimal" placeholder="Сумма, ₽"></div>`).join("") : `<p class="muted">Подходящих позиций нет — добавьте свою строку.</p>`;
      el.querySelectorAll("#ipos input").forEach((i) => (i.oninput = i.onchange = total)); total();
    };
    $("iu").onchange = loadPos; $("ir").onchange = loadPos; $("ipk").onchange = loadPos;
    $("iadd").onclick = () => { const d = document.createElement("div"); d.className = "irow"; d.innerHTML = `<input class="icm" placeholder="Описание (например: Доставка)"><input class="iamt" inputmode="decimal" placeholder="Сумма, ₽">`; $("icust").appendChild(d); d.querySelector(".iamt").oninput = total; };
    $("ix").onclick = () => el.remove();
    $("isave").onclick = async () => {
      const items = [];
      el.querySelectorAll("#ipos .irow").forEach((r) => { const v = r.querySelector(".iamt").value; if (r.querySelector(".ion").checked && v.trim()) items.push({ order_id: r.dataset.o, amount: v, comment: "" }); });
      el.querySelectorAll("#icust .irow").forEach((r) => { const v = r.querySelector(".iamt").value; if (v.trim()) items.push({ order_id: null, amount: v, comment: r.querySelector(".icm").value }); });
      if (!$("iu").value) return toast("Выберите клиента");
      if (!items.length) return toast("Добавьте хотя бы одну позицию с суммой");
      if (!confirm("Выставить счёт на " + $("itot").textContent.replace("Итого: ", "") + ($("in").checked ? " и отправить клиенту уведомление?" : " без уведомления клиенту?"))) return;
      $("isave").disabled = true;
      try { const r = await aapi("/ma/fin/issue", { method: "POST", json: { user_id: $("iu").value, reason: $("ir").value, package_id: $("ipk").value, deadline_date: $("id").value, comment: $("ic").value, items, notify: $("in").checked } });
        toast("Счёт выставлен: " + money(r.total) + " ₽" + (r.deposit_applied ? " (списан депозит " + money(r.deposit_applied) + " ₽)" : "") + (r.notified ? ", клиент уведомлён" : "")); el.remove(); refresh(); }
      catch (e) { $("isave").disabled = false; toast(errText(e)); }
    };
  }
})();
