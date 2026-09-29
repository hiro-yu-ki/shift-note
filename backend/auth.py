import hashlib
import logging
import os
import secrets
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, HTTPException, Request, Response
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import delete, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from . import db, tenant
from .config import production
from .employee_auth import EmailBody, consume_rate, email_ready, send_message

router = APIRouter(prefix="/api/auth")
COOKIE = "shift_manager"


def authenticated(request):
    token = request.cookies.get(COOKIE, "")
    if not token:
        return False
    with Session(db.current_engine()) as session:
        row = session.get(db.ManagerSession, hashlib.sha256(token.encode()).hexdigest())
        return bool(row and datetime.fromisoformat(row.expires) > datetime.now(timezone.utc))


@router.get("/status")
def status(request: Request):
    with Session(db.current_engine()) as session:
        auth = session.get(db.ManagerAuth, 1)
        return {
            "configured": bool(auth),
            "authenticated": authenticated(request),
            "setup_token_required": production(),
            "email_setup_required": bool(tenant.merchant_id.get() and not auth),
            "email_login_required": bool(auth and auth.email),
            "email_ready": email_ready() if tenant.merchant_id.get() else False,
        }


class Password(BaseModel):
    password: str = Field(min_length=10, max_length=128)
    setup_token: str = Field(default="", max_length=256)


class LoginBody(BaseModel):
    email: str = Field(default="", max_length=254)
    password: str = Field(min_length=10, max_length=128)

    @field_validator("email")
    @classmethod
    def normalize_email(cls, value):
        return EmailBody.model_validate({"email": value}).email if value else ""


class SetupRequest(EmailBody):
    setup_token: str = Field(min_length=32, max_length=256)


class SetupComplete(BaseModel):
    token: str = Field(min_length=32, max_length=100)
    password: str = Field(min_length=10, max_length=128)


def password_hash(password, salt):
    return hashlib.scrypt(password.encode(), salt=bytes.fromhex(salt), n=16384, r=8, p=1).hex()


@router.post("/login")
def login(body: LoginBody, response: Response):
    now = datetime.now(timezone.utc)
    with Session(db.current_engine()) as session:
        session.execute(text("BEGIN IMMEDIATE"))
        auth = session.get(db.ManagerAuth, 1)
        if not auth:
            raise HTTPException(409, "最初に管理者パスワードを設定してください")
        if auth.blocked_until and datetime.fromisoformat(auth.blocked_until) > now:
            raise HTTPException(429, "しばらく待ってから再度ログインしてください")
        salt, hashed = auth.password_hash.split(":")
        valid_email = not auth.email or secrets.compare_digest(auth.email, body.email)
        valid_password = secrets.compare_digest(hashed, password_hash(body.password, salt))
        if not (valid_email and valid_password):
            auth.failures += 1
            if auth.failures >= 5:
                auth.blocked_until = (now + timedelta(minutes=5)).isoformat()
                auth.failures = 0
            session.commit()
            raise HTTPException(401, "メールアドレスまたはパスワードが一致しません")
        auth.failures = 0
        auth.blocked_until = ""
        token = secrets.token_urlsafe(32)
        session.execute(
            delete(db.ManagerSession).where(db.ManagerSession.expires < now.isoformat())
        )
        session.add(
            db.ManagerSession(
                digest=hashlib.sha256(token.encode()).hexdigest(),
                expires=(now + timedelta(hours=8)).isoformat(),
            )
        )
        session.commit()
    response.set_cookie(
        COOKIE,
        token,
        httponly=True,
        secure=production(),
        samesite="strict",
        max_age=28800,
        path="/api",
    )
    return {"ok": True}


@router.post("/setup")
def setup(body: Password, response: Response):
    if tenant.merchant_id.get():
        raise HTTPException(409, "加盟店の管理者設定はメールに届くリンクから行ってください")
    if production():
        mid = tenant.merchant_id.get()
        if mid:
            from .platform import validate_manager_setup_token
            valid = validate_manager_setup_token(mid, body.setup_token)
        else:
            valid = secrets.compare_digest(body.setup_token, os.environ["SHIFT_SETUP_TOKEN"])
        if not valid:
            raise HTTPException(403, "初回設定キーを確認してください")
    with Session(db.current_engine()) as session:
        if session.get(db.ManagerAuth, 1):
            raise HTTPException(409, "管理者パスワードは設定済みです")
        salt = secrets.token_hex(16)
        session.add(
            db.ManagerAuth(
                id=1,
                password_hash=salt + ":" + password_hash(body.password, salt),
                failures=0,
                blocked_until="",
            )
        )
        try:
            session.commit()
        except IntegrityError as exc:
            raise HTTPException(409, "管理者パスワードは設定済みです") from exc
    return login(LoginBody(password=body.password), response)


