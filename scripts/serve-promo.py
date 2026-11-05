#!/usr/bin/env python3
"""Serve only promo source, redirecting documentation to its separate server."""

import argparse
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit


class PromoHandler(SimpleHTTPRequestHandler):
    def send_head(self):
        url = urlsplit(self.path)
        if url.path == "/docs" or url.path.startswith("/docs/"):
            suffix = url.path[len("/docs"):].lstrip("/")
            location = f"http://localhost:{self.server.docs_port}/{suffix}"
            if url.query:
                location += f"?{url.query}"
            self.send_response(302)
            self.send_header("Location", location)
            self.send_header("Content-Length", "0")
            self.end_headers()
            return None
        return super().send_head()


def port(value):
    number = int(value)
    if not 1 <= number <= 65535:
        raise argparse.ArgumentTypeError("port must be between 1 and 65535")
    return number


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=port, default=8081)
    parser.add_argument("--docs-port", type=port, default=8080)
    args = parser.parse_args()
    if args.port == args.docs_port:
        parser.error("promo and docs require separate ports")
    source = Path(__file__).resolve().parent.parent / "promo"
    handler = partial(PromoHandler, directory=str(source))
    with ThreadingHTTPServer(("127.0.0.1", args.port), handler) as server:
        server.docs_port = args.docs_port
        print(f"Promo: http://localhost:{args.port}; docs: http://localhost:{args.docs_port}", flush=True)
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass


if __name__ == "__main__":
    main()
