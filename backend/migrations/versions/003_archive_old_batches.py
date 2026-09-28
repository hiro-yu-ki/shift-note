"""Retain past work while showing only the latest candidate batch."""

import copy

import sqlalchemy as sa
from alembic import op

revision = "003"
down_revision = "002"
branch_labels = None
depends_on = None


def upgrade():
    table = sa.table(
        "store_snapshot",
        sa.column("id", sa.Integer),
        sa.column("data", sa.JSON),
        sa.column("version", sa.Integer),
    )
    connection = op.get_bind()
    for row in connection.execute(sa.select(table)).mappings():
        data = copy.deepcopy(row["data"])
        changed = False
        for p in data.get("periods", []):
            candidates = [c for c in data.get("candidates", []) if c["period"] == p["id"]]
            for c in candidates[:-3]:
                if c["id"] != p.get("selected") and not c.get("archived", False):
                    c["archived"] = True
                    changed = True
        if changed:
            data["version"] = row["version"] + 1
            connection.execute(
                table.update()
                .where(table.c.id == row["id"])
                .values(data=data, version=data["version"])
            )


def downgrade():
    # Archived schedules are retained and remain readable in the snapshot.
    pass
