"""Operator-only franchise registry and manual subscription billing.

This database is separate from every store database. It never contains employee
shifts, wages or attendance. Issued invoices keep a snapshot of their amounts.
"""

import csv
import hashlib
import html
import io
import os
import re
import secrets
from datetime import date, datetime, timedelta, timezone
from decimal import ROUND_HALF_UP, Decimal
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, Field, field_validator, model_validator
from sqlalchemy import ForeignKey, Integer, String, create_engine, delete, inspect, select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column

from . import tenant
from .config import production, public_origin

router = APIRouter(prefix="/api/platform")
COOKIE = "shift_platform"
engine = create_engine(
    os.getenv("SHIFT_PLATFORM_DB", "sqlite:///./platform.db"),
    connect_args={"check_same_thread": False, "timeout": 30},
    hide_parameters=True,
)


class Base(DeclarativeBase):
    pass


class Operator(Base):
    __tablename__ = "platform_operator"
    id: Mapped[int] = mapped_column(primary_key=True)
    password_hash: Mapped[str] = mapped_column(String)
    failures: Mapped[int] = mapped_column(Integer, default=0)
    blocked_until: Mapped[str] = mapped_column(String, default="")


class OperatorSession(Base):
    __tablename__ = "platform_session"
    digest: Mapped[str] = mapped_column(String, primary_key=True)
    expires: Mapped[str] = mapped_column(String)


class Merchant(Base):
    __tablename__ = "platform_merchant"
    id: Mapped[str] = mapped_column(String, primary_key=True)
    slug: Mapped[str] = mapped_column(String, unique=True, index=True)
    name: Mapped[str] = mapped_column(String)
    legal_name: Mapped[str] = mapped_column(String)
    contact_name: Mapped[str] = mapped_column(String, default="")
    contact_email: Mapped[str] = mapped_column(String, default="")
    contact_phone: Mapped[str] = mapped_column(String, default="")
    billing_address: Mapped[str] = mapped_column(String, default="")
    status: Mapped[str] = mapped_column(String, default="準備中")
    plan_name: Mapped[str] = mapped_column(String, default="標準")
    monthly_fee: Mapped[int] = mapped_column(Integer, default=0)
    tax_rate: Mapped[int] = mapped_column(Integer, default=10)
    billing_due_days: Mapped[int] = mapped_column(Integer, default=30)
    contract_start: Mapped[str] = mapped_column(String, default="")
    contract_end: Mapped[str] = mapped_column(String, default="")
    suite_origin: Mapped[str] = mapped_column(String, default="")
    deployment_status: Mapped[str] = mapped_column(String, default="未設置")
    setup_token_digest: Mapped[str] = mapped_column(String, default="")
    notes: Mapped[str] = mapped_column(String, default="")
    created_at: Mapped[str] = mapped_column(String)
    updated_at: Mapped[str] = mapped_column(String)


class Invoice(Base):
    __tablename__ = "platform_invoice"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    merchant_id: Mapped[str] = mapped_column(ForeignKey("platform_merchant.id"), index=True)
    service_month: Mapped[str] = mapped_column(String)
    number: Mapped[str] = mapped_column(String, unique=True, nullable=True)
    status: Mapped[str] = mapped_column(String, default="下書き")
    description: Mapped[str] = mapped_column(String)
    issue_date: Mapped[str] = mapped_column(String, default="")
    due_date: Mapped[str] = mapped_column(String)
    seller_name: Mapped[str] = mapped_column(String, default="")
    seller_registration: Mapped[str] = mapped_column(String, default="")
    seller_address: Mapped[str] = mapped_column(String, default="")
    payment_instructions: Mapped[str] = mapped_column(String, default="")
    buyer_name: Mapped[str] = mapped_column(String)
    buyer_address: Mapped[str] = mapped_column(String)
    subtotal: Mapped[int] = mapped_column(Integer)
    tax_rate: Mapped[int] = mapped_column(Integer)
    tax: Mapped[int] = mapped_column(Integer)
    total: Mapped[int] = mapped_column(Integer)
    created_at: Mapped[str] = mapped_column(String)
    updated_at: Mapped[str] = mapped_column(String)


