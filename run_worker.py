#!/usr/bin/env python3
"""
Start the RQ worker process (separate from FastAPI).

Usage:
    python run_worker.py
"""
from __future__ import annotations

import logging

from core.config import LOG_LEVEL, RQ_QUEUE_NAME
from job_queue.connection import get_redis_connection
from job_queue.queue import get_queue

logging.basicConfig(
    format="%(asctime)s %(levelname)s [%(name)s] %(message)s",
    level=getattr(logging, LOG_LEVEL, logging.INFO),
)


def main() -> None:
    redis_conn = get_redis_connection()
    if redis_conn is None:
        raise SystemExit("Redis is required to run the RQ worker.")

    queue = get_queue()
    if queue is None:
        raise SystemExit(f"Failed to initialize RQ queue '{RQ_QUEUE_NAME}'.")

    from rq import Worker

    worker = Worker([queue], connection=redis_conn)
    logging.getLogger("run_worker").info(
        "Starting RQ worker on queue '%s'",
        RQ_QUEUE_NAME,
    )
    worker.work(with_scheduler=False)


if __name__ == "__main__":
    main()
