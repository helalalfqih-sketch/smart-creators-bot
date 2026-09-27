import os
import unittest
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import patch, MagicMock

from storage import media_library as store


class MediaCatalogTests(unittest.TestCase):
    def setUp(self):
        store._memory.clear()
        self.redis = patch.object(store, 'get_redis_connection', return_value=None)
        self.redis.start()
        self.addCleanup(self.redis.stop)

    def test_idempotent_catalog_and_newest_first(self):
        store.save_media({'identity': 'a', 'created_at': '2026-09-01T00:00:00+00:00'})
        store.save_media({'identity': 'b', 'created_at': '2026-09-02T00:00:00+00:00'})
        store.save_media({'identity': 'a', 'created_at': '2026-09-01T00:00:00+00:00', 'filename': 'new'})
        records, total = store.list_media(0, 1)
        self.assertEqual(total, 2)
        self.assertEqual(records[0]['identity'], 'b')
        records, _ = store.list_media(1, 1)
        self.assertEqual(records[0]['filename'], 'new')

    def test_received_photo_uses_largest_size(self):
        photo = SimpleNamespace(file_id='largest', file_size=90)
        message = SimpleNamespace(message_id=12, chat_id=34, photo=[SimpleNamespace(file_id='small'), photo], date=datetime.now(timezone.utc), caption='photo')
        store.record_message(message, direction='received')
        records, total = store.list_media()
        self.assertEqual(total, 1)
        self.assertEqual(records[0]['telegram_file_id'], 'largest')
        self.assertEqual(records[0]['kind'], 'photo')

    def test_sent_video_and_retained_job_share_identity(self):
        video = SimpleNamespace(file_id='file', mime_type='video/mp4', duration=20)
        message = SimpleNamespace(message_id=12, chat_id=34, video=video, date=datetime.now(timezone.utc))
        with patch('storage.result_store.get_result', return_value={'storage_key': 'private/video.mp4'}):
            store.record_message(message, direction='sent', job_id='job1')
        store.save_media({'identity': 'job:job1', 'storage_key': 'private/video.mp4'})
        records, total = store.list_media()
        self.assertEqual(total, 1)
        self.assertEqual(records[0]['telegram_file_id'], 'file')


class MediaApiTests(unittest.TestCase):
    def setUp(self):
        from fastapi import FastAPI, Depends
        from fastapi.testclient import TestClient
        from api.media_library import router
        from api.server import require_media_library_auth
        self.env = patch.dict(os.environ, {'ADMIN_API_TOKEN': 'test-admin', 'DASHBOARD_PASSWORD': '', 'DASHBOARD_USERNAME': 'admin'})
        self.env.start()
        self.addCleanup(self.env.stop)
        app = FastAPI()
        app.include_router(router, dependencies=[Depends(require_media_library_auth)])
        self.client = TestClient(app)
        self.auth = ('admin', 'test-admin')

    def test_routes_reject_anonymous_and_fail_closed(self):
        self.assertEqual(self.client.get('/api/media-library').status_code, 401)
        self.assertEqual(self.client.post('/api/media-library/import-retained').status_code, 401)
        self.assertEqual(self.client.get('/api/media-library/' + 'a'*64 + '/content').status_code, 401)
        with patch.dict(os.environ, {'ADMIN_API_TOKEN': '', 'DASHBOARD_PASSWORD': ''}):
            self.assertEqual(self.client.get('/api/media-library').status_code, 503)

    def test_listing_does_not_expose_telegram_file_id_or_storage_key(self):
        with patch('api.media_library.list_media', return_value=([{'id': 'a'*64, 'telegram_file_id': 'secret-id', 'storage_key': 'private-key'}], 1)):
            response = self.client.get('/api/media-library', auth=self.auth)
        self.assertEqual(response.status_code, 200)
        self.assertNotIn('secret-id', response.text)
        self.assertNotIn('private-key', response.text)

    def test_proxy_streams_range_without_revealing_token(self):
        response = MagicMock(status_code=206, headers={'Content-Type': 'video/mp4', 'Content-Range': 'bytes 0-2/10'})
        response.iter_content.return_value = [b'abc']
        with patch('api.media_library.get_media', return_value={'telegram_file_id':'id', 'filename':'video.mp4'}), patch('api.media_library._telegram_file_url', return_value='https://api.telegram.org/file/botSECRET/a.mp4'), patch('api.media_library.requests.get', return_value=response) as get:
            result = self.client.get('/api/media-library/' + 'a'*64 + '/content', auth=self.auth, headers={'Range':'bytes=0-2'})
        self.assertEqual(result.status_code, 206)
        self.assertEqual(result.content, b'abc')
        self.assertNotIn('SECRET', str(result.headers))
        self.assertEqual(get.call_args.kwargs['headers']['Range'], 'bytes=0-2')
        response.close.assert_called_once()

    def test_html_file_is_download_only(self):
        response = MagicMock(status_code=200, headers={'Content-Type':'text/html'})
        response.iter_content.return_value = [b'<script>alert(1)</script>']
        with patch('api.media_library.get_media', return_value={'telegram_file_id':'id'}), patch('api.media_library._telegram_file_url', return_value='https://api.telegram.org/file/example'), patch('api.media_library.requests.get', return_value=response):
            result = self.client.get('/api/media-library/' + 'a'*64 + '/content', auth=self.auth)
        self.assertTrue(result.headers['content-disposition'].startswith('attachment'))
        self.assertEqual(result.headers['content-type'], 'application/octet-stream')



class DeliveryCatalogTests(unittest.IsolatedAsyncioTestCase):
    async def test_catalog_outage_does_not_trigger_duplicate_delivery(self):
        import tempfile
        from unittest.mock import AsyncMock
        from bot import telegram_bot
        with tempfile.NamedTemporaryFile(suffix='.mp4') as file:
            context = SimpleNamespace(bot=SimpleNamespace(send_video=AsyncMock(), send_document=AsyncMock()))
            with patch('storage.media_library.record_message', side_effect=RuntimeError('offline')), patch.object(telegram_bot, 'confirm_job_delivery') as confirm:
                await telegram_bot._send_result_media_unlocked(context, 123, {'job_id':'catalog-test','file':file.name,'media_type':'video'}, offer_4k=False)
            context.bot.send_video.assert_awaited_once()
            context.bot.send_document.assert_not_awaited()
            confirm.assert_called_once_with('catalog-test')

if __name__ == '__main__':
    unittest.main()
