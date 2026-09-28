"""Confirmed-shift requests and an on-site attendance kiosk.

Clock records are facts. Planned breaks are never silently deducted from them.
"""

import hashlib
import secrets
from datetime import date, datetime, timedelta, timezone
from decimal import ROUND_HALF_UP, Decimal
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Header, HTTPException, Request, Response
from pydantic import BaseModel, Field, model_validator
from sqlalchemy import select, text
from sqlalchemy.orm import Session

from . import db
from .breaks import break_minutes, required_break
from .config import production
from .employee_auth import employee_id
from .payroll import cycle, estimate

router = APIRouter()
JST = ZoneInfo("Asia/Tokyo")
KIOSK_COOKIE = "shift_kiosk"


def local_now():
    return datetime.now(JST)


def confirmed_assignments(state):
    selected = {p.selected for p in state.periods if p.status == "確定済み"}
    return sorted(
        (a for c in state.candidates if c.id in selected for a in c.assignments),
        key=lambda a: (a.date, a.start, a.staff),
    )


def active_staff(state, sid):
    return next((s for s in state.staff if s.id == sid and s.active), None)


def request_view(row):
    return {
        "id": row.id,
        "staff": row.staff,
        "assignment": row.assignment,
        "date": row.shift_date,
        "start": row.shift_start,
        "end": row.shift_end,
        "kind": row.kind,
        "reason": row.reason,
        "proposed_start": row.proposed_start,
        "proposed_end": row.proposed_end,
        "status": row.status,
        "manager_note": row.manager_note,
        "created_at": row.created_at,
        "updated_at": row.updated_at,
    }


def paid_seconds(row):
    if not row.clock_out:
        return 0
    seconds = (datetime.fromisoformat(row.clock_out) - datetime.fromisoformat(row.clock_in)).total_seconds()
    return max(0, seconds - row.break_minutes * 60)


def money(seconds, rate):
    return int(
        (Decimal(str(seconds)) * Decimal(rate) / Decimal(3600)).quantize(
            Decimal("1"), rounding=ROUND_HALF_UP
        )
    )


def attendance_view(row, state):
    staff = next((s for s in state.staff if s.id == row.staff), None)
    span = (
        (datetime.fromisoformat(row.clock_out) - datetime.fromisoformat(row.clock_in)).total_seconds()
        if row.clock_out
        else 0
    )
    paid = paid_seconds(row)
    needed = (
        required_break(state.store, staff, paid / 60, span / 60)
        if staff and state.store and row.clock_out
        else 0
    )
    return {
        "id": row.id,
        "staff": row.staff,
        "date": row.work_date,
        "assignment": row.assignment,
        "clock_in": row.clock_in,
        "clock_out": row.clock_out,
        "break_minutes": row.break_minutes,
        "break_confirmed": bool(row.break_confirmed),
        "break_required": needed,
        "paid_hours": round(paid / 3600, 2),
        "gross": money(paid, staff.hourly_rate) if staff and staff.hourly_rate is not None and row.clock_out else None,
        "correction_reason": row.correction_reason,
        "needs_review": bool(row.clock_out and (not row.break_confirmed or row.break_minutes < needed)),
    }


def pay_summary(state, staff, assignments, rows, today):
    start, close, payday = cycle(staff, today)
    completed = [
        row for row in rows if row.staff == staff.id and row.clock_out and start <= date.fromisoformat(row.work_date) <= close
    ]
    actual_seconds = sum(paid_seconds(row) for row in completed)
    actual_days = {row.work_date for row in completed}
    actual_wage = money(actual_seconds, staff.hourly_rate) if staff.hourly_rate is not None else None
    actual_transport = len(actual_days) * staff.transport_per_day
    future = [
        a for a in assignments if a.staff == staff.id and a.date >= today and start <= a.date <= close
        and not any(r.assignment == a.id and r.clock_out for r in completed)
    ]
    planned = estimate(staff, future)
    actual_total = actual_wage + actual_transport if actual_wage is not None else None
    forecast_total = actual_total + (planned["total"] or 0) if actual_total is not None and planned["total"] is not None else None
    return {
        "staff": staff.id,
        "name": staff.name,
        "start": str(start),
        "end": str(close),
        "payday": str(payday),
        "actual_hours": round(actual_seconds / 3600, 2),
        "actual_days": len(actual_days),
        "actual_wage": actual_wage,
        "actual_transport": actual_transport,
        "actual_total": actual_total,
        "forecast_hours": round(actual_seconds / 3600 + planned["paid_hours"], 2),
        "forecast_total": forecast_total,
        "unreviewed_breaks": sum(attendance_view(r, state)["needs_review"] for r in completed),
    }


