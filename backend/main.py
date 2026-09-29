import csv
import hashlib
import io
import json
import logging
import re
import secrets
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from contextlib import asynccontextmanager
from contextvars import copy_context
from datetime import datetime, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

from fastapi import FastAPI, Header, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.trustedhost import TrustedHostMiddleware
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from . import db, platform, tenant
from .auth import authenticated
from .auth import router as auth_router
from .breaks import paid_minutes
from .conditions import router as conditions_router
from .config import allowed_hosts, allowed_origins, production, validate_config
from .demand import router as demand_router
from .employee_auth import employee_id
from .employee_auth import router as employee_router
from .engine import PRESETS, preflight_check, solve, validate
from .operations import router as operations_router
from .optimizer import SchedulingError
from .payroll import employee_pay, estimate, labor_cost
from .platform import router as platform_router
from .schema import Assignment, State, Store, Submission
from .seed import demo

validate_config()


@asynccontextmanager
async def lifespan(_app):
    platform.init_db()
    platform.migrate_tenants()
    yield


app = FastAPI(
    title="シフトノート API",
    version="1.5.0",
    docs_url=None if production() else "/docs",
    redoc_url=None if production() else "/redoc",
    openapi_url=None if production() else "/openapi.json",
    lifespan=lifespan,
)
app.add_middleware(TrustedHostMiddleware, allowed_hosts=allowed_hosts())
app.include_router(auth_router)
app.include_router(employee_router)
app.include_router(demand_router)
app.include_router(conditions_router)
app.include_router(operations_router)
app.include_router(platform_router)
generation_lock = threading.Lock()
jobs_lock = threading.Lock()
generation_jobs = {}
generation_pool = ThreadPoolExecutor(max_workers=1, thread_name_prefix="shift-generation")


@app.middleware("http")
async def same_origin(request: Request, call_next):
    origin = request.headers.get("origin")
    path = request.url.path
    if path.startswith("/api/") and (
        (origin and origin not in allowed_origins())
        or request.headers.get("sec-fetch-site") == "cross-site"
    ):
        return JSONResponse({"detail": "このアクセス元は許可されていません"}, status_code=403)
    if (
        path.startswith("/api/")
        and not path.startswith(("/api/auth/", "/api/employee/", "/api/kiosk/", "/api/platform/"))
        and path != "/api/portal"
    ):
        if not authenticated(request):
            return JSONResponse(
                {"detail": "管理者ログインが必要です"},
                status_code=401,
                headers={"Cache-Control": "no-store"},
            )
    response = await call_next(request)
    response.headers["Referrer-Policy"] = "no-referrer"
    response.headers["Cache-Control"] = "no-store"
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Content-Security-Policy"] = (
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"
    )
    if production():
        response.headers["Strict-Transport-Security"] = "max-age=31536000"
    return response


@app.middleware("http")
async def tenant_scope(request: Request, call_next):
    match = re.match(r"^/s/([a-z][a-z0-9-]{2,30})(/.*)?$", request.scope["path"])
    if not match:
        return await call_next(request)
    slug = match.group(1)
    with Session(platform.engine) as session:
        merchant = session.scalar(select(platform.Merchant).where(platform.Merchant.slug == slug))
        if not merchant:
            return JSONResponse({"detail": "加盟店が見つかりません"}, status_code=404)
        if merchant.deployment_status != "稼働中" or merchant.status not in ("試用中", "利用中"):
            return JSONResponse({"detail": "この加盟店の利用は停止されています"}, status_code=403)
        mid = merchant.id
    request.scope["path"] = match.group(2) or "/admin"
    if request.scope["path"].startswith(("/api/platform/", "/platform")):
        return JSONResponse({"detail": "この画面は加盟店URLでは利用できません"}, status_code=404)
    id_token = tenant.merchant_id.set(mid)
    slug_token = tenant.merchant_slug.set(slug)
    try:
        response = await call_next(request)
        prefix = f"/s/{slug}".encode()
        response.raw_headers = [
            (key, value.replace(b"Path=/api", b"Path=" + prefix + b"/api"))
            if key.lower() == b"set-cookie" else (key, value)
            for key, value in response.raw_headers
        ]
        return response
    finally:
        tenant.merchant_slug.reset(slug_token)
        tenant.merchant_id.reset(id_token)