def send_manager_setup_mail(email: str, link: str):
    send_message(
        email,
        "シフトノート 管理者パスワード設定",
        "加盟店の管理者パスワードを設定するには、次のリンクを開いてください。\n\n"
        f"{link}\n\n有効期限は30分で、一度だけ利用できます。心当たりがなければ破棄してください。"
    )


@router.post("/setup-request")
def setup_request(body: SetupRequest, request: Request):
    mid = tenant.merchant_id.get()
    slug = tenant.merchant_slug.get()
    if not mid or not slug:
        raise HTTPException(404, "加盟店の管理画面から操作してください")
    if not email_ready():
        raise HTTPException(503, "管理者メールの送信設定が必要です。運営者にお問い合わせください")
    from .platform import validate_manager_setup_token

    if not validate_manager_setup_token(mid, body.setup_token):
        raise HTTPException(403, "初回設定キーを確認してください")
    with Session(db.current_engine()) as session:
        session.execute(text("BEGIN IMMEDIATE"))
        if session.get(db.ManagerAuth, 1):
            raise HTTPException(409, "管理者は設定済みです")
        consume_rate(session, "manager-setup-global", 20, 3600)
        consume_rate(session, "manager-setup:" + body.email, 3, 3600)
        session.commit()
    token = secrets.token_urlsafe(32)
    digest = hashlib.sha256(token.encode()).hexdigest()
    with Session(db.current_engine()) as session:
        session.execute(text("BEGIN IMMEDIATE"))
        session.execute(delete(db.ManagerSetupLink))
        session.add(db.ManagerSetupLink(
            digest=digest,
            email=body.email,
            expires=(datetime.now(timezone.utc) + timedelta(minutes=30)).isoformat(),
        ))
        session.commit()
    origin = os.getenv("SHIFT_PUBLIC_ORIGIN", "http://127.0.0.1:8000").rstrip("/") if production() else str(request.base_url).rstrip("/")
    link = f"{origin}/s/{slug}/admin#setup={token}"
    try:
        send_manager_setup_mail(body.email, link)
    except Exception:
        with Session(db.current_engine()) as session:
            session.execute(delete(db.ManagerSetupLink).where(db.ManagerSetupLink.digest == digest))
            session.commit()
        logging.getLogger(__name__).warning("Manager setup email delivery failed (recipient omitted)")
        raise HTTPException(503, "設定メールを送れませんでした。運営者に送信設定を確認してください") from None
    return {"message": "パスワード設定リンクをメールで送りました。30分以内に開いてください。"}


@router.post("/setup-complete")
def setup_complete(body: SetupComplete, response: Response):
    mid = tenant.merchant_id.get()
    if not mid:
        raise HTTPException(404, "加盟店の管理画面から操作してください")
    digest = hashlib.sha256(body.token.encode()).hexdigest()
    with Session(db.current_engine()) as session:
        session.execute(text("BEGIN IMMEDIATE"))
        link = session.get(db.ManagerSetupLink, digest)
        if not link or link.expires <= db.now():
            raise HTTPException(410, "設定リンクの有効期限が切れました。初回設定からやり直してください")
        if session.get(db.ManagerAuth, 1):
            raise HTTPException(409, "管理者は設定済みです")
        email = link.email
        salt = secrets.token_hex(16)
        session.add(db.ManagerAuth(
            id=1, email=email, password_hash=salt + ":" + password_hash(body.password, salt),
            failures=0, blocked_until="",
        ))
        session.delete(link)
        session.commit()
    from .platform import consume_manager_setup_token

    consume_manager_setup_token(mid)
    return login(LoginBody(email=email, password=body.password), response)


@router.post("/logout")
def logout(request: Request, response: Response):
    token = request.cookies.get(COOKIE, "")
    with Session(db.current_engine()) as session:
        session.execute(
            delete(db.ManagerSession).where(
                db.ManagerSession.digest == hashlib.sha256(token.encode()).hexdigest()
            )
        )
        session.commit()
    response.delete_cookie(COOKIE, path="/api")
    return {"ok": True}
