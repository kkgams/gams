"""Offline checks for the independent promo preview server."""

import http.client
import importlib.util
from pathlib import Path
from functools import partial
from http.server import ThreadingHTTPServer
from html.parser import HTMLParser
from urllib.parse import urlsplit
import threading
import unittest
import re
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("serve_promo", ROOT / "scripts/serve-promo.py")
promo = importlib.util.module_from_spec(spec)
spec.loader.exec_module(promo)


class PageLinks(HTMLParser):
    def __init__(self):
        super().__init__()
        self.links = []
        self.ids = []

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if "id" in attrs:
            self.ids.append(attrs["id"])
        for attr in ["href", "src"]:
            if attr in attrs:
                self.links.append(attrs[attr])


class PromoContentTests(unittest.TestCase):
    def test_hero_thumbnails_link_to_four_full_size_workspaces(self):
        html = (ROOT / "promo/index.html").read_text()
        figure = re.search(r'<figure class="hero-workspaces".*?</figure>', html, re.S).group(0)
        links = re.findall(r'<a class="hero-workspace" href="([^"]+)"[^>]*><img src="([^"]+)"[^>]*alt="([^"]+)"', figure)
        self.assertEqual(len(links), 4)
        self.assertEqual(len({href for href, _, _ in links}), 4)
        for href, thumbnail, alt in links:
            self.assertEqual(Path(href).stem, Path(thumbnail).stem)
            self.assertTrue((ROOT / "promo" / href).is_file())
            self.assertTrue((ROOT / "promo" / thumbnail).is_file())
            self.assertTrue(alt)

    def test_fonts_are_self_hosted_with_their_licenses(self):
        for name, filename, copyright_notice in [
            ("Outfit", "outfit-latin.woff2", "Copyright 2021 The Outfit Project Authors"),
            ("Inter", "inter-latin.woff2", "Copyright 2020 The Inter Project Authors"),
            ("IBMPlexMono", "ibm-plex-mono-latin.woff2", 'Copyright © 2017 IBM Corp. with Reserved Font Name "Plex"'),
            ("InstrumentSerif", "instrument-serif-italic-latin.woff2", "Copyright 2022 The Instrument Serif Project Authors"),
        ]:
            with self.subTest(font=name):
                font = ROOT / "promo/fonts" / filename
                self.assertEqual(font.read_bytes()[:4], b"wOF2")
                license_text = (ROOT / "promo/fonts" / f"{name}-OFL.txt").read_text()
                self.assertIn(copyright_notice, license_text)
                self.assertIn("SIL OPEN FONT LICENSE Version 1.1", license_text)

    def test_accent_text_contrast_in_both_themes(self):
        css = (ROOT / "promo/style.css").read_text()
        base = re.search(r":root \{(.*?)\}", css, re.S).group(1)
        light = re.search(r':root\[data-theme="light"\] \{(.*?)\}', css, re.S).group(1)
        def colors(block):
            return dict(re.findall(r"--([\w-]+):\s*(#[\da-f]{6});", block))

        def luminance(color):
            channels = [int(color[index:index + 2], 16) / 255 for index in (1, 3, 5)]
            linear = [value / 12.92 if value <= 0.04045 else ((value + 0.055) / 1.055) ** 2.4 for value in channels]
            return sum(value * weight for value, weight in zip(linear, (0.2126, 0.7152, 0.0722)))

        for theme, tokens in [("dark", colors(base)), ("light", colors(base) | colors(light))]:
            for foreground, background in [("accent-ink", "page-bg"), ("accent-ink", "surface"), ("on-accent", "accent")]:
                with self.subTest(theme=theme, foreground=foreground, background=background):
                    values = sorted([luminance(tokens[foreground]), luminance(tokens[background])])
                    self.assertGreaterEqual((values[1] + 0.05) / (values[0] + 0.05), 4.5)

    def test_header_logo_is_cropped_inline_and_theme_aware(self):
        logo = ET.parse(ROOT / "promo/new_logo.svg").getroot()
        ns = {"svg": "http://www.w3.org/2000/svg"}
        paths = logo.findall("svg:path", ns)
        self.assertEqual(len(paths), 1)
        self.assertEqual(logo.get("fill"), "currentColor")
        self.assertEqual(logo.get("viewBox"), "16 16 179.066 168")
        for filename in ["index.html", "app.html"]:
            with self.subTest(page=filename):
                html = (ROOT / "promo" / filename).read_text()
                match = re.search(r'<svg class="brand-mark".*?</svg>', html)
                self.assertIsNotNone(match)
                inline = ET.fromstring(match.group(0))
                self.assertEqual(inline.get("fill"), "currentColor")
                self.assertEqual(inline.get("viewBox"), logo.get("viewBox"))
                self.assertEqual(inline.get("aria-hidden"), "true")
                self.assertEqual(inline.find("svg:path", ns).get("d"), paths[0].get("d"))

    def test_relative_assets_and_documentation_routes_exist(self):
        for filename in ["index.html", "app.html"]:
            page = PageLinks()
            page.feed((ROOT / "promo" / filename).read_text())
            self.assertEqual(len(page.ids), len(set(page.ids)))
            for link in page.links:
                with self.subTest(page=filename, link=link):
                    url = urlsplit(link)
                    if url.scheme:
                        self.assertEqual(url.scheme, "https")
                        continue
                    self.assertFalse(url.path.startswith("/"), "Keep Pages subpaths portable")
                    if url.path == "docs/":
                        if url.fragment:
                            route = url.fragment.removeprefix("/").split("?")[0]
                            self.assertTrue((ROOT / "docs" / f"{route}.md").is_file())
                        continue
                    target = ROOT / "promo" / (url.path or filename)
                    if target.is_dir():
                        target /= "index.html"
                    self.assertTrue(target.is_file())
                    if url.fragment:
                        destination = PageLinks()
                        destination.feed(target.read_text())
                        self.assertIn(url.fragment, destination.ids)


class PromoPreviewTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        handler = partial(promo.PromoHandler, directory=str(ROOT / "promo"))
        cls.server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
        cls.server.docs_port = 4321
        cls.thread = threading.Thread(target=cls.server.serve_forever)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join()

    def request(self, path, method="GET"):
        connection = http.client.HTTPConnection(*self.server.server_address, timeout=5)
        try:
            connection.request(method, path)
            response = connection.getresponse()
            return response.status, dict(response.getheaders()), response.read()
        finally:
            connection.close()

    def test_landing_page_and_relative_docs_link(self):
        status, _, body = self.request("/")
        self.assertEqual(status, 200)
        self.assertIn(b'href="docs/"', body)

    def test_docs_redirect_preserves_path_and_query(self):
        for path, destination in [
            ("/docs", "/"),
            ("/docs/", "/"),
            ("/docs/content/index.md?x=1", "/content/index.md?x=1"),
            ("/docs//example.com", "/example.com"),
        ]:
            with self.subTest(path=path):
                status, headers, _ = self.request(path)
                self.assertEqual(status, 302)
                self.assertEqual(headers["Location"], f"http://localhost:4321{destination}")
        status, headers, body = self.request("/docs/", "HEAD")
        self.assertEqual(status, 302)
        self.assertEqual(body, b"")

    def test_repository_is_not_served(self):
        for path in ["/README.md", "/Makefile", "/../CONTEXT.md", "/docs-other"]:
            with self.subTest(path=path):
                self.assertEqual(self.request(path)[0], 404)


if __name__ == "__main__":
    unittest.main()