@app.exception_handler(RequestValidationError)
async def invalid(request, exc):
    return JSONResponse(
        status_code=422,
        content={
            "detail": "入力内容を確認してください",
            "errors": [
                {
                    "field": ".".join(map(str, e["loc"][1:])),
                    "message": str(e["msg"]).replace("Value error, ", ""),
                }
                for e in exc.errors()
            ],
        },
    )


@app.exception_handler(Exception)
async def unexpected(request, exc):
    logging.getLogger(__name__).exception("Request failed: %s", request.url.path, exc_info=exc)
    return JSONResponse(
        status_code=500,
        content={
            "detail": "処理を完了できませんでした。保存状態を再読み込みし、起動環境を確認してください"
        },
    )


def period(state, pid):
    p = next((p for p in state.periods if p.id == pid), None)
    if not p:
        raise HTTPException(404, "対象期間が見つかりません")
    return p


def unlocked(p):
    if p.status == "確定済み":
        raise HTTPException(423, "確定済みです。再編集を開始してください")


def candidate(state, cid):
    c = next((c for c in state.candidates if c.id == cid), None)
    if not c:
        raise HTTPException(404, "シフト案が見つかりません")
    return c


def version(state, expected):
    if state.version != expected:
        raise HTTPException(409, "他の画面で更新されました。再読み込みしてください")


@app.get("/api/state", response_model=State)
def read():
    state = db.get_state()
    for c in state.candidates:
        c.metrics["labor"] = labor_cost(state, c)
        if not c.archived:
            c.metrics["stale"] = c.input_fingerprint != fingerprint(
                state, period(state, c.period), c.seed
            )
    return state


class Setup(BaseModel):
    store: Store
    demo: bool = False


@app.post("/api/setup", response_model=State)
def setup(body: Setup):
    old = db.get_state()
    if old.store:
        raise HTTPException(409, "初回設定は完了しています")
    state = demo(body.store) if body.demo else State(store=body.store)
    state.version = old.version
    return db.save(state, "初回セットアップ")


@app.put("/api/state", response_model=State)
def update(body: State):
    old = db.get_state()
    version(old, body.version)
    if body.store is None:
        raise HTTPException(422, "店舗情報は削除できません")
    for state in [old, body]:
        for c in state.candidates:
            c.metrics.pop("labor", None)
            c.metrics.pop("stale", None)
    if body.candidates != old.candidates:
        raise HTTPException(400, "シフト案は専用の編集操作で変更してください")
    for p in body.periods:
        prev = next((x for x in old.periods if x.id == p.id), None)
        if (not prev and (p.status != "募集中" or p.selected or p.confirmed_at)) or (
            prev
            and (p.status, p.selected, p.confirmed_at, p.confirmed_by)
            != (prev.status, prev.selected, prev.confirmed_at, prev.confirmed_by)
        ):
            raise HTTPException(400, "期間の状態は専用操作で変更してください")
    for p in old.periods:
        if p.status == "確定済み":
            current = next((x for x in body.periods if x.id == p.id), None)
            if (
                current != p
                or body.store != old.store
                or [
                    s.model_dump(
                        exclude={
                            "hourly_rate",
                            "transport_per_day",
                            "closing_day",
                            "payday",
                            "pay_month_offset",
                        }
                    )
                    for s in body.staff
                ]
                != [
                    s.model_dump(
                        exclude={
                            "hourly_rate",
                            "transport_per_day",
                            "closing_day",
                            "payday",
                            "pay_month_offset",
                        }
                    )
                    for s in old.staff
                ]
                or body.roles != old.roles
                or [r for r in old.requirements if r.period == p.id]
                != [r for r in body.requirements if r.period == p.id]
                or [r for r in old.submissions if r.period == p.id]
                != [r for r in body.submissions if r.period == p.id]
            ):
                raise HTTPException(
                    423, "確定済みシフトに影響する変更です。先に再編集を開始してください"
                )
    for s in body.submissions:
        previous = next(
            (x for x in old.submissions if (x.staff, x.period) == (s.staff, s.period)), None
        )
        if previous != s:
            check_grid(s.slots, body.store.step)
            s.updated_at = db.now()
    for r in body.requirements:
        prev = next((x for x in old.requirements if x.id == r.id), None)
        if r != prev:
            check_grid([r], body.store.step)
    check_grid([body.store], body.store.step)
    for p in body.periods:
        check_grid([h for h in p.special if not h.closed], body.store.step)
    for c in body.candidates:
        validate(body, c)
    return db.save(body, "店長が設定・希望を更新")


