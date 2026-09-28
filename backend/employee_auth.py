"""Registered-email OTP login. Codes are never returned, logged, or persisted in plaintext."""

import hashlib
import hmac
import os
import re
import secrets
import smtplib
import ssl
import time
from datetime import datetime, timedelta, timezone
from email.message import EmailMessage

from fastapi import APIRouter, BackgroundTasks, HTTPException, Request, Response
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import delete, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from . import db
from .config import production
from .mail_settings import settings as mail_settings

router = APIRouter()
COOKIE = "shift_employee"
LOCAL_SECRET = secrets.token_hex(32)


def digest(value):
    return hashlib.sha256(value.encode()).hexdigest()


def code_digest(ticket, code):
    return hmac.new(
        os.getenv("SHIFT_AUTH_SECRET", LOCAL_SECRET).encode(),
        f"{ticket}:{code}".encode(),
        hashlib.sha256,
    ).hexdigest()


class EmailBody(BaseModel):
    email: str = Field(max_length=254)

    @field_validator("email")
    @classmethod
    def valid_email(cls, value):
        value = value.strip().lower()
        if not re.fullmatch(
            r"[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,63}", value
        ):
            raise ValueError("メールアドレスを確認してください")
        return value


class VerifyBody(BaseModel):
    ticket: str = Field(min_length=32, max_length=100)
    code: str = Field(pattern=r"^\d{8}$")


class AccountBody(EmailBody):
    revision: int = Field(ge=0)


def email_ready():
    return all(
        mail_settings().get(k)
        for k in ("SHIFT_SMTP_HOST", "SHIFT_SMTP_USER", "SHIFT_SMTP_PASSWORD", "SHIFT_MAIL_FROM")
    )


def send_code(email, code):
    config = mail_settings()
    msg = EmailMessage()
    msg["From"] = config["SHIFT_MAIL_FROM"]
    msg["To"] = email
    msg["Subject"] = "シフトノート ログイン確認コード"
    msg.set_content(
        f"確認コード: {code}\n\n有効期限は10分です。シフトノートの従業員ログイン画面に入力してください。\nこのコードを他の人に伝えないでください。心当たりがなければ、このメールは破棄してください。"
    )
    host, port = config["SHIFT_SMTP_HOST"], int(config.get("SHIFT_SMTP_PORT") or "465")
    context = ssl.create_default_context()
    if port == 465:
        connection = smtplib.SMTP_SSL(host, port, timeout=15, context=context)
    else:
        connection = smtplib.SMTP(host, port, timeout=15)
    with connection as smtp:
        if port != 465:
            smtp.starttls(context=context)
        smtp.login(
            config["SHIFT_SMTP_USER"],
            config["SHIFT_SMTP_PASSWORD"].replace(" ", "")
            if host == "smtp.gmail.com"
            else config["SHIFT_SMTP_PASSWORD"],
        )
        smtp.send_message(msg)


def consume_rate(session, key, limit, seconds):
    now = int(time.time())
    key = digest(key)
    row = session.get(db.AuthRate, key)
    if row and now - row.started < seconds:
        if row.count >= limit:
            raise HTTPException(429, "操作が続いています。しばらく待ってからお試しください")
        row.count += 1
    elif row:
        row.started, row.count = now, 1
    else:
        session.add(db.AuthRate(key=key, started=now, count=1))


def rate_limits(request, email=None):
    with Session(db.current_engine()) as session:
        session.execute(text("BEGIN IMMEDIATE"))
        consume_rate(
            session, "ip:" + (request.client.host if request.client else "unknown"), 60, 600
        )
        if email:
            consume_rate(session, "email:" + email, 1, 60)
            consume_rate(session, "daily:" + email, 20, 86400)
            consume_rate(session, "mail-global", 200, 3600)
        session.execute(delete(db.AuthRate).where(db.AuthRate.started < int(time.time()) - 86400))
        session.commit()


def active_staff(sid):
    return next((s for s in db.get_state().staff if s.id == sid and s.active), None)


def employee_id(request):
    token = request.cookies.get(COOKIE, "")
    with Session(db.current_engine()) as session:
        row = session.get(db.EmployeeSession, digest(token)) if token else None
        account = session.get(db.EmployeeAccount, row.staff) if row else None
        if (
            not row
            or not account
            or row.revision != account.revision
            or row.expires <= db.now()
            or not active_staff(row.staff)
        ):
            raise HTTPException(401, "従業員ログインが必要です。もう一度ログインしてください")
        return row.staff


@router.get("/api/employee/status")
def status(request: Request):
    try:
        sid = employee_id(request)
    except HTTPException:
        return {"authenticated": False, "email_ready": email_ready()}
    state = db.get_state()
    return {
        "authenticated": True,
        "email_ready": email_ready(),
        "name": next(s.name for s in state.staff if s.id == sid),
        "periods": [
            {"id": p.id, "start": p.start, "end": p.end, "status": p.status}
            for p in sorted(state.periods, key=lambda p: p.start, reverse=True)
        ],
    }