class Payment(Base):
    __tablename__ = "platform_payment"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    invoice_id: Mapped[int] = mapped_column(ForeignKey("platform_invoice.id"), index=True)
    amount: Mapped[int] = mapped_column(Integer)
    paid_on: Mapped[str] = mapped_column(String)
    reference: Mapped[str] = mapped_column(String, default="")
    created_at: Mapped[str] = mapped_column(String)
    reversed_at: Mapped[str] = mapped_column(String, default="")
    reversal_reason: Mapped[str] = mapped_column(String, default="")


class Activity(Base):
    __tablename__ = "platform_activity"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    kind: Mapped[str] = mapped_column(String)
    subject: Mapped[str] = mapped_column(String)
    detail: Mapped[str] = mapped_column(String)
    created_at: Mapped[str] = mapped_column(String)


def init_db():
    Base.metadata.create_all(engine)
    # The operator database is small; make additive schema changes safe on restart.
    with engine.begin() as connection:
        for table, column in (
            ("platform_invoice", "payment_instructions"),
            ("platform_seller_settings", "payment_instructions"),
            ("platform_payment", "reversed_at"),
            ("platform_payment", "reversal_reason"),
        ):
            existing = {item["name"] for item in inspect(connection).get_columns(table)}
            if column not in existing:
                connection.execute(text(f"ALTER TABLE {table} ADD COLUMN {column} VARCHAR NOT NULL DEFAULT ''"))


def migrate_tenants():
    """Upgrade existing merchant databases before accepting requests."""
    from alembic import command
    from alembic.config import Config

    from . import db

    with Session(engine) as session:
        mids = session.scalars(select(Merchant.id).where(Merchant.deployment_status == "稼働中")).all()
    for mid in mids:
        path = tenant.tenant_db_path(mid)
        if not path.is_file():
            raise RuntimeError(f"Merchant database is missing: {mid}")
        config = Config(str(Path(__file__).resolve().parent.parent / "alembic.ini"))
        with db.tenant_engine(mid).connect() as connection:
            config.attributes["connection"] = connection
            command.upgrade(config, "head")


def now():
    return datetime.now(timezone.utc).isoformat()


def hash_password(password, salt):
    return hashlib.scrypt(password.encode(), salt=bytes.fromhex(salt), n=16384, r=8, p=1).hex()


def authenticated(request: Request):
    token = request.cookies.get(COOKIE, "")
    if not token:
        return False
    with Session(engine) as session:
        row = session.get(OperatorSession, hashlib.sha256(token.encode()).hexdigest())
        return bool(row and row.expires > now())


def require_operator(request: Request):
    if not authenticated(request):
        raise HTTPException(401, "運営者ログインが必要です")


def record(session, kind, subject, detail):
    session.add(Activity(kind=kind, subject=subject, detail=detail, created_at=now()))


def merchant_view(row):
    return {key: getattr(row, key) for key in (
        "id", "slug", "name", "legal_name", "contact_name", "contact_email",
        "contact_phone", "billing_address", "status", "plan_name", "monthly_fee",
        "tax_rate", "billing_due_days", "contract_start", "contract_end",
        "suite_origin", "deployment_status", "notes", "created_at", "updated_at",
    )}


def payment_total(session, invoice_id):
    return sum(row.amount for row in session.scalars(select(Payment).where(Payment.invoice_id == invoice_id, Payment.reversed_at == "")))


def invoice_view(session, row):
    paid = payment_total(session, row.id)
    state = row.status
    if state == "発行済み":
        state = "入金済み" if paid >= row.total else "期限超過" if row.due_date < date.today().isoformat() else "一部入金" if paid else "未入金"
    return {key: getattr(row, key) for key in (
        "id", "merchant_id", "service_month", "number", "description", "issue_date",
        "due_date", "seller_name", "seller_registration", "seller_address", "payment_instructions",
        "buyer_name", "buyer_address", "subtotal", "tax_rate", "tax", "total",
        "created_at", "updated_at",
    )} | {"status": state, "record_status": row.status, "paid": paid, "balance": max(0, row.total - paid)}


