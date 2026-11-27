import logging
from contextlib import contextmanager
from decimal import Decimal, ROUND_CEILING

import psycopg2
from psycopg2.extras import RealDictCursor

import config

logger = logging.getLogger(__name__)
MAIN_MULTIPLIER = Decimal("1.1")


@contextmanager
def cursor(commit=False):
    conn = psycopg2.connect(config.DATABASE_URL, cursor_factory=RealDictCursor, connect_timeout=15)
    try:
        with conn.cursor() as cur:
            yield cur
        if commit:
            conn.commit()
    finally:
        conn.close()


def get_setting(cur, key, default=""):
    cur.execute("SELECT value FROM settings WHERE key = %s", (key,))
    row = cur.fetchone()
    return row["value"] if row else default


def format_order_number(n):
    if not n:
        return ""
    return n if n.startswith("#") else f"№{n}"


def format_rate(value) -> str:
    return format(Decimal(str(value)).normalize(), "f")


def find_or_create_user(telegram_id: int, username, name, channel_code=None):
    """Находит человека; если нового — создаёт со статусом «Необработанный» (заявка на доступ).
    Канал по ссылке ставится только новому человеку (как в боте)."""
    with cursor(commit=True) as cur:
        cur.execute("SELECT * FROM users WHERE telegram_id = %s", (telegram_id,))
        user = cur.fetchone()
        if user:
            return user
        channel_id = None
        if channel_code:
            cur.execute("SELECT id FROM channels WHERE code = %s AND archived = false", (channel_code.lower(),))
            row = cur.fetchone()
            channel_id = row["id"] if row else None
        cur.execute(
            "INSERT INTO users (telegram_id, username, telegram_name, channel_id) VALUES (%s, %s, %s, %s) RETURNING *",
            (telegram_id, username, name, channel_id),
        )
        user = cur.fetchone()
        cur.execute(
            "INSERT INTO history (entity_type, entity_id, description) VALUES ('user', %s, %s)",
            (user["id"], "Заявка на доступ к мини-приложению (новый пользователь)"),
        )
        return user


def get_channel(cur, channel_id):
    if not channel_id:
        return None
    cur.execute("SELECT * FROM channels WHERE id = %s", (channel_id,))
    return cur.fetchone()


def user_rate(cur, user):
    """Курс человека. Клиент канала видит ТОЛЬКО курс своего канала (множитель 1);
    если не задан — rate=None. Основной курс канальному никогда не подставляется."""
    channel = get_channel(cur, user.get("channel_id"))
    if user.get("channel_id"):
        rate = channel["rate"] if channel else None
        return {"rate": Decimal(str(rate)) if rate is not None else None, "multiplier": Decimal("1"),
                "display": format_rate(rate) if rate is not None else None, "is_channel": True,
                "channel_name": channel["name"] if channel else None, "channel_color": channel["color"] if channel else None}
    raw = get_setting(cur, "exchange_rate", "").strip()
    try:
        rate = Decimal(raw.replace(",", "."))
    except Exception:
        rate = Decimal("0")
    return {"rate": rate, "multiplier": MAIN_MULTIPLIER, "display": raw or "не задан", "is_channel": False,
            "channel_name": None, "channel_color": None}


def calculate_total(item_price, rate, multiplier) -> int:
    exact = Decimal(str(item_price)) * Decimal(str(rate)) * Decimal(str(multiplier))
    return int(exact.to_integral_value(rounding=ROUND_CEILING))


def get_orders(cur, user_id):
    cur.execute(
        """
        SELECT orders.id, orders.order_number, orders.title, orders.status, orders.items, orders.tracking_number,
               orders.created_at, orders.preorder_date, orders.event_name, orders.event_date, orders.event_state,
               orders.delivery_deadline, orders.delay_until, orders.delay_reason, orders.source, orders.source_comment,
               length(orders.photo_data) AS photo_size,
               packages.id AS package_id, packages.name AS package_name,
               packages.ship_date AS package_ship_date, packages.status AS package_status
        FROM orders LEFT JOIN packages ON orders.package_id = packages.id
        WHERE orders.user_id = %s AND orders.archived = false
        ORDER BY orders.id
        """,
        (user_id,),
    )
    return cur.fetchall()


def get_merge_parts(cur, merged_ids):
    """Из каких заказов собран объединённый заказ (с размером фото каждого)."""
    if not merged_ids:
        return {}
    cur.execute(
        """
        SELECT p.merged_order_id, p.original_order_id, p.original_order_number, p.original_title,
               length(o.photo_data) AS photo_size
        FROM order_merge_parts p LEFT JOIN orders o ON o.id = p.original_order_id
        WHERE p.merged_order_id = ANY(%s) ORDER BY p.id
        """,
        (list(merged_ids),),
    )
    result = {}
    for r in cur.fetchall():
        result.setdefault(r["merged_order_id"], []).append(r)
    return result


