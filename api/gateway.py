"""Backward-compatible entry point – same app as api.server."""

from api.server import app

__all__ = ["app"]
