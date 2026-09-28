import os
import sqlite3
import subprocess
import sys

import pytest
from sqlalchemy.orm import Session

from backend import db, employee_auth
from backend.config import allowed_hosts, allowed_origins, validate_config
from backend.tests.test_employee_auth import prepare


def test_production_config_requires_explicit_origin_and_secrets(monkeypatch):
    monkeypatch.setenv("SHIFT_ENV", "production")
    monkeypatch.setenv("SHIFT_PUBLIC_ORIGIN", "http://localhost:8000")
    with pytest.raises(RuntimeError):
        validate_config()
    monkeypatch.setenv("SHIFT_PUBLIC_ORIGIN", "https://shifts.example.com")
    monkeypatch.setenv("SHIFT_AUTH_SECRET", "")
    with pytest.raises(RuntimeError):
        validate_config()
    monkeypatch.setenv("SHIFT_AUTH_SECRET", "a" * 32)
    monkeypatch.setenv("SHIFT_SETUP_TOKEN", "b" * 32)
    monkeypatch.setenv("SHIFT_DB", "sqlite:///./shift.db")
    with pytest.raises(RuntimeError):
        validate_config()
    monkeypatch.setenv("SHIFT_DB", "sqlite:////data/shift.db")
    validate_config()
    assert allowed_hosts() == ["shifts.example.com"]
    assert allowed_origins() == ["https://shifts.example.com"]
    if os.name == "nt":
        monkeypatch.setenv("SHIFT_DB", "sqlite:///C:/ShiftNote/shift.db")
        validate_config()


def test_delivery_failure_is_generic_and_invalidates_code(client, monkeypatch, caplog):
    prepare(client, monkeypatch)

    def failure(email, code):
        raise RuntimeError(f"Do not log recipient {email} or {code}")

    monkeypatch.setattr(employee_auth, "send_code", failure)
    r = client.post("/api/employee/request-code", json={"email": "crew@example.com"})
    assert r.status_code == 200
    assert "crew@example.com" not in caplog.text
    with Session(db.engine) as session:
        assert session.get(db.EmailChallenge, r.json()["ticket"]) is None


def test_entrypoints_and_manuals(client):
    assert client.get("/employee", headers={"sec-fetch-site": "cross-site"}).status_code == 200
    assert client.get("/api/employee/status", headers={"sec-fetch-site": "cross-site"}).status_code == 403
    for path in ("/admin", "/employee", "/help/employee.html", "/help/manager.html"):
        response = client.get(path)
        assert response.status_code == 200
        assert response.headers["cache-control"] == "no-store"
        assert "text/html" in response.headers["content-type"]
    assert client.get("/healthz").json()["version"] == "1.3.1"
    assert client.get("/admin", headers={"host": "untrusted.example"}).status_code == 400


def test_backup_restore_and_migration(tmp_path):
    original = tmp_path / "source.db"
    backup = tmp_path / "backup.db"
    restored = tmp_path / "restored.db"
    env = {**os.environ, "SHIFT_ENV": "local", "SHIFT_DB": "sqlite:///" + original.as_posix()}
    subprocess.run(
        [sys.executable, "-m", "alembic", "upgrade", "head"],
        env=env,
        check=True,
        capture_output=True,
    )
    with sqlite3.connect(original) as conn:
        conn.execute("INSERT INTO employee_session VALUES ('secret-session','s',1,'2099')")
        conn.execute("INSERT INTO employee_account VALUES ('s','test@example.com',1)")
    subprocess.run(
        [sys.executable, "scripts/backup.py", str(backup)], env=env, check=True, capture_output=True
    )
    subprocess.run(
        [sys.executable, "scripts/restore_copy.py", str(backup), str(restored)],
        env=env,
        check=True,
        capture_output=True,
    )
    with sqlite3.connect(restored) as conn:
        assert conn.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
        assert conn.execute("SELECT count(*) FROM employee_session").fetchone()[0] == 0
        assert conn.execute("SELECT count(*) FROM employee_account").fetchone()[0] == 1
    with sqlite3.connect(backup) as conn:
        assert conn.execute("SELECT count(*) FROM employee_session").fetchone()[0] == 1
    assert (
        subprocess.run(
            [sys.executable, "scripts/backup.py", str(backup)], env=env, capture_output=True
        ).returncode
        != 0
    )
