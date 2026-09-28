import time

import pytest
from pydantic import ValidationError

from backend.breaks import duration_options, paid_minutes, required_break, working
from backend.conditions import parse_conditions
from backend.engine import solve, validate
from backend.schema import Assignment, Block, Slot, Staff, Submission
from backend.tests.test_app import seed, small


@pytest.mark.parametrize("paid,minimum", [(360, 0), (375, 45), (480, 45), (495, 60)])
def test_break_threshold_uses_net_work_strictly(paid, minimum):
    s = small()
    assert required_break(s.store, s.staff[0], paid, paid + 60) == minimum


@pytest.mark.parametrize("step", [15, 30, 60])
def test_explicit_breaks_never_leave_submitted_window(step):
    s = small()
    p = s.periods[0]
    p.end = p.start
    s.store.step = step
    s.store.end = 1140
    s.staff[0].day_max = 9
    s.staff[0].maximum = 20
    s.submissions[0].slots = [Slot(date=p.start, start=600, end=1140)]
    s.requirements = s.requirements[:1]
    s.requirements[0].end = 1140
    s.requirements[0].hard = False
    c = solve(s, p)
    assert c.assignments and not c.metrics["hard"]
    a = c.assignments[0]
    assert a.start % step == a.end % step == 0
    assert a.breaks and 600 <= a.start < a.breaks[0].start < a.breaks[0].end < a.end <= 1140
    assert paid_minutes(a) == a.end - a.start - sum(b.end - b.start for b in a.breaks)
    b = a.breaks[0]
    assert not working(a, b.start, b.start + 15)
    assert any(v["code"] == "shortage" and v["start"] == b.start for v in c.violations)


def test_break_cannot_bridge_unavailable_gap_or_create_day():
    s = small()
    p = s.periods[0]
    p.end = p.start
    s.staff[0].day_min = 1
    s.staff[0].day_max = 8
    s.store.end = 1140
    s.requirements = s.requirements[:1]
    s.requirements[0].hard = False
    s.requirements[0].end = 1140
    s.submissions[0].slots = [
        Slot(date=p.start, start=600, end=720),
        Slot(date=p.start, start=780, end=1140),
    ]
    c = solve(s, p)
    assert all(a.end <= 720 or a.start >= 780 for a in c.assignments)
    assert all(a.date == p.start for a in c.assignments)
    with pytest.raises(ValidationError):
        Assignment(
            id="x",
            staff="s",
            role="r",
            date=p.start,
            start=600,
            end=840,
            breaks=[{"start": 600, "end": 630}],
        )
    with pytest.raises(ValidationError):
        Assignment(
            id="x",
            staff="s",
            role="r",
            date=p.start,
            start=600,
            end=840,
            breaks=[{"start": 810, "end": 840}],
        )


def test_company_break_rule_and_small_shifts():
    s = small()
    from backend.schema import BreakRule

    s.store.break_rules = [BreakRule(after_hours=2, minutes=30)]
    from backend.schema import Store

    s.store = Store.model_validate(s.store.model_dump())
    s.staff[0].day_min = 0.25
    assert duration_options(s.store, s.staff[0], 15) == [(1, 1, 0)]
    assert duration_options(s.store, s.staff[0], 180) == [(12, 10, 2)]


def test_auto_break_never_pads_attendance_to_hide_daily_limit():
    from backend.schema import BreakRule

    s = small()
    s.staff[0].day_max = 8
    assert duration_options(s.store, s.staff[0], 600) == []
    assert duration_options(s.store, s.staff[0], 570) == []
    assert duration_options(s.store, s.staff[0], 540) == [(36, 32, 4)]
    assert duration_options(s.store, s.staff[0], 390) == [(26, 23, 3)]
    s.store.break_rules.append(BreakRule(after_hours=6, minutes=120))
    assert duration_options(s.store, s.staff[0], 600) == [(40, 32, 8)]


def test_regular_restricts_but_never_grants_availability():
    s = small()
    p = s.periods[0]
    s.staff[0].day_min = 1
    s.staff[0].regular = [Block(weekday=p.start.weekday(), start=660, end=840)]
    s.staff[0].regular_only = True
    c = solve(s, p)
    assert c.assignments and all(a.date == p.start and a.start >= 660 for a in c.assignments)
    s.submissions[0].status = "下書き"
    assert solve(s, p).assignments == []


def test_few_submitted_days_get_considered_and_zero_has_reason():
    s = small()
    p = s.periods[0]
    s.requirements[0].hard = False
    s.requirements[1].hard = False
    s.staff.append(Staff(id="rare", name="週1日", roles=["r"], day_min=2, maximum=8, target=8))
    s.submissions.append(
        Submission(
            staff="rare",
            period="p",
            status="提出済み",
            target=8,
            slots=[Slot(date=p.start, start=600, end=840)],
        )
    )
    c = solve(s, p)
    assert {a.staff for a in c.assignments} == {"s", "rare"}
    s.staff[-1].day_min = 8
    s.staff[-1].day_max = 8
    c = solve(s, p)
    row = next(r for r in c.metrics["summary"] if r["staff"] == "rare")
    assert row["hours"] == 0 and "最短" in row["zero_reason"]