class Generate(BaseModel):
    version: int
    seed: int = Field(default=42, ge=0, le=2147483647)
    preset: str = "バランス重視"


def check_grid(rows, step):
    if any(r.start % step or r.end % step for r in rows):
        raise HTTPException(422, f"この店舗は{step}分単位です。開始・終了時刻を合わせてください")


def fingerprint(state, p, seed):
    from .engine import external_shifts

    data = {
        "algorithm": "v3.2-fixed-contracts",
        "seed": seed,
        "store": state.store.model_dump(),
        "period": p.model_dump(
            mode="json", exclude={"status", "confirmed_at", "confirmed_by", "selected", "deadline"}
        ),
        "roles": [r.model_dump() for r in state.roles],
        "staff": [
            s.model_dump(
                mode="json",
                exclude={
                    "closing_day",
                    "payday",
                    "pay_month_offset",
                    "notes",
                    "display",
                    "skills",
                    "name",
                    "extra_fields",
                    "condition_text",
                    "condition_reviewed_text",
                },
            )
            for s in state.staff
        ],
        "requirements": [r.model_dump(mode="json") for r in state.requirements if r.period == p.id],
        "submissions": [
            s.model_dump(mode="json", exclude={"notes", "updated_at"})
            for s in state.submissions
            if s.period == p.id
        ],
        "external": [a.model_dump(mode="json") for a in external_shifts(state, p)],
    }
    return hashlib.sha256(json.dumps(data, sort_keys=True, ensure_ascii=False).encode()).hexdigest()


@app.post("/api/periods/{pid}/preflight")
def preflight(pid: str, seed: int = 42):
    from .schema import Candidate

    state = db.get_state()
    period(state, pid)
    c = validate(state, Candidate(id="", period=pid, name="事前確認"))
    submitted = {s.staff for s in state.submissions if s.period == pid and s.status == "提出済み"}
    return {
        "unsubmitted": [s.name for s in state.staff if s.active and s.id not in submitted],
        "messages": [
            "未提出・下書きのスタッフは自動割当に含みません",
            "必須役割を満たせない案は不足を表示し、確定を止めます",
            "提出時間の外には、休憩を含めて割り当てません",
            "時給未登録者は比較用に登録者の時給中央値（全員未登録時は1,200円）を使用。給与見込みは未計算と表示します",
        ],
        "required_slots": c.metrics["missing_slots"],
        "impossible": preflight_check(state, period(state, pid)),
        "reusable": any(
            c.period == pid
            and not c.archived
            and c.input_fingerprint == fingerprint(state, period(state, pid), seed)
            for c in state.candidates
        ),
    }


@app.post("/api/periods/{pid}/generate", response_model=State)
def generate(pid: str, body: Generate):
    if not generation_lock.acquire(blocking=False):
        raise HTTPException(409, "シフト案を作成中です。完了を待ってください")
    try:
        return generate_locked(pid, body)
    except SchedulingError as exc:
        raise HTTPException(422, str(exc)) from exc
    finally:
        generation_lock.release()


