"""Employee shift requests, private kiosk access and actual attendance."""

from alembic import op

from backend.db import Attendance, KioskCredential, ShiftChangeRequest

revision = "005"
down_revision = "004"
branch_labels = None
depends_on = None


def upgrade():
    for model in (ShiftChangeRequest, KioskCredential, Attendance):
        model.__table__.create(op.get_bind())


def downgrade():
    for model in (Attendance, KioskCredential, ShiftChangeRequest):
        model.__table__.drop(op.get_bind())
