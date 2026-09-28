import os
from datetime import datetime, timezone

from fastapi import HTTPException
from sqlalchemy import JSON, Integer, String, create_engine, update
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column

from .schema import State

engine = create_engine(
    os.getenv("SHIFT_DB", "sqlite:///./shift.db"),
    connect_args={"check_same_thread": False, "timeout": 30},
    hide_parameters=True,
)


class Base(DeclarativeBase):
    pass


class Snapshot(Base):
    __tablename__ = "store_snapshot"
    id: Mapped[int] = mapped_column(primary_key=True)
    version: Mapped[int] = mapped_column(Integer, default=0)
    data: Mapped[dict] = mapped_column(JSON)
    updated_at: Mapped[str] = mapped_column(String)


class AuditLog(Base):
    __tablename__ = "audit_log"
    id: Mapped[int] = mapped_column(primary_key=True)
    action: Mapped[str] = mapped_column(String)
    created_at: Mapped[str] = mapped_column(String)
    version: Mapped[int] = mapped_column(Integer)


class ShareToken(Base):
    __tablename__ = "share_token"
    digest: Mapped[str] = mapped_column(String, primary_key=True)
    staff: Mapped[str] = mapped_column(String)
    period: Mapped[str] = mapped_column(String)
    created_at: Mapped[str] = mapped_column(String)


class ManagerAuth(Base):
    __tablename__ = "manager_auth"
    id: Mapped[int] = mapped_column(primary_key=True)
    password_hash: Mapped[str] = mapped_column(String)
    failures: Mapped[int] = mapped_column(Integer, default=0)
    blocked_until: Mapped[str] = mapped_column(String, default="")


class ManagerSession(Base):
    __tablename__ = "manager_session"
    digest: Mapped[str] = mapped_column(String, primary_key=True)
    expires: Mapped[str] = mapped_column(String)


class EmployeeAccount(Base):
    __tablename__ = "employee_account"
    staff: Mapped[str] = mapped_column(String, primary_key=True)
    email: Mapped[str] = mapped_column(String, unique=True)
    revision: Mapped[int] = mapped_column(Integer, default=1)


class EmployeeSession(Base):
    __tablename__ = "employee_session"
    digest: Mapped[str] = mapped_column(String, primary_key=True)
    staff: Mapped[str] = mapped_column(String)
    revision: Mapped[int] = mapped_column(Integer)
    expires: Mapped[str] = mapped_column(String)


class EmailChallenge(Base):
    __tablename__ = "email_challenge"
    id: Mapped[str] = mapped_column(String, primary_key=True)
    email: Mapped[str] = mapped_column(String)
    digest: Mapped[str] = mapped_column(String)
    revision: Mapped[int] = mapped_column(Integer)
    expires: Mapped[str] = mapped_column(String)
    attempts: Mapped[int] = mapped_column(Integer, default=0)


class AuthRate(Base):
    __tablename__ = "auth_rate"
    key: Mapped[str] = mapped_column(String, primary_key=True)
    started: Mapped[int] = mapped_column(Integer)
    count: Mapped[int] = mapped_column(Integer)


def now():
    return datetime.now(timezone.utc).isoformat()


def get_state():
    with Session(engine) as db:
        row = db.get(Snapshot, 1)
        return State.model_validate(row.data) if row else State()


def save(state, action):
    # Compare-and-swap is performed inside SQLite, never a read-then-write check.
    with Session(engine) as db:
        expected = state.version
        state.version += 1
        body = state.model_dump(mode="json")
        result = db.execute(
            update(Snapshot)
            .where(Snapshot.id == 1, Snapshot.version == expected)
            .values(data=body, version=state.version, updated_at=now())
        )
        if result.rowcount != 1:
            raise HTTPException(
                409, "他の画面で更新されました。再読み込みして変更をやり直してください"
            )
        db.add(AuditLog(action=action, created_at=now(), version=state.version))
        db.commit()
    return state
