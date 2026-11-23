#!/usr/bin/env python3
"""Serve the Jetson UI locally and proxy all APIs to the workstation."""

import http.client
import json
import mimetypes
import os
import posixpath
import re
import socket
import socketserver
import subprocess
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from urllib.parse import unquote, urlsplit


FRONTEND_ROOT = Path(os.environ.get("YISHENG_FRONTEND_ROOT", "/opt/yisheng-guardian/frontend")).resolve()
LISTEN_HOST = os.environ.get("YISHENG_LISTEN_HOST", "127.0.0.1")
LISTEN_PORT = int(os.environ.get("YISHENG_LISTEN_PORT", "8080"))
WORKSTATION_HOST = os.environ.get("YISHENG_WORKSTATION_HOST", "192.168.55.1")

HOP_BY_HOP_HEADERS = {
    "connection",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authorization",
    "te",
    "trailers",
    "transfer-encoding",
    "upgrade",
}

# The browser talks to this server over the same origin. Forwarding its local
# Origin/Referer to the workstation would make Spring treat the server-to-
# server hop as a cross-origin browser request and reject POST/PUT with 403.
REQUEST_HEADERS_TO_REWRITE = HOP_BY_HOP_HEADERS | {
    "host",
    "content-length",
    "origin",
    "referer",
}


class ThreadingHTTPServer(socketserver.ThreadingMixIn, HTTPServer):
    daemon_threads = True
    allow_reuse_address = True


