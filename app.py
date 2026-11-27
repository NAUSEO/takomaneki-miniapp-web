import logging
from datetime import date, datetime, timedelta
from decimal import Decimal

from flask import Flask, jsonify, request, Response, send_from_directory, abort, g
from flask.json.provider import DefaultJSONProvider

import auth
import config
import db

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("miniapp")


class Provider(DefaultJSONProvider):
    @staticmethod
    def default(o):
        if isinstance(o, Decimal):
            return float(o)
        if isinstance(o, (datetime, date)):
            return o.isoformat()
        return DefaultJSONProvider.default(o)


app = Flask(__name__, static_folder="static", static_url_path="/static")
app.json = Provider(app)


@app.after_request
def api_headers(resp):
    if request.path.startswith("/api/"):
        resp.headers["Cache-Control"] = "no-store"
        # интерфейс живёт на другом адресе (GitHub Pages) — разрешаем ему обращаться к данным
        allowed = config.ALLOWED_ORIGIN
        origin = request.headers.get("Origin", "")
        if allowed and (allowed == "*" or origin == allowed):
            resp.headers["Access-Control-Allow-Origin"] = origin if allowed != "*" else "*"
            resp.headers["Access-Control-Allow-Headers"] = "X-Init-Data, Content-Type, X-Dev-User, X-Dev-Start"
            resp.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
            resp.headers["Access-Control-Max-Age"] = "86400"
            resp.headers["Vary"] = "Origin"
    return resp


def plain(text):
    """Убирает разметку бота (**жирный**, __курсив__): в приложении она выводилась бы как есть."""
    return (text or "").replace("**", "").replace("__", "")


# ---------------- доступ ----------------

def identify():
    """Определяет человека по подписи Телеграма. Возвращает (user_row | None, access) где access:
    'ok' — доступ открыт, 'pending' — заявка ждёт решения, 'denied' — доступ закрыт, 'unauth' — подпись неверна."""
    init_data = request.headers.get("X-Init-Data", "")
    parsed = auth.validate_init_data(init_data)
    if parsed:
        tg = parsed["user"]
        telegram_id = int(tg["id"])
        name = " ".join(x for x in (tg.get("first_name"), tg.get("last_name")) if x) or None
        start_param = parsed.get("start_param")
        username = tg.get("username")
    elif config.ALLOW_DEV and request.headers.get("X-Dev-User", "").isdigit():   # только для проверки с компьютера
        telegram_id, name, username = int(request.headers["X-Dev-User"]), "Тест", None
        start_param = request.headers.get("X-Dev-Start") or None
    else:
        return None, "unauth"

    user = db.find_or_create_user(telegram_id, username, name, start_param)
    if telegram_id in config.ADMIN_IDS:
        return user, "ok"
    status = user.get("status")
    if status in config.ACCESS_DENIED_STATUSES:
        return user, "denied"
    if status in config.ACCESS_OK_STATUSES:
        return user, "ok"
    return user, "pending"


def require_user():
    user, access = identify()
    if access == "unauth":
        abort(401)
    if access != "ok":
        abort(403)
    return user


# ---------------- страницы и фото ----------------

@app.route("/")
def index():
    import os
    if os.path.exists(os.path.join(app.root_path, "static", "index.html")):
        return send_from_directory("static", "index.html")
    return "ok"


@app.route("/healthz")
def healthz():
    return "ok"


def _photo_response(row):
    if not row or not row["photo_data"]:
        abort(404)
    resp = Response(bytes(row["photo_data"]), mimetype=row["photo_mimetype"] or "image/jpeg")
    resp.headers["Cache-Control"] = "private, max-age=31536000, immutable"
    return resp


@app.route("/photo/<kind>/<int:entity_id>")
def photo(kind, entity_id):
    """Фото по подписанной ссылке: подпись знает только тот, кому её выдал сервер."""
    if kind not in ("order", "user"):
        abort(404)
    version = request.args.get("v", "")
    if not version.isdigit() or not request.args.get("s") or \
            request.args["s"] != auth.photo_signature(kind, entity_id, int(version)):
        abort(404)
    with db.cursor() as cur:
        row = db.get_order_photo(cur, entity_id) if kind == "order" else db.get_user_photo(cur, entity_id)
    return _photo_response(row)