class PasswordBody(BaseModel):
    password: str = Field(min_length=12, max_length=128)
    setup_token: str = Field(default="", max_length=256)


@router.get("/auth/status")
def auth_status(request: Request):
    with Session(engine) as session:
        return {"configured": bool(session.get(Operator, 1)), "authenticated": authenticated(request), "setup_token_required": production()}


def set_session(response, session):
    token = secrets.token_urlsafe(32)
    session.add(OperatorSession(digest=hashlib.sha256(token.encode()).hexdigest(), expires=(datetime.now(timezone.utc) + timedelta(hours=8)).isoformat()))
    session.commit()
    response.set_cookie(COOKIE, token, httponly=True, secure=production(), samesite="strict", max_age=28800, path="/api/platform")


@router.post("/auth/setup")
def auth_setup(body: PasswordBody, response: Response):
    setup_secret = os.getenv("SHIFT_PLATFORM_SETUP_TOKEN", "")
    if production() and (len(setup_secret) < 32 or not secrets.compare_digest(body.setup_token, setup_secret)):
        raise HTTPException(403, "運営者用の初回設定キーを確認してください")
    with Session(engine) as session:
        session.execute(text("BEGIN IMMEDIATE"))
        if session.get(Operator, 1):
            raise HTTPException(409, "運営者パスワードは設定済みです")
        salt = secrets.token_hex(16)
        session.add(Operator(id=1, password_hash=salt + ":" + hash_password(body.password, salt), failures=0, blocked_until=""))
        session.flush()
        set_session(response, session)
    return {"ok": True}


@router.post("/auth/login")
def auth_login(body: PasswordBody, response: Response):
    current = datetime.now(timezone.utc)
    with Session(engine) as session:
        session.execute(text("BEGIN IMMEDIATE"))
        operator = session.get(Operator, 1)
        if not operator:
            raise HTTPException(409, "最初に運営者パスワードを設定してください")
        if operator.blocked_until and operator.blocked_until > now():
            raise HTTPException(429, "しばらく待ってから再度お試しください")
        salt, digest = operator.password_hash.split(":")
        if not secrets.compare_digest(digest, hash_password(body.password, salt)):
            operator.failures += 1
            if operator.failures >= 5:
                operator.failures = 0
                operator.blocked_until = (current + timedelta(minutes=5)).isoformat()
            session.commit()
            raise HTTPException(401, "パスワードが一致しません")
        operator.failures = 0
        operator.blocked_until = ""
        set_session(response, session)
    return {"ok": True}


@router.post("/auth/logout")
def auth_logout(request: Request, response: Response):
    token = request.cookies.get(COOKIE, "")
    with Session(engine) as session:
        row = session.get(OperatorSession, hashlib.sha256(token.encode()).hexdigest()) if token else None
        if row:
            session.delete(row)
            session.commit()
    response.delete_cookie(COOKIE, path="/api/platform")
    return {"ok": True}


class ChangePasswordBody(BaseModel):
    current_password: str = Field(min_length=1, max_length=128)
    new_password: str = Field(min_length=12, max_length=128)


@router.post("/auth/change-password", dependencies=[Depends(require_operator)])
def change_password(body: ChangePasswordBody, response: Response):
    with Session(engine) as session:
        session.execute(text("BEGIN IMMEDIATE"))
        operator = session.get(Operator, 1)
        salt, digest = operator.password_hash.split(":")
        if not secrets.compare_digest(digest, hash_password(body.current_password, salt)):
            raise HTTPException(401, "現在のパスワードが一致しません")
        if body.current_password == body.new_password:
            raise HTTPException(422, "新しいパスワードを入力してください")
        salt = secrets.token_hex(16)
        operator.password_hash = salt + ":" + hash_password(body.new_password, salt)
        session.execute(delete(OperatorSession))
        record(session, "パスワード変更", "operator", "運営者の全ログインを更新")
        set_session(response, session)
    return {"ok": True}


