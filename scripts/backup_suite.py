"""Create verified online backups of the operator and every merchant SQLite DB."""

import argparse
import hashlib
import json
import os
import sqlite3
from datetime import datetime, timezone
from pathlib import Path


def database_path(url):
    if not url.startswith("sqlite:///"):
        raise SystemExit("Expected an sqlite:/// database URL")
    return Path(url.removeprefix("sqlite:///"))


def backup(source, target):
    target.parent.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(f"file:{source.resolve().as_posix()}?mode=ro", uri=True) as original:
        with sqlite3.connect(target) as saved:
            original.backup(saved)
            if saved.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
                raise RuntimeError(f"Integrity check failed: {target}")
    return hashlib.sha256(target.read_bytes()).hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("destination", type=Path, help="A new directory outside the live database directory")
    parser.add_argument("--platform-db", type=Path, default=database_path(os.getenv("SHIFT_PLATFORM_DB", "sqlite:///./platform.db")))
    parser.add_argument("--legacy-db", type=Path, default=database_path(os.getenv("SHIFT_DB", "sqlite:///./shift.db")))
    parser.add_argument("--tenant-root", type=Path, default=Path(os.getenv("SHIFT_TENANT_ROOT", "./tenants")))
    args = parser.parse_args()
    destination = args.destination.resolve()
    if destination.exists():
        raise SystemExit("Destination exists; choose a new directory")
    sources = [("platform.db", args.platform_db), ("legacy.db", args.legacy_db)]
    sources += [
        (f"tenants/{entry.name}/shift.db", entry / "shift.db")
        for entry in sorted(args.tenant_root.glob("*"))
        if entry.is_dir() and (entry / "shift.db").is_file()
    ]
    if any(not source.is_file() for _, source in sources):
        raise SystemExit("One or more source databases do not exist")
    tenant_root = args.tenant_root.resolve()
    if destination == tenant_root or tenant_root in destination.parents or any(destination == source.resolve() or destination in source.resolve().parents for _, source in sources):
        raise SystemExit("Destination must not contain a live database")
    manifest = {"created_at_utc": datetime.now(timezone.utc).isoformat(), "databases": {}}
    destination.mkdir(parents=True)
    for name, source in sources:
        target = destination / name
        manifest["databases"][name] = {"sha256": backup(source, target), "bytes": target.stat().st_size}
    (destination / "MANIFEST.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Backed up and verified {len(sources)} databases in {destination}")


if __name__ == "__main__":
    main()
