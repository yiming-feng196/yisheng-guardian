import importlib.util
import os
from pathlib import Path
import sys
import types
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('voice_app', Path(__file__).parents[1] / 'app.py')
worker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(worker)


class SpeechTests(unittest.TestCase):
    def test_system_proxy_is_used_when_no_override_exists(self):
        with patch.dict(os.environ, {}, clear=True), patch.object(worker, 'getproxies', return_value={'https': 'http://127.0.0.1:7890'}):
            self.assertEqual(worker.tts_proxy(), 'http://127.0.0.1:7890')

    def test_explicit_proxy_and_direct_connection_override_system_proxy(self):
        with patch.object(worker, 'getproxies', return_value={'https': 'http://system-proxy'}):
            with patch.dict(os.environ, {'VOICE_TTS_PROXY': 'http://configured-proxy'}):
                self.assertEqual(worker.tts_proxy(), 'http://configured-proxy')
            with patch.dict(os.environ, {'VOICE_TTS_PROXY': 'direct'}):
                self.assertIsNone(worker.tts_proxy())

    def test_synthesis_delivers_audio_and_passes_proxy_to_online_client(self):
        called = {}

        class Communicate:
            def __init__(self, text, **kwargs):
                called.update(text=text, **kwargs)

            async def stream(self):
                yield {'type': 'audio', 'data': b'ID3' + b'\x00' * 200}

        with patch.dict(sys.modules, {'edge_tts': types.SimpleNamespace(Communicate=Communicate)}), patch.object(worker, 'tts_proxy', return_value='http://configured-proxy'):
            response = worker.app.test_client().post('/synthesize', json={'text': '你好，小忆'})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.mimetype, 'audio/mpeg')
        self.assertTrue(response.data.startswith(b'ID3'))
        self.assertEqual(response.headers['Cache-Control'], 'no-store')
        self.assertEqual(called['proxy'], 'http://configured-proxy')
        self.assertEqual(called['text'], '你好，小忆')

    def test_upstream_failure_is_a_real_error_without_exception_details(self):
        class Communicate:
            def __init__(self, *args, **kwargs):
                pass

            async def stream(self):
                raise TimeoutError('a private upstream URL')
                yield

        with patch.dict(sys.modules, {'edge_tts': types.SimpleNamespace(Communicate=Communicate)}):
            response = worker.app.test_client().post('/synthesize', json={'text': '你好'})
        self.assertEqual(response.status_code, 503)
        self.assertNotIn('private', response.get_data(as_text=True))

    def test_empty_and_oversized_text_never_reaches_online_client(self):
        with patch.dict(sys.modules, {'edge_tts': None}):
            client = worker.app.test_client()
            for text in ['', '   ', '字' * 3001]:
                self.assertEqual(client.post('/synthesize', json={'text': text}).status_code, 400)


if __name__ == '__main__':
    unittest.main()
