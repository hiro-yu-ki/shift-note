"""Request-scoped store database selection for centrally hosted merchants."""

import os
import re
from contextvars import ContextVar
from pathlib import Path

merchant_id: ContextVar[str | None] = ContextVar("merchant_id", default=None)
merchant_slug: ContextVar[str | None] = ContextVar("merchant_slug", default=None)


def tenant_root() -> Path:
    raw = Path(os.getenv("SHIFT_TENANT_ROOT", "./tenant-data"))
    if os.getenv("SHIFT_ENV") == "production" and not raw.is_absolute():
        raise RuntimeError("SHIFT_TENANT_ROOT must be absolute")
    return raw.resolve()


def tenant_db_path(mid: str) -> Path:
    if not re.fullmatch(r"[0-9a-f]{32}", mid):
        raise ValueError("Invalid merchant ID")
    return tenant_root() / mid / "shift.db"


def cookie_path(path: str) -> str:
    slug = merchant_slug.get()
    return f"/s/{slug}{path}" if slug else path