class ChangeBody(BaseModel):
    assignment: str = Field(min_length=1, max_length=100)
    kind: str = Field(pattern="^(休み希望|時間変更|相談)$")
    reason: str = Field(min_length=5, max_length=1000)
    proposed_start: int | None = Field(default=None, ge=0, le=1439)
    proposed_end: int | None = Field(default=None, ge=1, le=1440)

    @model_validator(mode="after")
    def time_pair(self):
        if (self.proposed_start is None) != (self.proposed_end is None):
            raise ValueError("変更可能な時間は開始と終了を両方入力してください")
        if self.proposed_start is not None and self.proposed_start >= self.proposed_end:
            raise ValueError("変更可能な時間は開始より終了を後にしてください")
        if self.kind == "時間変更" and self.proposed_start is None:
            raise ValueError("時間変更では対応できる時間を入力してください")
        return self


@router.get("/api/employee/my-work")
def employee_work(request: Request):
    sid = employee_id(request)
    state = db.get_state()
    staff = active_staff(state, sid)
    assignments = confirmed_assignments(state)
    with Session(db.engine) as session:
        changes = session.scalars(select(db.ShiftChangeRequest).where(db.ShiftChangeRequest.staff == sid).order_by(db.ShiftChangeRequest.created_at.desc())).all()
        attendance = session.scalars(select(db.Attendance).where(db.Attendance.staff == sid).order_by(db.Attendance.clock_in.desc())).all()
    return {
        "assignments": [a.model_dump(mode="json") for a in assignments if a.staff == sid],
        "requests": [request_view(row) for row in changes],
        "attendance": [attendance_view(row, state) for row in attendance],
        "pay": pay_summary(state, staff, assignments, attendance, local_now().date()),
        "roles": [{"id": r.id, "name": r.name} for r in state.roles],
    }


@router.post("/api/employee/change-requests")
def create_change(body: ChangeBody, request: Request):
    sid = employee_id(request)
    state = db.get_state()
    assignment = next((a for a in confirmed_assignments(state) if a.id == body.assignment and a.staff == sid), None)
    if not assignment or assignment.date < local_now().date():
        raise HTTPException(404, "今後の確定勤務から選んでください")
    if body.proposed_start is not None:
        if body.proposed_start % state.store.step or body.proposed_end % state.store.step:
            raise HTTPException(422, f"変更可能な時間は{state.store.step}分単位で入力してください")
        if body.proposed_start < state.store.start or body.proposed_end > state.store.end:
            raise HTTPException(422, "変更可能な時間は店舗の営業時間内にしてください")
    with Session(db.engine) as session:
        session.execute(text("BEGIN IMMEDIATE"))
        pending = session.scalar(select(db.ShiftChangeRequest).where(
            db.ShiftChangeRequest.staff == sid,
            db.ShiftChangeRequest.assignment == assignment.id,
            db.ShiftChangeRequest.status.in_(["未確認", "確認中"]),
        ))
        if pending:
            raise HTTPException(409, "この勤務の申請は確認中です")
        row = db.ShiftChangeRequest(
            id=secrets.token_hex(16), staff=sid, assignment=assignment.id,
            shift_date=str(assignment.date), shift_start=assignment.start, shift_end=assignment.end,
            kind=body.kind, reason=body.reason.strip(), proposed_start=body.proposed_start,
            proposed_end=body.proposed_end, status="未確認", manager_note="",
            created_at=db.now(), updated_at=db.now(),
        )
        session.add(row)
        session.commit()
        return request_view(row)


class ReviewBody(BaseModel):
    status: str = Field(pattern="^(未確認|確認中|確認済み|見送り)$")
    note: str = Field(default="", max_length=1000)


@router.put("/api/operations/change-requests/{rid}")
def review_change(rid: str, body: ReviewBody):
    with Session(db.engine) as session:
        row = session.get(db.ShiftChangeRequest, rid)
        if not row:
            raise HTTPException(404, "申請が見つかりません")
        if body.status in ("確認済み", "見送り") and not body.note.strip():
            raise HTTPException(422, "結果を本人に伝えるコメントを入力してください")
        row.status, row.manager_note, row.updated_at = body.status, body.note.strip(), db.now()
        session.commit()
        return request_view(row)


@router.post("/api/operations/kiosk-token")
def rotate_kiosk_token():
    token = secrets.token_urlsafe(32)
    with Session(db.engine) as session:
        row = session.get(db.KioskCredential, 1)
        if row:
            row.digest, row.created_at = hashlib.sha256(token.encode()).hexdigest(), db.now()
        else:
            session.add(db.KioskCredential(id=1, digest=hashlib.sha256(token.encode()).hexdigest(), created_at=db.now()))
        session.commit()
    return {"token": token}


@router.get("/api/operations/kiosk-devices")
def kiosk_devices():
    with Session(db.engine) as session:
        return [{"id": row.digest, "label": row.label, "created_at": row.created_at, "last_seen": row.last_seen}
                for row in session.scalars(select(db.KioskDevice).order_by(db.KioskDevice.created_at)).all()]


