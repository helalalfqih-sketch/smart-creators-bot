"""
Cache layer: tries Redis first, falls back to a TTL-aware in-memory dict.
"""
from __future__ import annotations

import asyncio
import json
import logging
import time
from typing import Any, Protocol

from core.config import CACHE_TTL_SECONDS, REDIS_URL

logger = logging.getLogger("cache")


class CacheProtocol(Protocol):
    async def get(self, key: str) -> Any | None:
        ...

    async def set(self, key: str, value: Any, ttl: int = CACHE_TTL_SECONDS) -> None:
        ...

    async def delete(self, key: str) -> None:
        ...

    async def close(self) -> None:
        ...


# ── In-memory fallback ────────────────────────────────────────────────────────

class _MemoryCache:
    """Simple TTL-aware in-memory cache (no external dependency)."""

    def __init__(self) -> None:
        self._store: dict[str, tuple[Any, float]] = {}  # key -> (value, expires_at)
        self._lock = asyncio.Lock()

    async def get(self, key: str) -> Any | None:
        async with self._lock:
            entry = self._store.get(key)
            if entry is None:
                return None
            value, expires_at = entry
            if time.monotonic() > expires_at:
                del self._store[key]
                return None
            return value

    async def set(self, key: str, value: Any, ttl: int = CACHE_TTL_SECONDS) -> None:
        async with self._lock:
            self._store[key] = (value, time.monotonic() + ttl)

    async def delete(self, key: str) -> None:
        async with self._lock:
            self._store.pop(key, None)

    async def close(self) -> None:
        pass


# ── Redis wrapper ─────────────────────────────────────────────────────────────

class _RedisCache:
    def __init__(self, client: Any) -> None:
        self._r = client

    async def get(self, key: str) -> Any | None:
        raw = await self._r.get(key)
        if raw is None:
            return None
        return json.loads(raw)

    async def set(self, key: str, value: Any, ttl: int = CACHE_TTL_SECONDS) -> None:
        await self._r.set(key, json.dumps(value), ex=ttl)

    async def delete(self, key: str) -> None:
        await self._r.delete(key)

    async def close(self) -> None:
        await self._r.aclose()


# ── Factory ───────────────────────────────────────────────────────────────────

async def create_cache() -> _RedisCache | _MemoryCache:
    """Return a Redis-backed cache or fall back to in-memory."""
    try:
        import redis.asyncio as aioredis  # type: ignore

        client = aioredis.from_url(REDIS_URL, socket_connect_timeout=2, decode_responses=True)
        await client.ping()
        logger.info("✅ Redis connected at %s", REDIS_URL)
        return _RedisCache(client)
    except Exception as exc:
        logger.warning("⚠️  Redis unavailable (%s) – using in-memory cache", exc)
        return _MemoryCache()