def generate_locked(pid, body, progress=None):
    state = db.get_state()
    p = period(state, pid)
    unlocked(p)
    if body.preset not in PRESETS:
        raise HTTPException(422, "作成方針を選んでください")
    pending = [
        s.name
        for s in state.staff
        if s.active and s.condition_text.strip() and s.condition_text != s.condition_reviewed_text
    ]
    if pending:
        raise HTTPException(
            422,
            "未確認の文章条件があります。スタッフ編集で読み取り結果を確認して反映してください："
            + "、".join(pending),
        )
    key = fingerprint(state, p, body.seed)
    if any(
        c.period == pid and not c.archived and c.input_fingerprint == key for c in state.candidates
    ):
        return state
    version(state, body.version)
    for c in state.candidates:
        if c.period == pid:
            c.archived = True
    for i, preset in enumerate([body.preset] + [k for k in PRESETS if k != body.preset]):
        if progress:
            progress(f"{i + 1}/3案目：{preset}を計算中。希望・休憩・人件費を確認しています")
        c = solve(state, p, preset, body.seed)
        c.id = secrets.token_hex(8)
        c.input_fingerprint = key
        state.candidates.append(c)
    p.status = "作成中"
    return db.save(state, "3案を自動作成")


@app.post("/api/periods/{pid}/generation-jobs")
def start_generation(pid: str, body: Generate):
    state = db.get_state()
    unlocked(period(state, pid))
    version(state, body.version)
    with jobs_lock:
        for job in generation_jobs.values():
            if job["status"] == "running":
                if job["period"] == pid and job.get("merchant_id") == tenant.merchant_id.get():
                    return job.copy()
                raise HTTPException(409, "別の期間を作成中です。完了を待ってください")
        if not generation_lock.acquire(blocking=False):
            raise HTTPException(409, "作成中です。完了を待ってください")
        job_id = secrets.token_hex(12)
        job = {
            "id": job_id,
            "merchant_id": tenant.merchant_id.get(),
            "period": pid,
            "status": "running",
            "message": "条件を確認しています",
            "created": time.time(),
        }
        generation_jobs[job_id] = job
        for key in list(generation_jobs):
            if (
                key != job_id
                and len(generation_jobs) > 30
                and generation_jobs[key]["status"] != "running"
            ):
                generation_jobs.pop(key)

    def work():
        try:
            generate_locked(pid, body, lambda message: job.update(message=message))
            job.update(status="done", message="3案を作成しました")
        except (HTTPException, SchedulingError) as exc:
            job.update(
                status="failed",
                message=str(exc.detail) if isinstance(exc, HTTPException) else str(exc),
            )
        except Exception:
            logging.getLogger(__name__).exception("Generation job failed")
            job.update(
                status="failed",
                message="計算を完了できませんでした。以前の案は保持しています。起動ログを確認してください",
            )
        finally:
            generation_lock.release()

    generation_pool.submit(copy_context().run, work)
    return job.copy()


@app.get("/api/generation-jobs/{job_id}")
def generation_status(job_id: str):
    job = generation_jobs.get(job_id)
    if not job or job.get("merchant_id") != tenant.merchant_id.get():
        raise HTTPException(404, "作成処理が見つかりません。サーバー再起動後は再作成してください")
    return job.copy()


class Edit(BaseModel):
    version: int
    assignments: list[Assignment]


@app.put("/api/candidates/{cid}", response_model=State)
def edit(cid: str, body: Edit):
    state = db.get_state()
    version(state, body.version)
    c = candidate(state, cid)
    unlocked(period(state, c.period))
    check_grid(body.assignments, state.store.step)
    for a in body.assignments:
        s = next((s for s in state.staff if s.id == a.staff and s.active), None)
        if not s or a.role not in s.roles:
            raise HTTPException(422, "このスタッフには選択した役割の担当許可がありません")
    c.previous = c.assignments
    c.assignments = body.assignments
    try:
        state = State.model_validate(state.model_dump())
    except ValueError as exc:
        raise HTTPException(422, "スタッフ・役割または勤務IDが不正です") from exc
    validate(state, candidate(state, cid))
    unsafe = [
        v
        for v in candidate(state, cid).violations
        if v["code"] in {"availability", "break", "hours"} and v["hard"]
    ]
    if unsafe:
        raise HTTPException(422, unsafe[0]["message"] + "。保存していません")
    return db.save(state, "シフト手動編集・再検証")


class Version(BaseModel):
    version: int


@app.post("/api/candidates/{cid}/undo", response_model=State)
def undo(cid: str, body: Version):
    state = db.get_state()
    version(state, body.version)
    c = candidate(state, cid)
    unlocked(period(state, c.period))
    if c.previous is None:
        raise HTTPException(400, "取り消せる変更がありません")
    c.assignments, c.previous = c.previous, None
    validate(state, c)
    return db.save(state, "直前の編集を取り消し")