@router.delete("/api/operations/kiosk-devices/{digest}")
def revoke_kiosk_device(digest: str):
    with Session(db.engine) as session:
        row = session.get(db.KioskDevice, digest)
        if not row:
            raise HTTPException(404, "端末が見つかりません")
        session.delete(row)
        session.commit()
    return {"ok": True}


class PairBody(BaseModel):
    token: str = Field(min_length=32, max_length=256)
    label: str = Field(default="店舗の打刻端末", min_length=1, max_length=80)


@router.post("/api/kiosk/pair")
def pair_kiosk(body: PairBody, response: Response):
    device_token = secrets.token_urlsafe(32)
    with Session(db.engine) as session:
        session.execute(text("BEGIN IMMEDIATE"))
        credential = session.get(db.KioskCredential, 1)
        if not credential or not secrets.compare_digest(credential.digest, hashlib.sha256(body.token.encode()).hexdigest()):
            raise HTTPException(401, "登録リンクの期限が切れています。管理者から新しいリンクを受け取ってください")
        session.add(db.KioskDevice(
            digest=hashlib.sha256(device_token.encode()).hexdigest(),
            label=body.label.strip(), created_at=db.now(), last_seen=db.now(),
        ))
        session.delete(credential)  # Pairing links work once; registered devices remain valid.
        session.commit()
    response.set_cookie(KIOSK_COOKIE, device_token, httponly=True, secure=production(),
                        samesite="strict", max_age=365 * 86400, path="/api/kiosk")
    return {"ok": True}


def kiosk_authorized(request, token=None, response=None):
    device_token = request.cookies.get(KIOSK_COOKIE, "")
    with Session(db.engine) as session:
        device = session.get(db.KioskDevice, hashlib.sha256(device_token.encode()).hexdigest()) if device_token else None
        if device:
            device.last_seen = db.now()
            session.commit()
            if response is not None:
                response.set_cookie(KIOSK_COOKIE, device_token, httponly=True, secure=production(),
                                    samesite="strict", max_age=365 * 86400, path="/api/kiosk")
            return
        credential = session.get(db.KioskCredential, 1)
        if token and credential and secrets.compare_digest(credential.digest, hashlib.sha256(token.encode()).hexdigest()):
            return
    raise HTTPException(401, "この端末は未登録です。管理者から登録リンクを受け取ってください")


@router.get("/api/kiosk/status")
def kiosk_status(request: Request, response: Response):
    kiosk_authorized(request, response=response)
    return {"registered": True}


@router.get("/api/kiosk/today")
def kiosk_today(request: Request, response: Response, x_kiosk_token: str | None = Header(default=None)):
    kiosk_authorized(request, x_kiosk_token, response)
    state = db.get_state()
    today = local_now().date()
    assignments = [a for a in confirmed_assignments(state) if a.date == today]
    with Session(db.engine) as session:
        records = session.scalars(select(db.Attendance).where(db.Attendance.clock_out.is_(None))).all()
        finished = session.scalars(select(db.Attendance).where(db.Attendance.work_date == str(today), db.Attendance.clock_out.is_not(None))).all()
    active = {row.staff: row for row in records}
    done = {row.staff for row in finished}
    scheduled = []
    seen = set()
    for a in assignments:
        s = active_staff(state, a.staff)
        if s and a.staff not in active and a.staff not in done and a.staff not in seen:
            scheduled.append({"staff": s.id, "name": s.name, "start": a.start, "end": a.end})
            seen.add(a.staff)
    working = [
        {"id": row.id, "staff": row.staff, "name": s.name, "clock_in": row.clock_in}
        for row in records if (s := active_staff(state, row.staff))
    ]
    return {"date": str(today), "store": state.store.name if state.store else "", "scheduled": scheduled, "working": working, "finished": len(finished)}


class ClockInBody(BaseModel):
    staff: str = Field(min_length=1, max_length=100)


@router.post("/api/kiosk/clock-in")
def clock_in(body: ClockInBody, request: Request, x_kiosk_token: str | None = Header(default=None)):
    kiosk_authorized(request, x_kiosk_token)
    state = db.get_state()
    today = local_now().date()
    assignment = next((a for a in confirmed_assignments(state) if a.staff == body.staff and a.date == today), None)
    if not assignment or not active_staff(state, body.staff):
        raise HTTPException(403, "本日の確定シフトに登録されていません。管理者に確認してください")
    with Session(db.engine) as session:
        session.execute(text("BEGIN IMMEDIATE"))
        if session.scalar(select(db.Attendance).where(db.Attendance.staff == body.staff, db.Attendance.clock_out.is_(None))):
            raise HTTPException(409, "すでに出勤中です")
        if session.scalar(select(db.Attendance).where(db.Attendance.staff == body.staff, db.Attendance.work_date == str(today))):
            raise HTTPException(409, "本日の打刻は登録済みです。修正は管理者に依頼してください")
        row = db.Attendance(
            id=secrets.token_hex(16), staff=body.staff, work_date=str(today), assignment=assignment.id,
            clock_in=db.now(), clock_out=None, break_minutes=0, break_confirmed=0,
            correction_reason="", updated_at=db.now(),
        )
        session.add(row)
        session.commit()
        return {"id": row.id, "clock_in": row.clock_in}


