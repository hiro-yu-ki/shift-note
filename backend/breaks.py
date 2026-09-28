"""Explicit unpaid breaks; all scheduling/accounting use these intervals."""


def break_minutes(assignment):
    return sum(b.end - b.start for b in assignment.breaks)


def paid_minutes(assignment):
    return assignment.end - assignment.start - break_minutes(assignment)


def working(assignment, start, end):
    return (
        assignment.start <= start
        and assignment.end >= end
        and not any(b.start < end and b.end > start for b in assignment.breaks)
    )


def required_break(store, staff, paid, span):
    # Standard Japanese rule is based on actual work, strictly above 6 / 8 hours.
    legal = 60 if paid > 480 else 45 if paid > 360 else 0
    company = max((r.minutes for r in store.break_rules if paid > r.after_hours * 60), default=0)
    contract = staff.unpaid_break_minutes if span >= staff.break_after_hours * 60 else 0
    return max(legal, company, contract)


def duration_options(store, staff, span):
    if not span:
        return [(0, 0, 0)]
    # Do not invent long unpaid breaks just to evade a daily paid-hours cap.
    # Only use durations actually present in applicable policies (or zero).
    choices = {0}
    if span > 360:
        choices.add(45)
    if span > 480:
        choices.add(60)
    choices.update(r.minutes for r in store.break_rules if span > r.after_hours * 60)
    if span >= staff.break_after_hours * 60 and staff.unpaid_break_minutes:
        choices.add(((staff.unpaid_break_minutes + 14) // 15) * 15)
    for pause in sorted(choices):
        if pause and pause > span - 2 * store.break_margin:
            continue
        paid = span - pause
        if (
            paid >= staff.day_min * 60
            and paid <= staff.day_max * 60
            and pause >= required_break(store, staff, paid, span)
        ):
            # Minimum sufficient break: avoid padding attendance with unpaid time.
            return [(span // 15, paid // 15, pause // 15)]
    return []
