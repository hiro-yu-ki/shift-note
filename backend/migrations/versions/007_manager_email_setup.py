"""Give each store manager a verified email and one-time setup link."""

from alembic import op
from sqlalchemy import Column, String

from backend.db import ManagerSetupLink

revision = "007"
down_revision = "006"
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table("manager_auth") as batch:
        batch.add_column(Column("email", String(), nullable=False, server_default=""))
    ManagerSetupLink.__table__.create(op.get_bind())


def downgrade():
    ManagerSetupLink.__table__.drop(op.get_bind())
    with op.batch_alter_table("manager_auth") as batch:
        batch.drop_column("email")