def get_order_photo(cur, order_id):
    cur.execute("SELECT photo_data, photo_mimetype FROM orders WHERE id = %s", (order_id,))
    return cur.fetchone()


def get_user_photo(cur, user_id):
    cur.execute("SELECT photo_data, photo_mimetype FROM users WHERE id = %s", (user_id,))
    return cur.fetchone()


def profile_stats(cur, user_id):
    cur.execute("SELECT status FROM orders WHERE user_id = %s AND archived = false", (user_id,))
    china = transit = hand = total = 0
    for r in cur.fetchall():
        total += 1
        s = r["status"]
        if s in ("Оформлен", "Выкуплен", "В пути на кит.склад", "На кит.складе"):
            china += 1
        elif s == "Отправлен в РФ":
            transit += 1
        elif s in ("Получен в РФ", "На руках у админа", "Оформлена доставка по РФ"):
            hand += 1
    return {"total": total, "china": china, "in_transit_rf": transit, "on_hand_admin": hand}


def spending_stats(cur, user_id):
    cur.execute(
        """
        SELECT
            COALESCE(SUM(CASE WHEN reason = 'Оплата за позицию' THEN paid_amount ELSE 0 END), 0) AS positions_sum,
            COALESCE(SUM(CASE WHEN reason IN ('Оплата за карго', 'Оплата за белую доставку',
                                              'Оплата за курьера', 'Оплата за доставку по РФ')
                         THEN paid_amount ELSE 0 END), 0) AS delivery_sum,
            COALESCE(SUM(CASE WHEN reason = 'Дополнительный платеж' THEN paid_amount ELSE 0 END), 0) AS extra_sum
        FROM payments WHERE user_id = %s
        """,
        (user_id,),
    )
    row = cur.fetchone()
    cur.execute("SELECT finance_started_at, deposit_amount, deposit_comment FROM users WHERE id = %s", (user_id,))
    u = cur.fetchone() or {}
    pos, dlv, ext = float(row["positions_sum"] or 0), float(row["delivery_sum"] or 0), float(row["extra_sum"] or 0)
    return {"positions_sum": pos, "delivery_sum": dlv, "extra_sum": ext, "total_sum": pos + dlv + ext,
            "since": u.get("finance_started_at"), "deposit_amount": float(u.get("deposit_amount") or 0),
            "deposit_comment": u.get("deposit_comment")}


def position_breakdown(cur, user_id):
    cur.execute(
        """
        SELECT orders.id, orders.order_number, orders.title, SUM(payment_items.paid_amount) AS total_paid
        FROM payment_items
        JOIN payments ON payment_items.payment_id = payments.id
        JOIN orders ON payment_items.order_id = orders.id
        WHERE orders.user_id = %s AND payments.reason != 'Дополнительный платеж'
        GROUP BY orders.id, orders.order_number, orders.title
        HAVING SUM(payment_items.paid_amount) > 0
        ORDER BY orders.id
        """,
        (user_id,),
    )
    return cur.fetchall()


_POS = """(SELECT STRING_AGG(COALESCE(o.order_number || ' ' || o.title, pi.comment, 'Без привязки'), ', ')
          FROM payment_items pi LEFT JOIN orders o ON pi.order_id = o.id WHERE pi.payment_id = payments.id) AS positions_label"""
PAY_ACTIVE = ("Выставлен", "Отсрочка", "Просрочен", "Частично оплачен")


def active_payments(cur, user_id):
    cur.execute(
        f"""
        SELECT id, reason, total_amount, paid_amount, deposit_applied, status, created_at, deadline_date,
               COALESCE(deadline_extended, false) AS deadline_extended, {_POS}
        FROM payments
        WHERE user_id = %s AND archived = false AND status IN ('Выставлен', 'Отсрочка', 'Просрочен', 'Частично оплачен')
          AND (needs_amount = false OR needs_amount IS NULL)
        ORDER BY created_at, id
        """,
        (user_id,),
    )
    return cur.fetchall()


def pending_payments(cur, user_id):
    """Платежи, по которым человек уже написал «оплатил» и ждёт проверки администратора."""
    cur.execute(
        f"""
        SELECT id, reason, total_amount, paid_amount, status, user_responded_at, {_POS}
        FROM payments WHERE user_id = %s AND archived = false AND status = 'На проверке' ORDER BY user_responded_at, id
        """,
        (user_id,),
    )
    return cur.fetchall()


