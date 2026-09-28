"""Register persistent on-site attendance devices."""

from alembic import op

from backend.db import KioskDevice

revision = "006"
down_revision = "005"
branch_labels = None
depends_on = None


def upgrade():
    KioskDevice.__table__.create(op.get_bind())


def downgrade():
    KioskDevice.__table__.drop(op.get_bind())
