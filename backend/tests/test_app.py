from copy import deepcopy
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from backend import db
from backend.engine import solve, validate
from backend.main import app, csv_safe
from backend.schema import (
    Assignment,
    Period,
    Requirement,
    Role,
    Slot,
    Staff,
    State,
    Store,
    Submission,
)


@pytest.fixture
def client(tmp_path, monkeypatch):
    engine = create_engine(
        "sqlite:///" + str(tmp_path / "test.db"), connect_args={"check_same_thread": False}
    )
    monkeypatch.setattr(db, "engine", engine)
    db.Base.metadata.create_all(engine)
    with Session(engine) as session:
        session.add(
            db.Snapshot(id=1, version=0, data=State().model_dump(mode="json"), updated_at=db.now())
        )
        session.commit()
    with TestClient(app) as client:
        response = client.post("/api/auth/setup", json={"password": "test-manager-password"})
        assert response.status_code == 200
        yield client
    engine.dispose()


def small():
    d = datetime.now(timezone.utc).date() + timedelta(days=7)
    p = Period(
        id="p",
        start=d,
        end=d + timedelta(days=1),
        deadline=datetime.now(timezone.utc) + timedelta(days=3),
    )
    return State(
        store=Store(name="テスト店舗", start=600, end=840),
        roles=[Role(id="r", name="責任者")],
        staff=[
            Staff(
                id="s",
                name="佐藤 美咲",
                roles=["r"],
                target=8,
                maximum=8,
                day_min=2,
                day_max=4,
                consecutive=2,
            )
        ],
        periods=[p],
        requirements=[
            Requirement(
                id=str(i),
                period="p",
                date=d + timedelta(days=i),
                start=600,
                end=840,
                total=1,
                roles={"r": 1},
                hard=True,
            )
            for i in range(2)
        ],
        submissions=[
            Submission(
                staff="s",
                period="p",
                status="提出済み",
                target=8,
                slots=[Slot(date=d + timedelta(days=i), start=600, end=840) for i in range(2)],
            )
        ],
    )


def seed(client):
    body = small().model_dump(mode="json")
    result = client.put("/api/state", json=body)
    assert result.status_code == 200, result.text
    return result.json()


def test_crud_and_conflict(client):
    s = seed(client)
    original = deepcopy(s)
    s["staff"][0]["display"] = "さとう"
    assert client.put("/api/state", json=s).status_code == 200
    assert client.put("/api/state", json=original).status_code == 409
    s = client.get("/api/state").json()
    s["roles"].append({"id": "hall", "name": "ホール"})
    assert client.put("/api/state", json=s).status_code == 200
    s = client.get("/api/state").json()
    s["roles"] = [r for r in s["roles"] if r["id"] != "hall"]
    assert client.put("/api/state", json=s).status_code == 200
    assert client.post("/api/periods/unknown/preflight").status_code == 404


def test_invalid_ranges_overlap_and_roles(client):
    s = seed(client)
    s["submissions"][0]["slots"][0]["end"] = 500
    assert client.put("/api/state", json=s).status_code == 422
    s = client.get("/api/state").json()
    s["submissions"][0]["slots"].append(deepcopy(s["submissions"][0]["slots"][0]))
    assert client.put("/api/state", json=s).status_code == 422
    s = client.get("/api/state").json()
    s["requirements"][0]["roles"] = {"r": 2}
    assert client.put("/api/state", json=s).status_code == 422


def test_portal_scope_deadline_rotation_and_privacy(client):
    s = seed(client)
    token = client.post("/api/periods/p/tokens/s").json()["token"]
    headers = {"X-Share-Token": token}
    response = client.get("/api/portal", headers=headers)
    assert response.status_code == 200
    assert "staff" in response.json() and "candidates" not in response.json()
    body = {"version": s["version"], "submission": s["submissions"][0]}
    body["submission"]["staff"] = "another"
    assert client.put("/api/portal", json=body, headers=headers).status_code == 403
    body["submission"]["staff"] = "s"
    assert client.put("/api/portal", json=body, headers=headers).status_code == 200
    assert client.put("/api/portal", json=body, headers=headers).status_code == 409
    client.post("/api/periods/p/tokens/s")
    assert client.get("/api/portal", headers=headers).status_code == 404
    token = client.post("/api/periods/p/tokens/s").json()["token"]
    headers = {"X-Share-Token": token}
    s = client.get("/api/state").json()
    s["periods"][0]["deadline"] = (datetime.now(timezone.utc) - timedelta(days=1)).isoformat()
    s = client.put("/api/state", json=s).json()
    body = {"version": s["version"], "submission": s["submissions"][0]}
    assert client.put("/api/portal", json=body, headers=headers).status_code == 403
    assert client.get("/api/portal").status_code == 401


