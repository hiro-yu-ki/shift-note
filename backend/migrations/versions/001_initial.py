"""Local store aggregate, hashed share tokens and immutable audit history."""

import sqlalchemy as sa
from alembic import op

revision = "001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "store_snapshot",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("version", sa.Integer, nullable=False),
        sa.Column("data", sa.JSON, nullable=False),
        sa.Column("updated_at", sa.String, nullable=False),
    )
    op.create_table(
        "audit_log",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("action", sa.String, nullable=False),
        sa.Column("created_at", sa.String, nullable=False),
        sa.Column("version", sa.Integer, nullable=False),
    )
    op.create_table(
        "share_token",
        sa.Column("digest", sa.String, primary_key=True),
        sa.Column("staff", sa.String, nullable=False),
        sa.Column("period", sa.String, nullable=False),
        sa.Column("created_at", sa.String, nullable=False),
    )
    from backend.db import now
    from backend.schema import State

    table = sa.table(
        "store_snapshot",
        sa.column("id", sa.Integer),
        sa.column("version", sa.Integer),
        sa.column("data", sa.JSON),
        sa.column("updated_at", sa.String),
    )
    op.bulk_insert(
        table, [dict(id=1, version=0, data=State().model_dump(mode="json"), updated_at=now())]
    )


def downgrade():
    op.drop_table("share_token")
    op.drop_table("audit_log")
    op.drop_table("store_snapshot")