class MerchantBody(BaseModel):
    slug: str = Field(pattern=r"^[a-z][a-z0-9-]{2,30}$")
    name: str = Field(min_length=1, max_length=120)
    legal_name: str = Field(min_length=1, max_length=160)
    contact_name: str = Field(default="", max_length=120)
    contact_email: str = Field(default="", max_length=254)
    contact_phone: str = Field(default="", max_length=40)
    billing_address: str = Field(default="", max_length=500)
    status: str = Field(default="準備中", pattern="^(準備中|試用中|利用中|停止中|解約)$")
    plan_name: str = Field(default="標準", max_length=100)
    monthly_fee: int = Field(default=0, ge=0, le=1_000_000_000)
    tax_rate: int = Field(default=10, ge=0, le=100)
    billing_due_days: int = Field(default=30, ge=1, le=180)
    contract_start: date | None = None
    contract_end: date | None = None
    suite_origin: str = Field(default="", max_length=250)
    deployment_status: str = Field(default="未設置", pattern="^(未設置|設置中|稼働中|停止中)$")
    notes: str = Field(default="", max_length=4000)

    @field_validator("contract_start", "contract_end", mode="before")
    @classmethod
    def empty_date(cls, value):
        return None if value == "" else value

    @field_validator("contact_email")
    @classmethod
    def email(cls, value):
        value = value.strip().lower()
        if value and not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", value):
            raise ValueError("連絡先メールアドレスを確認してください")
        return value

    @field_validator("suite_origin")
    @classmethod
    def origin(cls, value):
        value = value.strip().rstrip("/")
        return value

    @model_validator(mode="after")
    def dates(self):
        if self.contract_start and self.contract_end and self.contract_end < self.contract_start:
            raise ValueError("契約終了日は開始日以降にしてください")
        if self.suite_origin and self.suite_origin != f"{public_origin()}/s/{self.slug}":
            raise ValueError("加盟店URLはシステムが自動で設定します")
        return self


@router.get("/dashboard", dependencies=[Depends(require_operator)])
def dashboard():
    with Session(engine) as session:
        merchants = session.scalars(select(Merchant)).all()
        invoices = session.scalars(select(Invoice)).all()
        views = [invoice_view(session, row) for row in invoices]
        return {
            "merchants": len(merchants),
            "active": sum(m.status == "利用中" for m in merchants),
            "trial": sum(m.status == "試用中" for m in merchants),
            "unprovisioned": sum(m.deployment_status != "稼働中" and m.status != "解約" for m in merchants),
            "mrr": sum(m.monthly_fee for m in merchants if m.status == "利用中"),
            "outstanding": sum(v["balance"] for v in views if v["record_status"] == "発行済み"),
            "overdue": sum(v["balance"] for v in views if v["status"] == "期限超過"),
            "recent_activity": [{"kind": a.kind, "subject": a.subject, "detail": a.detail, "created_at": a.created_at}
                                for a in session.scalars(select(Activity).order_by(Activity.id.desc()).limit(20))],
        }


@router.get("/merchants", dependencies=[Depends(require_operator)])
def merchants():
    with Session(engine) as session:
        return [merchant_view(row) for row in session.scalars(select(Merchant).order_by(Merchant.created_at.desc()))]


@router.post("/merchants", dependencies=[Depends(require_operator)])
def create_merchant(body: MerchantBody):
    values = body.model_dump(mode="json")
    values["contract_start"] = values["contract_start"] or ""
    values["contract_end"] = values["contract_end"] or ""
    values["suite_origin"] = ""
    values["deployment_status"] = "未設置"
    row = Merchant(id=secrets.token_hex(16), **values, created_at=now(), updated_at=now())
    with Session(engine) as session:
        session.add(row)
        record(session, "加盟店登録", row.id, row.name)
        try:
            session.commit()
        except IntegrityError as exc:
            raise HTTPException(409, "この加盟店IDは使用済みです") from exc
        return merchant_view(row)