@app.post("/api/candidates/{cid}/validate", response_model=State)
def revalidate(cid: str, body: Version):
    state = db.get_state()
    version(state, body.version)
    validate(state, candidate(state, cid))
    return db.save(state, "シフト再検証")


class Confirm(Version):
    name: str = Field(min_length=1, max_length=60)


@app.post("/api/candidates/{cid}/confirm", response_model=State)
def confirm(cid: str, body: Confirm):
    state = db.get_state()
    version(state, body.version)
    c = validate(state, candidate(state, cid))
    p = period(state, c.period)
    unlocked(p)
    if c.metrics["hard"]:
        raise HTTPException(422, "重大な違反を解消してから確定してください")
    if c.input_fingerprint != fingerprint(state, p, c.seed):
        raise HTTPException(
            409,
            "希望・勤務条件が変更されています。現在の条件でシフト案を作成してから確定してください",
        )
    p.status, p.selected, p.confirmed_at, p.confirmed_by = "確定済み", cid, db.now(), body.name
    return db.save(state, "シフト確定")


@app.post("/api/periods/{pid}/reopen", response_model=State)
def reopen(pid: str, body: Version):
    state = db.get_state()
    version(state, body.version)
    p = period(state, pid)
    p.status, p.selected, p.confirmed_at, p.confirmed_by = "作成中", None, None, None
    return db.save(state, "確定を解除し再編集開始")


@app.post("/api/periods/{pid}/tokens/{sid}")
def token(pid: str, sid: str):
    if production():
        raise HTTPException(
            410,
            "公開版は従業員メール認証を使用します。「スタッフ」でメールアドレスを登録してください",
        )
    state = db.get_state()
    period(state, pid)
    if not any(s.id == sid and s.active for s in state.staff):
        raise HTTPException(404, "在籍中のスタッフが見つかりません")
    token = secrets.token_urlsafe(32)
    with Session(db.current_engine()) as session:
        session.execute(
            delete(db.ShareToken).where(db.ShareToken.staff == sid, db.ShareToken.period == pid)
        )
        session.add(
            db.ShareToken(
                digest=hashlib.sha256(token.encode()).hexdigest(),
                staff=sid,
                period=pid,
                created_at=db.now(),
            )
        )
        session.commit()
    return {"token": token}


def scope(token):
    if production():
        raise HTTPException(401, "メール認証で従業員画面にログインしてください")
    if not token:
        raise HTTPException(401, "提出URLを確認してください")
    with Session(db.current_engine()) as session:
        row = session.get(db.ShareToken, hashlib.sha256(token.encode()).hexdigest())
        if not row:
            raise HTTPException(404, "提出URLが無効です。店長に再発行を依頼してください")
        return row.staff, row.period


@app.get("/api/portal")
def portal(x_share_token: str | None = Header(default=None)):
    sid, pid = scope(x_share_token)
    return portal_data(sid, pid)


def portal_data(sid, pid):
    state = db.get_state()
    p = period(state, pid)
    s = next((s for s in state.staff if s.id == sid and s.active), None)
    if not s:
        raise HTTPException(403, "在籍状態を店長に確認してください")
    return {
        "store": state.store,
        "staff": {
            "id": s.id,
            "name": s.name,
            "target": s.target,
            "regular": s.regular,
            "regular_only": s.regular_only,
            "fixed_shifts": s.fixed_shifts,
            "fixed_exceptions": s.fixed_exceptions,
        },
        "period": p.model_dump(exclude={"pairs", "confirmed_by"}),
        "submission": next(
            (x for x in state.submissions if x.staff == sid and x.period == pid), None
        ),
        "version": state.version,
        "roles": state.roles,
        "pay": employee_pay(state, s, datetime.now(ZoneInfo("Asia/Tokyo")).date()),
        "period_pay": estimate(
            s,
            [
                a
                for c in state.candidates
                if c.id == p.selected and p.status == "確定済み"
                for a in c.assignments
                if a.staff == sid
            ],
        ),
        "assignments": [
            a
            for c in state.candidates
            if c.id == p.selected and p.status == "確定済み"
            for a in c.assignments
            if a.staff == sid
        ],
    }