# ---------------- API ----------------

@app.route("/api/me")
def api_me():
    user, access = identify()
    if access == "unauth":
        return jsonify({"access": "unauth"}), 401
    result = {"access": access, "name": user["telegram_name"], "is_admin": user["telegram_id"] in config.ADMIN_IDS, "admin_api": config.PANEL_URL if user["telegram_id"] in config.ADMIN_IDS else None}
    if access == "ok":
        with db.cursor() as cur:
            info = db.user_rate(cur, user)
        result["can_pay"] = not info["is_channel"]
    return jsonify(result)


def _order_dict(o):
    group_key, group_label = config.GROUP_BY_STATUS.get(o["status"], ("other", "Мероприятия&Другое"))
    d = {
        "id": o["id"], "number": db.format_order_number(o["order_number"]), "title": o["title"] or "без названия",
        "status": o["status"], "emoji": config.STATUS_EMOJI.get(o["status"], "•"),
        "group": group_key, "group_label": group_label,
        "photo": auth.photo_url("order", o["id"], o["photo_size"]),
        "added": o["created_at"], "items": o["items"],
    }
    if o["package_status"] == "В пути в РФ" and o["package_ship_date"]:
        d["ship_date"] = o["package_ship_date"]
    if o["package_id"]:
        d["package"] = {"id": o["package_id"], "name": o["package_name"] or "Посылка", "ship_date": o["package_ship_date"]}
    if o["status"] == "Предзаказ" and o["preorder_date"]:
        d["preorder_date"] = o["preorder_date"]
    if o["status"] in ("На руках у админа", "Просрок хранения") and o["delivery_deadline"]:
        d["delivery_deadline"] = o["delivery_deadline"]
    if o["status"] == "Отложено":
        d["delay_until"], d["delay_reason"] = o["delay_until"], o["delay_reason"]
    if o["status"] == "Мероприятие":
        d["event_name"], d["event_date"] = o["event_name"], o["event_date"]
        d["event_state"] = o["event_state"] or "Оформлено"
    if o["status"] in config.EARLY_STATUSES:
        d["source"] = o["source"] + (f" ({o['source_comment']})" if o["source"] == "Другое" and o["source_comment"] else "")
    return d


@app.route("/api/orders")
def api_orders():
    user = require_user()
    with db.cursor() as cur:
        orders = db.get_orders(cur, user["id"])
        parts = db.get_merge_parts(cur, [o["id"] for o in orders])
    items = [_order_dict(o) for o in orders]
    for item in items:
        merged = parts.get(item["id"])
        if merged:          # объединённый заказ: общее фото не показываем, фото — у каждой части
            item["merged"] = True
            item["photo"] = None
            item["items"] = None
            item["parts"] = [{"number": db.format_order_number(p["original_order_number"]), "title": p["original_title"] or "без названия",
                              "photo": auth.photo_url("order", p["original_order_id"], p["photo_size"])} for p in merged]
    groups = []
    for key, label, statuses in config.STATUS_GROUPS:
        count = sum(1 for i in items if i["status"] in statuses)
        groups.append({"key": key, "label": label, "count": count})
    return jsonify({"orders": items, "groups": groups})


@app.route("/api/rate")
def api_rate():
    user = require_user()
    with db.cursor() as cur:
        info = db.user_rate(cur, user)
        if info["rate"] is None:
            return jsonify({"rate_set": False, "text": "Курс для вашего канала пока не задан. Напишите администратору."})
        key = "text_rate_channel" if info["is_channel"] else "text_rate"
        template = db.get_setting(cur, key, "Текущий курс: {rate}")
    try:
        text = template.format(rate=info["display"])
    except (KeyError, IndexError, ValueError):
        text = f"Текущий курс: {info['display']}"
    return jsonify({"rate_set": True, "rate": info["display"], "text": plain(text)})