class ClockOutBody(BaseModel):
    attendance: str = Field(min_length=1, max_length=100)


@router.post("/api/kiosk/clock-out")
def clock_out(body: ClockOutBody, request: Request, x_kiosk_token: str | None = Header(default=None)):
    kiosk_authorized(request, x_kiosk_token)
    state = db.get_state()
    with Session(db.engine) as session:
        session.execute(text("BEGIN IMMEDIATE"))
        row = session.get(db.Attendance, body.attendance)
        if not row or row.clock_out:
            raise HTTPException(409, "出勤中の記録が見つかりません。画面を更新してください")
        current = datetime.now(timezone.utc)
        if current - datetime.fromisoformat(row.clock_in) > timedelta(hours=24):
            raise HTTPException(409, "24時間を超える打刻は管理者が確認してください")
        row.clock_out = current.isoformat()
        assignment = next((a for a in confirmed_assignments(state) if a.id == row.assignment), None)
        row.break_confirmed = int(not assignment or break_minutes(assignment) == 0 and paid_seconds(row) <= 6 * 3600)
        row.updated_at = db.now()
        session.commit()
        return attendance_view(row, state)


class CorrectionBody(BaseModel):
    clock_in: datetime
    clock_out: datetime
    break_minutes: int = Field(ge=0, le=720)
    break_confirmed: bool
    reason: str = Field(min_length=5, max_length=1000)

    @model_validator(mode="after")
    def valid_times(self):
        if not self.clock_in.tzinfo or not self.clock_out.tzinfo:
            raise ValueError("時刻にはタイムゾーンが必要です")
        duration = self.clock_out - self.clock_in
        if duration <= timedelta(0) or duration > timedelta(hours=24):
            raise ValueError("退勤は出勤より後、24時間以内にしてください")
        if self.break_minutes * 60 >= duration.total_seconds():
            raise ValueError("休憩は勤務の途中の時間内にしてください")
        return self


@router.put("/api/operations/attendance/{aid}")
def correct_attendance(aid: str, body: CorrectionBody):
    with Session(db.engine) as session:
        row = session.get(db.Attendance, aid)
        if not row:
            raise HTTPException(404, "打刻が見つかりません")
        if body.clock_in.astimezone(JST).date().isoformat() != row.work_date:
            raise HTTPException(422, "勤務日を変更する場合は管理者が別途確認してください")
        row.clock_in = body.clock_in.astimezone(timezone.utc).isoformat()
        row.clock_out = body.clock_out.astimezone(timezone.utc).isoformat()
        row.break_minutes = body.break_minutes
        row.break_confirmed = int(body.break_confirmed)
        row.correction_reason = body.reason.strip()
        row.updated_at = db.now()
        session.commit()
        return attendance_view(row, db.get_state())


@router.get("/api/operations/overview")
def operations_overview():
    state = db.get_state()
    assignments = confirmed_assignments(state)
    today = local_now().date()
    with Session(db.engine) as session:
        changes = session.scalars(select(db.ShiftChangeRequest).order_by(db.ShiftChangeRequest.created_at.desc())).all()
        attendance = session.scalars(select(db.Attendance).order_by(db.Attendance.clock_in.desc())).all()
        kiosk_ready = bool(session.get(db.KioskCredential, 1) or session.scalar(select(db.KioskDevice.digest).limit(1)))
    rows = [pay_summary(state, s, assignments, attendance, today) for s in state.staff if s.active]
    return {
        "date": str(today),
        "kiosk_ready": kiosk_ready,
        "requests": [{**request_view(r), "name": next((s.name for s in state.staff if s.id == r.staff), "退職者")} for r in changes],
        "attendance": [{**attendance_view(r, state), "name": next((s.name for s in state.staff if s.id == r.staff), "退職者")} for r in attendance],
        "pay": {
            "actual_total": sum(r["actual_total"] or 0 for r in rows),
            "forecast_total": sum(r["forecast_total"] or 0 for r in rows),
            "unpriced": sum(r["forecast_total"] is None for r in rows),
            "rows": rows,
            "basis": "締め期間は各従業員の契約設定によります。打刻実績と今後の確定シフトによる概算で、税・保険・割増賃金・控除は含みません。",
        },
    }
