"""Explicit public-origin configuration; local defaults never expose the service."""

import os
import re
from urllib.parse import urlsplit


def production():
    return os.getenv("SHIFT_ENV", "local") == "production"


def public_origin():
    return os.getenv("SHIFT_PUBLIC_ORIGIN", "http://127.0.0.1:8000").rstrip("/")


def validate_config():
    if not production():
        return
    url = urlsplit(public_origin())
    if (
        url.scheme != "https"
        or not url.hostname
        or url.path
        or url.query
        or url.fragment
        or url.username
    ):
        raise RuntimeError("SHIFT_PUBLIC_ORIGIN must be an HTTPS origin without a path")
    if len(os.getenv("SHIFT_AUTH_SECRET", "")) < 32:
        raise RuntimeError("SHIFT_AUTH_SECRET must contain at least 32 characters")
    if len(os.getenv("SHIFT_SETUP_TOKEN", "")) < 32:
        raise RuntimeError("SHIFT_SETUP_TOKEN must contain at least 32 characters")
    database_url = os.getenv("SHIFT_DB", "")
    windows_absolute = os.name == "nt" and re.match(r"^sqlite:///[A-Za-z]:/", database_url)
    if not database_url.startswith("sqlite:////") and not windows_absolute:
        raise RuntimeError("Production requires an absolute SQLite path on a persistent disk")


def allowed_hosts():
    return (
        [urlsplit(public_origin()).hostname]
        if production()
        else ["127.0.0.1", "localhost", "testserver"]
    )


def allowed_origins():
    if production():
        return [public_origin()]
    return [
        f"http://{host}:{port}"
        for host in ("127.0.0.1", "localhost")
        for port in (5173, 8000, 8001)
    ]