@app.route("/api/calc", methods=["POST"])
def api_calc():
    user = require_user()
    try:
        price = Decimal(str((request.get_json(silent=True) or {}).get("price", "")).replace(",", ".").strip())
    except Exception:
        return jsonify({"error": "Введите сумму в юанях числом"}), 400
    if price <= 0 or price > Decimal("10000000"):
        return jsonify({"error": "Введите сумму в юанях числом"}), 400
    with db.cursor() as cur:
        info = db.user_rate(cur, user)
        if info["rate"] is None:
            return jsonify({"error": "Курс для вашего канала пока не задан. Напишите администратору."}), 409
        total = db.calculate_total(price, info["rate"], info["multiplier"])
        key = "text_price_result_channel" if info["is_channel"] else "text_price_result"
        template = db.get_setting(cur, key, "Ориентировочная стоимость: {amount}. Обратите внимание, что доставка может быть платной.")
    try:
        text = template.format(amount=total)
    except (KeyError, IndexError, ValueError):
        text = f"Ориентировочная стоимость: {total}"
    return jsonify({"amount": total, "text": plain(text)})


@app.route("/api/profile")
def api_profile():
    user = require_user()
    with db.cursor() as cur:
        stats = db.profile_stats(cur, user["id"])
        spending = db.spending_stats(cur, user["id"])
        photo = db.get_user_photo(cur, user["id"])
    size = len(photo["photo_data"]) if photo and photo["photo_data"] else 0
    return jsonify({"name": user["telegram_name"], "stats": stats, "spending": spending,
                    "photo": auth.photo_url("user", user["id"], size)})


@app.route("/api/profile/detail")
def api_profile_detail():
    user = require_user()
    with db.cursor() as cur:
        rows = db.position_breakdown(cur, user["id"])
    return jsonify({"rows": [{"number": db.format_order_number(r["order_number"]), "title": r["title"] or "без названия",
                              "paid": r["total_paid"]} for r in rows]})


def _pay_json(r, channel):
    status = r["status"]
    if channel and status == "Выставлен" and r["deadline_date"] and r["deadline_date"] < date.today():
        status = "Просрочен"        # у клиентов канала статус в базе не меняется — просрочка видна по дате
    total, paid = float(r["total_amount"] or 0), float(r["paid_amount"] or 0)
    return {"id": r["id"], "reason": r["reason"], "total": r["total_amount"], "paid": r["paid_amount"],
            "left": max(total - paid, 0), "deposit_applied": r.get("deposit_applied"), "status": status,
            "created": r.get("created_at"), "deadline": r.get("deadline_date"), "positions": r.get("positions_label") or "",
            "can_defer": not channel and not r.get("deadline_extended")}


@app.route("/api/payments")
def api_payments():
    """Выставленные счета. Обычные клиенты могут отметить оплату и взять отсрочку; клиентам канала оплата идёт через личные сообщения."""
    user = require_user()
    with db.cursor(commit=True) as cur:
        channel = db.user_rate(cur, user)["is_channel"]
        rows = db.active_payments(cur, user["id"])
        waiting = [] if channel else db.pending_payments(cur, user["id"])
        requisites = "" if channel else db.get_setting(cur, "payment_requisites", "")
        db.mark_payments_seen(cur, user["id"])          # маркер «!» на главной гаснет после открытия
    return jsonify({"can_pay": not channel, "channel": channel, "requisites": requisites, "deferral_days": config.DEFERRAL_DAYS,
                    "payments": [_pay_json(r, channel) for r in rows],
                    "waiting": [{"id": r["id"], "reason": r["reason"], "total": r["total_amount"], "positions": r.get("positions_label") or ""} for r in waiting]})


def _ids(body):
    ids = []
    for x in (body.get("ids") or [])[:50]:
        try:
            ids.append(int(x))
        except (TypeError, ValueError):
            pass
    return ids


