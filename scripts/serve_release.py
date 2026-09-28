"""One process/worker: SQLite and the generation queue are deliberately single-instance."""
import os
import subprocess
import sys
from pathlib import Path

root = Path(__file__).resolve().parent.parent
os.chdir(root)
sys.path.insert(0, str(root))
from backend.config import validate_config  # noqa: E402

if os.getenv("SHIFT_ENV") != "production":
    raise SystemExit("Release server requires SHIFT_ENV=production. Use scripts/start.ps1 locally.")
validate_config()
# Docker starts as root only to initialize the mounted volume, then drops privileges.
if hasattr(os, "getuid") and os.getuid() == 0:
    data = Path("/data")
    data.mkdir(exist_ok=True)
    os.chown(data, 10001, 10001)
    os.chmod(data, 0o700)
    tenants = data / "tenants"
    tenants.mkdir(exist_ok=True)
    os.chown(tenants, 10001, 10001)
    for database in (data / "shift.db", data / "platform.db"):
        if database.exists():
            os.chown(database, 10001, 10001)
    os.setgroups([])
    os.setgid(10001)
    os.setuid(10001)
os.umask(0o077)
subprocess.run([sys.executable, "-m", "alembic", "upgrade", "head"], check=True)
os.execv(sys.executable, [sys.executable, "-m", "uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", os.getenv("PORT", "8000"), "--workers", "1", "--no-access-log", "--no-proxy-headers"])
