"""Serves the repo for tests/run.html with caching turned off, so the browser always tests the current files.

Run from the repo root:  python tests/serve.py [port]   (default 8765), then open
http://127.0.0.1:<port>/tests/run.html
"""
import http.server
import sys


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, max-age=0")
        super().end_headers()


port = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
print(f"Serving on http://127.0.0.1:{port}/tests/run.html (no caching)", flush=True)
http.server.ThreadingHTTPServer(("127.0.0.1", port), NoCacheHandler).serve_forever()