def mark_payments_awaiting_check(cur, user_id, payment_ids, response_text, action):
    """Как в финансовом боте: помечает «оплатил, ждёт проверки» только выбранные платежи, которые ещё ждут оплаты."""
    cur.execute(
        """UPDATE payments SET user_response_text = %s, user_responded_at = now(),
               previous_status = status, status = 'На проверке', pending_action = %s
           WHERE id = ANY(%s) AND user_id = %s AND archived = false
             AND status IN ('Выставлен', 'Отсрочка', 'Просрочен', 'Частично оплачен') RETURNING id""",
        (response_text, action, list(payment_ids), user_id),
    )
    marked = [r["id"] for r in cur.fetchall()]
    for pid in marked:
        cur.execute("INSERT INTO history (entity_type, entity_id, description) VALUES ('payment', %s, %s)",
                    (pid, f"Пользователь указал данные оплаты (через приложение): {response_text}"))
    return marked


def apply_deferral(cur, payment_id, user_id, days):
    """Отсрочка один раз на платёж: от текущего дедлайна, а если он прошёл — от сегодня. Возвращает новую дату или None."""
    cur.execute(
        """UPDATE payments
           SET deadline_date = GREATEST(COALESCE(deadline_date, CURRENT_DATE), CURRENT_DATE) + %s::int,
               deadline_extended = true,
               status = CASE WHEN status = 'Частично оплачен' THEN status ELSE 'Отсрочка' END
           WHERE id = %s AND user_id = %s AND archived = false AND COALESCE(deadline_extended, false) = false
             AND status IN ('Выставлен', 'Отсрочка', 'Просрочен', 'Частично оплачен')
           RETURNING deadline_date""",
        (days, payment_id, user_id),
    )
    row = cur.fetchone()
    if not row:
        return None
    cur.execute("INSERT INTO history (entity_type, entity_id, description) VALUES ('payment', %s, %s)",
                (payment_id, f"Отсрочка предоставлена через приложение до {row['deadline_date'].strftime('%d.%m.%Y')}"))
    return row["deadline_date"]


# ---------------- доставка по РФ ----------------

WAITING_STATUSES = ("На руках у админа", "Просрок хранения")      # позиции, которые можно записать на доставку


def delivery_phase(row_status):
    """Что видит человек по статусу строки во вкладке «Доставка по РФ» в панели."""
    return config.DELIVERY_PHASE.get(row_status, "Оформлена заявка на доставку")


def delivery_orders(cur, user_id):
    """Позиции для экрана «Доставка»: ждущие действия/отложенные и уже записанные на доставку."""
    cur.execute(
        """
        SELECT o.id, o.order_number, o.title, o.status, o.storage_start, o.delivery_deadline, o.storage_state,
               length(o.photo_data) AS photo_size, o.delivery_id, o.delivery_added_at,
               d.status AS delivery_status, d.carrier, d.carrier_comment
        FROM orders o LEFT JOIN deliveries d ON o.delivery_id = d.id
        WHERE o.user_id = %s AND o.archived = false
          AND ((o.delivery_id IS NULL AND o.status = ANY(%s)) OR (o.delivery_id IS NOT NULL AND d.archived = false))
        ORDER BY o.id
        """,
        (user_id, list(WAITING_STATUSES)),
    )
    return cur.fetchall()


def active_deliveries(cur, user_id):
    cur.execute(
        "SELECT id, status FROM deliveries WHERE user_id = %s AND archived = false AND status <> 'Отправлено' ORDER BY id",
        (user_id,),
    )
    return cur.fetchall()


def user_flags(cur, user_id):
    cur.execute("SELECT app_defer_used, app_payments_seen_at, app_delivery_seen_at, app_pack_ack_ids FROM users WHERE id = %s", (user_id,))
    return cur.fetchone() or {}


def has_unseen_admin_additions(cur, user_id):
    """Админ вручную добавил позиции в посылку, а человек ещё не заходил в «Доставку»."""
    cur.execute(
        """
        SELECT 1 FROM deliveries d JOIN users u ON u.id = d.user_id
        WHERE d.user_id = %s AND d.archived = false AND d.admin_added_at IS NOT NULL
          AND (u.app_delivery_seen_at IS NULL OR d.admin_added_at > u.app_delivery_seen_at)
        LIMIT 1
        """,
        (user_id,),
    )
    return cur.fetchone() is not None


def mark_delivery_seen(cur, user_id):
    cur.execute("UPDATE users SET app_delivery_seen_at = now() WHERE id = %s", (user_id,))


