"""Read-only local regression review. Never saves state or tokens."""

import json
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from backend import db  # noqa: E402
from backend.breaks import break_minutes, paid_minutes, required_break  # noqa: E402
from backend.engine import PRESETS, solve  # noqa: E402
from backend.schema import available  # noqa: E402

s = db.get_state()
p = next(p for p in s.periods if p.status != "確定済み")
report = []
for preset in PRESETS:
    start = time.monotonic()
    c = solve(s.model_copy(deep=True), p, preset)
    for a in c.assignments:
        staff = next(x for x in s.staff if x.id == a.staff)
        assert all(available(s, p, staff, a.date, t, 15) for t in range(a.start, a.end, 15))
        assert break_minutes(a) >= required_break(s.store, staff, paid_minutes(a), a.end - a.start)
        assert all(a.start < b.start < b.end < a.end for b in a.breaks)
    assert not any(v["hard"] and v["code"] != "role_shortage" for v in c.violations)
    row = {
        "preset": preset,
        "seconds": round(time.monotonic() - start, 2),
        "staff_assigned": len({a.staff for a in c.assignments}),
        "coverage": c.metrics["coverage"],
        "paid_hours": c.metrics["total_hours"],
        "hard": c.metrics["hard"],
        "breaks": sum(len(a.breaks) for a in c.assignments),
        "solver": c.solver,
    }
    report.append(row)
    print(json.dumps(row, ensure_ascii=True), flush=True)
Path("artifacts/scheduler-v3-review.json").write_text(
    json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
)