@router.put("/merchants/{mid}", dependencies=[Depends(require_operator)])
def update_merchant(mid: str, body: MerchantBody):
    with Session(engine) as session:
        row = session.get(Merchant, mid)
        if not row:
            raise HTTPException(404, "加盟店が見つかりません")
        before = merchant_view(row)
        values = body.model_dump(mode="json")
        if values["slug"] != row.slug:
            raise HTTPException(422, "加盟店IDは配布URLになるため変更できません")
        values["suite_origin"] = row.suite_origin
        values["deployment_status"] = row.deployment_status
        for key, value in values.items():
            setattr(row, key, value or "" if key in ("contract_start", "contract_end") else value)
        row.updated_at = now()
        record(session, "加盟店更新", mid, ", ".join(k for k, v in values.items() if before[k] != (v or "" if k in ("contract_start", "contract_end") else v)))
        try:
            session.commit()
        except IntegrityError as exc:
            raise HTTPException(409, "この加盟店IDは使用済みです") from exc
        return merchant_view(row)


@router.post("/merchants/{mid}/provision", dependencies=[Depends(require_operator)])
def provision_merchant(mid: str):
    """Create a separate migrated store DB and one-time manager setup key."""
    from alembic import command
    from alembic.config import Config

    from . import db

    with Session(engine) as session:
        session.execute(text("BEGIN IMMEDIATE"))
        merchant = session.get(Merchant, mid)
        if not merchant:
            raise HTTPException(404, "加盟店が見つかりません")
        if merchant.deployment_status == "稼働中":
            raise HTTPException(409, "この加盟店の専用環境は作成済みです")
        db_path = tenant.tenant_db_path(mid)
        db_path.parent.mkdir(parents=True, exist_ok=True)
        tenant_engine = db.tenant_engine(mid)
        config = Config(str(Path(__file__).resolve().parent.parent / "alembic.ini"))
        with tenant_engine.connect() as connection:
            config.attributes["connection"] = connection
            command.upgrade(config, "head")
        setup_token = secrets.token_urlsafe(32)
        merchant.setup_token_digest = hashlib.sha256(setup_token.encode()).hexdigest()
        merchant.suite_origin = f"{public_origin()}/s/{merchant.slug}"
        merchant.deployment_status = "稼働中"
        if merchant.status == "準備中":
            merchant.status = "試用中"
        merchant.updated_at = now()
        record(session, "専用環境作成", mid, merchant.suite_origin)
        session.commit()
        return {"merchant": merchant_view(merchant), "manager_setup_token": setup_token,
                "manager": merchant.suite_origin + "/admin", "employee": merchant.suite_origin + "/employee",
                "attendance": merchant.suite_origin + "/clock"}


def validate_manager_setup_token(mid: str, token: str) -> bool:
    with Session(engine) as session:
        merchant = session.get(Merchant, mid)
        return bool(merchant and merchant.setup_token_digest and secrets.compare_digest(
            merchant.setup_token_digest, hashlib.sha256(token.encode()).hexdigest()
        ))


def consume_manager_setup_token(mid: str):
    with Session(engine) as session:
        merchant = session.get(Merchant, mid)
        if merchant:
            merchant.setup_token_digest = ""
            session.commit()


@router.get("/merchants/{mid}/distribution", dependencies=[Depends(require_operator)])
def distribution(mid: str):
    with Session(engine) as session:
        row = session.get(Merchant, mid)
        if not row:
            raise HTTPException(404, "加盟店が見つかりません")
        if row.deployment_status != "稼働中" or not row.suite_origin:
            raise HTTPException(409, "加盟店専用環境の稼働確認後に配布できます")
        return {"merchant": row.name, "manager": row.suite_origin + "/admin", "employee": row.suite_origin + "/employee", "attendance": row.suite_origin + "/clock"}


class BillingSettings(BaseModel):
    seller_name: str = Field(min_length=1, max_length=160)
    seller_address: str = Field(default="", max_length=500)
    registration_number: str = Field(default="", max_length=14)
    payment_instructions: str = Field(default="", max_length=1000)

    @field_validator("registration_number")
    @classmethod
    def registration(cls, value):
        if value and not re.fullmatch(r"T\d{13}", value):
            raise ValueError("登録番号はTと13桁の数字で入力してください")
        return value


class SellerSettings(Base):
    __tablename__ = "platform_seller_settings"
    id: Mapped[int] = mapped_column(primary_key=True)
    seller_name: Mapped[str] = mapped_column(String)
    seller_address: Mapped[str] = mapped_column(String, default="")
    registration_number: Mapped[str] = mapped_column(String, default="")
    payment_instructions: Mapped[str] = mapped_column(String, default="")