def ack_pack_notice(cur, user_id, order_ids):
    """«Ознакомлен» с плашкой «записаться пока нельзя»: запоминаем, какие позиции человек уже видел."""
    cur.execute("UPDATE users SET app_pack_ack_ids = %s WHERE id = %s", (list(order_ids), user_id))


def mark_payments_seen(cur, user_id):
    cur.execute("UPDATE users SET app_payments_seen_at = now() WHERE id = %s", (user_id,))


def has_new_payments(cur, user_id):
    cur.execute(
        """
        SELECT 1 FROM payments p JOIN users u ON u.id = p.user_id
        WHERE p.user_id = %s AND p.archived = false AND p.status IN ('Выставлен', 'Отсрочка', 'Просрочен', 'Частично оплачен')
          AND (p.needs_amount = false OR p.needs_amount IS NULL)
          AND (u.app_payments_seen_at IS NULL OR p.created_at > u.app_payments_seen_at)
        LIMIT 1
        """,
        (user_id,),
    )
    return cur.fetchone() is not None


def _log(cur, entity, entity_id, text):
    cur.execute("INSERT INTO history (entity_type, entity_id, description) VALUES (%s, %s, %s)", (entity, entity_id, text))


def _add_payment_items(cur, payment_id, orders):
    for o in orders:
        cur.execute("SELECT * FROM order_merge_parts WHERE merged_order_id = %s ORDER BY id", (o["id"],))
        parts = cur.fetchall()
        if parts:
            for p in parts:
                comment = f"{p['original_order_number']} {p['original_title'] or ''}".strip()
                cur.execute("INSERT INTO payment_items (payment_id, order_id, amount, comment) VALUES (%s, %s, 0, %s)",
                            (payment_id, o["id"], comment))
        else:
            cur.execute("INSERT INTO payment_items (payment_id, order_id, amount) VALUES (%s, %s, 0)", (payment_id, o["id"]))


def request_delivery(cur, user_id, carrier, carrier_name, insurance, insurance_amount):
    """Запись на доставку: все позиции «на руках» человека. Делает то же, что кнопка «Оформить доставку» в панели
    (строка в «Доставке по РФ», черновик счёта на доставку), плюс ТК и страховка из заявки.
    Если у человека уже есть доставка, которую ещё не упаковали, позиции добавляются в неё.
    Возвращает (код, число позиций): 'ok' | 'none' (нет позиций) | 'packed' (текущая посылка уже упакована)."""
    cur.execute(
        """
        SELECT id, order_number, title FROM orders
        WHERE user_id = %s AND archived = false AND delivery_id IS NULL AND status = ANY(%s)
        ORDER BY id FOR UPDATE
        """,
        (user_id, list(WAITING_STATUSES)),
    )
    orders = cur.fetchall()
    if not orders:
        return "none", 0
    ids = [o["id"] for o in orders]

    existing = active_deliveries(cur, user_id)
    target = None
    for d in existing:
        if d["status"] in config.DELIVERY_ADDABLE:
            target = d
            break
    if existing and not target:
        return "packed", len(orders)

    if target:
        delivery_id = target["id"]
        cur.execute(
            "UPDATE deliveries SET carrier = COALESCE(carrier, %s), carrier_comment = COALESCE(carrier_comment, %s) WHERE id = %s",
            (carrier, carrier_name, delivery_id),
        )
    else:
        cur.execute(
            """
            INSERT INTO deliveries (user_id, carrier, carrier_comment, via_app, insurance_required, insurance_amount)
            VALUES (%s, %s, %s, true, %s, %s) RETURNING id
            """,
            (user_id, carrier, carrier_name, insurance, insurance_amount if insurance else None),
        )
        delivery_id = cur.fetchone()["id"]

    cur.execute(
        """
        UPDATE orders SET delivery_id = %s, status = 'Оформлена доставка по РФ', storage_state = 'Оформлена доставка',
               delivery_carrier = %s, delivery_comment = %s
        WHERE id = ANY(%s)
        """,
        (delivery_id, carrier, carrier_name, ids),
    )

    draft = None
    if target:
        cur.execute(
            """
            SELECT DISTINCT p.id FROM payments p
            JOIN payment_items pi ON pi.payment_id = p.id
            JOIN orders o ON pi.order_id = o.id
            WHERE o.delivery_id = %s AND p.reason = 'Оплата за доставку по РФ' AND p.needs_amount = true AND p.archived = false
            LIMIT 1
            """,
            (delivery_id,),
        )
        draft = cur.fetchone()
    if draft:
        payment_id = draft["id"]
    else:
        cur.execute(
            "INSERT INTO payments (user_id, reason, total_amount, status, needs_amount) "
            "VALUES (%s, 'Оплата за доставку по РФ', 0, 'Выставлен', true) RETURNING id",
            (user_id,),
        )
        payment_id = cur.fetchone()["id"]
    _add_payment_items(cur, payment_id, orders)

    cur.execute("UPDATE users SET app_defer_used = false WHERE id = %s", (user_id,))
    ins = "страховка: " + (f"{insurance_amount} ₽" if insurance and insurance_amount else "уточнить" if insurance else "нет")
    _log(cur, "user", user_id,
         f"Заявка на доставку из приложения ({carrier}{' ' + carrier_name if carrier_name else ''}, {ins}): "
         + ", ".join(f"{format_order_number(o['order_number'])} {o['title'] or ''}".strip() for o in orders)
         + (" — добавлено в существующую доставку" if target else ""))
    _log(cur, "payment", payment_id, "Автоматически создан черновик 'Оплата за доставку по РФ' — требуется указать суммы по позициям")
    return "ok", len(orders)


