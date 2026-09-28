from datetime import date as Date
from datetime import datetime, timedelta
from typing import Literal

from pydantic import BaseModel, Field, model_validator


class Span(BaseModel):
    start: int = Field(ge=0, le=1425)
    end: int = Field(ge=15, le=1440)

    @model_validator(mode="after")
    def valid(self):
        if self.end <= self.start or self.start % 15 or self.end % 15:
            raise ValueError("開始・終了は15分単位で、終了を開始より後にしてください")
        return self


class BreakRule(BaseModel):
    after_hours: float = Field(ge=0, le=24)
    minutes: int = Field(ge=15, le=240, multiple_of=15)


class Store(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    start: int = 600
    end: int = 1200
    step: Literal[15, 30, 60] = 30
    week_start: int = Field(default=0, ge=0, le=6)
    break_rules: list[BreakRule] = [
        BreakRule(after_hours=6, minutes=45),
        BreakRule(after_hours=8, minutes=60),
    ]
    break_margin: int = Field(default=30, ge=15, le=180, multiple_of=15)

    @model_validator(mode="after")
    def hours(self):
        Span(start=self.start, end=self.end)
        return self


class Role(BaseModel):
    id: str
    name: str = Field(min_length=1, max_length=40)


class Block(Span):
    weekday: int = Field(ge=0, le=6)


class Staff(BaseModel):
    id: str
    name: str = Field(min_length=1, max_length=60)
    display: str = ""
    roles: list[str] = []
    skills: str = ""
    active: bool = True
    target: int = Field(default=20, ge=0, le=168)
    minimum: int = Field(default=0, ge=0, le=168)
    maximum: int = Field(default=30, ge=1, le=168)
    period_max: int = Field(default=120, ge=1, le=744)
    day_min: float = Field(default=3, ge=0.25, le=24)
    day_max: float = Field(default=8, ge=0.25, le=24)
    consecutive: int = Field(default=5, ge=1, le=14)
    interval: int = Field(default=11, ge=0, le=48)
    blocks: list[Block] = []
    notes: str = Field(default="", max_length=2000)
    hourly_rate: int | None = Field(default=None, ge=0, le=100000)
    transport_per_day: int = Field(default=0, ge=0, le=100000)
    closing_day: int = Field(default=31, ge=1, le=31)
    payday: int = Field(default=25, ge=1, le=31)
    pay_month_offset: Literal[0, 1, 2] = 1
    unpaid_break_minutes: int = Field(default=0, ge=0, le=240)
    break_after_hours: float = Field(default=6, ge=0, le=24)
    regular: list[Block] = []
    regular_only: bool = False
    employment_type: Literal["未設定", "社員", "派遣", "パート", "アルバイト", "その他"] = "未設定"
    fixed_shifts: list[Block] = Field(default_factory=list, max_length=7)
    fixed_exceptions: list[Date] = Field(default_factory=list, max_length=366)
    max_days_week: int = Field(default=7, ge=1, le=7)
    min_shifts_period: int = Field(default=0, ge=0, le=31)
    earliest_start: int = Field(default=0, ge=0, le=1425, multiple_of=15)
    latest_end: int = Field(default=1440, ge=15, le=1440, multiple_of=15)
    condition_text: str = Field(default="", max_length=2000)
    condition_reviewed_text: str = Field(default="", max_length=2000)
    extra_fields: dict[str, str] = Field(default_factory=dict, max_length=20)

    @model_validator(mode="after")
    def limits(self):
        if len({b.weekday for b in self.fixed_shifts}) != len(self.fixed_shifts):
            raise ValueError("固定勤務は曜日ごとに1つの連続した時間帯で登録してください")
        if len(set(self.fixed_exceptions)) != len(self.fixed_exceptions):
            raise ValueError("固定勤務の除外日が重複しています")
        for i, a in enumerate(self.regular):
            if any(
                a.weekday == b.weekday and a.start < b.end and b.start < a.end
                for b in self.regular[i + 1 :]
            ):
                raise ValueError("基本の曜日・時間帯が重複しています")
        if self.minimum > self.maximum or self.day_min > self.day_max:
            raise ValueError("最低時間は上限時間以下にしてください")
        if self.earliest_start >= self.latest_end:
            raise ValueError("勤務条件の最早開始は最遅終了より前にしてください")
        if self.regular_only and not self.regular:
            raise ValueError("基本曜日・時間帯に限定する場合は少なくとも1行登録してください")
        if any(len(k) > 60 or len(v) > 300 for k, v in self.extra_fields.items()):
            raise ValueError("追加項目は項目名60文字・内容300文字以内です")
        if self.day_min * 4 % 1 or self.day_max * 4 % 1:
            raise ValueError("勤務時間は0.25時間単位です")
        if self.pay_month_offset == 0 and self.payday < self.closing_day:
            raise ValueError("当月払いの支払日は締め日以降にしてください（または翌月払いを選択）")
        return self


class Special(Span):
    date: Date
    closed: bool = False


class PairPreference(BaseModel):
    first: str
    second: str
    weight: int = Field(default=5, ge=1, le=100)


class Period(BaseModel):
    id: str
    start: Date
    end: Date
    deadline: datetime
    status: Literal["募集中", "作成中", "確定済み"] = "募集中"
    special: list[Special] = []
    confirmed_at: str | None = None
    confirmed_by: str | None = None
    selected: str | None = None
    pairs: list[PairPreference] = []

    @model_validator(mode="after")
    def dates(self):
        if not 0 <= (self.end - self.start).days <= 30:
            raise ValueError("期間は1〜31日で指定してください")
        if self.deadline.tzinfo is None:
            raise ValueError("締切にはタイムゾーンが必要です")
        if len({s.date for s in self.special}) != len(self.special):
            raise ValueError("営業時間の日付が重複しています")
        if any(not self.start <= s.date <= self.end for s in self.special):
            raise ValueError("営業時間の日付は期間内で指定してください")
        return self


class Requirement(Span):
    id: str
    period: str
    weekday: int = Field(default=0, ge=0, le=6)
    date: Date | None = None
    total: int = Field(default=2, ge=0, le=30)
    roles: dict[str, int] = {}
    hard: bool = False


class Slot(Span):
    date: Date
    kind: Literal["勤務可能", "できれば入りたい", "勤務不可"] = "勤務可能"


class Submission(BaseModel):
    staff: str
    period: str
    status: Literal["下書き", "提出済み"] = "下書き"
    target: int = Field(default=20, ge=0, le=168)
    notes: str = Field(default="", max_length=2000)
    updated_at: str = ""
    slots: list[Slot] = []

    @model_validator(mode="after")
    def overlap(self):
        for i, a in enumerate(self.slots):
            for b in self.slots[i + 1 :]:
                if a.date == b.date and a.start < b.end and b.start < a.end:
                    raise ValueError("同じ日の希望時間が重複しています")
        return self


class Assignment(Span):
    id: str
    staff: str
    role: str
    date: Date
    reason: str = "店長による調整"
    breaks: list[Span] = []

    @model_validator(mode="after")
    def valid_breaks(self):
        ordered = sorted(self.breaks, key=lambda b: b.start)
        if any(b.start <= self.start or b.end >= self.end for b in ordered):
            raise ValueError("休憩は勤務の開始・終了を避け、勤務時間の途中に配置してください")
        if any(a.end > b.start for a, b in zip(ordered, ordered[1:])):
            raise ValueError("休憩時間が重複しています")
        return self


class Candidate(BaseModel):
    id: str
    period: str
    name: str
    assignments: list[Assignment] = []
    previous: list[Assignment] | None = None
    metrics: dict = {}
    violations: list[dict] = []
    solver: str = ""
    input_fingerprint: str = ""
    archived: bool = False
    seed: int = 42


class DemandRecord(BaseModel):
    date: Date
    sales: float = Field(ge=0, le=1e10)
    weather: str = Field(default="", max_length=40)


class State(BaseModel):
    version: int = 0
    store: Store | None = None
    roles: list[Role] = []
    staff: list[Staff] = []
    periods: list[Period] = []
    requirements: list[Requirement] = []
    submissions: list[Submission] = []
    candidates: list[Candidate] = []
    demand_history: list[DemandRecord] = []

    @model_validator(mode="after")
    def references(self):
        for items in [self.roles, self.staff, self.periods, self.requirements, self.candidates]:
            if len({x.id for x in items}) != len(items):
                raise ValueError("IDが重複しています")
        roles = {r.id for r in self.roles}
        staff = {s.id for s in self.staff}
        periods = {p.id: p for p in self.periods}
        for p in self.periods:
            for pair in p.pairs:
                if pair.first not in staff or pair.second not in staff or pair.first == pair.second:
                    raise ValueError("組み合わせ希望には異なるスタッフ2名を選んでください")
        for s in self.staff:
            if not set(s.roles) <= roles:
                raise ValueError("存在しない役割です")
        for r in self.requirements:
            if r.period not in periods or not set(r.roles) <= roles:
                raise ValueError("必要人数の期間・役割が存在しません")
            if any(v < 0 or v > 30 for v in r.roles.values()) or sum(r.roles.values()) > r.total:
                raise ValueError("役割人数の合計は必要人数以下にしてください（1人1役割）")
            if r.date and not periods[r.period].start <= r.date <= periods[r.period].end:
                raise ValueError("必要人数の日付は期間内にしてください")
        for i, a in enumerate(self.requirements):
            for b in self.requirements[i + 1 :]:
                if (
                    a.period == b.period
                    and (a.date, a.weekday if not a.date else None)
                    == (b.date, b.weekday if not b.date else None)
                    and a.start < b.end
                    and b.start < a.end
                ):
                    raise ValueError("必要人数の時間帯が重複しています")
        keys = [(s.period, s.staff) for s in self.submissions]
        if len(set(keys)) != len(keys):
            raise ValueError("希望提出が重複しています")
        for s in self.submissions:
            if s.staff not in staff or s.period not in periods:
                raise ValueError("希望提出のスタッフ・期間が存在しません")
            if any(
                not periods[s.period].start <= slot.date <= periods[s.period].end
                for slot in s.slots
            ):
                raise ValueError("希望日時は対象期間内にしてください")
        for c in self.candidates:
            if c.period not in periods:
                raise ValueError("シフト案の期間が存在しません")
            if len({a.id for a in c.assignments}) != len(c.assignments):
                raise ValueError("勤務IDが重複しています")
            if any(a.staff not in staff or a.role not in roles for a in c.assignments):
                raise ValueError("勤務のスタッフ・役割が存在しません")
        return self


def days(p):
    return [p.start + timedelta(days=i) for i in range((p.end - p.start).days + 1)]


def hours(state, period, day):
    s = next((s for s in period.special if s.date == day), None)
    return (
        (0, 0)
        if s and s.closed
        else (s.start, s.end)
        if s
        else (state.store.start, state.store.end)
    )


def requirements(state, period, day):
    rows = [r for r in state.requirements if r.period == period.id]
    special = [r for r in rows if r.date == day]
    return special or [r for r in rows if r.date is None and r.weekday == day.weekday()]


def available(state, period, staff, day, t, step=None):
    step = step or state.store.step
    if t < staff.earliest_start or t + step > staff.latest_end:
        return None
    if staff.regular_only and not any(
        b.weekday == day.weekday() and b.start <= t and b.end >= t + step for b in staff.regular
    ):
        return None
    if any(b.weekday == day.weekday() and b.start < t + step and b.end > t for b in staff.blocks):
        return None
    sub = next(
        (
            s
            for s in state.submissions
            if s.staff == staff.id and s.period == period.id and s.status == "提出済み"
        ),
        None,
    )
    return (
        next(
            (
                s.kind
                for s in sub.slots
                if s.date == day and s.start <= t and s.end >= t + step and s.kind != "勤務不可"
            ),
            None,
        )
        if sub
        else None
    )