def test_solver_constraints_reproducibility():
    state = small()
    a = solve(state, state.periods[0], seed=12)
    b = solve(state, state.periods[0], seed=12)
    assert a.assignments == b.assignments
    assert len(a.assignments) == 2
    assert a.metrics["hard"] == 0 and a.metrics["coverage"] == 100
    assert a.metrics["total_hours"] <= 8
    for shift in a.assignments:
        assert 600 <= shift.start < shift.end <= 840
        assert shift.role == "r"
    state.submissions[0].slots[0].kind = "勤務不可"
    c = solve(state, state.periods[0])
    assert c.metrics["hard"] > 0
    assert all(a.date != state.periods[0].start for a in c.assignments)
    assert any("不足" in v["message"] for v in c.violations)


def test_solver_consecutive_interval_and_upper_limits():
    s = small()
    s.staff[0].consecutive = 1
    c = solve(s, s.periods[0])
    assert len(c.assignments) <= 1
    assert not any(v["code"] == "consecutive" for v in c.violations)
    s.staff[0].consecutive = 2
    s.staff[0].interval = 48
    c = solve(s, s.periods[0])
    assert len(c.assignments) <= 1
    s.staff[0].interval = 11
    s.staff[0].period_max = 2
    c = solve(s, s.periods[0])
    assert c.metrics["total_hours"] <= 2


def test_manual_validation_and_confirmation_lock(client):
    s = seed(client)
    response = client.post("/api/periods/p/generate", json={"version": s["version"]})
    assert response.status_code == 200, response.text
    s = response.json()
    assert len(s["candidates"]) == 3
    c = s["candidates"][0]
    rows = deepcopy(c["assignments"])
    rows[0]["start"] = 0
    rejected = client.put(
        "/api/candidates/" + c["id"], json={"version": s["version"], "assignments": rows}
    )
    assert rejected.status_code == 422
    assert client.get("/api/state").json()["version"] == s["version"]
    # Valid in-window edits still support undo.
    s = client.put(
        "/api/candidates/" + c["id"], json={"version": s["version"], "assignments": []}
    ).json()
    s = client.post("/api/candidates/" + c["id"] + "/undo", json={"version": s["version"]}).json()
    assert s["candidates"][0]["assignments"] == c["assignments"]
    s = client.post(
        "/api/candidates/" + c["id"] + "/confirm", json={"version": s["version"], "name": "店長"}
    ).json()
    assert s["periods"][0]["status"] == "確定済み"
    assert (
        client.put(
            "/api/candidates/" + c["id"], json={"version": s["version"], "assignments": []}
        ).status_code
        == 423
    )
    bad = deepcopy(s)
    bad["staff"][0]["maximum"] = 1
    assert client.put("/api/state", json=bad).status_code == 423
    token = client.post("/api/periods/p/tokens/s").json()["token"]
    assert (
        len(client.get("/api/portal", headers={"X-Share-Token": token}).json()["assignments"]) == 2
    )
    assert client.get("/api/candidates/" + c["id"] + "/csv").content.startswith(b"\xef\xbb\xbf")
    assert (
        client.post("/api/periods/p/reopen", json={"version": s["version"]}).json()["periods"][0][
            "status"
        ]
        == "作成中"
    )


def test_security_and_csv(client):
    for text in ["=SUM(A1:A2)", "+1", "-1", "@formula", "\tHello", " \n=cmd"]:
        assert csv_safe(text).startswith("'")
    assert csv_safe("佐藤 美咲") == "佐藤 美咲"
    assert client.get("/api/state", headers={"host": "evil.example"}).status_code == 400
    assert (
        client.put("/api/state", json={}, headers={"origin": "https://evil.example"}).status_code
        == 403
    )


def test_validator_overlap_and_qualification():
    s = small()
    c = solve(s, s.periods[0])
    c.assignments.append(
        Assignment(id="extra", staff="s", role="r", date=s.periods[0].start, start=600, end=840)
    )
    c = validate(s, c)
    assert any(v["code"] == "interval" for v in c.violations)
    s.staff[0].roles = []
    assert any(v["code"] == "role" for v in validate(s, c).violations)


