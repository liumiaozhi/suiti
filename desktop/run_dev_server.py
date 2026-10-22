# -*- coding: utf-8 -*-
"""开发用 HTTP 服务：把 app/gui 当静态站点，并把 /api/<name> 直接接到真实 Api。

这样浏览器里预览的界面与打包后的 exe 完全同一套代码（只有桥接层从
pywebview.api 换成 fetch），既能截图核对，也能在没有 GUI 的环境里调试。
仅供开发使用，不参与打包。

用法：
    .venv-build\\Scripts\\python.exe run_dev_server.py [端口]
    然后浏览器打开 http://127.0.0.1:8765/index.html?dev=1#/home
"""
from __future__ import annotations

import json
import logging
import os
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import unquote, urlparse

HERE = os.path.dirname(os.path.abspath(__file__))
APP = os.path.join(HERE, "app")
sys.path.insert(0, APP)

import db  # noqa: E402
import paths  # noqa: E402
from api import Api  # noqa: E402

LOG = logging.getLogger("dev")
MIME = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".ico": "image/x-icon",
    ".png": "image/png",
    ".svg": "image/svg+xml",
}

API = Api()


class Handler(BaseHTTPRequestHandler):
    server_version = "SuiTiDev/1.0"

    def log_message(self, fmt, *args):
        LOG.info("%s - %s" % (self.address_string(), fmt % args))

    def do_GET(self):
        p = urlparse(self.path).path
        if p in ("/", "/index.html"):
            p = "/index.html"
        fp = os.path.normpath(os.path.join(paths.gui_dir(), p.lstrip("/")))
        if not fp.startswith(str(paths.gui_dir())) or not os.path.isfile(fp):
            self.send_error(404, "not found")
            return
        ext = os.path.splitext(fp)[1].lower()
        with open(fp, "rb") as f:
            data = f.read()
        self.send_response(200)
        self.send_header("Content-Type", MIME.get(ext, "application/octet-stream"))
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)

    def do_POST(self):
        p = urlparse(self.path).path
        if not p.startswith("/api/"):
            self.send_error(404)
            return
        name = unquote(p[5:])
        length = int(self.headers.get("Content-Length") or 0)
        try:
            payload = json.loads(self.rfile.read(length) or b"{}")
        except ValueError:
            payload = {}
        fn = getattr(API, name, None)
        if fn is None or name.startswith("_"):
            out = {"ok": False, "error": {"code": "NO_METHOD", "msg": "接口不存在：%s" % name}}
        else:
            try:
                out = fn(payload)
            except Exception as e:  # 兜底，Api 内部已 guard
                out = {"ok": False, "error": {"code": "INTERNAL", "msg": str(e)}}
        body = json.dumps(out, ensure_ascii=False).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


def main():
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    db.init_db()
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
    srv = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    print("dev server: http://127.0.0.1:%d/index.html?dev=1#/home" % port)
    print("data dir:", paths.data_dir())
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
