from collections import defaultdict
from datetime import timedelta
from statistics import pstdev

from .breaks import break_minutes, paid_minutes, required_break, working
from .contracts import contract_conflicts, fixed_on
from .schema import available, days, hours, requirements

PRESETS = {
    "バランス重視": (80, 4, 8, 4),
    "希望優先": (60, 20, 3, 2),
    "人件費を抑える": (300, 2, 2, 1),
}
DETERMINISTIC_LIMIT = 2.0
FEASIBILITY_LIMIT = 5.0
HARD_ROLE_PENALTY = 10000
BUSY_THRESHOLD = 5


def week(day, start):
    return day - timedelta(days=(day.weekday() - start) % 7)


def external_shifts(state, period):
    selected = {p.selected for p in state.periods if p.id != period.id and p.status == "確定済み"}
    return [a for c in state.candidates if c.id in selected for a in c.assignments]


def validate(state, candidate):
    step = 15
    p = next(p for p in state.periods if p.id == candidate.period)
    staff = {s.id: s for s in state.staff}
    roles = {r.id: r.name for r in state.roles}
    issues = []

    def issue(code, message, hard=True, **extra):
        issues.append(dict(code=code, message=message, hard=hard, **extra))

    for s in state.staff:
        if not s.active:
            continue
        for day in days(p):
            fixed = fixed_on(s, day)
            shifts = [a for a in candidate.assignments if a.staff == s.id and a.date == day]
            if fixed and (
                len(shifts) != 1 or shifts[0].start != fixed.start or shifts[0].end != fixed.end
            ):
                issue("fixed_contract", f"{day} {s.name}：契約上の固定勤務と一致しません")

    totals = defaultdict(float)
    preferred = 0
    all_slots = 0
    groups = defaultdict(list)
    for a in candidate.assignments:
        s = staff[a.staff]
        groups[s.id].append(a)
        totals[s.id] += paid_minutes(a) / 60
        lo, hi = hours(state, p, a.date)
        if not p.start <= a.date <= p.end or a.start < lo or a.end > hi:
            issue("hours", f"{a.date} {s.name}：営業時間または対象期間外です")
        if a.start % state.store.step or a.end % state.store.step:
            issue(
                "unit",
                f"{a.date} {s.name}：現在の{step}分単位に合っていません。勤務時間を調整してください",
            )
        if not s.active or a.role not in s.roles:
            issue("role", f"{s.name}：在籍状態または担当できる役割を確認してください")
        if not s.day_min <= paid_minutes(a) / 60 <= s.day_max:
            issue("duration", f"{a.date} {s.name}：1勤務の最短・最長時間に違反しています")
        needed_break = required_break(state.store, s, paid_minutes(a), a.end - a.start)
        if break_minutes(a) < needed_break:
            issue("break", f"{a.date} {s.name}：勤務途中に{needed_break}分以上の休憩が必要です")
        if any(
            b.start < a.start + state.store.break_margin or b.end > a.end - state.store.break_margin
            for b in a.breaks
        ):
            issue(
                "break",
                f"{a.date} {s.name}：休憩前後に{state.store.break_margin}分以上の勤務が必要です",
            )
        unavailable = False
        for t in range(a.start, a.end, step):
            kind = available(state, p, s, a.date, t, 15)
            unavailable |= kind is None
            if working(a, t, t + step):
                preferred += kind == "できれば入りたい"
                all_slots += 1
        if unavailable:
            issue(
                "availability",
                f"{a.date} {s.name}：提出済みの勤務可能時間外です。希望を確認してください",
            )
    for sid, shifts in groups.items():
        s = staff[sid]
        daily, weekly = defaultdict(float), defaultdict(float)
        shifts = shifts + [a for a in external_shifts(state, p) if a.staff == sid]
        shifts.sort(key=lambda a: (a.date, a.start))
        for a in shifts:
            daily[a.date] += paid_minutes(a) / 60
            weekly[week(a.date, state.store.week_start)] += paid_minutes(a) / 60
        for d, net in daily.items():
            day_shifts = [a for a in shifts if a.date == d]
            required = required_break(
                state.store, s, round(net * 60), sum(a.end - a.start for a in day_shifts)
            )
            if sum(break_minutes(a) for a in day_shifts) < required:
                issue(
                    "break", f"{d} {s.name}：1日の実働合計に対して{required}分以上の休憩が必要です"
                )
        if (
            totals[sid] > s.period_max
            or any(v > s.maximum for v in weekly.values())
            or any(v > s.day_max for v in daily.values())
        ):
            issue("limit", f"{s.name}：日・週・期間の上限時間を超えています")
        week_days = defaultdict(set)
        for a in shifts:
            week_days[week(a.date, state.store.week_start)].add(a.date)
        if any(len(v) > s.max_days_week for v in week_days.values()):
            issue("days_limit", f"{s.name}：週の勤務日数上限を超えています")
        for a, b in zip(shifts, shifts[1:]):
            gap = (b.date - a.date).days * 1440 + b.start - a.end
            if gap < s.interval * 60:
                issue("interval", f"{s.name}：勤務の重複または勤務間インターバル不足です")
        for d in [p.start + timedelta(days=i) for i in range(-s.consecutive, len(days(p)))]:
            if all(d + timedelta(days=k) in daily for k in range(s.consecutive + 1)):
                issue("consecutive", f"{s.name}：{d}からの連続勤務日数が上限を超えています")
                break
    need = filled = missing_slots = 0
    for d in days(p):
        lo, hi = hours(state, p, d)
        for r in requirements(state, p, d):
            for t in range(max(lo, r.start), min(hi, r.end), step):
                active = [
                    a
                    for a in candidate.assignments
                    if a.date == d and working(a, t, t + step) and staff[a.staff].active
                ]
                need += r.total
                filled += min(r.total, len({a.staff for a in active}))
                lack = max(0, r.total - len({a.staff for a in active}))
                label = f"{d} {t // 60:02}:{t % 60:02}"
                if lack:
                    missing_slots += 1
                    issue(
                        "shortage",
                        f"{label}：あと{lack}人必要です。勤務可能なスタッフの追加・希望時間の見直しを検討してください",
                        False,
                        date=str(d),
                        start=t,
                    )
                for rid, n in r.roles.items():
                    count = len(
                        {a.staff for a in active if a.role == rid and rid in staff[a.staff].roles}
                    )
                    if count < n:
                        options = [
                            s.name
                            for s in state.staff
                            if s.active and rid in s.roles and all(a.staff != s.id for a in active)
                        ]
                        issue(
                            "role_shortage",
                            f"{label}：{roles[rid]}が{n - count}人不足。"
                            + (
                                "希望・上限の確認候補：" + "、".join(options[:3])
                                if options
                                else "この役割を持つスタッフの追加が必要です"
                            ),
                            r.hard,
                            date=str(d),
                            start=t,
                        )
    summary = []
    for s in state.staff:
        if not s.active:
            continue
        sub = next((x for x in state.submissions if x.staff == s.id and x.period == p.id), None)
        target = (sub.target if sub else s.target) * len(days(p)) / 7
        streak = best = 0
        for d in days(p):
            streak = streak + 1 if any(a.date == d for a in groups[s.id]) else 0
            best = max(best, streak)
        summary.append(
            dict(
                staff=s.id,
                name=s.name,
                hours=totals[s.id],
                target=round(target, 1),
                difference=round(totals[s.id] - target, 1),
                consecutive=best,
                zero_reason=zero_reason(state, p, s) if totals[s.id] == 0 else "",
                submitted_days=len({x.date for x in sub.slots if x.kind != "勤務不可"})
                if sub and sub.status == "提出済み"
                else 0,
                available_hours=round(
                    sum(x.end - x.start for x in sub.slots if x.kind != "勤務不可") / 60, 2
                )
                if sub and sub.status == "提出済み"
                else 0,
            )
        )
        if len({a.date for a in groups[s.id]}) < s.min_shifts_period:
            issue("minimum_days", f"{s.name}：期間の最低希望日数に達していません", False)
        if totals[s.id] == 0 and sub and sub.status == "提出済み":
            issue("zero_hours", f"{s.name}：0時間。" + zero_reason(state, p, s), False)
        if totals[s.id] < s.minimum * len(days(p)) / 7:
            issue("minimum", f"{s.name}：最低希望時間に達していません", False)
    candidate.violations = issues
    candidate.metrics = dict(
        coverage=round(100 * filled / need, 1) if need else 100,
        preference=round(100 * preferred / all_slots, 1) if all_slots else 0,
        fairness=round(pstdev([x["difference"] for x in summary]), 1) if summary else 0,
        hard=sum(x["hard"] for x in issues),
        total_hours=sum(totals.values()),
        missing_slots=missing_slots,
        summary=summary,
    )
    return candidate