@router.get("/billing-settings", dependencies=[Depends(require_operator)])
def billing_settings():
    with Session(engine) as session:
        row = session.get(SellerSettings, 1)
        return {"seller_name": row.seller_name, "seller_address": row.seller_address, "registration_number": row.registration_number, "payment_instructions": row.payment_instructions} if row else {"seller_name": "", "seller_address": "", "registration_number": "", "payment_instructions": ""}


@router.put("/billing-settings", dependencies=[Depends(require_operator)])
def save_billing_settings(body: BillingSettings):
    with Session(engine) as session:
        row = session.get(SellerSettings, 1)
        if row:
            row.seller_name, row.seller_address, row.registration_number, row.payment_instructions = body.seller_name, body.seller_address, body.registration_number, body.payment_instructions
        else:
            session.add(SellerSettings(id=1, **body.model_dump()))
        record(session, "請求元設定", "operator", "請求書の発行者情報を更新")
        session.commit()
    return body.model_dump()


class GenerateBody(BaseModel):
    merchant_id: str
    service_month: str = Field(pattern=r"^\d{4}-(0[1-9]|1[0-2])$")


def calc_tax(subtotal, tax_rate):
    return int((Decimal(subtotal) * Decimal(tax_rate) / Decimal(100)).quantize(Decimal("1"), rounding=ROUND_HALF_UP))


@router.post("/invoices/draft", dependencies=[Depends(require_operator)])
def make_invoice(body: GenerateBody):
    with Session(engine) as session:
        session.execute(text("BEGIN IMMEDIATE"))
        merchant = session.get(Merchant, body.merchant_id)
        if not merchant or merchant.status not in ("利用中", "試用中"):
            raise HTTPException(409, "利用中または試用中の加盟店を選んでください")
        existing = session.scalar(select(Invoice).where(Invoice.merchant_id == body.merchant_id, Invoice.service_month == body.service_month, Invoice.status != "取消"))
        if existing:
            raise HTTPException(409, "この加盟店・対象月の請求書は作成済みです")
        issued = date.today()
        settings = session.get(SellerSettings, 1)
        if not settings or not settings.seller_name:
            raise HTTPException(409, "先に請求元情報を登録してください")
        subtotal = merchant.monthly_fee
        tax = calc_tax(subtotal, merchant.tax_rate)
        row = Invoice(
            merchant_id=merchant.id, service_month=body.service_month, number=None, status="下書き",
            description=f"シフトノート {merchant.plan_name}プラン {body.service_month} 利用料",
            issue_date="", due_date=str(issued + timedelta(days=merchant.billing_due_days)),
            seller_name=settings.seller_name, seller_registration=settings.registration_number,
            seller_address=settings.seller_address, payment_instructions=settings.payment_instructions,
            buyer_name=merchant.legal_name,
            buyer_address=merchant.billing_address, subtotal=subtotal, tax_rate=merchant.tax_rate,
            tax=tax, total=subtotal + tax, created_at=now(), updated_at=now(),
        )
        session.add(row)
        session.flush()
        record(session, "請求書下書き", merchant.id, f"{body.service_month} / {row.total}円")
        session.commit()
        return invoice_view(session, row)


@router.get("/invoices", dependencies=[Depends(require_operator)])
def invoices():
    with Session(engine) as session:
        return [invoice_view(session, row) for row in session.scalars(select(Invoice).order_by(Invoice.id.desc()))]


@router.post("/invoices/{iid}/issue", dependencies=[Depends(require_operator)])
def issue_invoice(iid: int):
    with Session(engine) as session:
        row = session.get(Invoice, iid)
        if not row or row.status != "下書き":
            raise HTTPException(409, "発行可能な下書きが見つかりません")
        if not row.buyer_name or not row.seller_name or not row.description:
            raise HTTPException(422, "請求書の必須情報を確認してください")
        row.status = "発行済み"
        row.issue_date = date.today().isoformat()
        row.number = f"SN-{date.today():%Y%m}-{row.id:06d}"
        row.updated_at = now()
        record(session, "請求書発行", row.merchant_id, row.number)
        session.commit()
        return invoice_view(session, row)


