"""Admin media catalog, independent of expiring job results. No secret URLs stored."""
from __future__ import annotations
import hashlib
import json
from datetime import datetime, timezone
from typing import Any
from job_queue.connection import get_redis_connection

INDEX = 'media:library:index'
_memory: dict[str, dict] = {}


def save_media(record: dict) -> dict:
    item = dict(record)
    identity = item.get('identity') or item.get('job_id')
    if not identity:
        raise ValueError('Media identity required')
    item['id'] = hashlib.sha256(str(identity).encode()).hexdigest()
    item['created_at'] = item.get('created_at') or datetime.now(timezone.utc).isoformat()
    conn = get_redis_connection()
    if conn is None:
        _memory[item['id']] = {**_memory.get(item['id'], {}), **item}
        return _memory[item['id']]
    key = f"media:library:item:{item['id']}"
    old = conn.get(key)
    item = {**(json.loads(old) if old else {}), **item}
    score = datetime.fromisoformat(item['created_at'].replace('Z', '+00:00')).timestamp()
    with conn.pipeline() as pipe:
        pipe.set(key, json.dumps(item))
        pipe.zadd(INDEX, {item['id']: score})
        pipe.execute()
    return item


def get_media(item_id: str) -> dict | None:
    conn = get_redis_connection()
    if conn is None:
        return _memory.get(item_id)
    raw = conn.get(f'media:library:item:{item_id}')
    return json.loads(raw) if raw else None


def list_media(offset: int = 0, limit: int = 24) -> tuple[list[dict], int]:
    conn = get_redis_connection()
    if conn is None:
        items = sorted(_memory.values(), key=lambda x: x['created_at'], reverse=True)
        return items[offset:offset + limit], len(items)
    ids = conn.zrevrange(INDEX, offset, offset + limit - 1)
    if not ids:
        return [], conn.zcard(INDEX)
    keys = ['media:library:item:' + (i.decode() if isinstance(i, bytes) else i) for i in ids]
    return [json.loads(raw) for raw in conn.mget(keys) if raw], conn.zcard(INDEX)


def record_message(message: Any, *, direction: str, job_id: str | None = None) -> None:
    """Record only actual Telegram photo/video/audio/document message objects."""
    if not isinstance(getattr(message, 'message_id', None), int):
        return
    media = None
    kind = ''
    for field in ('video', 'animation', 'audio', 'voice', 'document'):
        candidate = getattr(message, field, None)
        if isinstance(getattr(candidate, 'file_id', None), str):
            media, kind = candidate, field
            break
    photos = getattr(message, 'photo', None)
    if media is None and isinstance(photos, (list, tuple)) and photos:
        media, kind = photos[-1], 'photo'
    if media is None:
        return
    mime = getattr(media, 'mime_type', None) or ('image/jpeg' if kind == 'photo' else '')
    if kind == 'document':
        kind = 'video' if mime.startswith('video/') else 'audio' if mime.startswith('audio/') else 'photo' if mime.startswith('image/') else 'document'
    thumbnail = getattr(media, 'thumbnail', None)
    chat_id = message.chat_id
    record = {
        'identity': f'job:{job_id}' if job_id else f'telegram:{chat_id}:{message.message_id}',
        'telegram_file_id': media.file_id,
        'thumbnail_file_id': getattr(thumbnail, 'file_id', None),
        'kind': kind, 'mime_type': mime, 'direction': direction,
        'filename': getattr(media, 'file_name', None) or f'{kind}-{message.message_id}',
        'caption': (getattr(message, 'caption', None) or '')[:2000],
        'duration': getattr(media, 'duration', 0) or 0,
        'file_size': getattr(media, 'file_size', 0) or 0,
        'chat_id': chat_id, 'message_id': message.message_id,
        'created_at': message.date.isoformat(),
        'job_id': job_id,
    }
    if job_id:
        from storage.result_store import get_result
        result = get_result(job_id)
        if result:
            record['storage_key'] = result.get('storage_key')
            record['thumbnail_storage_key'] = result.get('thumbnail_storage_key')
    save_media(record)
