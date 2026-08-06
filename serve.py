"""Run Omnia locally.

    python serve.py              # serve app/ and open a browser
    python serve.py --tests      # serve the repo root, open both test pages
    python serve.py --lan        # also reachable from your phone
    python serve.py --port 3000

This is a development convenience, not a backend. Omnia is a static site — the
deployed app is answered by files on disk with no process behind it — so this
script only does what GitHub Pages does: hand over files. Nothing here ships,
and nothing here is required to deploy.

It is deliberately not Flask. Flask arrives in Phase 8 as an *optional*
self-hosted API with its own entry point; putting a Flask app at the root now
would imply Omnia needs a server, and it does not.

Standard library only — no pip install.
"""

from __future__ import annotations

import argparse
import http.server
import mimetypes
import socket
import socketserver
import threading
import webbrowser
from functools import partial
from pathlib import Path

ROOT = Path(__file__).resolve().parent
APP_DIR = ROOT / "app"

# Python's mimetypes table predates these; without the mapping Chrome rejects
# the manifest and the service worker never registers.
mimetypes.add_type("application/manifest+json", ".webmanifest")
mimetypes.add_type("text/javascript", ".js")
mimetypes.add_type("image/svg+xml", ".svg")


class Handler(http.server.SimpleHTTPRequestHandler):
    """Static handler with caching disabled.

    Omnia registers a service worker that caches the whole app shell. That is
    the right behaviour in production and maddening in development — you edit a
    file, reload, and get yesterday's copy. `no-store` keeps the browser and
    the worker honest while you work.
    """

    def end_headers(self):
        self.send_header("Cache-Control", "no-store, must-revalidate")
        super().end_headers()

    def log_message(self, fmt, *args):
        # One line per request, without the date noise the default prints.
        print(f"  {fmt % args}")


def lan_address() -> str | None:
    """This machine's LAN IP, for opening the app on a phone."""
    try:
        # No packets are sent; connect() on UDP just picks the outbound
        # interface, which is the address a phone on the same Wi-Fi can reach.
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as probe:
            probe.connect(("8.8.8.8", 80))
            return probe.getsockname()[0]
    except OSError:
        return None


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=8000)
    parser.add_argument("--tests", action="store_true",
                        help="serve the repo root and open the test pages")
    parser.add_argument("--lan", action="store_true",
                        help="bind 0.0.0.0 so a phone on the same Wi-Fi can reach it")
    parser.add_argument("--no-browser", action="store_true")
    args = parser.parse_args()

    if not APP_DIR.is_dir():
        print(f"error: {APP_DIR} not found — run this from the repository.")
        return 1

    # The tests import modules from app/ with a relative path, so they need the
    # repository root as the document root; the app itself does not.
    directory = ROOT if args.tests else APP_DIR
    host = "0.0.0.0" if args.lan else "127.0.0.1"

    urls = (
        [f"http://localhost:{args.port}/tests/timer.test.html",
         f"http://localhost:{args.port}/tests/store.test.html"]
        if args.tests else
        [f"http://localhost:{args.port}/"]
    )

    socketserver.TCPServer.allow_reuse_address = True
    handler = partial(Handler, directory=str(directory))

    try:
        server = socketserver.ThreadingTCPServer((host, args.port), handler)
    except OSError as exc:
        print(f"error: cannot bind port {args.port} ({exc}).")
        print(f"       Something else is using it — try --port {args.port + 1}.")
        return 1

    print(f"\n  Omnia — serving {directory.relative_to(ROOT) if directory != ROOT else '.'}\n")
    for url in urls:
        print(f"  {url}")

    if args.lan:
        ip = lan_address()
        if ip:
            print(f"\n  On your phone (same Wi-Fi):  http://{ip}:{args.port}/")
            # Worth saying plainly — these fail silently and look like bugs.
            print("  Note: install-to-home-screen and offline mode need https,")
            print("        so they will not work over a LAN address. Everything")
            print("        else — timer, calendar, layout — does.")
        else:
            print("\n  Could not determine a LAN address.")

    print("\n  Ctrl+C to stop.\n")

    if not args.no_browser:
        # Slight delay so the first request lands after the server is accepting.
        for url in urls:
            threading.Timer(0.4, webbrowser.open, args=(url,)).start()

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n  Stopped.")
    finally:
        server.shutdown()
        server.server_close()

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