@router.post("/invoices/{iid}/void", dependencies=[Depends(require_operator)])
def void_invoice(iid: int):
    with Session(engine) as session:
        row = session.get(Invoice, iid)
        if not row or row.status not in ("下書き", "発行済み"):
            raise HTTPException(409, "取消可能な請求書が見つかりません")
        if payment_total(session, iid):
            raise HTTPException(409, "入金のある請求書は取消できません")
        row.status, row.updated_at = "取消", now()
        record(session, "請求書取消", row.merchant_id, row.number or str(iid))
        session.commit()
        return invoice_view(session, row)


class PaymentBody(BaseModel):
    amount: int = Field(gt=0, le=1_000_000_000)
    paid_on: date
    reference: str = Field(default="", max_length=200)


@router.post("/invoices/{iid}/payments", dependencies=[Depends(require_operator)])
def record_payment(iid: int, body: PaymentBody):
    with Session(engine) as session:
        session.execute(text("BEGIN IMMEDIATE"))
        row = session.get(Invoice, iid)
        if not row or row.status != "発行済み":
            raise HTTPException(409, "発行済みの請求書を選んでください")
        if body.amount > row.total - payment_total(session, iid):
            raise HTTPException(422, "入金額が未収額を超えています")
        session.add(Payment(invoice_id=iid, amount=body.amount, paid_on=str(body.paid_on), reference=body.reference, created_at=now(), reversed_at="", reversal_reason=""))
        record(session, "入金記録", row.merchant_id, f"{row.number} / {body.amount}円")
        session.commit()
        return invoice_view(session, row)


class ReversalBody(BaseModel):
    reason: str = Field(min_length=5, max_length=500)


@router.post("/invoices/{iid}/payments/{pid}/reverse", dependencies=[Depends(require_operator)])
def reverse_payment(iid: int, pid: int, body: ReversalBody):
    with Session(engine) as session:
        payment = session.get(Payment, pid)
        invoice = session.get(Invoice, iid)
        if not payment or payment.invoice_id != iid or payment.reversed_at or not invoice:
            raise HTTPException(409, "取り消せる入金記録が見つかりません")
        payment.reversed_at = now()
        payment.reversal_reason = body.reason.strip()
        record(session, "入金記録訂正", invoice.merchant_id, f"{invoice.number} / {payment.amount}円 / {body.reason.strip()}")
        session.commit()
        return invoice_view(session, invoice)


@router.get("/invoices/{iid}", dependencies=[Depends(require_operator)])
def invoice_detail(iid: int):
    with Session(engine) as session:
        row = session.get(Invoice, iid)
        if not row:
            raise HTTPException(404, "請求書が見つかりません")
        return invoice_view(session, row) | {"payments": [
            {"id": p.id, "amount": p.amount, "paid_on": p.paid_on, "reference": p.reference,
             "reversed_at": p.reversed_at, "reversal_reason": p.reversal_reason}
            for p in session.scalars(select(Payment).where(Payment.invoice_id == iid).order_by(Payment.id))
        ]}


@router.get("/merchants.csv", dependencies=[Depends(require_operator)])
def merchant_csv():
    with Session(engine) as session:
        rows = session.scalars(select(Merchant).order_by(Merchant.slug)).all()
        output = io.StringIO()
        writer = csv.writer(output)
        writer.writerow(["加盟店ID", "加盟店名", "契約名義", "状態", "担当者", "メール", "月額税抜", "専用URL"])
        for row in rows:
            writer.writerow([csv_safe(value) for value in (row.slug, row.name, row.legal_name, row.status, row.contact_name, row.contact_email, row.monthly_fee, row.suite_origin)])
        return Response("\ufeff" + output.getvalue(), media_type="text/csv; charset=utf-8", headers={"Content-Disposition": "attachment; filename=merchants.csv"})


def csv_safe(value):
    if isinstance(value, str) and value.lstrip().startswith(("=", "+", "-", "@")):
        return "'" + value
    return value


def esc(value):
    return html.escape(str(value or ""), quote=True)