def test_closed_day_and_fixed_unavailability():
    from backend.schema import Block, Special

    s = small()
    s.periods[0].special = [Special(date=s.periods[0].start, start=600, end=840, closed=True)]
    s.staff[0].blocks = [Block(weekday=s.periods[0].end.weekday(), start=600, end=840)]
    c = solve(s, s.periods[0])
    assert not c.assignments
    assert any(v["code"] == "role_shortage" for v in c.violations)


def test_cross_period_confirmed_shifts_count_in_limits():
    from backend.schema import Candidate

    s = small()
    d = s.periods[0].start
    previous = Period(
        id="old",
        start=d - timedelta(days=1),
        end=d - timedelta(days=1),
        deadline=datetime.now(timezone.utc),
        status="確定済み",
        selected="old-c",
    )
    s.periods.append(previous)
    s.candidates.append(
        Candidate(
            id="old-c",
            period="old",
            name="前期",
            assignments=[
                Assignment(
                    id="old-a",
                    staff="s",
                    role="r",
                    date=d - timedelta(days=1),
                    start=1080,
                    end=1320,
                )
            ],
        )
    )
    s.staff[0].interval = 15
    c = solve(s, s.periods[0])
    assert not any(a.date == d and a.start < 780 for a in c.assignments)
    assert not any(v["code"] == "interval" for v in c.violations)
    c.assignments.append(Assignment(id="bad", staff="s", role="r", date=d, start=600, end=840))
    assert any(v["code"] == "interval" for v in validate(s, c).violations)


def test_preflight_identifies_missing_role(client):
    s = seed(client)
    s["submissions"] = []
    assert client.put("/api/state", json=s).status_code == 200
    check = client.post("/api/periods/p/preflight").json()
    assert check["unsubmitted"] == ["佐藤 美咲"]
    assert any("責任者" in message for message in check["impossible"])


def test_demo_real_solver_and_reproducibility(monkeypatch):
    from ortools.sat.python import cp_model

    from backend.seed import demo

    # Reproducibility requires reaching the deterministic search limit. The
    # production wall-clock cap intentionally returns the best available plan
    # sooner on a busy PC, which need not be identical across runs.
    original_solve = cp_model.CpSolver.solve

    def deterministic_run(solver, *args, **kwargs):
        solver.parameters.max_time_in_seconds = 120
        return original_solve(solver, *args, **kwargs)

    monkeypatch.setattr(cp_model.CpSolver, "solve", deterministic_run)
    s = demo()
    a = solve(s, s.periods[0], seed=42)
    b = solve(s, s.periods[0], seed=42)
    assert a.assignments == b.assignments
    assert len(a.assignments) > 50
    assert a.metrics["hard"] == 0
    assert a.metrics["coverage"] > 70
    assert a.metrics["missing_slots"] > 0


@pytest.mark.parametrize("step", [15, 30, 60])
def test_real_time_units_and_submission_grid(client, step):
    state = small()
    state.store.step = step
    state.staff[0].day_min = step / 60
    state.staff[0].day_max = step / 60
    state.requirements = state.requirements[:1]
    state.requirements[0].end = 600 + step
    state.periods[0].end = state.periods[0].start
    state.submissions[0].slots = state.submissions[0].slots[:1]
    state.submissions[0].slots[0].end = 600 + step
    c = solve(state, state.periods[0])
    assert c.metrics["hard"] == 0
    assert c.assignments[0].end - c.assignments[0].start == step
    payload = state.model_dump(mode="json")
    s = client.put("/api/state", json=payload).json()
    token = client.post("/api/periods/p/tokens/s").json()["token"]
    if step > 15:
        s["submissions"][0]["slots"][0]["end"] = 615
        response = client.put(
            "/api/portal",
            headers={"X-Share-Token": token},
            json={"version": s["version"], "submission": s["submissions"][0]},
        )
        assert response.status_code == 422


