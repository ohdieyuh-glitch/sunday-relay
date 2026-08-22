#!/usr/bin/env python3
"""Read an SPZ file's HEADER and say which version wrote it. Nothing else.

    python3 spz_probe.py <file.spz | url>

WHY THIS IS THE FIRST STEP AND NOT A RENDERER

three.js gained a native Gaussian-splat renderer in r186 with an SPZLoader, and
Niantic's SPZ format reached v4 in May 2026 with a different container: six
parallel ZSTD streams where v2/v3 used a single GZip stream. Niantic's own
release notes say plainly that older readers report v4 files as an unrecognised
format.

So "can three.js load World Labs' .spz" is not a question about renderers. It is
a question about which SPZ version World Labs writes and which one the loader
implements, and that is answerable from the first sixteen bytes of the file
without installing anything, without a GPU, and without making Wonderland depend
on a splat pipeline.

Answer that first. Adopt nothing until it is answered.

The header, per nianticlabs/spz:
    uint32 magic   = 0x5053474e  ('NGSP' little-endian)
    uint32 version
    uint32 numPoints
    uint8  shDegree
    uint8  fractionalBits
    uint8  flags
    uint8  reserved
An SPZ file is the GZip/ZSTD-compressed stream; the header sits inside it, so
the outer container has to be decompressed first — and WHICH container it is is
itself the version tell.
"""
import gzip
import io
import struct
import sys

MAGIC = 0x5053474E
GZIP_MAGIC = b"\x1f\x8b"
ZSTD_MAGIC = b"\x28\xb5\x2f\xfd"


def describe(raw):
    lines = []
    if raw[:2] == GZIP_MAGIC:
        lines.append("container: GZIP — the single-stream form used by SPZ v1-v3")
        # Streaming, not gzip.decompress: the header is the first 16 bytes of
        # the stream, so a truncated range read is enough and there is no reason
        # to pull a whole splat file to answer a question about its version.
        import zlib
        try:
            body = zlib.decompressobj(31).decompress(raw, 4096)
        except Exception as exc:
            return lines + ["could not decompress: %s" % exc]
    elif raw[:4] == ZSTD_MAGIC:
        lines.append("container: ZSTD — the multi-stream form introduced by SPZ v4")
        lines.append("NOTE: v2/v3 readers report this as an unrecognised format. If the "
                     "three.js SPZLoader implements the earlier container, it cannot read "
                     "this file at all, and no amount of renderer work changes that.")
        try:
            import zstandard  # noqa: F401
        except ImportError:
            return lines + ["cannot decompress here: no zstandard module in this "
                            "environment. The container is the finding; report it as that."]
        import zstandard
        body = zstandard.ZstdDecompressor().decompressobj().decompress(raw)
    else:
        lines.append("container: UNRECOGNISED (first bytes %s)" % raw[:8].hex())
        body = raw

    if len(body) < 16:
        return lines + ["too short to hold an SPZ header"]
    magic, version, points = struct.unpack("<III", body[:12])
    sh, frac, flags, _res = struct.unpack("<BBBB", body[12:16])
    lines.append("magic: 0x%08x %s" % (magic, "(NGSP, valid)" if magic == MAGIC else "(NOT an SPZ header)"))
    lines.append("version: %d" % version)
    lines.append("points: %s" % format(points, ","))
    lines.append("sh degree: %d" % sh)
    lines.append("fractional bits: %d" % frac)
    lines.append("flags: 0x%02x" % flags)
    return lines


def main(argv):
    if len(argv) < 2:
        sys.stderr.write(__doc__)
        return 2
    target = argv[1]
    if target.startswith("http"):
        import urllib.request
        try:
            request = urllib.request.Request(target, headers={"Range": "bytes=0-65535"})
            with urllib.request.urlopen(request, timeout=30) as response:
                raw = response.read()
        except Exception as exc:
            print("could not fetch: %s" % exc)
            print("A signed CDN URL expires. This says the URL is stale, NOT that the "
                  "format is unsupported — do not record it as the latter.")
            return 1
    else:
        with io.open(target, "rb") as handle:
            raw = handle.read()
    print("%s (%d bytes read)" % (target.split("/")[-1], len(raw)))
    for line in describe(raw):
        print("  " + line)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
