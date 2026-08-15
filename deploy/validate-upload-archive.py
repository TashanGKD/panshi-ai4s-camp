#!/usr/bin/env python3
import argparse
import os
from pathlib import PurePosixPath
import sys
import tarfile


def reject(message: str) -> None:
    print(f"Archive validation failed: {message}", file=sys.stderr)
    raise SystemExit(1)


parser = argparse.ArgumentParser(add_help=False)
parser.add_argument("--archive", required=True)
parser.add_argument("--max-compressed-bytes", required=True, type=int)
parser.add_argument("--max-expanded-bytes", required=True, type=int)
parser.add_argument("--max-entries", required=True, type=int)
parser.add_argument("--max-path-depth", required=True, type=int)
args = parser.parse_args()

try:
    archive_stat = os.lstat(args.archive)
    if not os.path.isfile(args.archive) or os.path.islink(args.archive):
        reject("archive must be a regular non-symlink file")
    if archive_stat.st_size > args.max_compressed_bytes:
        reject("compressed bytes exceed configured maximum")

    entries = 0
    expanded = 0
    with tarfile.open(args.archive, mode="r:gz", errorlevel=2) as archive:
        for member in archive:
            entries += 1
            if entries > args.max_entries:
                reject("entry count exceeds configured maximum")
            if member.name in (".", "./"):
                depth = 0
            else:
                if not member.name.startswith("./"):
                    reject("entry name is not relative to archive root")
                relative = member.name[2:]
                path = PurePosixPath(relative)
                has_control = any(ord(character) < 32 or ord(character) == 127 for character in relative)
                if not relative or path.is_absolute() or ".." in path.parts or has_control:
                    reject("entry name contains traversal or invalid bytes")
                depth = len(path.parts)
            if depth > args.max_path_depth:
                reject("path depth exceeds configured maximum")
            sparse_headers = any(
                key.startswith("GNU.sparse.") or key == "SCHILY.realsize"
                for key in member.pax_headers
            )
            if member.type == tarfile.GNUTYPE_SPARSE or member.sparse is not None or sparse_headers:
                reject("sparse entries are not supported")
            if not (member.isfile() or member.isdir()):
                reject("links and special entries are not supported")
            if member.isfile():
                if member.size < 0:
                    reject("negative entry size")
                expanded += member.size
                if expanded > args.max_expanded_bytes:
                    reject("expanded bytes exceed configured maximum")
except (OSError, tarfile.TarError, ValueError) as error:
    reject(f"invalid archive metadata ({type(error).__name__})")

print(f"compressed={archive_stat.st_size} expanded={expanded} entries={entries}")
