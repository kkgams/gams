import functools
from pathlib import Path
import tempfile
import threading
import unittest
from urllib.error import HTTPError
from urllib.request import Request, urlopen

from serve import StaticHandler, StaticServer


class QuietHandler(StaticHandler):
    def log_message(self, *_args):
        pass


class StaticServingTests(unittest.TestCase):
    def setUp(self):
        output = Path(__file__).resolve().parents[2] / 'build.nosync/web-build'
        output.mkdir(parents=True, exist_ok=True)
        self.directory = tempfile.TemporaryDirectory(dir=output)
        Path(self.directory.name, 'app.js').write_text('export const current = true;')
        self.server = StaticServer(('127.0.0.1', 0), functools.partial(QuietHandler, directory=self.directory.name))
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.url = f'http://127.0.0.1:{self.server.server_port}/app.js'

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()
        self.directory.cleanup()

    def test_stale_modified_since_never_returns_wrong_cached_module(self):
        request = Request(self.url, headers={'If-Modified-Since': 'Wed, 21 Oct 2037 07:28:00 GMT'})
        with urlopen(request) as response:
            self.assertEqual(response.status, 200)
            self.assertEqual(response.read(), b'export const current = true;')
            self.assertEqual(response.headers['Cache-Control'], 'no-store')

    def test_head_and_parallel_accept_queue(self):
        with urlopen(Request(self.url, method='HEAD')) as response:
            self.assertEqual(response.status, 200)
            self.assertEqual(response.read(), b'')
        self.assertGreaterEqual(self.server.request_queue_size, 64)

    def test_no_host_post_endpoint(self):
        with self.assertRaises(HTTPError) as error:
            urlopen(Request(self.url, method='POST'))
        self.assertEqual(error.exception.code, 501)