class Submit(BaseModel):
    version: int
    submission: Submission


@app.put("/api/portal")
def submit(body: Submit, x_share_token: str | None = Header(default=None)):
    sid, pid = scope(x_share_token)
    return save_submission(body, sid, pid)


def save_submission(body, sid, pid):
    state = db.get_state()
    version(state, body.version)
    p = period(state, pid)
    unlocked(p)
    if not any(s.id == sid and s.active for s in state.staff):
        raise HTTPException(403, "在籍状態を店長に確認してください")
    if datetime.now(timezone.utc) > p.deadline:
        raise HTTPException(403, "提出締切を過ぎています。店長へご相談ください")
    s = body.submission
    check_grid(s.slots, state.store.step)
    if (s.staff, s.period) != (sid, pid):
        raise HTTPException(403, "他のスタッフや期間の希望は変更できません")
    s.updated_at = db.now()
    state.submissions = [x for x in state.submissions if (x.staff, x.period) != (sid, pid)] + [s]
    try:
        State.model_validate(state.model_dump())
    except ValueError as exc:
        raise HTTPException(422, "希望日付は対象期間内にしてください") from exc
    for c in state.candidates:
        if c.period == pid:
            validate(state, c)
    db.save(state, "スタッフが希望を保存・提出")
    return portal_data(sid, pid)


@app.get("/api/employee/portal/{pid}")
def employee_portal(pid: str, request: Request):
    return portal_data(employee_id(request), pid)


@app.get("/api/employee-preview/{sid}/{pid}")
def employee_preview(sid: str, pid: str):
    return portal_data(sid, pid)


@app.put("/api/employee/portal/{pid}")
def employee_submit(pid: str, body: Submit, request: Request):
    return save_submission(body, employee_id(request), pid)


def csv_safe(value):
    value = str(value)
    return (
        "'" + value
        if value.lstrip().startswith(("=", "+", "-", "@", "\t", "\r", "\n"))
        or value.startswith(("\t", "\r", "\n"))
        else value
    )


@app.get("/api/candidates/{cid}/csv")
def export(cid: str):
    state = db.get_state()
    c = candidate(state, cid)
    out = io.StringIO(newline="")
    writer = csv.writer(out)
    writer.writerow(["日付", "氏名", "役割", "開始", "終了", "休憩", "実働時間"])
    for a in sorted(c.assignments, key=lambda a: (a.date, a.start, a.staff)):
        s = next(s for s in state.staff if s.id == a.staff)
        r = next(r for r in state.roles if r.id == a.role)
        writer.writerow(
            [
                str(a.date),
                csv_safe(s.name),
                csv_safe(r.name),
                f"{a.start // 60:02}:{a.start % 60:02}",
                f"{a.end // 60:02}:{a.end % 60:02}",
                " / ".join(
                    f"{b.start // 60:02}:{b.start % 60:02}–{b.end // 60:02}:{b.end % 60:02}"
                    for b in a.breaks
                ),
                paid_minutes(a) / 60,
            ]
        )
    return Response(
        "\ufeff" + out.getvalue(),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": 'attachment; filename="shift.csv"'},
    )


@app.get("/api/audit")
def audit():
    with Session(db.current_engine()) as session:
        return [
            {"action": a.action, "created_at": a.created_at, "version": a.version}
            for a in session.query(db.AuditLog).order_by(db.AuditLog.id.desc()).limit(100)
        ]


dist = Path(__file__).resolve().parent.parent / "frontend" / "dist"


@app.get("/healthz")
def health():
    with Session(db.current_engine()) as session:
        if not session.get(db.Snapshot, 1):
            raise HTTPException(503, "Database unavailable")
    return {"status": "ok", "version": "1.5.0"}


@app.get("/admin")
@app.get("/admin/employee-preview")
@app.get("/employee")
@app.get("/clock")
@app.get("/platform")
def entry():
    return FileResponse(dist / "index.html")


if dist.exists():
    app.mount("/", StaticFiles(directory=dist, html=True), name="ui")