class YiShengHandler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    server_version = "YiShengJetson/1.0"

    def do_GET(self):
        if urlsplit(self.path).path == "/device-audio/volume":
            self._audio_volume()
            return
        if self.path == "/healthz":
            self._send_json({"status": "ok", "frontend_root": str(FRONTEND_ROOT)})
            return
        if urlsplit(self.path).path == "/camera-stream":
            self._camera_stream()
            return
        if self._serve_static():
            return
        self._proxy_request()

    def do_HEAD(self):
        if self._serve_static(head_only=True):
            return
        self._proxy_request(head_only=True)

    def do_POST(self):
        if urlsplit(self.path).path == "/device-audio/volume":
            self._audio_volume(update=True)
            return
        self._proxy_request()

    def _audio_volume(self, update=False):
        environment = dict(os.environ, LC_ALL="C")
        def pactl(*arguments):
            return subprocess.check_output(
                ["pactl"] + list(arguments), env=environment,
                stderr=subprocess.STDOUT, timeout=3).decode("utf-8", "replace")
        try:
            if update:
                origin = self.headers.get("Origin")
                if origin and origin != "http://" + self.headers.get("Host", ""):
                    self._send_json({"error": "origin is not allowed"}, 403)
                    return
                try:
                    length = int(self.headers.get("Content-Length", "0"))
                    if not 0 < length <= 1024:
                        raise ValueError("invalid request size")
                    volume = json.loads(self.rfile.read(length).decode("utf-8")).get("volume")
                    if type(volume) is not int or not 0 <= volume <= 100:
                        raise ValueError("volume must be an integer between 0 and 100")
                except (ValueError, AttributeError, UnicodeError):
                    self.close_connection = True
                    self._send_json({"error": "volume must be an integer between 0 and 100"}, 400)
                    return
                pactl("set-sink-volume", "yisheng_speaker", "{}%".format(volume))
                pactl("set-sink-mute", "yisheng_speaker", "0")
            output = pactl("list", "sinks")
            for sink in re.split(r"(?m)^Sink #", output):
                if re.search(r"(?m)^\s*Name: yisheng_speaker\s*$", sink):
                    match = re.search(r"\bVolume:.*?/\s*(\d+)%", sink)
                    if match:
                        muted = bool(re.search(r"\bMute: yes", sink))
                        self._send_json({"volume": 0 if muted else min(100, int(match.group(1))), "muted": muted})
                        return
            raise RuntimeError("speaker not found")
        except (OSError, subprocess.SubprocessError, RuntimeError):
            self._send_json({"error": "speaker volume is unavailable"}, 503)

    def do_PUT(self):
        self._proxy_request()

    def do_PATCH(self):
        self._proxy_request()

    def do_DELETE(self):
        self._proxy_request()

    def do_OPTIONS(self):
        self._proxy_request()

    def _send_json(self, payload, status=200):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def _local_path(self):
        parsed = urlsplit(self.path)
        relative = posixpath.normpath(unquote(parsed.path)).lstrip("/")
        candidate = (FRONTEND_ROOT / relative).resolve()
        try:
            candidate.relative_to(FRONTEND_ROOT)
        except ValueError:
            return None
        if candidate.is_dir():
            candidate = candidate / "index.html"
        return candidate

    def _serve_static(self, head_only=False):
        if self.command not in ("GET", "HEAD"):
            return False
        candidate = self._local_path()
        if candidate is None or not candidate.is_file():
            return False
        try:
            size = candidate.stat().st_size
            content_type = mimetypes.guess_type(str(candidate))[0] or "application/octet-stream"
            self.send_response(200)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(size))
            self.send_header("Cache-Control", "no-cache" if candidate.suffix in (".html", ".js", ".css") else "public, max-age=86400")
            self.end_headers()
            if not head_only:
                with candidate.open("rb") as source:
                    while True:
                        chunk = source.read(64 * 1024)
                        if not chunk:
                            break
                        self.wfile.write(chunk)
            return True
        except (OSError, BrokenPipeError):
            return True

    def _upstream(self):
        if self.path.startswith("/vision-api/"):
            return 8092, "/" + self.path[len("/vision-api/"):]
        if self.path.startswith("/digital-human-api/"):
            return 8091, "/" + self.path[len("/digital-human-api/"):]
        return 8080, self.path

    def _camera_stream(self):
        source = None
        try:
            source = socket.create_connection(("127.0.0.1", 8094), timeout=6)
            source.settimeout(30)
            self.send_response(200)
            self.send_header("Content-Type", "multipart/x-mixed-replace; boundary=yishengframe")
            self.send_header("Cache-Control", "no-store, no-cache, must-revalidate")
            self.send_header("Connection", "close")
            self.end_headers()
            self.close_connection = True
            while True:
                chunk = source.recv(64 * 1024)
                if not chunk:
                    break
                self.wfile.write(chunk)
                self.wfile.flush()
        except (OSError, BrokenPipeError):
            if source is None:
                try:
                    self._send_json({"error": "camera stream unavailable"}, 503)
                except (OSError, BrokenPipeError):
                    pass
        finally:
            if source is not None:
                source.close()

    def _proxy_request(self, head_only=False):
        port, upstream_path = self._upstream()
        length = int(self.headers.get("Content-Length", "0") or "0")
        if length > 30 * 1024 * 1024:
            self._send_json({"error": "request body is too large"}, 413)
            return
        body = self.rfile.read(length) if length else None
        headers = {
            key: value
            for key, value in self.headers.items()
            if key.lower() not in REQUEST_HEADERS_TO_REWRITE
        }
        if body is not None:
            headers["Content-Length"] = str(len(body))
        headers["Host"] = "{}:{}".format(WORKSTATION_HOST, port)
        headers["X-Forwarded-For"] = self.client_address[0]
        connection = http.client.HTTPConnection(WORKSTATION_HOST, port, timeout=310)
        try:
            connection.request(self.command, upstream_path, body=body, headers=headers)
            response = connection.getresponse()
            self.send_response(response.status, response.reason)
            has_length = False
            for key, value in response.getheaders():
                lowered = key.lower()
                if lowered in HOP_BY_HOP_HEADERS:
                    continue
                if lowered == "content-length":
                    has_length = True
                self.send_header(key, value)
            if not has_length:
                self.send_header("Connection", "close")
                self.close_connection = True
            self.end_headers()
            if head_only:
                return
            reader = response.read1 if hasattr(response, "read1") else response.read
            while True:
                chunk = reader(64 * 1024)
                if not chunk:
                    break
                self.wfile.write(chunk)
                self.wfile.flush()
        except (OSError, http.client.HTTPException) as error:
            if not self.wfile.closed:
                try:
                    self._send_json({"error": "upstream unavailable", "detail": str(error)}, 502)
                except (OSError, BrokenPipeError):
                    pass
        finally:
            connection.close()

    def log_message(self, message, *args):
        print("{} - {}".format(self.address_string(), message % args), flush=True)


if __name__ == "__main__":
    if not FRONTEND_ROOT.is_dir():
        raise SystemExit("frontend directory does not exist: {}".format(FRONTEND_ROOT))
    server = ThreadingHTTPServer((LISTEN_HOST, LISTEN_PORT), YiShengHandler)
    print("YiSheng frontend listening on http://{}:{}".format(LISTEN_HOST, LISTEN_PORT), flush=True)
    server.serve_forever()
