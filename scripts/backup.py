"""Consistent online SQLite backup. The destination must be new."""
import argparse
import os
import sqlite3
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument("destination", type=Path)
args = parser.parse_args()
source = os.getenv("SHIFT_DB", "sqlite:///./shift.db").removeprefix("sqlite:///")
if args.destination.exists():
    raise SystemExit("Destination already exists; choose a new filename.")
if not Path(source).is_file():
    raise SystemExit("Source database does not exist.")
args.destination.parent.mkdir(parents=True, exist_ok=True)
with sqlite3.connect(f"file:{Path(source).resolve().as_posix()}?mode=ro", uri=True) as src:
    with sqlite3.connect(args.destination) as dst:
        src.backup(dst)
        if dst.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
            raise SystemExit("Backup integrity check failed")
print("Backup completed and integrity checked.")
