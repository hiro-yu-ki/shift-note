"""Environment on servers; optional Windows-user encrypted settings for local trials."""

import json
import os
import subprocess
from pathlib import Path

from .config import production

KEYS = (
    "SHIFT_SMTP_HOST",
    "SHIFT_SMTP_PORT",
    "SHIFT_SMTP_USER",
    "SHIFT_SMTP_PASSWORD",
    "SHIFT_MAIL_FROM",
)
_cache = (None, {})


def settings():
    global _cache
    configured = {k: os.getenv(k, "") for k in KEYS}
    if (
        any(configured[k] for k in KEYS if k != "SHIFT_SMTP_PORT")
        or (production() and os.getenv("SHIFT_LOCAL_MAIL_SETTINGS") != "1")
        or os.name != "nt"
    ):
        return configured
    path = Path(os.getenv("LOCALAPPDATA", "")) / "ShiftNote" / "mail.xml"
    if not path.is_file():
        return configured
    stamp = path.stat().st_mtime_ns
    if _cache[0] != stamp:
        command = "$ErrorActionPreference='Stop'; $c=Import-Clixml -LiteralPath (Join-Path $env:LOCALAPPDATA 'ShiftNote\\mail.xml'); $p=[System.Net.NetworkCredential]::new('', $c.Password).Password; @{SHIFT_SMTP_HOST=$c.Host;SHIFT_SMTP_PORT=[string]$c.Port;SHIFT_SMTP_USER=$c.User;SHIFT_SMTP_PASSWORD=$p;SHIFT_MAIL_FROM=$c.From} | ConvertTo-Json -Compress"
        try:
            result = subprocess.run(
                ["powershell.exe", "-NoProfile", "-NonInteractive", "-Command", command],
                capture_output=True,
                timeout=10,
                check=True,
            )
            data = json.loads(result.stdout.decode("utf-8-sig"))
            _cache = (stamp, {k: str(data.get(k, "")) for k in KEYS})
        except (OSError, ValueError, subprocess.SubprocessError):
            # Never log decrypted output or subprocess errors containing it.
            _cache = (stamp, configured)
    return _cache[1]
