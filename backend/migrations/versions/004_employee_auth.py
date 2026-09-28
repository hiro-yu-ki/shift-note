"""Email accounts, one-time challenges and revocable employee sessions."""

from alembic import op

from backend.db import AuthRate, EmailChallenge, EmployeeAccount, EmployeeSession

revision = "004"
down_revision = "003"
branch_labels = None
depends_on = None


def upgrade():
    for model in (EmployeeAccount, EmployeeSession, EmailChallenge, AuthRate):
        model.__table__.create(op.get_bind())


def downgrade():
    for model in (AuthRate, EmailChallenge, EmployeeSession, EmployeeAccount):
        model.__table__.drop(op.get_bind())
