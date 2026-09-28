"""Private manager data is accessible only with an authenticated session."""

import sqlalchemy as sa
from alembic import op

revision = "002"
down_revision = "001"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "manager_auth",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("password_hash", sa.String, nullable=False),
        sa.Column("failures", sa.Integer, nullable=False),
        sa.Column("blocked_until", sa.String, nullable=False),
    )
    op.create_table(
        "manager_session",
        sa.Column("digest", sa.String, primary_key=True),
        sa.Column("expires", sa.String, nullable=False),
    )


def downgrade():
    op.drop_table("manager_session")
    op.drop_table("manager_auth")