def defer_delivery(cur, user_id, mode):
    """Отложить запись на доставку (один раз). '2weeks' — срок записи +14 дней, 'next' — до приезда следующей посылки.
    Возвращает 'ok' | 'used' (уже было) | 'none' (нечего откладывать)."""
    cur.execute("SELECT app_defer_used FROM users WHERE id = %s FOR UPDATE", (user_id,))
    row = cur.fetchone()
    if row and row["app_defer_used"]:
        return "used"
    cur.execute(
        """
        SELECT id, delivery_deadline FROM orders
        WHERE user_id = %s AND archived = false AND delivery_id IS NULL AND status = ANY(%s) ORDER BY id FOR UPDATE
        """,
        (user_id, list(WAITING_STATUSES)),
    )
    orders = cur.fetchall()
    if not orders:
        return "none"
    from datetime import datetime, timedelta, date as _date
    for o in orders:
        if mode == "next":
            cur.execute("UPDATE orders SET status = 'На руках у админа', storage_state = 'Ждет позиции', delivery_deadline = NULL WHERE id = %s", (o["id"],))
        else:
            cur_dl = o["delivery_deadline"]
            if isinstance(cur_dl, _date) and not isinstance(cur_dl, datetime):
                cur_dl = datetime.combine(cur_dl, datetime.min.time())
            base = max(cur_dl or datetime.utcnow(), datetime.utcnow())
            cur.execute("UPDATE orders SET status = 'На руках у админа', storage_state = 'Отсрок', delivery_deadline = %s WHERE id = %s",
                        (base + timedelta(days=14), o["id"]))
        _log(cur, "order", o["id"], "Отложена запись на доставку из приложения: " + ("до приезда следующей посылки" if mode == "next" else "на 2 недели"))
    cur.execute("UPDATE users SET app_defer_used = true WHERE id = %s", (user_id,))
    return "ok"


# ---------------- уведомления (колокольчик) и запрет доставки ----------------

def today_msk():
    from datetime import datetime, timedelta
    return (datetime.utcnow() + timedelta(hours=3)).date()


def active_delivery_block(cur):
    """Запрет доставки, действующий сегодня (по Москве), или None."""
    day = today_msk()
    cur.execute(
        "SELECT date_from, date_to, reason FROM delivery_blocks WHERE date_from <= %s AND date_to >= %s ORDER BY date_to DESC LIMIT 1",
        (day, day),
    )
    return cur.fetchone()


def app_notifications(cur, user_id, channel_id):
    """Личные уведомления человека + рассылки для него (всем / основным / его каналу) за последние 60 дней."""
    cur.execute(
        """
        SELECT id, text, created_at, user_id IS NULL AS general FROM app_notifications
        WHERE created_at > now() - interval '60 days'
          AND (user_id = %s
               OR (user_id IS NULL AND (audience = 'all'
                   OR (audience = 'main' AND %s IS NULL)
                   OR (audience = 'channel' AND %s IS NOT NULL AND (channel_id IS NULL OR channel_id = %s)))))
        ORDER BY created_at DESC, id DESC LIMIT 60
        """,
        (user_id, channel_id, channel_id, channel_id),
    )
    return cur.fetchall()


def notif_seen_at(cur, user_id):
    cur.execute("SELECT app_notif_seen_at FROM users WHERE id = %s", (user_id,))
    row = cur.fetchone()
    return row["app_notif_seen_at"] if row else None


def mark_notifications_seen(cur, user_id):
    cur.execute("UPDATE users SET app_notif_seen_at = now() WHERE id = %s", (user_id,))
