from datetime import datetime, timedelta, timezone

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from backend import db, employee_auth
from backend.main import app
from backend.schema import Staff
from backend.tests.test_app import small


def prepare(client, monkeypatch):
    state = small()
    state.staff.append(Staff(id="other", name="別のスタッフ", roles=["r"], hourly_rate=9999))
    db.save(state, "test")
    monkeypatch.setattr(employee_auth, "email_ready", lambda: True)
    sent = []
    monkeypatch.setattr(employee_auth, "send_code", lambda email, code: sent.append((email, code)))
    assert (
        client.put(
            "/api/employee-accounts/s", json={"email": "Crew@Example.com", "revision": 0}
        ).status_code
        == 200
    )
    return sent


def sign_in(employee, sent):
    r = employee.post("/api/employee/request-code", json={"email": "crew@example.com"})
    assert r.status_code == 200
    body = {"ticket": r.json()["ticket"], "code": sent[-1][1]}
    result = employee.post("/api/employee/verify", json=body)
    assert result.status_code == 200
    return body, result


def test_email_login_scope_logout_and_one_time(client, monkeypatch):
    sent = prepare(client, monkeypatch)
    with TestClient(app) as employee:
        assert employee.get("/api/employee/portal/p").status_code == 401
        assert employee.get("/api/employee-accounts").status_code == 401
        body, result = sign_in(employee, sent)
        assert "HttpOnly" in result.headers["set-cookie"]
        assert employee.post("/api/employee/verify", json=body).status_code == 401
        assert employee.get("/api/state").status_code == 401
        assert employee.get("/api/employee/status").json()["authenticated"]
        portal = employee.get("/api/employee/portal/p").json()
        assert portal["staff"]["id"] == "s"
        assert "9999" not in str(portal)
        submission = portal["submission"]
        submission["staff"] = "other"
        assert (
            employee.put(
                "/api/employee/portal/p",
                json={"version": portal["version"], "submission": submission},
            ).status_code
            == 403
        )
        submission["staff"] = "s"
        assert (
            employee.put(
                "/api/employee/portal/p",
                json={"version": portal["version"], "submission": submission},
            ).status_code
            == 200
        )
        assert employee.post("/api/employee/logout").status_code == 200
        assert employee.get("/api/employee/portal/p").status_code == 401


def test_registration_change_revoke_and_disabled_staff(client, monkeypatch):
    sent = prepare(client, monkeypatch)
    with TestClient(app) as employee:
        sign_in(employee, sent)
        assert (
            client.put(
                "/api/employee-accounts/other", json={"email": "crew@example.com", "revision": 0}
            ).status_code
            == 409
        )
        assert (
            client.put(
                "/api/employee-accounts/s", json={"email": "new@example.com", "revision": 0}
            ).status_code
            == 409
        )
        assert (
            client.put(
                "/api/employee-accounts/s", json={"email": "new@example.com", "revision": 1}
            ).status_code
            == 200
        )
        assert employee.get("/api/employee/portal/p").status_code == 401
        r = employee.post("/api/employee/request-code", json={"email": "new@example.com"})
        assert (
            employee.post(
                "/api/employee/verify", json={"ticket": r.json()["ticket"], "code": sent[-1][1]}
            ).status_code
            == 200
        )
        s = db.get_state()
        s.staff[0].active = False
        db.save(s, "disable")
        assert employee.get("/api/employee/portal/p").status_code == 401
        assert client.post("/api/employee-accounts/s/revoke").status_code == 200
        assert client.get("/api/employee-accounts").json()["accounts"] == []


def test_code_expiry_attempts_throttle_unknown_email(client, monkeypatch):
    sent = prepare(client, monkeypatch)
    with TestClient(app) as employee:
        unknown = employee.post("/api/employee/request-code", json={"email": "unknown@example.com"})
        assert unknown.status_code == 200 and sent == []
        assert set(unknown.json()) == {"ticket", "message"}
        r = employee.post("/api/employee/request-code", json={"email": "crew@example.com"})
        ticket, code = r.json()["ticket"], sent[-1][1]
        assert code not in r.text
        assert (
            employee.post(
                "/api/employee/request-code", json={"email": "crew@example.com"}
            ).status_code
            == 429
        )
        wrong = "00000000" if code != "00000000" else "11111111"
        for _ in range(5):
            assert (
                employee.post(
                    "/api/employee/verify", json={"ticket": ticket, "code": wrong}
                ).status_code
                == 401
            )
        assert (
            employee.post("/api/employee/verify", json={"ticket": ticket, "code": code}).status_code
            == 401
        )
        with Session(db.engine) as session:
            row = session.get(db.EmailChallenge, ticket)
            assert code not in row.digest
            row.attempts = 0
            row.expires = (datetime.now(timezone.utc) - timedelta(minutes=1)).isoformat()
            session.commit()
        assert (
            employee.post("/api/employee/verify", json={"ticket": ticket, "code": code}).status_code
            == 401
        )


def test_production_cookie_legacy_csrf_and_bootstrap(client, monkeypatch):
    sent = prepare(client, monkeypatch)
    monkeypatch.setenv("SHIFT_ENV", "production")
    monkeypatch.setenv("SHIFT_PUBLIC_ORIGIN", "https://shifts.example.com")
    monkeypatch.setenv("SHIFT_SETUP_TOKEN", "a" * 32)
    assert (
        client.post("/api/auth/setup", json={"password": "valid-test-password"}).status_code == 403
    )
    with TestClient(app) as employee:
        _, result = sign_in(employee, sent)
        assert "Secure" in result.headers["set-cookie"]
        assert employee.get("/api/portal", headers={"x-share-token": "anything"}).status_code == 401
        assert (
            employee.post(
                "/api/employee/logout", headers={"origin": "https://evil.example"}
            ).status_code
            == 403
        )
        assert employee.get("/employee").headers["x-frame-options"] == "DENY"
    assert client.post("/api/periods/p/tokens/s").status_code == 410


def test_no_mail_configuration_fails_closed(client, monkeypatch):
    monkeypatch.setattr(employee_auth, "email_ready", lambda: False)
    assert (
        client.post("/api/employee/request-code", json={"email": "crew@example.com"}).status_code
        == 503
    )
    assert not client.get("/api/employee/status").json()["authenticated"]
