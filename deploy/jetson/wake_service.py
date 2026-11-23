#!/usr/bin/env python3
"""Offline Xiaoyi wake listener. Compatible with Jetson's Python 3.6.

Microphone PCM and decoder text stay in RAM. HTTP exposes only a wake counter,
health and controls; there is no audio upload, recording or transcript route.
"""
import audioop
import json
import os
import re
import select
import signal
import socketserver
import subprocess
import threading
import time
import uuid
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from urllib.parse import urlsplit

WAKE_PATTERN = re.compile(r"[小晓筱][忆意艺易怡依一伊益毅医衣仪宜壹][小晓筱][忆意艺易怡依一伊益毅医衣仪宜壹]")


def contains_wake(text):
    return bool(WAKE_PATTERN.search(re.sub(r"[\s，。！？、,.!?]", "", text or "")))


class WakeGate:
    def __init__(self):
        self.since = None
        self.last_voice = -100.0

    def update(self, text, now, voiced, final=False):
        if voiced:
            self.last_voice = now
        if not contains_wake(text) or now - self.last_voice > 1.0:
            self.since = None
            return False
        if self.since is None:
            self.since = now
        return final or now - self.since >= 0.15


class WakeState:
    def __init__(self, preference=None, clock=time.monotonic):
        self.lock = threading.RLock()
        self.changed = threading.Event()
        self.shutdown = threading.Event()
        self.clock = clock
        self.preference = Path(preference) if preference else None
        self.enabled = True
        if self.preference and self.preference.is_file():
            try:
                self.enabled = json.loads(self.preference.read_text()).get("enabled", True) is True
            except (OSError, ValueError):
                pass
        self.ready = False
        self.listening = False
        self.error = ""
        self.sequence = 0
        self.instance_id = uuid.uuid4().hex
        self.wake_at = None
        self.cooldown_until = 0.0
        self.leases = {}
        self.last_audio = None

    def _busy(self):
        now = self.clock()
        self.leases = {key: until for key, until in self.leases.items() if until > now}
        return bool(self.leases) or now < self.cooldown_until

    def capture_allowed(self):
        with self.lock:
            return self.enabled and not self._busy() and not self.shutdown.is_set()

    def enable(self, enabled):
        with self.lock:
            if self.preference:
                self.preference.parent.mkdir(parents=True, exist_ok=True)
                temporary = self.preference.with_suffix(".new")
                temporary.write_text(json.dumps({"enabled": enabled}))
                temporary.chmod(0o600)
                temporary.replace(self.preference)
            self.enabled = enabled
            self.listening = False
            if not enabled:
                self.cooldown_until = 0
            self.changed.set()

    def lease(self, client, busy, seconds=5):
        with self.lock:
            if busy:
                if len(self.leases) >= 32 and client not in self.leases:
                    self._busy()
                    if len(self.leases) >= 32:
                        raise ValueError("too many clients")
                self.leases[client] = self.clock() + min(10, max(2, seconds))
                self.listening = False
            else:
                self.leases.pop(client, None)
            self.changed.set()

    def fire(self):
        with self.lock:
            if not self.capture_allowed():
                return False
            self.sequence += 1
            self.wake_at = self.clock()
            self.cooldown_until = self.clock() + 3.0
            self.listening = False
            self.changed.set()
            return True

    def snapshot(self):
        with self.lock:
            busy = self._busy()
            recent = self.last_audio is not None and self.clock() - self.last_audio < 1.5
            listening = self.enabled and self.ready and self.listening and not busy and recent
            state = "disabled" if not self.enabled else "error" if self.error else "starting" if not self.ready else "paused" if busy else "listening" if listening else "starting"
            return {"enabled": self.enabled, "ready": self.ready, "listening": listening,
                    "state": state, "reason": self.error, "sequence": self.sequence,
                    "instance_id": self.instance_id,
                    "event_age_ms": None if self.wake_at is None else max(0, round((self.clock() - self.wake_at) * 1000)),
                    "wake_phrase": "小忆小忆", "audio_storage": "disabled", "recognition": "local"}


def make_recognizer(model, recognizer_class):
    # Only include vocabulary items present in this model. Chinese aliases share
    # the same wake sound; [unk] keeps unrelated speech out of the keyword path.
    candidates = ["小 忆 小 忆", "小 意 小 意", "小 艺 小 艺", "小 易 小 易", "小 一 小 一", "小 依 小 依", "小艺 小艺", "小易 小易", "小一 小一"]
    grammar = [phrase for phrase in candidates if all(model.vosk_model_find_word(word) >= 0 for word in phrase.split())]
    if not grammar:
        raise RuntimeError("wake vocabulary unavailable")
    recognizer = recognizer_class(model, 16000, json.dumps(grammar + ["[unk]"], ensure_ascii=False))
    recognizer.SetWords(True)
    return recognizer


def prepare_pcm(pcm, gain):
    centered = audioop.bias(pcm, 2, -audioop.avg(pcm, 2))
    peak = max(1, audioop.max(centered, 2))
    return audioop.mul(centered, 2, min(gain, 28000.0 / peak))


def stop_capture(process):
    if process is None:
        return
    if process.poll() is None:
        process.terminate()
        try:
            process.wait(timeout=1)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait(timeout=1)
    if process.stdout:
        process.stdout.close()


