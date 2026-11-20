"""Serve static Web Host or diagnostic assets; no Host operations or conversion endpoints."""
import argparse
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer


class StaticHandler(SimpleHTTPRequestHandler):
    # Copies preserve source mtimes. An older file at the same URL must not
    # validate stale JavaScript cached from another build/Project server.
    def send_head(self):
        del self.headers['If-Modified-Since']
        return super().send_head()

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Cross-Origin-Opener-Policy', 'same-origin')
        self.send_header('Cross-Origin-Embedder-Policy', 'require-corp')
        super().end_headers()


class StaticServer(ThreadingHTTPServer):
    # Allow bursts of shared-frontend module requests beyond Python's default
    # five-connection accept queue.
    request_queue_size = 128


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--port', type=int, default=8093)
    parser.add_argument('--directory', required=True)
    args = parser.parse_args()
    handler = partial(StaticHandler, directory=args.directory)
    with StaticServer(('127.0.0.1', args.port), handler) as server:
        print(f'Serving static GAMS assets at http://127.0.0.1:{args.port}', flush=True)
        server.serve_forever()


if __name__ == '__main__':
    main()
