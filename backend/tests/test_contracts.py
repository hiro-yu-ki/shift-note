from datetime import timedelta

import pytest
from fastapi.testclient import TestClient

from backend import db
from backend.contracts import contract_conflicts
from backend.engine import solve, validate
from backend.main import app, fingerprint
from backend.optimizer import SchedulingError
from backend.schema import Block, Candidate, Staff
from backend.tests.test_app import small


def fixed_state():
    s = small()
    s.periods[0].end = s.periods[0].start
    s.requirements = []
    s.submissions[0].slots = [x for x in s.submissions[0].slots if x.date == s.periods[0].start]
    s.staff[0].employment_type = "社員"
    s.staff[0].fixed_shifts = [Block(weekday=s.periods[0].start.weekday(), start=600, end=840)]
    return s


def test_fixed_contract_is_required_even_without_demand():
    s = fixed_state()
    c = solve(s, s.periods[0])
    assert len(c.assignments) == 1
    assert (c.assignments[0].start, c.assignments[0].end) == (600, 840)
    assert c.metrics["hard"] == 0
    empty = Candidate(id="empty", period="p", name="test")
    validate(s, empty)
    assert any(v["code"] == "fixed_contract" and v["hard"] for v in empty.violations)


def test_fixed_contract_never_overrides_availability():
    s = fixed_state()
    s.submissions[0].slots[0].start = 660
    assert any("希望" in e for e in contract_conflicts(s, s.periods[0]))
    with pytest.raises(SchedulingError, match="希望外には配置しません"):
        solve(s, s.periods[0])
    s.staff[0].fixed_exceptions = [s.periods[0].start]
    assert contract_conflicts(s, s.periods[0]) == []
    c = solve(s, s.periods[0])
    assert all(a.start >= 660 for a in c.assignments)
    fingerprint(s, s.periods[0], 42)  # Dates must serialize for caching.


def test_fixed_contract_checks_closed_unsubmitted_and_duplicate_weekdays():
    s = fixed_state()
    s.submissions = []
    with pytest.raises(SchedulingError):
        solve(s, s.periods[0])
    with pytest.raises(ValueError, match="曜日ごとに1つ"):
        Staff(
            id="s",
            name="test",
            fixed_shifts=[
                Block(weekday=0, start=600, end=720),
                Block(weekday=0, start=900, end=960),
            ],
        )
    s.staff[0].fixed_exceptions = [s.periods[0].start + timedelta(days=1)]
    assert contract_conflicts(s, s.periods[0])


def test_employee_preview_requires_manager_and_is_read_only(client):
    db.save(small(), "test")
    assert client.get("/api/employee-preview/s/p").status_code == 200
    assert client.put("/api/employee-preview/s/p", json={}).status_code == 405
    with TestClient(app) as stranger:
        assert stranger.get("/api/employee-preview/s/p").status_code == 401
