"""Contract-based gross estimates, not payroll/tax or statutory determinations."""

from calendar import monthrange
from collections import defaultdict
from datetime import date, timedelta
from decimal import ROUND_HALF_UP, Decimal

from .breaks import break_minutes


def month_day(year, month, day):
    return date(year, month, min(day, monthrange(year, month)[1]))


def add_month(day, n, wanted):
    index = day.year * 12 + day.month - 1 + n
    return month_day(index // 12, index % 12 + 1, wanted)


def cycle(staff, day):
    close = month_day(day.year, day.month, staff.closing_day)
    if day > close:
        close = add_month(close, 1, staff.closing_day)
    start = add_month(close, -1, staff.closing_day) + timedelta(days=1)
    payday = add_month(close, staff.pay_month_offset, staff.payday)
    return start, close, payday


def estimate(staff, assignments):
    by_day = defaultdict(int)
    for a in assignments:
        by_day[a.date] += a.end - a.start
    minutes = sum(by_day.values())
    breaks = sum(break_minutes(a) for a in assignments)
    paid = minutes - breaks
    transport = len(by_day) * staff.transport_per_day
    wage = (
        None
        if staff.hourly_rate is None
        else int(
            (Decimal(paid) * Decimal(staff.hourly_rate) / 60).quantize(
                Decimal("1"), rounding=ROUND_HALF_UP
            )
        )
    )
    return {
        "hours": round(minutes / 60, 2),
        "paid_hours": round(paid / 60, 2),
        "break_minutes": breaks,
        "days": len(by_day),
        "wage": wage,
        "transport": transport,
        "total": None if wage is None else wage + transport,
        "hourly_rate": staff.hourly_rate,
    }


def labor_cost(state, candidate):
    rows = [
        {
            "staff": s.id,
            "name": s.name,
            **estimate(s, [a for a in candidate.assignments if a.staff == s.id]),
        }
        for s in state.staff
        if any(a.staff == s.id for a in candidate.assignments)
    ]
    return {
        "total": sum(r["total"] or 0 for r in rows),
        "unpriced": sum(r["total"] is None for r in rows),
        "rows": rows,
        "basis": "登録時給 × 有給の予定時間 ＋ 出勤日ごとの交通費。税・保険・割増賃金は含みません。",
    }


def employee_pay(state, staff, today):
    confirmed = {p.selected for p in state.periods if p.status == "確定済み"}
    rows = [
        a
        for c in state.candidates
        if c.id in confirmed
        for a in c.assignments
        if a.staff == staff.id
    ]
    cycles = [cycle(staff, add_month(today, n, 1)) for n in range(-2, 5)]
    choices = [c for c in cycles if c[2] >= today]
    start, close, payday = min(choices, key=lambda c: c[2])
    included = [a for a in rows if start <= a.date <= close]
    return {
        **estimate(staff, included),
        "payday": str(payday),
        "start": str(start),
        "end": str(close),
        "basis": "確定シフトからの概算（控除前）。未確定の勤務・税・保険・割増賃金は含みません。",
    }
