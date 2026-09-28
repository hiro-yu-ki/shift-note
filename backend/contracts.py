"""Required contract attendance never grants availability without a submission."""

from .breaks import duration_options
from .schema import available, days, hours


def fixed_on(staff, day):
    if day in staff.fixed_exceptions:
        return None
    return next((b for b in staff.fixed_shifts if b.weekday == day.weekday()), None)


def contract_conflicts(state, period):
    errors = []
    for staff in state.staff:
        if not staff.active:
            continue
        for day in days(period):
            block = fixed_on(staff, day)
            if not block:
                continue
            label = f"{day} {staff.name}：固定勤務"
            lo, hi = hours(state, period, day)
            if not staff.roles:
                errors.append(label + "の担当可能な役割がありません")
            if (
                block.start < lo
                or block.end > hi
                or block.start % state.store.step
                or block.end % state.store.step
            ):
                errors.append(label + "が営業時間または入力単位と合いません")
            if not all(
                available(state, period, staff, day, t, 15)
                for t in range(block.start, block.end, 15)
            ):
                errors.append(
                    label
                    + "と提出希望・勤務条件が一致しません。本人に希望を確認するか、合意した除外日を登録してください（希望外には配置しません）"
                )
            if not duration_options(state.store, staff, block.end - block.start):
                errors.append(label + "の長さが実働上限・最短勤務・休憩条件と合いません")
    return errors
