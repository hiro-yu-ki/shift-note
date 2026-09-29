"""Operator controls, billing and real store-data separation."""

from datetime import date

from fastapi.testclient import TestClient
from sqlalchemy import create_engine

from backend import db, platform
from backend.main import app


def setup_platform(tmp_path, monkeypatch):
    engine = create_engine("sqlite:///" + (tmp_path / "platform.db").as_posix(), connect_args={"check_same_thread": False})
    monkeypatch.setattr(platform, "engine", engine)
    monkeypatch.setenv("SHIFT_TENANT_ROOT", str(tmp_path / "tenants"))
    db.tenant_engine.cache_clear()
    platform.init_db()
    return engine


def merchant(slug):
    return {
        "slug": slug, "name": slug + " 店", "legal_name": slug + "株式会社",
        "contact_email": slug + "@example.com", "monthly_fee": 10000,
        "status": "準備中", "plan_name": "標準", "tax_rate": 10,
    }


def test_production_operator_setup_key(tmp_path, monkeypatch):
    engine = setup_platform(tmp_path, monkeypatch)
    monkeypatch.setattr(platform, "production", lambda: True)
    monkeypatch.setenv("SHIFT_PLATFORM_SETUP_TOKEN", "test-secret-operator-setup-token-123456")
    try:
        with TestClient(app, base_url="https://testserver") as operator:
            wrong = operator.post("/api/platform/auth/setup", json={
                "password": "operator-password-123", "setup_token": "wrong-token",
            })
            assert wrong.status_code == 403
            assert operator.get("/api/platform/auth/status").json()["configured"] is False
            correct = operator.post("/api/platform/auth/setup", json={
                "password": "operator-password-123", "setup_token": "test-secret-operator-setup-token-123456",
            })
            assert correct.status_code == 200
            assert operator.get("/api/platform/auth/status").json()["authenticated"] is True
    finally:
        db.tenant_engine.cache_clear()
        engine.dispose()


def test_operator_provisions_isolated_suites_and_bills(tmp_path, monkeypatch):
    engine = setup_platform(tmp_path, monkeypatch)
    try:
        with TestClient(app) as operator:
            assert operator.get("/api/platform/merchants").status_code == 401
            assert operator.post("/api/platform/auth/setup", json={"password": "operator-password-123"}).status_code == 200
            ids = []
            for slug in ("alpha", "bravo"):
                made = operator.post("/api/platform/merchants", json=merchant(slug))
                assert made.status_code == 200, made.text
                mid = made.json()["id"]
                ids.append(mid)
                provision = operator.post(f"/api/platform/merchants/{mid}/provision")
                assert provision.status_code == 200, provision.text
                key = provision.json()["manager_setup_token"]
                assert operator.post(f"/s/{slug}/api/auth/setup", json={
                    "password": "manager-password-123", "setup_token": key,
                }).status_code == 200
                assert operator.get(f"/s/{slug}/api/state").status_code == 200
                assert operator.get(f"/s/{slug}/admin").status_code == 200
                assert operator.get(f"/s/{slug}/employee").status_code == 200
                assert operator.get(f"/s/{slug}/clock").status_code == 200
            # A session from alpha does not authenticate against bravo's DB.
            with TestClient(app) as isolated:
                assert isolated.post("/s/alpha/api/auth/login", json={"password": "manager-password-123"}).status_code == 200
                assert isolated.get("/s/alpha/api/state").status_code == 200
                assert isolated.get("/s/bravo/api/state").status_code == 401
                state = isolated.get("/s/alpha/api/state").json()
                assert isolated.post("/s/alpha/api/setup", json={
                    "store": {"name": "alpha only", "start": 600, "end": 1200, "step": 30}, "demo": False,
                }).status_code == 200
                assert state["store"] is None
                assert isolated.get("/s/bravo/api/auth/status").json()["authenticated"] is False
            with TestClient(app) as bravo_manager:
                assert bravo_manager.post("/s/bravo/api/auth/login", json={"password": "manager-password-123"}).status_code == 200
                assert bravo_manager.get("/s/bravo/api/state").json()["store"] is None
                assert bravo_manager.get("/s/alpha/api/state").status_code == 401
            assert operator.get("/api/platform/merchants").status_code == 200
            with TestClient(app) as old_session:
                assert old_session.post("/api/platform/auth/login", json={"password": "operator-password-123"}).status_code == 200
                assert operator.post("/api/platform/auth/change-password", json={"current_password": "wrong", "new_password": "new-operator-password"}).status_code == 401
                assert operator.post("/api/platform/auth/change-password", json={"current_password": "operator-password-123", "new_password": "new-operator-password"}).status_code == 200
                assert old_session.get("/api/platform/merchants").status_code == 401
                assert operator.get("/api/platform/merchants").status_code == 200
            assert operator.put("/api/platform/billing-settings", json={"seller_name": "運営会社", "payment_instructions": "テスト銀行 普通 1234567"}).status_code == 200
            alpha = operator.get("/api/platform/merchants").json()[1]
            alpha["status"] = "利用中"
            assert operator.put(f'/api/platform/merchants/{alpha["id"]}', json=alpha).status_code == 200
            month = date.today().strftime("%Y-%m")
            draft = operator.post("/api/platform/invoices/draft", json={"merchant_id": alpha["id"], "service_month": month})
            assert draft.status_code == 200, draft.text
            assert draft.json()["subtotal"] == 10000
            assert draft.json()["tax"] == 1000
            assert draft.json()["payment_instructions"] == "テスト銀行 普通 1234567"
            iid = draft.json()["id"]
            assert operator.post("/api/platform/invoices/draft", json={"merchant_id": alpha["id"], "service_month": month}).status_code == 409
            assert operator.post(f"/api/platform/invoices/{iid}/issue").status_code == 200
            printed = operator.get(f"/api/platform/invoices/{iid}/print")
            assert printed.status_code == 200 and "請求書" in printed.text and "テスト銀行" in printed.text
            assert operator.post(f"/api/platform/invoices/{iid}/payments", json={"amount": 11000, "paid_on": date.today().isoformat()}).json()["status"] == "入金済み"
            payment_id = operator.get(f"/api/platform/invoices/{iid}").json()["payments"][0]["id"]
            assert operator.post(f"/api/platform/invoices/{iid}/payments/{payment_id}/reverse", json={"reason": "振込先の照合に誤り"}).json()["balance"] == 11000
            assert operator.post(f"/api/platform/invoices/{iid}/payments/{payment_id}/reverse", json={"reason": "重複して訂正"}).status_code == 409
            assert operator.post(f"/api/platform/invoices/{iid}/payments", json={"amount": 11000, "paid_on": date.today().isoformat()}).json()["status"] == "入金済み"
            assert operator.get("/api/platform/dashboard").json()["active"] == 1
            assert operator.get(f'/api/platform/merchants/{alpha["id"]}/distribution').status_code == 200
            assert (tmp_path / "tenants" / ids[0] / "shift.db").is_file()
            assert (tmp_path / "tenants" / ids[1] / "shift.db").is_file()
            assert operator.get("/api/platform/merchants.csv").status_code == 200
            reset = operator.post(f'/api/platform/merchants/{alpha["id"]}/reset-manager')
            assert reset.status_code == 200
            assert operator.get("/s/alpha/api/auth/status").json()["configured"] is False
            assert operator.post("/s/alpha/api/auth/setup", json={"password": "new-manager-password", "setup_token": reset.json()["manager_setup_token"]}).status_code == 200
    finally:
        db.tenant_engine.cache_clear()
        engine.dispose()