@router.post("/api/employee/request-code")
def request_code(body: EmailBody, request: Request, background_tasks: BackgroundTasks):
    if not email_ready():
        raise HTTPException(503, "メール認証の準備中です。管理者にお問い合わせください")
    rate_limits(request, body.email)
    now = datetime.now(timezone.utc)
    ticket, code = secrets.token_urlsafe(32), f"{secrets.randbelow(100000000):08d}"
    with Session(db.current_engine()) as session:
        account = session.query(db.EmployeeAccount).filter_by(email=body.email).first()
        eligible = account and active_staff(account.staff)
        session.execute(delete(db.EmailChallenge).where(db.EmailChallenge.expires < db.now()))
        session.execute(delete(db.EmailChallenge).where(db.EmailChallenge.email == body.email))
        session.add(
            db.EmailChallenge(
                id=ticket,
                email=body.email,
                digest=code_digest(ticket, code),
                revision=account.revision if eligible else -1,
                expires=(now + timedelta(minutes=10)).isoformat(),
                attempts=0,
            )
        )
        session.commit()
    if eligible:
        background_tasks.add_task(deliver_code, body.email, code, ticket)
    return {
        "ticket": ticket,
        "message": "登録済みのメールアドレスに確認コードを送ります。届かない場合は迷惑メールと登録アドレスを確認してください。",
    }


def deliver_code(email, code, ticket):
    try:
        send_code(email, code)
    except Exception:
        with Session(db.current_engine()) as session:
            session.execute(delete(db.EmailChallenge).where(db.EmailChallenge.id == ticket))
            session.commit()
        import logging

        logging.getLogger(__name__).warning(
            "Employee login email delivery failed (recipient omitted)"
        )


@router.post("/api/employee/verify")
def verify(body: VerifyBody, request: Request, response: Response):
    rate_limits(request)
    token = secrets.token_urlsafe(32)
    with Session(db.current_engine()) as session:
        session.execute(text("BEGIN IMMEDIATE"))
        row = session.get(db.EmailChallenge, body.ticket)
        account = (
            session.query(db.EmployeeAccount).filter_by(email=row.email).first() if row else None
        )
        good = bool(
            row
            and row.expires > db.now()
            and row.attempts < 5
            and account
            and row.revision == account.revision
            and active_staff(account.staff)
            and hmac.compare_digest(row.digest, code_digest(body.ticket, body.code))
        )
        if not good:
            if row:
                row.attempts += 1
            session.commit()
            raise HTTPException(
                401, "コードが一致しないか有効期限が切れています。再送してお試しください"
            )
        session.delete(row)
        session.execute(delete(db.EmployeeSession).where(db.EmployeeSession.expires < db.now()))
        session.add(
            db.EmployeeSession(
                digest=digest(token),
                staff=account.staff,
                revision=account.revision,
                expires=(datetime.now(timezone.utc) + timedelta(hours=24)).isoformat(),
            )
        )
        session.commit()
    response.set_cookie(
        COOKIE,
        token,
        httponly=True,
        secure=production(),
        samesite="strict",
        max_age=86400,
        path="/api",
    )
    return {"ok": True}


@router.post("/api/employee/logout")
def logout(request: Request, response: Response):
    with Session(db.current_engine()) as session:
        session.execute(
            delete(db.EmployeeSession).where(
                db.EmployeeSession.digest == digest(request.cookies.get(COOKIE, ""))
            )
        )
        session.commit()
    response.delete_cookie(
        COOKIE, path="/api", secure=production(), httponly=True, samesite="strict"
    )
    return {"ok": True}


@router.get("/api/employee-accounts")
def accounts():
    with Session(db.current_engine()) as session:
        return {
            "accounts": [
                {"staff": a.staff, "email": a.email, "revision": a.revision}
                for a in session.query(db.EmployeeAccount)
            ],
            "email_ready": email_ready(),
            "production": production(),
        }


@router.put("/api/employee-accounts/{sid}")
def register(sid: str, body: AccountBody):
    if not active_staff(sid):
        raise HTTPException(404, "在籍中のスタッフが見つかりません")
    with Session(db.current_engine()) as session:
        session.execute(text("BEGIN IMMEDIATE"))
        row = session.get(db.EmployeeAccount, sid)
        if body.revision != (row.revision if row else 0):
            raise HTTPException(409, "登録が更新されています。再読み込みしてください")
        existing = session.query(db.EmployeeAccount).filter_by(email=body.email).first()
        if existing and existing.staff != sid:
            raise HTTPException(409, "このメールアドレスは別のスタッフに登録されています")
        if row:
            session.execute(delete(db.EmailChallenge).where(db.EmailChallenge.email == row.email))
            row.email, row.revision = body.email, row.revision + 1
        else:
            session.add(db.EmployeeAccount(staff=sid, email=body.email, revision=1))
        session.execute(delete(db.EmployeeSession).where(db.EmployeeSession.staff == sid))
        try:
            session.commit()
        except IntegrityError as exc:
            raise HTTPException(409, "このメールアドレスは別のスタッフに登録されています") from exc
    return accounts()


@router.post("/api/employee-accounts/{sid}/revoke")
def revoke(sid: str):
    with Session(db.current_engine()) as session:
        session.execute(text("BEGIN IMMEDIATE"))
        row = session.get(db.EmployeeAccount, sid)
        if row:
            session.execute(delete(db.EmailChallenge).where(db.EmailChallenge.email == row.email))
            session.delete(row)
        session.execute(delete(db.EmployeeSession).where(db.EmployeeSession.staff == sid))
        session.commit()
    return accounts()
