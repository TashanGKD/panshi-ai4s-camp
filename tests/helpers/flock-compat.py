#!/usr/bin/env python3
import errno
import fcntl
import sys


if len(sys.argv) != 3 or sys.argv[1] not in {"-n", "-u"}:
    raise SystemExit("usage: flock-compat.py {-n|-u} FD")

operation = fcntl.LOCK_UN if sys.argv[1] == "-u" else fcntl.LOCK_EX | fcntl.LOCK_NB
try:
    fcntl.flock(int(sys.argv[2]), operation)
except OSError as error:
    if error.errno in {errno.EACCES, errno.EAGAIN}:
        raise SystemExit(1)
    raise
