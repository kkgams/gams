#!/usr/bin/env python3
"""Serve prebuilt test Units on loopback without CORS headers."""
import argparse
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('directory', type=Path)
parser.add_argument('--port', type=int, default=8765)
parser.add_argument('--ready-file', type=Path)
args = parser.parse_args()
if not args.directory.is_dir():
    parser.error('directory must exist')
server = ThreadingHTTPServer(('127.0.0.1', args.port),
                             partial(SimpleHTTPRequestHandler, directory=str(args.directory.resolve())))
url = f'http://127.0.0.1:{server.server_port}'
if args.ready_file:
    args.ready_file.write_text(url)
print(f'Serving prebuilt Units at {url}', flush=True)
try:
    server.serve_forever()
except KeyboardInterrupt:
    pass
finally:
    server.server_close()