@app.route("/api/payments/pay", methods=["POST"])
def api_payments_pay():
    """«Оплатил» / «Оплатил часть»: сообщение человека (сумма, банк, время) привязывается к выбранным счетам, они уходят на проверку."""
    user = require_user()
    body = request.get_json(silent=True) or {}
    ids, text = _ids(body), (body.get("text") or "").strip()[:1000]
    action = "partial" if body.get("mode") == "partial" else "full"
    if not ids:
        return jsonify({"error": "Выберите платёж"}), 400
    if not text:
        return jsonify({"error": "Напишите сумму, банк и время перевода"}), 400
    with db.cursor(commit=True) as cur:
        if db.user_rate(cur, user)["is_channel"]:
            return jsonify({"error": "Оплата через личные сообщения канала"}), 403
        active = {p["id"]: p for p in db.active_payments(cur, user["id"])}
        chosen = [active[i] for i in ids if i in active]
        if not chosen:
            return jsonify({"error": "Эти платежи уже обработаны или закрыты"}), 409
        stored = text
        if len(chosen) > 1:
            total = sum(max(float(p["total_amount"] or 0) - float(p["paid_amount"] or 0), 0) for p in chosen)
            stored = f"[Один перевод за несколько платежей ({len(chosen)}), всего к оплате {total:g} ₽] {text}"
        marked = db.mark_payments_awaiting_check(cur, user["id"], [p["id"] for p in chosen], stored, action)
    if not marked:
        return jsonify({"error": "Эти платежи уже обработаны или закрыты"}), 409
    _admin_notify(f"💳 Оплата из приложения на проверке\n{user['telegram_name'] or user.get('username') or user['id']}: платежей {len(marked)}. «{text[:200]}»")
    return jsonify({"ok": True, "count": len(marked)})


@app.route("/api/payments/defer", methods=["POST"])
def api_payments_defer():
    """Отсрочка (один раз на платёж) на DEFERRAL_DAYS дней."""
    user = require_user()
    ids = _ids(request.get_json(silent=True) or {})
    if not ids:
        return jsonify({"error": "Выберите платёж"}), 400
    granted, skipped = [], []
    with db.cursor(commit=True) as cur:
        if db.user_rate(cur, user)["is_channel"]:
            return jsonify({"error": "Отсрочка у клиентов канала — через личные сообщения"}), 403
        for i in ids:
            d = db.apply_deferral(cur, i, user["id"], config.DEFERRAL_DAYS)
            (granted.append({"id": i, "date": d}) if d else skipped.append(i))
    return jsonify({"ok": bool(granted), "granted": granted, "skipped": skipped, "days": config.DEFERRAL_DAYS})


# ---------------- доставка ----------------

def _admin_notify(text):
    """Короткое сообщение админам в Телеграм о новой заявке (в фоне, ошибки не мешают работе)."""
    if not config.BOT_TOKEN or not config.ADMIN_IDS:
        return
    import json, threading, urllib.request

    def send():
        for admin_id in config.ADMIN_IDS:
            try:
                req = urllib.request.Request(
                    f"https://api.telegram.org/bot{config.BOT_TOKEN}/sendMessage",
                    data=json.dumps({"chat_id": admin_id, "text": text}).encode(),
                    headers={"Content-Type": "application/json"})
                urllib.request.urlopen(req, timeout=5).read()
            except Exception as e:
                logging.warning("Не удалось уведомить админа: %s", e)
    threading.Thread(target=send, daemon=True).start()


def _delivery_state(o):
    """('waiting'|'deferred'|'delivery', подпись статуса, пояснение)"""
    if o["delivery_id"]:
        return "delivery", db.delivery_phase(o["delivery_status"]), ""
    state, deadline = o["storage_state"], o["delivery_deadline"]
    if state == "Ждет позиции":
        return "deferred", "Отложено", "до приезда следующей посылки"
    if state == "Отсрок" and deadline:
        day = deadline.date() if isinstance(deadline, datetime) else deadline
        if day >= date.today():
            return "deferred", "Отложено", f"до {day.strftime('%d.%m.%Y')}"
    return "waiting", "Ожидает действия", ""


