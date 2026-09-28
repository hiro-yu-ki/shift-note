from datetime import datetime, timedelta, timezone

from .schema import Block, Period, Requirement, Role, Slot, Staff, State, Store, Submission, days


def demo(store=None):
    today = datetime.now(timezone(timedelta(hours=9))).date()
    start = today + timedelta(days=7 - today.weekday())
    p = Period(
        id="p-demo",
        start=start,
        end=start + timedelta(days=13),
        deadline=datetime.now(timezone.utc) + timedelta(days=6),
    )
    state = State(
        store=store or Store(name="喫茶 こもれび"),
        roles=[
            Role(id=k, name=v)
            for k, v in [
                ("hall", "ホール"),
                ("kitchen", "キッチン"),
                ("cash", "レジ"),
                ("lead", "責任者"),
            ]
        ],
        periods=[p],
    )
    names = [
        "佐藤 美咲",
        "高橋 悠人",
        "田中 葵",
        "伊藤 翔",
        "渡辺 陽菜",
        "小林 蓮",
        "中村 結衣",
        "加藤 大輝",
        "吉田 咲良",
        "山本 湊",
        "松本 玲奈",
        "井上 陸",
        "木村 七海",
        "林 颯太",
    ]
    for i, name in enumerate(names):
        s = Staff(
            id=f"s{i}",
            name=name,
            display=name.split()[0],
            roles=["lead", "hall"] if i < 4 else ["kitchen", "cash"] if i % 2 else ["hall", "cash"],
            target=24 if i < 4 else 18,
            maximum=36,
            day_min=3,
            day_max=6 if i == 10 else 8,
            notes="夕方までの勤務を希望" if i == 10 else "",
            blocks=[Block(weekday=2, start=0, end=1440)] if i == 9 else [],
        )
        state.staff.append(s)
        if i == 13:
            continue
        state.submissions.append(
            Submission(
                staff=s.id,
                period=p.id,
                status="下書き" if i == 12 else "提出済み",
                target=s.target,
                updated_at=datetime.now(timezone.utc).isoformat(),
                slots=[
                    Slot(
                        date=d,
                        start=state.store.start,
                        end=state.store.end
                        if i != 10
                        else min(state.store.start + 360, state.store.end),
                        kind="できれば入りたい" if (i + d.day) % 3 == 0 else "勤務可能",
                    )
                    for d in days(p)
                    if (d.weekday() != i % 7 or i < 4) and not (i == 9 and d.weekday() == 2)
                ],
            )
        )
    for w in range(7):
        state.requirements.append(
            Requirement(
                id=f"r{w}",
                period=p.id,
                weekday=w,
                start=state.store.start,
                end=state.store.end,
                total=4 if w < 5 else 5,
                roles={"lead": 1, "kitchen": 1, "hall": 1},
                hard=True,
            )
        )
    # A single busy window demonstrates shortages without weakening staff constraints.
    state.requirements.append(
        Requirement(
            id="rush",
            period=p.id,
            date=start + timedelta(days=5),
            start=min(state.store.start + 120, state.store.end - 30),
            end=min(state.store.start + 240, state.store.end),
            total=13,
            roles={"lead": 1, "kitchen": 1},
            hard=True,
        )
    )
    return State.model_validate(state.model_dump())
