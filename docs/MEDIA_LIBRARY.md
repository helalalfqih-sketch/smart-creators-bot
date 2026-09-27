# Dashboard media library

The dashboard media tab includes an authenticated gallery of media sent or received by the production Telegram bot after this change. The first gallery page refreshes every 15 seconds while visible; pagination can be refreshed manually. Metadata is stored in Redis without the expiring job-result TTL. Redis persistence/eviction settings still determine durability. Configure `ADMIN_API_TOKEN` or `DASHBOARD_PASSWORD`; the gallery fails closed if neither exists.

The bot records Telegram file IDs and, for delivered jobs, available private object-storage keys. File IDs and bot-token download URLs are not exposed in catalog responses. Telegram downloads are proxied through authenticated endpoints. Existing private object-storage keys produce short-lived signed links. Telegram file-size and availability limits can prevent previews; the UI reports this rather than presenting fabricated media.

The import button indexes retained job results that have private object-storage keys. It is idempotent and does not restore expired results or fetch full Telegram conversation history. To add old media that is no longer retained, forward it to the bot. Large forwarded files may be cataloged but unavailable for browser download via the hosted Bot API.

Routes: GET `/api/media-library`, POST `/api/media-library/import-retained`, GET `/api/media-library/{id}/content`, GET `/api/media-library/{id}/thumbnail`. All routes require admin authentication. No Telegram message is sent by gallery browsing or import.

Build the frontend before deployment (`cd frontend && npm run build`); the existing Docker image serves the committed `frontend/dist` assets. Focused tests: `python -m unittest discover -s tests -p test_media_library.py -v`.