def _delivery_snapshot(cur, user):
    """Общие данные для экрана «Доставка» и маркера «!»."""
    channel = db.user_rate(cur, user)["is_channel"]
    rows = db.delivery_orders(cur, user["id"])
    parts = db.get_merge_parts(cur, [o["id"] for o in rows])
    active = db.active_deliveries(cur, user["id"])
    flags = db.user_flags(cur, user["id"])
    contact = "в личные сообщения канала" if channel else "в личные сообщения администратору"
    requested = f"Вы можете заранее самостоятельно прислать данные для доставки {contact}, либо ожидайте сообщения от администратора."
    items, waiting_ids = [], []
    for o in rows:
        kind, label, note = _delivery_state(o)
        if kind == "delivery" and label == "Оформлена заявка на доставку":
            note = requested
        if kind != "delivery":
            waiting_ids.append(o["id"])
        item = {"id": o["id"], "number": db.format_order_number(o["order_number"]), "title": o["title"] or "без названия",
                "photo": auth.photo_url("order", o["id"], o["photo_size"]), "kind": kind, "status": label, "note": note}
        if o.get("delivery_added_at"):
            item["tag"] = "Добавлено в посылку администратором"
        if kind != "delivery":
            item["ready_date"] = o["storage_start"]
            if o["storage_state"] != "Ждет позиции" and o["delivery_deadline"]:
                item["storage_until"] = o["delivery_deadline"]
        merged = parts.get(o["id"])
        if merged:
            item["photo"] = None
            item["parts"] = [{"number": db.format_order_number(p["original_order_number"]), "title": p["original_title"] or "без названия",
                              "photo": auth.photo_url("order", p["original_order_id"], p["photo_size"])} for p in merged]
        items.append(item)
    items.sort(key=lambda i: {"waiting": 0, "deferred": 1, "delivery": 2}[i["kind"]])
    packed_block = bool(waiting_ids) and bool(active) and not any(d["status"] in config.DELIVERY_ADDABLE for d in active)
    acked = set(flags.get("app_pack_ack_ids") or [])
    pack_notice = packed_block and any(i not in acked for i in waiting_ids)
    return {"items": items, "waiting_ids": waiting_ids, "packed_block": packed_block, "pack_notice": pack_notice,
            "flags": flags, "requested": requested}


@app.route("/api/delivery")
def api_delivery():
    user = require_user()
    with db.cursor(commit=True) as cur:
        snap = _delivery_snapshot(cur, user)
        added = db.has_unseen_admin_additions(cur, user["id"])
        db.mark_delivery_seen(cur, user["id"])
        block = db.active_delivery_block(cur)
    waiting, flags = len(snap["waiting_ids"]), snap["flags"]
    return jsonify({
        "items": snap["items"], "carriers": config.CARRIERS, "pickup": config.PICKUP, "pickup_address": config.PICKUP_ADDRESS, "waiting": waiting,
        "can_request": waiting > 0 and not snap["packed_block"] and not block, "packed_block": snap["packed_block"],
        "block": ({"from": block["date_from"], "to": block["date_to"], "reason": block["reason"]} if block else None),
        "can_defer": waiting > 0 and not flags.get("app_defer_used"), "defer_used": bool(flags.get("app_defer_used")),
        "pack_notice": snap["pack_notice"],
        "pack_notice_text": "Приехали новые позиции, но записаться на них пока нельзя: у вас уже есть упакованная посылка. "
                            "Запись откроется после её отправки.",
        "added_notice": added,
        "added_notice_text": "Администратор добавил позиции в вашу посылку — заказы объединены. Они отмечены в списке.",
        "requested_text": snap["requested"],
    })


@app.route("/api/delivery/ack", methods=["POST"])
def api_delivery_ack():
    user = require_user()
    with db.cursor(commit=True) as cur:
        snap = _delivery_snapshot(cur, user)
        db.ack_pack_notice(cur, user["id"], snap["waiting_ids"])
    return jsonify({"ok": True})


