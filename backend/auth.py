import hashlib
import os
import secrets
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, HTTPException, Request, Response
from pydantic import BaseModel, Field
from sqlalchemy import delete, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from . import db
from .config import production

router = APIRouter(prefix="/api/auth")
COOKIE = "shift_manager"


def authenticated(request):
    token = request.cookies.get(COOKIE, "")
    if not token:
        return False
    with Session(db.engine) as session:
        row = session.get(db.ManagerSession, hashlib.sha256(token.encode()).hexdigest())
        return bool(row and datetime.fromisoformat(row.expires) > datetime.now(timezone.utc))


@router.get("/status")
def status(request: Request):
    with Session(db.engine) as session:
        return {
            "configured": bool(session.get(db.ManagerAuth, 1)),
            "authenticated": authenticated(request),
            "setup_token_required": production(),
        }


class Password(BaseModel):
    password: str = Field(min_length=10, max_length=128)
    setup_token: str = Field(default="", max_length=256)


def password_hash(password, salt):
    return hashlib.scrypt(password.encode(), salt=bytes.fromhex(salt), n=16384, r=8, p=1).hex()


@router.post("/login")
def login(body: Password, response: Response):
    now = datetime.now(timezone.utc)
    with Session(db.engine) as session:
        session.execute(text("BEGIN IMMEDIATE"))
        auth = session.get(db.ManagerAuth, 1)
        if not auth:
            raise HTTPException(409, "最初に管理者パスワードを設定してください")
        if auth.blocked_until and datetime.fromisoformat(auth.blocked_until) > now:
            raise HTTPException(429, "しばらく待ってから再度ログインしてください")
        salt, hashed = auth.password_hash.split(":")
        if not secrets.compare_digest(hashed, password_hash(body.password, salt)):
            auth.failures += 1
            if auth.failures >= 5:
                auth.blocked_until = (now + timedelta(minutes=5)).isoformat()
                auth.failures = 0
            session.commit()
            raise HTTPException(401, "パスワードが一致しません")
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
    if production() and not secrets.compare_digest(
        body.setup_token, os.environ["SHIFT_SETUP_TOKEN"]
    ):
        raise HTTPException(403, "初回設定キーを確認してください")
    with Session(db.engine) as session:
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
    return login(body, response)


@router.post("/logout")
def logout(request: Request, response: Response):
    token = request.cookies.get(COOKIE, "")
    with Session(db.engine) as session:
        session.execute(
            delete(db.ManagerSession).where(
                db.ManagerSession.digest == hashlib.sha256(token.encode()).hexdigest()
            )
        )
        session.commit()
    response.delete_cookie(COOKIE, path="/api")
    return {"ok": True}
