import importlib.util
import json
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from pathlib import Path

spec = importlib.util.spec_from_file_location('wake_service', Path(__file__).parents[1] / 'wake_service.py')
wake = importlib.util.module_from_spec(spec)
spec.loader.exec_module(wake)


class WakeTests(unittest.TestCase):
    def test_gain_boosts_quiet_audio_without_clipping_loud_input(self):
        import struct
        quiet = struct.pack('<hh', -100, 100) * 800
        self.assertEqual(wake.audioop.max(wake.prepare_pcm(quiet, 20), 2), 2000)
        loud = struct.pack('<hh', -30000, 30000) * 800
        self.assertLessEqual(wake.audioop.max(wake.prepare_pcm(loud, 20), 2), 28001)

    def test_phrase_requires_two_calls_and_accepts_phonetic_variants(self):
        for phrase in ['小忆小忆', '小 忆 小 忆', '小艺，小艺', '晓意晓意', '小一小一']:
            self.assertTrue(wake.contains_wake(phrase), phrase)
        for phrase in ['', '小忆', '小医生小医生', '你好', '[unk]']:
            self.assertFalse(wake.contains_wake(phrase), phrase)

    def test_partial_must_stabilize_and_have_recent_voice(self):
        gate = wake.WakeGate()
        self.assertFalse(gate.update('小艺小艺', 1, True))
        self.assertTrue(gate.update('小艺小艺', 1.2, True))
        self.assertFalse(wake.WakeGate().update('小艺小艺', 3, False, True))
        self.assertFalse(gate.update('小艺小艺', 4, False, True))

    def test_unrelated_partial_resets_candidate(self):
        gate = wake.WakeGate()
        self.assertFalse(gate.update('小一小一', 0, True))
        self.assertFalse(gate.update('[unk]', .1, True))
        self.assertFalse(gate.update('小一小一', .2, True))

    def test_busy_lease_expires_and_cannot_be_cleared_by_other_client(self):
        clock = [0]
        state = wake.WakeState(clock=lambda: clock[0])
        state.lease('recording', True)
        state.lease('other', False)
        self.assertFalse(state.capture_allowed())
        self.assertFalse(state.fire())
        clock[0] = 5.1
        self.assertTrue(state.capture_allowed())

    def test_event_is_monotonic_and_does_not_expose_audio_or_text(self):
        clock = [10]
        state = wake.WakeState(clock=lambda: clock[0])
        self.assertTrue(state.fire())
        self.assertFalse(state.fire())
        clock[0] += 1
        snapshot = state.snapshot()
        self.assertEqual(snapshot['sequence'], 1)
        self.assertEqual(snapshot['event_age_ms'], 1000)
        self.assertEqual(snapshot['audio_storage'], 'disabled')
        self.assertNotIn('transcription', snapshot)
        clock[0] += 3
        self.assertTrue(state.fire())
        self.assertEqual(state.snapshot()['sequence'], 2)

    def test_disable_is_persistent_and_stops_capture(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'wake.json'
            state = wake.WakeState(path)
            state.enable(False)
            self.assertFalse(state.capture_allowed())
            self.assertFalse(wake.WakeState(path).enabled)
            self.assertEqual(json.loads(path.read_text()), {'enabled': False})

    def test_only_valid_model_words_are_used_for_keyword_grammar(self):
        class Model:
            def vosk_model_find_word(self, word):
                return 1 if word in ['小', '一'] else -1
        class Recognizer:
            def __init__(self, model, rate, grammar):
                self.grammar = json.loads(grammar)
            def SetWords(self, value):
                pass
        result = wake.make_recognizer(Model(), Recognizer)
        self.assertEqual(result.grammar, ['小 一 小 一', '[unk]'])

    def test_control_http_validates_input_and_does_not_enable_cors(self):
        state = wake.WakeState()
        server = wake.LocalServer(('127.0.0.1', 0), wake.handler_for(state))
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        base = 'http://127.0.0.1:{}/'.format(server.server_port)
        try:
            req = urllib.request.Request(base + 'control', data=b'{"enabled":false}', headers={'Content-Type':'application/json'})
            with urllib.request.urlopen(req) as response:
                self.assertFalse(json.load(response)['enabled'])
                self.assertIsNone(response.headers.get('Access-Control-Allow-Origin'))
            req = urllib.request.Request(base + 'control', data=b'{"enabled":"false"}', headers={'Content-Type':'application/json'})
            with self.assertRaises(urllib.error.HTTPError) as result:
                urllib.request.urlopen(req)
            self.assertEqual(result.exception.code, 400)
            req = urllib.request.Request(base + 'control', data=b'{"enabled":true}', headers={'Content-Type':'application/json','Origin':'https://example.invalid'})
            with self.assertRaises(urllib.error.HTTPError) as result:
                urllib.request.urlopen(req)
            self.assertEqual(result.exception.code, 403)
            self.assertFalse(state.enabled)
        finally:
            server.shutdown()
            server.server_close()
            thread.join(1)


if __name__ == '__main__':
    unittest.main()