def solve(state, period, preset="バランス重視", seed=42, relaxed=False):
    from .optimizer import solve as optimize

    return optimize(state, period, preset, seed, relaxed)


def preflight_check(state, p):
    step = 15
    result = contract_conflicts(state, p)
    from .optimizer import capacity

    for s in state.staff:
        sub = next(
            (
                a
                for a in state.submissions
                if a.staff == s.id and a.period == p.id and a.status == "提出済み"
            ),
            None,
        )
        if s.active and sub and (not s.roles or capacity(state, p, s)[0] == 0):
            result.append(s.name + "：" + zero_reason(state, p, s))
    for d in days(p):
        lo, hi = hours(state, p, d)
        for r in requirements(state, p, d):
            for t in range(max(lo, r.start), min(hi, r.end), step):
                eligible = [
                    s
                    for s in state.staff
                    if s.active and s.roles and available(state, p, s, d, t, 15)
                ]
                label = f"{d} {t // 60:02}:{t % 60:02}"
                if len(eligible) < r.total:
                    result.append(
                        f"{label}：必要{r.total}人に対し希望提出済みで勤務可能なのは{len(eligible)}人です"
                    )
                for rid, count in r.roles.items():
                    names = [s.name for s in eligible if rid in s.roles]
                    if len(names) < count:
                        role = next(role.name for role in state.roles if role.id == rid)
                        result.append(
                            f"{label}：{role}の必要{count}人に対し勤務可能なのは{len(names)}人です。役割を持つ人の希望変更・追加を検討してください"
                        )
    return result


def zero_reason(state, p, s):
    from .optimizer import capacity

    sub = next((x for x in state.submissions if x.staff == s.id and x.period == p.id), None)
    if not sub or sub.status != "提出済み":
        return "希望が未提出または下書きです。"
    if not s.roles:
        return "担当を許可された役割がありません。"
    if not any(x.kind != "勤務不可" for x in sub.slots):
        return "勤務可能な日時が提出されていません。"
    cap, _ = capacity(state, p, s)
    if not cap:
        return "提出時間と営業時間・基本曜日の条件・最短勤務時間・休憩を同時に満たせません。"
    if not any(
        available(state, p, s, d, t, 15) and r.total > 0
        for d in days(p)
        for r in requirements(state, p, d)
        for t in range(r.start, r.end, 15)
    ):
        return "提出した時間に必要人数の設定がありません。"
    return "勤務可能な時間はありますが、この案では必要人数・他の人の希望・上限等との組み合わせで未割当です。希望優先の案と比較し、必要人数や勤務条件を確認してください。"
