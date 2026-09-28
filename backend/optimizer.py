"""15-minute attendance/work/break model with store-aligned shift boundaries."""

from collections import defaultdict
from datetime import timedelta
from math import ceil, floor
from statistics import median

from ortools.sat.python import cp_model

from .breaks import duration_options, paid_minutes
from .schema import Assignment, Candidate, Span, available, days, hours, requirements


class SchedulingError(ValueError):
    pass


def capacity(state, period, staff):
    """Upper bound from the longest submitted contiguous window on each day."""
    total = 0
    feasible_days = 0
    for d in days(period):
        lo, hi = hours(state, period, d)
        run = longest = 0
        for t in range(ceil(lo / 15) * 15, floor(hi / 15) * 15, 15):
            run = run + 15 if available(state, period, staff, d, t, 15) else 0
            longest = max(longest, run)
        best = max(
            (
                row[1] * 15
                for span in range(state.store.step, longest + 1, state.store.step)
                for row in duration_options(state.store, staff, span)
            ),
            default=0,
        )
        if best and staff.roles:
            feasible_days += 1
            total += best
    return min(total, staff.period_max * 60), feasible_days


def solve(state, period, preset="バランス重視", seed=42, relaxed=False):
    from .contracts import contract_conflicts, fixed_on

    conflicts = contract_conflicts(state, period)
    if conflicts:
        raise SchedulingError("\n".join(conflicts[:8]))
    from .engine import external_shifts, validate, week

    ds = days(period)
    people = [s for s in state.staff if s.active]
    external = external_shifts(state, period)
    model = cp_model.CpModel()
    attendance, productive, pauses, role_vars, worked = {}, {}, {}, {}, {}
    daily_paid = {}
    objectives = []
    coverage_terms = []
    by_time, by_role = defaultdict(list), defaultdict(list)
    regular_weight = 180 if preset == "希望優先" else 80
    target_weight = 450 if preset == "希望優先" else 220
    cost_weight = 2 if preset == "人件費を抑える" else 1
    fallback_rate = (
        round(median([s.hourly_rate for s in people if s.hourly_rate is not None]))
        if any(s.hourly_rate is not None for s in people)
        else 1200
    )
    for s in people:
        for d in ds:
            fixed = fixed_on(s, d)
            lo, hi = hours(state, period, d)
            lo, hi = (
                ceil(lo / state.store.step) * state.store.step,
                floor(hi / state.store.step) * state.store.step,
            )
            times = list(range(lo, hi, 15))
            permitted = {t for t in times if available(state, period, s, d, t, 15)}
            permitted = {
                t
                for t in permitted
                if not any(
                    a.staff == s.id
                    and (d - a.date).days * 1440 + t < a.end + s.interval * 60
                    and (d - a.date).days * 1440 + t + 15 > a.start - s.interval * 60
                    for a in external
                )
            }
            w = model.new_bool_var(f"day_{s.id}_{d}")
            worked[s.id, d] = w
            role_day = {r: model.new_bool_var(f"role_{s.id}_{d}_{r}") for r in s.roles}
            model.add(sum(role_day.values()) == w)
            starts, break_starts = [], []
            for t in times:
                key = s.id, d, t
                y = model.new_bool_var(f"attend_{s.id}_{d}_{t}")
                b = model.new_bool_var(f"break_{s.id}_{d}_{t}")
                z = model.new_bool_var(f"paid_{s.id}_{d}_{t}")
                attendance[key], pauses[key], productive[key] = y, b, z
                model.add(z + b == y)
                if t not in permitted:
                    model.add(y == 0)
                if fixed:
                    model.add(y == int(fixed.start <= t < fixed.end))
                previous = attendance.get((s.id, d, t - 15), 0)
                begin = model.new_bool_var(f"begin_{s.id}_{d}_{t}")
                model.add(begin >= y - previous)
                starts.append(begin)
                if t % state.store.step:
                    model.add(y == previous)
                begin_break = model.new_bool_var(f"pause_start_{s.id}_{d}_{t}")
                model.add(begin_break >= b - pauses.get((s.id, d, t - 15), 0))
                break_starts.append(begin_break)
                choices = []
                for rid, role in role_day.items():
                    x = model.new_bool_var(f"x_{s.id}_{d}_{t}_{rid}")
                    model.add(x <= role)
                    choices.append(x)
                    role_vars[s.id, d, t, rid] = x
                    by_role[d, t, rid].append(x)
                model.add(sum(choices) == z)
                by_time[d, t].append(z)
                rate = s.hourly_rate if s.hourly_rate is not None else fallback_rate
                objectives.append(cost_weight * ceil(rate / 4) * z)
                if available(state, period, s, d, t, 15) == "できれば入りたい":
                    objectives.append(-regular_weight * z)
                if any(
                    b.weekday == d.weekday() and b.start <= t and b.end >= t + 15 for b in s.regular
                ):
                    objectives.append(-regular_weight * z)
            for t in times:
                model.add(
                    pauses[s.id, d, t] <= attendance.get((s.id, d, t - state.store.break_margin), 0)
                )
                model.add(
                    pauses[s.id, d, t] <= attendance.get((s.id, d, t + state.store.break_margin), 0)
                )
            a = model.new_int_var(0, 96, "attendance_total")
            b = model.new_int_var(0, 16, "break_total")
            paid = model.new_int_var(0, 96, "paid_total")
            model.add(a == sum(attendance[s.id, d, t] for t in times))
            model.add(b == sum(pauses[s.id, d, t] for t in times))
            model.add(paid == sum(productive[s.id, d, t] for t in times))
            rows = [(0, 0, 0)] + [
                row
                for span in range(state.store.step, max(0, hi - lo) + 1, state.store.step)
                for row in duration_options(state.store, s, span)
            ]
            model.add_allowed_assignments([a, paid, b], rows)
            model.add(a >= w)
            model.add(a <= 96 * w)
            model.add(sum(starts) <= w)
            has_break = model.new_bool_var("has_break")
            model.add(b >= has_break)
            model.add(b <= 16 * has_break)
            model.add(sum(break_starts) == has_break)
            center_difference = (
                2 * sum(t * v for t, v in zip(times, break_starts))
                + 15 * b
                - 2 * sum(t * v for t, v in zip(times, starts))
                - 15 * a
            )
            distance = model.new_int_var(0, 2880, "break_center_distance")
            model.add(distance >= center_difference).only_enforce_if(has_break)
            model.add(distance >= -center_difference).only_enforce_if(has_break)
            model.add(distance <= 2880 * has_break)
            objectives.append(distance)
            existing = sum(paid_minutes(a) for a in external if a.staff == s.id and a.date == d)
            model.add(paid * 15 + existing <= floor(s.day_max * 60))
            daily_paid[s.id, d] = paid
            objectives.append(cost_weight * s.transport_per_day * w)
        for wd in {week(d, state.store.week_start) for d in ds}:
            existing = [
                a
                for a in external
                if a.staff == s.id and week(a.date, state.store.week_start) == wd
            ]
            these = [d for d in ds if week(d, state.store.week_start) == wd]
            model.add(
                sum(daily_paid[s.id, d] for d in these) * 15
                + sum(paid_minutes(a) for a in existing)
                <= s.maximum * 60
            )
            existing_days = {a.date for a in existing}
            model.add(
                sum(worked[s.id, d] for d in these if d not in existing_days) + len(existing_days)
                <= s.max_days_week
            )
        total = sum(daily_paid[s.id, d] for d in ds)
        model.add(total * 15 <= s.period_max * 60)
        cap, n_days = capacity(state, period, s)
        sub = next(
            (
                a
                for a in state.submissions
                if a.staff == s.id and a.period == period.id and a.status == "提出済み"
            ),
            None,
        )
        target = min(cap // 15, round((sub.target if sub else s.target) * len(ds) / 7 * 4))
        deficit = model.new_int_var(0, 2976, "target_deficit")
        model.add(deficit >= target - total)
        objectives.append(target_weight * deficit)
        minimum = model.new_int_var(0, 2976, "minimum_deficit")
        model.add(minimum >= min(cap // 15, round(s.minimum * len(ds) / 7 * 4)) - total)
        objectives.append(500 * minimum)
        if target > 0 and n_days:
            zero = model.new_bool_var("zero_hours")
            model.add(total == 0).only_enforce_if(zero)
            model.add(total >= 1).only_enforce_if(zero.Not())
            objectives.append(8000 * zero)
            # Compare fulfillment ratios, not raw hours of full- and part-time staff.
            ratio = model.new_int_var(0, 100, "unfulfilled_percent")
            model.add(ratio * target >= (target - total) * 100)
            objectives.append(30 * ratio)
        shift_deficit = model.new_int_var(0, 31, "shift_deficit")
        model.add(shift_deficit >= s.min_shifts_period - sum(worked[s.id, d] for d in ds))
        objectives.append(4000 * shift_deficit)
        existing_days = {a.date for a in external if a.staff == s.id}
        for i in range(-s.consecutive, len(ds)):
            window = [period.start + timedelta(days=i + k) for k in range(s.consecutive + 1)]
            model.add(
                sum(worked[s.id, d] for d in window if d in ds and d not in existing_days)
                + sum(d in existing_days for d in window)
                <= s.consecutive
            )
        # Only boundary pairs can violate the interval; no unchecked dictionary indexing.
        for i, d in enumerate(ds):
            first = [(t, v) for (sid, day, t), v in attendance.items() if sid == s.id and day == d]
            for e in ds[i + 1 : i + 4]:
                second = [
                    (t, v) for (sid, day, t), v in attendance.items() if sid == s.id and day == e
                ]
                for t, v in first:
                    for u, other in second:
                        if (e - d).days * 1440 + u - t - 15 < s.interval * 60:
                            model.add(v + other <= 1)
    for pair in period.pairs:
        for (sid, d, t), y in productive.items():
            if sid == pair.first and (pair.second, d, t) in productive:
                delta = model.new_bool_var("pair")
                model.add_abs_equality(delta, y - productive[pair.second, d, t])
                objectives.append(pair.weight * delta)
    for (d, t), workers in by_time.items():
        req = next(
            (r for r in requirements(state, period, d) if r.start <= t and r.end >= t + 15), None
        )
        count = sum(workers)
        needed = req.total if req else 0
        lack = model.new_int_var(0, 30, "shortage")
        excess = model.new_int_var(0, len(people), "excess")
        model.add(lack >= needed - count)
        model.add(excess >= count - needed)
        coverage_terms.append(200000 * lack)
        objectives.append(5000 * excess)
        if req:
            for rid, n in req.roles.items():
                count_role = sum(by_role[d, t, rid])
                if req.hard and not relaxed:
                    model.add(count_role >= n)
                else:
                    missing = model.new_int_var(0, 30, "role_shortage")
                    model.add(missing >= n - count_role)
                    coverage_terms.append((1000000 if req.hard else 100000) * missing)
    model.minimize(sum(coverage_terms) + sum(objectives))
    invalid = model.validate()
    if invalid:
        raise SchedulingError(
            "勤務条件から計算モデルを作れませんでした。勤務時間・人数の設定を確認してください。"
        )
    solver = cp_model.CpSolver()
    solver.parameters.num_search_workers = 1
    solver.parameters.random_seed = seed
    solver.parameters.max_deterministic_time = 5.0
    solver.parameters.max_time_in_seconds = 25
    solver.parameters.linearization_level = 0
    solver.parameters.cp_model_presolve = False
    feasibility = model.clone()
    feasibility.clear_objective()
    initial = cp_model.CpSolver()
    initial.parameters.num_search_workers = 1
    initial.parameters.random_seed = seed
    initial.parameters.max_deterministic_time = 2.0
    initial.parameters.max_time_in_seconds = 15
    initial.parameters.cp_model_presolve = False
    initial.parameters.linearization_level = 0
    initial_status = initial.solve(feasibility)
    if initial_status in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        for index in range(len(model.proto.variables)):
            v = model.get_int_var_from_proto_index(index)
            model.add_hint(v, initial.value(v))
    status = solver.solve(model)
    if status == cp_model.UNKNOWN and initial_status in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        solver, status = initial, cp_model.FEASIBLE
    if status in (cp_model.INFEASIBLE, cp_model.UNKNOWN) and not relaxed:
        return solve(state, period, preset, seed, True)
    if status not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        raise SchedulingError(
            "計算時間内に勤務条件を満たす案が見つかりませんでした。既存の確定勤務による日・週上限、勤務日数、期間の長さを確認してください。以前の案は保持しています。"
        )
    assignments = []
    for s in people:
        for d in ds:
            selected = sorted(
                t
                for (sid, day, t), v in attendance.items()
                if sid == s.id and day == d and solver.value(v)
            )
            if not selected:
                continue
            bp = sorted(
                t
                for (sid, day, t), v in pauses.items()
                if sid == s.id and day == d and solver.value(v)
            )
            role = next(
                r
                for (sid, day, t, r), v in role_vars.items()
                if sid == s.id and day == d and solver.value(v)
            )
            assignments.append(
                Assignment(
                    id=f"{s.id}_{d}",
                    staff=s.id,
                    role=role,
                    date=d,
                    start=selected[0],
                    end=selected[-1] + 15,
                    breaks=[Span(start=bp[0], end=bp[-1] + 15)] if bp else [],
                    reason="提出済みの希望内で、役割・勤務条件・途中休憩を守り、充足と希望を優先して人件費を調整",
                )
            )
    label = solver.status_name(status) + (
        " / 必須役割を満たす案が見つからず不足を表示（確定不可）" if relaxed else ""
    )
    result = validate(
        state,
        Candidate(
            id="", period=period.id, name=preset, assignments=assignments, solver=label, seed=seed
        ),
    )
    unsafe = [v for v in result.violations if v["hard"] and v["code"] != "role_shortage"]
    if unsafe:
        raise SchedulingError(
            "作成結果の安全検証に失敗したため保存しませんでした：" + unsafe[0]["message"]
        )
    return result
