"""Authenticated catalog and Telegram file proxy. Never return bot-token URLs."""
from __future__ import annotations
import re
from urllib.parse import quote
import requests
from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import RedirectResponse, StreamingResponse
from storage.media_library import get_media, list_media, save_media
from storage.object_store import create_signed_download_url

router = APIRouter(prefix='/api/media-library')


@router.get('')
def catalog(offset: int = Query(0, ge=0), limit: int = Query(24, ge=1, le=100)):
    records, total = list_media(offset, limit)
    items = []
    for record in records:
        item = {k: record.get(k) for k in ('id', 'kind', 'filename', 'caption', 'duration', 'file_size', 'created_at', 'direction')}
        item['content_url'] = f"/api/media-library/{record['id']}/content"
        item['thumbnail_url'] = f"/api/media-library/{record['id']}/thumbnail" if record.get('thumbnail_file_id') or record.get('thumbnail_storage_key') else None
        items.append(item)
    return {'items': items, 'total': total, 'next_offset': offset + len(items) if offset + len(items) < total else None}


@router.post('/import-retained')
def import_retained(cursor: int = Query(0, ge=0)):
    """Import a bounded Redis scan page, without claiming Telegram history access."""
    from job_queue.connection import get_redis_connection
    conn = get_redis_connection()
    if conn is None:
        raise HTTPException(503, 'Redis غير متاح لحفظ مكتبة الوسائط')
    import json
    next_cursor, keys = conn.scan(cursor=cursor, match='media:result:*', count=100)
    imported = 0
    for key in keys:
        raw = conn.get(key)
        if not raw:
            continue
        record = json.loads(raw)
        # Worker-local files and expired external URLs are not durable media sources.
        if not record.get('storage_key'):
            continue
        job_id = record['job_id']
        import hashlib
        if get_media(hashlib.sha256(f'job:{job_id}'.encode()).hexdigest()):
            continue
        kind = str(record.get('media_type', 'document')).split('/')[0]
        save_media({'identity': f'job:{job_id}', 'job_id': job_id,
                    'storage_key': record['storage_key'],
                    'thumbnail_storage_key': record.get('thumbnail_storage_key'),
                    'kind': kind, 'filename': record.get('filename') or job_id,
                    'duration': record.get('duration', 0), 'direction': 'retained',
                    'created_at': record.get('completed_at')})
        imported += 1
    return {'imported': imported, 'cursor': int(next_cursor)}


def _telegram_file_url(file_id: str) -> str:
    from core.config import BOT_TOKEN
    if not BOT_TOKEN:
        raise HTTPException(503, 'اتصال تلجرام غير مهيأ')
    try:
        result = requests.post(f'https://api.telegram.org/bot{BOT_TOKEN}/getFile',
                               json={'file_id': file_id}, timeout=20)
        data = result.json()
        path = data.get('result', {}).get('file_path', '')
        if not data.get('ok') or not re.fullmatch(r'[A-Za-z0-9_./-]+', path) or '..' in path.split('/') or path.startswith('/'):
            raise HTTPException(410, 'تعذرت معاينة الملف من تلجرام؛ قد يتجاوز حد حجم التنزيل أو لم يعد متاحًا')
        return f'https://api.telegram.org/file/bot{BOT_TOKEN}/{path}'
    except requests.RequestException:
        raise HTTPException(502, 'تعذر الاتصال بخادم الوسائط') from None
    except ValueError:
        raise HTTPException(502, 'استجابة غير صالحة من خادم الوسائط') from None


@router.get('/{item_id}/{part}')
def content(item_id: str, part: str, request: Request, download: bool = False):
    if not re.fullmatch(r'[a-f0-9]{64}', item_id) or part not in ('content', 'thumbnail'):
        raise HTTPException(404, 'الوسائط غير موجودة')
    item = get_media(item_id)
    if not item:
        raise HTTPException(404, 'الوسائط غير موجودة')
    thumb = part == 'thumbnail'
    storage_key = item.get('thumbnail_storage_key' if thumb else 'storage_key')
    if storage_key:
        try:
            return RedirectResponse(create_signed_download_url(storage_key), headers={'Cache-Control': 'private, no-store'})
        except Exception:
            pass  # Try the recorded Telegram file when object storage is unavailable.
    file_id = item.get('thumbnail_file_id' if thumb else 'telegram_file_id')
    if not file_id:
        raise HTTPException(410, 'الملف غير متاح؛ أعد توجيهه إلى البوت لإضافته للمكتبة')
    url = _telegram_file_url(file_id)
    headers = {}
    range_value = request.headers.get('range', '')
    if range_value and re.fullmatch(r'bytes=\d*-\d*', range_value):
        headers['Range'] = range_value
    try:
        upstream = requests.get(url, headers=headers, stream=True, timeout=(15, 60), allow_redirects=False)
    except requests.RequestException:
        raise HTTPException(502, 'تعذر تحميل الوسائط') from None
    if upstream.status_code not in (200, 206):
        upstream.close()
        raise HTTPException(410, 'الملف غير متاح للعرض حاليًا')
    response_headers = {'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff'}
    for name in ('Content-Length', 'Content-Range', 'Accept-Ranges'):
        if name in upstream.headers:
            response_headers[name] = upstream.headers[name]
    mime = upstream.headers.get('Content-Type', 'application/octet-stream').split(';')[0]
    safe_preview = mime in ('image/jpeg', 'image/png', 'image/webp', 'image/gif', 'video/mp4', 'video/webm', 'audio/mpeg', 'audio/ogg', 'audio/mp4')
    disposition = 'attachment' if download or not safe_preview else 'inline'
    response_headers['Content-Disposition'] = f"{disposition}; filename*=UTF-8''{quote(str(item.get('filename') or 'media'), safe='')}"
    def chunks():
        try:
            yield from upstream.iter_content(chunk_size=256 * 1024)
        finally:
            upstream.close()
    return StreamingResponse(chunks(), status_code=upstream.status_code, media_type=mime if safe_preview else 'application/octet-stream', headers=response_headers)
