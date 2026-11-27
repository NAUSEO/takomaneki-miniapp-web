"""Проверка подписи Телеграма (initData) и подписанные ссылки на фото."""
import hashlib
import hmac
import json
import time
from urllib.parse import parse_qsl

import config


def validate_init_data(init_data: str):
    """Возвращает словарь данных (с ключом 'user'), если подпись верна и свежа, иначе None."""
    if not init_data or not config.BOT_TOKEN:
        return None
    try:
        pairs = dict(parse_qsl(init_data, keep_blank_values=True, strict_parsing=True))
    except ValueError:
        return None
    received_hash = pairs.pop("hash", None)
    if not received_hash:
        return None
    check_string = "\n".join(f"{k}={pairs[k]}" for k in sorted(pairs))
    secret = hmac.new(b"WebAppData", config.BOT_TOKEN.encode(), hashlib.sha256).digest()
    expected = hmac.new(secret, check_string.encode(), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expected, received_hash):
        return None
    try:
        if time.time() - int(pairs.get("auth_date", "0")) > config.INIT_DATA_MAX_AGE:
            return None
        user = json.loads(pairs.get("user", ""))
        int(user["id"])
    except (ValueError, KeyError, TypeError):
        return None
    pairs["user"] = user
    return pairs


def photo_signature(kind: str, entity_id: int, size: int) -> str:
    """Ссылка на фото не угадывается; меняется при замене фото (size)."""
    msg = f"{kind}:{entity_id}:{size}".encode()
    return hmac.new(config.SECRET_KEY.encode(), msg, hashlib.sha256).hexdigest()[:24]


def photo_url(kind: str, entity_id: int, size) -> str | None:
    if not size:
        return None
    return f"/photo/{kind}/{entity_id}?v={size}&s={photo_signature(kind, entity_id, int(size))}"