def test_salary_is_private_and_manager_auth_required(client):
    s = seed(client)
    s["staff"][0]["hourly_rate"] = 1400
    s["staff"].append({**s["staff"][0], "id": "other", "name": "非公開の人", "hourly_rate": 9876})
    s = client.put("/api/state", json=s).json()
    token = client.post("/api/periods/p/tokens/s").json()["token"]
    client.post("/api/auth/logout")
    for path in ["/api/state", "/api/audit", "/api/candidates/any/csv"]:
        assert client.get(path).status_code == 401
    assert client.post("/api/periods/p/tokens/other").status_code == 401
    response = client.get("/api/portal", headers={"X-Share-Token": token})
    assert response.status_code == 200
    assert response.json()["pay"]["hourly_rate"] == 1400
    assert "9876" not in response.text
    assert "非公開の人" not in response.text
    assert client.post("/api/auth/login", json={"password": "wrong-password"}).status_code == 401
    assert (
        client.post("/api/auth/login", json={"password": "test-manager-password"}).status_code
        == 200
    )
    assert client.get("/api/state").status_code == 200
    assert (
        client.post("/api/auth/setup", json={"password": "overwrite-password"}).status_code == 409
    )


def test_payroll_close_date_breaks_unknown_rate_and_payday():
    from datetime import date

    from backend.payroll import cycle, employee_pay, estimate
    from backend.schema import Candidate

    s = small()
    staff = s.staff[0]
    staff.hourly_rate = 1200
    staff.transport_per_day = 300
    staff.unpaid_break_minutes = 45
    staff.break_after_hours = 6
    shifts = [
        Assignment(
            id="a",
            staff="s",
            role="r",
            date=date(2026, 9, 28),
            start=600,
            end=1080,
            breaks=[{"start": 780, "end": 825}],
        )
    ]
    result = estimate(staff, shifts)
    assert result["paid_hours"] == 7.25 and result["total"] == 9000
    assert cycle(staff, date(2026, 9, 30)) == (
        date(2026, 9, 1),
        date(2026, 9, 30),
        date(2026, 10, 25),
    )
    assert cycle(staff, date(2026, 10, 1))[2] == date(2026, 11, 25)
    s.periods[0].selected = "c"
    s.periods[0].status = "確定済み"
    s.candidates = [Candidate(id="c", period="p", name="案", assignments=shifts)]
    assert employee_pay(s, staff, date(2026, 9, 26))["total"] == 9000
    staff.hourly_rate = None
    assert estimate(staff, shifts)["total"] is None


def test_generation_reuses_unchanged_input_and_replaces_changed(client):
    s = seed(client)
    s = client.post("/api/periods/p/generate", json={"version": s["version"]}).json()
    ids = [c["id"] for c in s["candidates"]]
    unchanged = client.post("/api/periods/p/generate", json={"version": s["version"]}).json()
    assert unchanged["version"] == s["version"]
    assert [c["id"] for c in unchanged["candidates"]] == ids
    cid = ids[0]
    s = client.put(
        "/api/candidates/" + cid, json={"version": s["version"], "assignments": []}
    ).json()
    s = client.post("/api/periods/p/generate", json={"version": s["version"]}).json()
    assert s["candidates"][0]["assignments"] == []
    s["submissions"][0]["target"] = 5
    s = client.put("/api/state", json=s).json()
    s = client.post("/api/periods/p/generate", json={"version": s["version"]}).json()
    assert len([c for c in s["candidates"] if not c["archived"]]) == 3
    assert len([c for c in s["candidates"] if c["archived"]]) == 3


def test_manual_role_requires_permission(client):
    s = seed(client)
    s["roles"].append({"id": "restricted", "name": "有資格者"})
    s = client.put("/api/state", json=s).json()
    s = client.post("/api/periods/p/generate", json={"version": s["version"]}).json()
    candidate = s["candidates"][0]
    candidate["assignments"][0]["role"] = "restricted"
    assert (
        client.put(
            "/api/candidates/" + candidate["id"],
            json={"version": s["version"], "assignments": candidate["assignments"]},
        ).status_code
        == 422
    )


def test_demand_preview_never_applies_until_confirmed(client):
    s = seed(client)
    body = {"period": "p", "version": s["version"], "history": [], "minimum": 3}
    result = client.post("/api/demand/preview", json=body)
    assert result.status_code == 200, result.text
    assert result.json()["rows"][0]["confidence"] == "データ不足"
    assert client.get("/api/state").json()["requirements"] == s["requirements"]
    s = client.post("/api/demand/apply", json=body).json()
    assert s["requirements"][0]["total"] == 3
    assert client.post("/api/demand/apply", json=body).status_code == 409
