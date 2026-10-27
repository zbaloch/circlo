"""The drill must actually catch leaks: python3 -m unittest infra/test_leak_drill.py"""
import os
import subprocess
import sys
import tempfile
import unittest

SCRIPT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "leak_drill.py")


class LeakDrillTest(unittest.TestCase):
    def run_drill(self, dump: bytes, objects: dict, log: bytes = b"", markers: str = "Secret post text\n"):
        with tempfile.TemporaryDirectory() as d:
            os.mkdir(os.path.join(d, "objects"))
            for name, data in objects.items():
                with open(os.path.join(d, "objects", name), "wb") as f:
                    f.write(data)
            paths = {}
            for name, data in (("db.sql", dump), ("server.log", log), ("markers.txt", markers.encode())):
                paths[name] = os.path.join(d, name)
                with open(paths[name], "wb") as f:
                    f.write(data)
            r = subprocess.run(
                [sys.executable, SCRIPT, "--dump", paths["db.sql"], "--objects", os.path.join(d, "objects"),
                 "--log", paths["server.log"], "--markers", paths["markers.txt"]],
                capture_output=True, text=True)
            return r.returncode, r.stdout

    def test_ciphertext_only_passes(self):
        code, out = self.run_drill(b"INSERT INTO posts VALUES (" + os.urandom(300) + b");", {"a": os.urandom(8192)},
                                   b"INFO started on port 8080")
        self.assertEqual(code, 0, out)

    def test_catches_plaintext_media_markers_emails_and_ips(self):
        cases = [
            (b"INSERT INTO posts VALUES ('secret POST text');", {}, b""),          # marker, any case
            ("Secret post text".encode("utf-16-le"), {}, b""),                   # marker in UTF-16
            (b"", {"photo": b"\xff\xd8\xff\xe0" + os.urandom(8000)}, b""),        # JPEG object
            (b"", {"low": b"A" * 8192}, b""),                                     # not ciphertext
            (b"INSERT INTO users VALUES ('sam.k@example.org');", {}, b""),       # email in the DB
            (b"", {}, b"GET /v1/feed from 203.0.113.7"),                          # IP in the log
        ]
        for dump, objects, log in cases:
            code, out = self.run_drill(dump, objects, log)
            self.assertEqual(code, 1, out)


if __name__ == "__main__":
    unittest.main()