def listen(state, model_path, source, gain):
    recognizer = None
    while not state.shutdown.is_set():
        if recognizer is None:
            try:
                from vosk import Model, KaldiRecognizer, SetLogLevel
                SetLogLevel(-1)
                model = Model(str(model_path))
                recognizer = make_recognizer(model, KaldiRecognizer)
                with state.lock:
                    state.ready, state.error = True, ""
            except Exception:
                with state.lock:
                    state.error = "model_unavailable"
                state.shutdown.wait(3)
                continue
        if not state.capture_allowed():
            with state.lock:
                state.listening = False
            state.changed.wait(0.25)
            state.changed.clear()
            continue
        process = None
        try:
            recognizer.Reset()
            gate = WakeGate()
            process = subprocess.Popen(["parec", "--device=" + source, "--format=s16le", "--rate=16000", "--channels=1", "--latency-msec=100", "--client-name=YiSheng-Wake"], stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, bufsize=0)
            pending = b""
            while state.capture_allowed():
                readable, _, _ = select.select([process.stdout], [], [], 0.25)
                if not readable:
                    if process.poll() is not None:
                        raise RuntimeError("microphone closed")
                    continue
                data = os.read(process.stdout.fileno(), 3200)
                if not data:
                    raise RuntimeError("microphone unavailable")
                pending += data
                if len(pending) < 3200:
                    continue
                pcm, pending = pending[:3200], pending[3200:]
                pcm = prepare_pcm(pcm, gain)
                voiced = audioop.rms(pcm, 2) >= 180
                with state.lock:
                    state.listening, state.error, state.last_audio = True, "", state.clock()
                final = recognizer.AcceptWaveform(pcm)
                result = json.loads(recognizer.Result() if final else recognizer.PartialResult())
                text = result.get("text" if final else "partial", "")
                if gate.update(text, state.clock(), voiced, final):
                    if state.fire():
                        break
                if final:
                    gate = WakeGate()
        except Exception:
            with state.lock:
                state.listening, state.error = False, "microphone_unavailable"
            state.shutdown.wait(1)
        finally:
            stop_capture(process)
            with state.lock:
                state.listening = False


class LocalServer(socketserver.ThreadingMixIn, HTTPServer):
    daemon_threads = True
    allow_reuse_address = True


def handler_for(state):
    class Handler(BaseHTTPRequestHandler):
        def respond(self, value, status=200):
            data = json.dumps(value, ensure_ascii=False).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(data)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(data)

        def do_GET(self):
            if urlsplit(self.path).path != "/status":
                self.respond({"error": "not found"}, 404)
                return
            self.respond(state.snapshot())

        def do_POST(self):
            origin = self.headers.get("Origin")
            try:
                parsed = urlsplit(origin) if origin else None
                disallowed = parsed and (parsed.hostname not in ["localhost", "127.0.0.1"] or parsed.port not in [8080, 8095])
            except ValueError:
                disallowed = True
            if disallowed:
                self.respond({"error": "origin not allowed"}, 403)
                return
            if self.headers.get("Content-Type", "").split(";")[0].strip() != "application/json":
                self.respond({"error": "JSON required"}, 415)
                return
            try:
                length = int(self.headers.get("Content-Length", "0"))
                if not 0 < length <= 2048:
                    raise ValueError()
                data = json.loads(self.rfile.read(length).decode("utf-8"))
                path = urlsplit(self.path).path
                if path == "/control":
                    if type(data.get("enabled")) is not bool:
                        raise ValueError()
                    state.enable(data["enabled"])
                elif path == "/lease":
                    client = data.get("client", "")
                    if not isinstance(client, str) or not 1 <= len(client) <= 80 or type(data.get("busy")) is not bool:
                        raise ValueError()
                    state.lease(client, data["busy"])
                else:
                    self.respond({"error": "not found"}, 404)
                    return
                self.respond(state.snapshot())
            except (ValueError, TypeError, AttributeError):
                self.respond({"error": "invalid request"}, 400)
            except OSError:
                self.respond({"error": "preference unavailable"}, 503)

        def log_message(self, *_args):
            pass
    return Handler


def main():
    root = Path(__file__).resolve().parent
    state = WakeState(os.getenv("WAKE_PREFERENCE", str(Path.home() / ".config/yisheng-companion/wake.json")))
    worker = threading.Thread(target=listen, args=(state, os.getenv("WAKE_MODEL", str(root / "models/vosk-model-small-cn-0.22")), os.getenv("WAKE_SOURCE", "yisheng_microphone"), min(30, max(1, float(os.getenv("WAKE_GAIN", "20"))))), daemon=True)
    server = LocalServer(("127.0.0.1", int(os.getenv("WAKE_PORT", "8095"))), handler_for(state))
    def terminate(_signal, _frame):
        raise KeyboardInterrupt()
    signal.signal(signal.SIGTERM, terminate)
    worker.start()
    try:
        server.serve_forever(poll_interval=0.25)
    except KeyboardInterrupt:
        pass
    finally:
        state.shutdown.set()
        state.changed.set()
        server.server_close()
        worker.join(timeout=2)


if __name__ == "__main__":
    main()
