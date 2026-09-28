from datetime import datetime, time, timedelta
from zoneinfo import ZoneInfo

from fastapi.testclient import TestClient

from backend import db, operations
from backend.main import app
from backend.schema import Assignment, Candidate
from backend.tests.test_employee_auth import prepare, sign_in


def confirmed_today(client, monkeypatch):
    sent = prepare(client, monkeypatch)
    today = operations.local_now().date()
    state = db.get_state()
    state.store.end = 1080
    state.staff[0].hourly_rate = 1200
    state.staff[0].transport_per_day = 300
    state.periods[0].start = today
    state.periods[0].end = today + timedelta(days=1)
    for i, row in enumerate(state.requirements):
        row.date = today + timedelta(days=i)
    for i, row in enumerate(state.submissions[0].slots):
        row.date = today + timedelta(days=i)
    state.candidates = [
        Candidate(
            id="c", period="p", name="確定", assignments=[
                Assignment(
                    id="a", staff="s", role="r", date=today, start=600, end=1080,
                    breaks=[{"start": 720, "end": 765}],
                )
            ],
        )
    ]
    state.periods[0].status = "確定済み"
    state.periods[0].selected = "c"
    db.save(state, "test confirmed")
    return sent, today


def test_kiosk_shift_request_attendance_and_pay_scope(client, monkeypatch):
    sent, today = confirmed_today(client, monkeypatch)
    with TestClient(app) as employee:
        sign_in(employee, sent)
        own = employee.get("/api/employee/my-work")
        assert own.status_code == 200
        assert [a["id"] for a in own.json()["assignments"]] == ["a"]
        assert "9999" not in own.text
        assert employee.get("/api/operations/overview").status_code == 401
        assert employee.post("/api/operations/kiosk-token").status_code == 401
        assert employee.post("/api/employee/change-requests", json={
            "assignment": "a", "kind": "休み希望", "reason": "体調の都合で休みを相談したいです",
            "proposed_start": 660, "proposed_end": 900,
        }).status_code == 200
        assert employee.post("/api/employee/change-requests", json={
            "assignment": "a", "kind": "休み希望", "reason": "同じ日の重複申請です",
        }).status_code == 409
        assert employee.post("/api/employee/change-requests", json={
            "assignment": "someone-else", "kind": "相談", "reason": "他人の勤務を変更したいです",
        }).status_code == 404

        overview = client.get("/api/operations/overview").json()
        rid = overview["requests"][0]["id"]
        assert overview["requests"][0]["proposed_start"] == 660
        assert client.put(f"/api/operations/change-requests/{rid}", json={
            "status": "確認済み", "note": "本人と相談し、確定シフトを編集します",
        }).status_code == 200
        assert employee.get("/api/employee/my-work").json()["requests"][0]["manager_note"]

        token = client.post("/api/operations/kiosk-token").json()["token"]
        headers = {"x-kiosk-token": token}
        assert client.get("/api/kiosk/today").status_code == 401
        assert employee.get("/api/kiosk/today", headers=headers).json()["scheduled"][0]["name"]
        first = client.post("/api/kiosk/clock-in", json={"staff": "s"}, headers=headers)
        assert first.status_code == 200
        aid = first.json()["id"]
        assert client.post("/api/kiosk/clock-in", json={"staff": "s"}, headers=headers).status_code == 409
        assert client.post("/api/kiosk/clock-in", json={"staff": "other"}, headers=headers).status_code == 403
        assert client.get("/api/kiosk/today", headers=headers).json()["working"][0]["id"] == aid
        stopped = client.post("/api/kiosk/clock-out", json={"attendance": aid}, headers=headers)
        assert stopped.status_code == 200
        assert stopped.json()["break_minutes"] == 0
        assert stopped.json()["needs_review"]
        assert client.post("/api/kiosk/clock-out", json={"attendance": aid}, headers=headers).status_code == 409

        start = datetime.combine(today, time(10), ZoneInfo("Asia/Tokyo"))
        end = datetime.combine(today, time(18), ZoneInfo("Asia/Tokyo"))
        corrected = client.put(f"/api/operations/attendance/{aid}", json={
            "clock_in": start.isoformat(), "clock_out": end.isoformat(),
            "break_minutes": 45, "break_confirmed": True,
            "reason": "本人の申告と打刻記録を照合して修正",
        })
        assert corrected.status_code == 200, corrected.text
        assert corrected.json()["paid_hours"] == 7.25
        assert corrected.json()["gross"] == 8700
        assert not corrected.json()["needs_review"]
        own = employee.get("/api/employee/my-work").json()
        assert len(own["attendance"]) == 1
        assert own["attendance"][0]["gross"] == 8700
        assert "9999" not in str(own)
        assert client.get("/api/operations/overview").json()["pay"]["actual_total"] >= 9000


def test_kiosk_rotation_revokes_old_link(client, monkeypatch):
    confirmed_today(client, monkeypatch)
    first = client.post("/api/operations/kiosk-token").json()["token"]
    second = client.post("/api/operations/kiosk-token").json()["token"]
    assert client.get("/api/kiosk/today", headers={"x-kiosk-token": first}).status_code == 401
    assert client.get("/api/kiosk/today", headers={"x-kiosk-token": second}).status_code == 200


def test_kiosk_device_stays_registered_without_reusing_link(client, monkeypatch):
    confirmed_today(client, monkeypatch)
    first = client.post("/api/operations/kiosk-token").json()["token"]
    with TestClient(app) as terminal:
        assert terminal.get("/api/kiosk/status").status_code == 401
        assert terminal.post("/api/kiosk/pair", json={"token": first, "label": "レジ横"}).status_code == 200
        assert terminal.get("/api/kiosk/status").json()["registered"]
        assert terminal.get("/api/kiosk/today").status_code == 200
        assert client.get("/api/kiosk/today", headers={"x-kiosk-token": first}).status_code == 401
        second = client.post("/api/operations/kiosk-token").json()["token"]
        assert second != first
        assert terminal.get("/api/kiosk/today").status_code == 200
        clock = terminal.post("/api/kiosk/clock-in", json={"staff": "s"})
        assert clock.status_code == 200
        assert terminal.post("/api/kiosk/clock-out", json={"attendance": clock.json()["id"]}).status_code == 200
        devices = client.get("/api/operations/kiosk-devices").json()
        assert len(devices) == 1 and devices[0]["label"] == "レジ横"
        assert client.delete(f'/api/operations/kiosk-devices/{devices[0]["id"]}').status_code == 200
        assert terminal.get("/api/kiosk/today").status_code == 401
