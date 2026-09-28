"""Explainable staffing proposal; always requires explicit manager application."""

from math import ceil

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from . import db
from .schema import DemandRecord, Requirement, State, days, hours

router = APIRouter(prefix="/api/demand")


class Proposal(BaseModel):
    period: str
    version: int
    history: list[DemandRecord] = Field(default=[], max_length=3000)
    sales_per_labor_hour: float = Field(default=5000, gt=0, le=1e8)
    minimum: int = Field(default=2, ge=0, le=30)
    weather: str = Field(default="", max_length=40)
    event_factor: float = Field(default=1, ge=0.1, le=5)
    roles: dict[str, int] = {}


def preview(body):
    state = db.get_state()
    p = next((p for p in state.periods if p.id == body.period), None)
    if not p:
        raise HTTPException(404, "期間が見つかりません")
    if len({h.date for h in body.history}) != len(body.history):
        raise HTTPException(422, "実績の日付が重複しています")
    if (
        not set(body.roles) <= {r.id for r in state.roles}
        or any(n < 0 or n > 30 for n in body.roles.values())
        or sum(body.roles.values()) > 30
    ):
        raise HTTPException(422, "役割人数を確認してください")
    result = []
    for d in days(p):
        lo, hi = hours(state, p, d)
        if lo == hi:
            continue
        records = [h for h in body.history if h.date < p.start and h.date.weekday() == d.weekday()]
        source = "同じ曜日の実績"
        if not records:
            records = [h for h in body.history if h.date < p.start]
            source = "全曜日の実績（同曜日のデータなし）"
        weighted = []
        for h in records:
            age = (d - h.date).days
            weight = 1 / (1 + age / 90)
            if age <= 60:
                weight *= 2
            if abs(age - 365) <= 21:
                weight *= 2
            if body.weather and h.weather == body.weather:
                weight *= 1.5
            weighted.append((h, weight))
        expected = (
            sum(h.sales * w for h, w in weighted) / sum(w for _, w in weighted) * body.event_factor
            if weighted
            else None
        )
        raw = (
            ceil(expected / (body.sales_per_labor_hour * ((hi - lo) / 60)))
            if expected is not None
            else body.minimum
        )
        total = max(body.minimum, sum(body.roles.values()), raw)
        if total > 30:
            raise HTTPException(
                422, f"{d}：提案が30人を超えます。売上あたり人時・実績を確認してください"
            )
        result.append(
            {
                "date": str(d),
                "start": lo,
                "end": hi,
                "total": total,
                "sales": round(expected) if expected is not None else None,
                "samples": len(records),
                "confidence": "参考値" if len(records) >= 4 else "データ不足",
                "reason": source
                + f" {len(records)}件。直近・前年同時期を重視"
                + ("、同じ天気を加重" if body.weather else "")
                + f"。補正倍率 {body.event_factor}。"
                + ("実績がないため最低人数を使用。" if not weighted else ""),
                "roles": body.roles,
            }
        )
    return {
        "rows": result,
        "method": "売上見込み ÷ 1人1時間あたり売上目安 ÷ 営業時間。日別の目安であり、ピーク時間は推定しません。",
        "version": state.version,
    }


@router.post("/preview")
def proposal(body: Proposal):
    return preview(body)


@router.post("/apply", response_model=State)
def apply(body: Proposal):
    result = preview(body)
    state = db.get_state()
    if body.version != state.version or result["version"] != state.version:
        raise HTTPException(409, "条件が更新されました。提案を再確認してください")
    p = next(p for p in state.periods if p.id == body.period)
    state.demand_history = body.history
    if p.status == "確定済み":
        raise HTTPException(423, "確定済みの期間は変更できません")
    from secrets import token_hex

    state.requirements = [r for r in state.requirements if r.period != p.id] + [
        Requirement(
            id=token_hex(8),
            period=p.id,
            date=r["date"],
            start=r["start"],
            end=r["end"],
            total=r["total"],
            roles=r["roles"],
            hard=True,
        )
        for r in result["rows"]
    ]
    from .engine import validate

    for c in state.candidates:
        if c.period == p.id:
            validate(state, c)
    return db.save(state, "実績からの必要人数提案を確認して反映")
