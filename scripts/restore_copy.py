"""Prepare a NEW restored DB offline, invalidating all old login sessions/codes."""
import argparse
import sqlite3
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument("backup", type=Path)
parser.add_argument("destination", type=Path)
args = parser.parse_args()
if not args.backup.is_file() or args.destination.exists():
    raise SystemExit("Backup must exist and destination must be new.")
args.destination.parent.mkdir(parents=True, exist_ok=True)
with sqlite3.connect(f"file:{args.backup.resolve().as_posix()}?mode=ro", uri=True) as src:
    if src.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
        raise SystemExit("Backup integrity check failed")
    with sqlite3.connect(args.destination) as dst:
        src.backup(dst)
        tables = {r[0] for r in dst.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        for table in ("manager_session", "manager_setup_link", "employee_session", "email_challenge", "share_token"):
            if table in tables:
                dst.execute(f"DELETE FROM {table}")
        dst.commit()
print("New restore copy prepared. Previous login sessions, codes, and legacy links invalidated.")