@router.get("/invoices/{iid}/print", dependencies=[Depends(require_operator)])
def printable_invoice(iid: int):
    with Session(engine) as session:
        row = session.get(Invoice, iid)
        if not row or row.status != "発行済み":
            raise HTTPException(404, "発行済みの請求書が見つかりません")
        paid = payment_total(session, iid)
        start = date.fromisoformat(row.service_month + "-01")
        next_month = (start.replace(day=28) + timedelta(days=4)).replace(day=1)
        last = next_month - timedelta(days=1)
        content = f"""<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>請求書 {esc(row.number)}</title>
<style>body{{font-family:system-ui,'Yu Gothic',sans-serif;color:#22342e;max-width:760px;margin:50px auto;padding:0 26px}}header{{display:flex;justify-content:space-between;border-bottom:2px solid #315c4b;padding-bottom:22px}}h1{{font-size:29px;margin:0}}h2{{font-size:18px}}.seller{{text-align:right;margin:32px 0}}.amount{{font-size:26px;font-weight:700;border-bottom:1px solid #b9c9bf;padding:18px 0}}dl{{display:grid;grid-template-columns:150px 1fr;margin:36px 0}}dt,dd{{padding:11px 0;border-bottom:1px solid #dbe2dd;margin:0}}dt{{color:#607468}}footer{{margin-top:45px;color:#64786d;font-size:12px}}button{{padding:10px 18px;background:#315c4b;color:white;border:0;cursor:pointer}}@media print{{button{{display:none}}body{{margin:20px auto}}}}</style>
<header><div><h1>請求書</h1><p>番号：{esc(row.number)}</p></div><div>発行日：{esc(row.issue_date)}</div></header>
<h2>{esc(row.buyer_name)} 御中</h2><p>{esc(row.buyer_address)}</p><p class="amount">ご請求額　{row.total:,} 円（税込）</p>
<div class="seller"><strong>{esc(row.seller_name)}</strong><br>{esc(row.seller_address)}<br>{'登録番号：' + esc(row.seller_registration) if row.seller_registration else ''}</div>
<dl><dt>取引内容</dt><dd>{esc(row.description)}</dd><dt>対象期間</dt><dd>{start.isoformat()} ～ {last.isoformat()}</dd><dt>税抜金額</dt><dd>{row.subtotal:,} 円</dd><dt>適用税率</dt><dd>{row.tax_rate}%</dd><dt>消費税額</dt><dd>{row.tax:,} 円</dd><dt>税込合計</dt><dd>{row.total:,} 円</dd><dt>支払期限</dt><dd>{esc(row.due_date)}</dd><dt>入金済み</dt><dd>{paid:,} 円</dd>{'<dt>お支払い方法</dt><dd>' + esc(row.payment_instructions).replace(chr(10), '<br>') + '</dd>' if row.payment_instructions else ''}</dl>
<footer>この書面は発行時の契約・請求元情報を保存したものです。入金記録は運営者画面で管理します。ブラウザーの印刷機能からPDF保存できます。</footer></html>"""
        return Response(content, media_type="text/html; charset=utf-8", headers={"Cache-Control": "no-store"})


@router.post("/merchants/{mid}/reset-manager", dependencies=[Depends(require_operator)])
def reset_merchant_manager(mid: str):
    from . import db

    with Session(engine) as session:
        merchant = session.get(Merchant, mid)
        if not merchant or merchant.deployment_status != "稼働中":
            raise HTTPException(404, "稼働中の加盟店が見つかりません")
        token = secrets.token_urlsafe(32)
        with Session(db.tenant_engine(mid)) as store_session:
            store_session.execute(text("BEGIN IMMEDIATE"))
            auth = store_session.get(db.ManagerAuth, 1)
            if auth:
                store_session.delete(auth)
            for row in store_session.scalars(select(db.ManagerSession)):
                store_session.delete(row)
            store_session.execute(delete(db.ManagerSetupLink))
            store_session.commit()
        merchant.setup_token_digest = hashlib.sha256(token.encode()).hexdigest()
        merchant.updated_at = now()
        record(session, "管理者ログイン再設定", mid, merchant.name)
        session.commit()
        return {"manager_setup_token": token, "manager": merchant.suite_origin + "/admin"}