@app.route("/api/delivery/request", methods=["POST"])
def api_delivery_request():
    user = require_user()
    body = request.get_json(silent=True) or {}
    carrier = body.get("carrier")
    if carrier not in config.CARRIERS:
        return jsonify({"error": "Выберите службу доставки"}), 400
    carrier_name = str(body.get("carrier_name") or "").strip()[:40]
    if carrier == "Другое" and not carrier_name:
        return jsonify({"error": "Укажите название службы доставки"}), 400
    if carrier != "Другое":
        carrier_name = ""
    insurance = body.get("insurance")
    if carrier == config.PICKUP:
        insurance = False                       # при самовывозе страховка не нужна
    if not isinstance(insurance, bool):
        return jsonify({"error": "Укажите, нужна ли страховка"}), 400
    amount = 0
    if insurance:
        raw = str(body.get("insurance_amount") or "0").replace(" ", "")
        if not raw.isdigit() or int(raw) > 10_000_000:
            return jsonify({"error": "Сумма страховки — число, если хотите уточнить при оформлении, укажите 0"}), 400
        amount = int(raw)
    with db.cursor() as cur:
        block = db.active_delivery_block(cur)
    if block:
        return jsonify({"error": f"Запись на доставку сейчас недоступна. Причина: {block['reason']}"}), 409
    with db.cursor(commit=True) as cur:
        code, count = db.request_delivery(cur, user["id"], carrier, carrier_name or None, insurance, amount)
    if code == "none":
        return jsonify({"error": "Нет позиций для доставки"}), 409
    if code == "packed":
        return jsonify({"error": "Текущая посылка уже упакована — новые позиции можно будет записать после её отправки"}), 409
    ins = "самовывоз, без страховки" if carrier == config.PICKUP else "без страховки" if not insurance else (f"страховка {amount} ₽" if amount else "страховка — уточнить")
    _admin_notify(f"📦 Новая заявка на доставку из приложения\n{user['telegram_name']}: позиций {count}, {carrier}{' ' + carrier_name if carrier_name else ''}, {ins}.")
    return jsonify({"ok": True, "count": count})


@app.route("/api/delivery/defer", methods=["POST"])
def api_delivery_defer():
    user = require_user()
    mode = (request.get_json(silent=True) or {}).get("mode")
    if mode not in ("2weeks", "next"):
        return jsonify({"error": "Выберите вариант"}), 400
    with db.cursor(commit=True) as cur:
        code = db.defer_delivery(cur, user["id"], mode)
    if code == "used":
        return jsonify({"error": "Отсрочка уже была использована"}), 409
    if code == "none":
        return jsonify({"error": "Нет позиций, которые можно отложить"}), 409
    return jsonify({"ok": True})


@app.route("/api/notifications")
def api_notifications():
    """Лента «колокольчика»: личные сообщения + общие рассылки. Открытие ленты гасит маркер."""
    user = require_user()
    with db.cursor(commit=True) as cur:
        rows = db.app_notifications(cur, user["id"], user["channel_id"])
        seen = db.notif_seen_at(cur, user["id"])
        db.mark_notifications_seen(cur, user["id"])
    return jsonify({"items": [{"id": r["id"], "text": plain(r["text"]), "created": r["created_at"], "general": bool(r["general"]),
                               "unread": seen is None or r["created_at"] > seen} for r in rows]})


@app.route("/api/badges")
def api_badges():
    """Маркеры «!» на главной: новые оплаты, которые человек ещё не открывал, и «Доставка»:
    позиции ждут действия (если посылка уже упакована — только пока человек не нажал «Ознакомлен»)
    или админ добавил позиции в его посылку."""
    user = require_user()
    with db.cursor() as cur:
        pay = db.has_new_payments(cur, user["id"])
        snap = _delivery_snapshot(cur, user)
        added = db.has_unseen_admin_additions(cur, user["id"])
        seen = db.notif_seen_at(cur, user["id"])
        unread = any(seen is None or r["created_at"] > seen for r in db.app_notifications(cur, user["id"], user["channel_id"]))
        blocked = db.active_delivery_block(cur) is not None
    if blocked:
        waiting = False                      # пока доставка запрещена, делать нечего — маркер не нужен
    elif snap["packed_block"]:
        waiting = snap["pack_notice"]
    else:
        waiting = any(i["kind"] == "waiting" for i in snap["items"])
    return jsonify({"payments": pay, "delivery": bool(waiting or added), "notifications": unread})


@app.errorhandler(401)
def e401(e):
    return jsonify({"error": "unauthorized"}), 401


@app.errorhandler(403)
def e403(e):
    return jsonify({"error": "forbidden"}), 403


if __name__ == "__main__":
    import os
    app.run(host="0.0.0.0", port=int(os.getenv("PORT", 8080)))