def test_labor_cost_breaks_tie_without_overstaffing():
    s = small()
    p = s.periods[0]
    p.end = p.start
    s.requirements = s.requirements[:1]
    s.staff[0].hourly_rate = 5000
    s.staff[0].day_min = 4
    s.staff[0].target = 0
    s.submissions[0].target = 0
    cheap = s.staff[0].model_copy(deep=True)
    cheap.id = "cheap"
    cheap.hourly_rate = 1000
    s.staff.append(cheap)
    s.submissions.append(
        Submission(
            staff="cheap",
            period="p",
            status="提出済み",
            target=0,
            slots=[Slot(date=p.start, start=600, end=840)],
        )
    )
    c = solve(s, p, "人件費を抑える")
    assert len(c.assignments) == 1 and c.assignments[0].staff == "cheap"


def test_week_days_and_earliest_latest_are_hard():
    s = small()
    p = s.periods[0]
    s.staff[0].max_days_week = 1
    s.staff[0].earliest_start = 660
    s.staff[0].latest_end = 780
    c = solve(s, p)
    # The fixture may straddle the configured week; each week is checked separately.
    from backend.engine import week

    assert all(660 <= a.start < a.end <= 780 for a in c.assignments)
    assert len({week(a.date, 0) for a in c.assignments}) == len(c.assignments)


def test_condition_parser_rejects_ambiguity_and_never_silently_ignores():
    parsed = parse_conditions("基本: 月、水 10:00-17:00\n週の上限: 20時間\n最短勤務: 2.5時間")
    assert parsed["can_apply"] and len(parsed["patch"]["regular"]) == 2
    assert parsed["patch"]["maximum"] == 20
    for text in [
        "たぶん夜は無理",
        "基本: 月 10:17-20:00",
        "週の上限: 2日",
        "時給: 1000円\n時給: 2000円",
    ]:
        result = parse_conditions(text)
        assert not result["can_apply"] and result["errors"]


def test_conditions_api_ai_off_and_unreviewed_blocks_generation(client):
    s = seed(client)
    response = client.post("/api/conditions/preview", json={"text": "週の上限: 20時間"})
    assert response.json()["patch"]["maximum"] == 20
    assert client.get("/api/state").json()["staff"][0]["maximum"] == 8
    assert (
        client.post("/api/conditions/preview", json={"text": "abc", "use_ai": True}).status_code
        == 422
    )
    s["staff"][0]["condition_text"] = "週の上限: 20時間"
    s = client.put("/api/state", json=s).json()
    assert client.post("/api/periods/p/generate", json={"version": s["version"]}).status_code == 422


def test_wage_changes_invalidate_cache_and_stale_confirmation(client):
    s = seed(client)
    s = client.post("/api/periods/p/generate", json={"version": s["version"]}).json()
    cid = s["candidates"][0]["id"]
    s["staff"][0]["hourly_rate"] = 1800
    s = client.put("/api/state", json=s).json()
    assert client.get("/api/state").json()["candidates"][0]["metrics"]["stale"]
    assert (
        client.post(
            "/api/candidates/" + cid + "/confirm", json={"version": s["version"], "name": "管理者"}
        ).status_code
        == 409
    )
    s = client.post("/api/periods/p/generate", json={"version": s["version"]}).json()
    assert sum(not c["archived"] for c in s["candidates"]) == 3


def test_background_job_result_is_atomic_and_reports_failure(client, monkeypatch):
    s = seed(client)
    from backend import main
    from backend.optimizer import SchedulingError

    monkeypatch.setattr(
        main, "solve", lambda *args: (_ for _ in ()).throw(SchedulingError("試験用失敗"))
    )
    response = client.post("/api/periods/p/generation-jobs", json={"version": s["version"]})
    assert response.status_code == 200
    for _ in range(100):
        job = client.get("/api/generation-jobs/" + response.json()["id"]).json()
        if job["status"] != "running":
            break
        time.sleep(0.01)
    assert job["status"] == "failed" and "試験用失敗" in job["message"]
    assert client.get("/api/state").json()["version"] == s["version"]
    assert client.get("/api/state").json()["candidates"] == []


def test_ai_result_is_preview_only_and_provider_failure_leaves_state(client, monkeypatch):
    from backend import condition_ai

    s = seed(client)
    monkeypatch.setattr(
        condition_ai,
        "translate",
        lambda text: condition_ai.AIResult(
            lines=["週の上限: 20時間"], unsupported=["隔週だけ出勤"]
        ),
    )
    result = client.post(
        "/api/conditions/preview",
        json={"text": "週20時間以内で隔週だけ出勤", "use_ai": True, "consent": True},
    )
    assert result.status_code == 200
    assert not result.json()["can_apply"] and result.json()["errors"]
    assert client.get("/api/state").json()["version"] == s["version"]
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    assert not condition_ai.configured()


def test_split_work_still_requires_daily_break():
    from backend.schema import Candidate

    s = small()
    p = s.periods[0]
    s.store.end = 1140
    s.staff[0].day_max = 8
    s.staff[0].maximum = 20
    s.staff[0].interval = 0
    s.submissions[0].slots = [Slot(date=p.start, start=600, end=1140)]
    c = validate(
        s,
        Candidate(
            id="x",
            period=p.id,
            name="分割",
            assignments=[
                Assignment(id="a", staff="s", role="r", date=p.start, start=600, end=840),
                Assignment(id="b", staff="s", role="r", date=p.start, start=900, end=1140),
            ],
        ),
    )
    assert any(v["code"] == "break" and v["hard"] for v in c.violations)
