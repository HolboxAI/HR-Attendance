"""Dates an employee says they will not come. A notice, not leave.

Revision ID: f4b8c1a09e77
Revises: c3a1e9d04b22
Create Date: 2026-10-07 11:20:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

import app.db.types


revision: str = "f4b8c1a09e77"
down_revision: Union[str, Sequence[str], None] = "c3a1e9d04b22"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "planned_absences",
        sa.Column("id", app.db.types.GUID(), nullable=False),
        sa.Column("org_id", app.db.types.GUID(), nullable=False),
        sa.Column("employee_id", app.db.types.GUID(), nullable=False),
        sa.Column("absent_on", sa.Date(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("(CURRENT_TIMESTAMP)"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("(CURRENT_TIMESTAMP)"), nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["employee_id"], ["employees.id"]),
        sa.ForeignKeyConstraint(["org_id"], ["organizations.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("employee_id", "absent_on", name="uq_planned_absence_employee_day"),
    )
    op.create_index("ix_planned_absences_org_id", "planned_absences", ["org_id"])
    op.create_index("ix_planned_absences_employee_id", "planned_absences", ["employee_id"])


def downgrade() -> None:
    op.drop_index("ix_planned_absences_employee_id", table_name="planned_absences")
    op.drop_index("ix_planned_absences_org_id", table_name="planned_absences")
    op.drop_table("planned_absences")
