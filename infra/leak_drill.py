#!/usr/bin/env python3
"""Leaked-database drill scanner (PLAN.md Phase 12).

Given a database dump, a directory of bucket objects and (optionally) a server log, checks that nothing a user
typed or uploaded is readable: no marker strings (things you typed into the app while testing), no image/video
file signatures or metadata, no email addresses or IP addresses, and every stored object looks like ciphertext
(high entropy). Exits 1 if anything is found. The markers file is never committed; it holds test content only.

Usage: leak_drill.py --dump db.sql --objects DIR [--log server.log] [--markers markers.txt]
"""
import argparse
import math
import os
import re
import sys
from collections import Counter

# Signatures of plaintext media and metadata. A ciphertext object starting with one of these is astronomically
# unlikely; anywhere inside large blobs they can occur by chance, so objects are checked at offset 0 only and the
# metadata strings (long enough not to collide) anywhere.
MAGIC = {
    b"\xff\xd8\xff": "JPEG",
    b"\x89PNG\r\n\x1a\n": "PNG",
    b"GIF8": "GIF",
    b"RIFF": "RIFF/WebP",
}
METADATA = [b"JFIF\x00", b"Exif\x00\x00", b"ftypisom", b"ftypmp42", b"ftypheic", b"http://ns.adobe.com/xap/"]
# Emails are looked for in the dump and the log only: random ciphertext can contain a short "x@y.zz" by chance.
EMAIL = re.compile(rb"(?<![A-Za-z0-9._%+-])[A-Za-z0-9._%+-]{3,}@[A-Za-z0-9-]{3,}\.[a-z]{2,6}(?![A-Za-z0-9])")
IPV4 = re.compile(rb"(?<![\d.])(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)(?![\d.])")
# Addresses that are configuration, not users (localhost, the unspecified address, version-like strings).
IP_ALLOWED = {b"127.0.0.1", b"0.0.0.0"}
MIN_ENTROPY = 7.9  # bits per byte, for objects of at least ENTROPY_MIN_SIZE bytes
ENTROPY_MIN_SIZE = 4096


def entropy(data: bytes) -> float:
    counts = Counter(data)
    n = len(data)
    return -sum(c / n * math.log2(c / n) for c in counts.values())


def marker_forms(marker: str):
    """The marker as UTF-8 (any case), UTF-16LE, and hex, so plaintext can't hide in a different encoding."""
    raw = marker.encode()
    yield "utf-8", re.compile(re.escape(raw), re.IGNORECASE)
    yield "utf-16", re.compile(re.escape(marker.encode("utf-16-le")), re.IGNORECASE)
    yield "hex", re.compile(re.escape(raw.hex().encode()), re.IGNORECASE)


def scan_text(name: str, data: bytes, markers, findings, check_ips: bool, check_emails: bool = True):
    for m in markers:
        for form, rx in marker_forms(m):
            hits = len(rx.findall(data))
            if hits:
                findings.append(f"{name}: marker {m!r} found {hits}x ({form})")
    for sig in METADATA:
        if sig in data:
            findings.append(f"{name}: media metadata signature {sig!r}")
    for email in set(EMAIL.findall(data)) if check_emails else ():
        findings.append(f"{name}: email-like string {email[:3].decode(errors='replace')}…")
    if check_ips:
        ips = {ip for ip in IPV4.findall(data) if ip not in IP_ALLOWED}
        if ips:
            findings.append(f"{name}: {len(ips)} IP address(es), e.g. {sorted(ips)[0].decode()}")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dump", required=True)
    ap.add_argument("--objects", required=True)
    ap.add_argument("--log")
    ap.add_argument("--markers")
    a = ap.parse_args()

    markers = []
    if a.markers:
        with open(a.markers, encoding="utf-8") as f:
            markers = [line.strip() for line in f if line.strip() and not line.startswith("#")]
    findings: list[str] = []

    with open(a.dump, "rb") as f:
        dump = f.read()
    # IPs in the dump would mean we store client addresses; the schema has none.
    scan_text("database", dump, markers, findings, check_ips=True)
    print(f"database dump: {len(dump):,} bytes scanned")

    objects = low = 0
    for root, _, files in os.walk(a.objects):
        for fn in files:
            path = os.path.join(root, fn)
            with open(path, "rb") as f:
                data = f.read()
            objects += 1
            rel = os.path.relpath(path, a.objects)
            for sig, kind in MAGIC.items():
                if data.startswith(sig):
                    findings.append(f"object {rel}: starts like a {kind} file")
            scan_text(f"object {rel}", data, markers, findings, check_ips=False, check_emails=False)
            if len(data) >= ENTROPY_MIN_SIZE and (e := entropy(data)) < MIN_ENTROPY:
                low += 1
                findings.append(f"object {rel}: entropy {e:.2f} bits/byte (ciphertext is ~8)")
    print(f"bucket: {objects} objects scanned, {low} with low entropy")

    if a.log:
        with open(a.log, "rb") as f:
            log = f.read()
        scan_text("server log", log, markers, findings, check_ips=True)
        print(f"server log: {len(log):,} bytes scanned")

    print(f"markers checked: {len(markers)}")
    if findings:
        print(f"\nFAIL: {len(findings)} finding(s)")
        for x in findings:
            print(" -", x)
        return 1
    print("\nPASS: nothing readable found")
    return 0


if __name__ == "__main__":
    sys.exit(main())
