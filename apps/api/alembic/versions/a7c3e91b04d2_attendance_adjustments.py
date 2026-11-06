"""Admin edits of a displayed attendance day. Punches stay as they were.

Revision ID: a7c3e91b04d2
Revises: f4b8c1a09e77
Create Date: 2026-10-07 19:40:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

import app.db.types


revision: str = "a7c3e91b04d2"
down_revision: Union[str, Sequence[str], None] = "f4b8c1a09e77"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "attendance_adjustments",
        sa.Column("id", app.db.types.GUID(), nullable=False),
        sa.Column("org_id", app.db.types.GUID(), nullable=False),
        sa.Column("employee_id", app.db.types.GUID(), nullable=False),
        sa.Column("shift_date", sa.Date(), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("first_in", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_out", sa.DateTime(timezone=True), nullable=True),
        sa.Column("previous_status", sa.String(length=40), nullable=False),
        sa.Column("reason", sa.String(length=400), nullable=False),
        sa.Column("changed_by_user_id", app.db.types.GUID(), nullable=True),
        sa.Column("changed_by_name", sa.String(length=200), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("(CURRENT_TIMESTAMP)"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("(CURRENT_TIMESTAMP)"), nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["changed_by_user_id"], ["users.id"]),
        sa.ForeignKeyConstraint(["employee_id"], ["employees.id"]),
        sa.ForeignKeyConstraint(["org_id"], ["organizations.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_attendance_adjustments_org_id", "attendance_adjustments", ["org_id"])
    op.create_index(
        "ix_attendance_adjustment_employee_date",
        "attendance_adjustments",
        ["employee_id", "shift_date"],
    )


def downgrade() -> None:
    op.drop_index("ix_attendance_adjustment_employee_date", table_name="attendance_adjustments")
    op.drop_index("ix_attendance_adjustments_org_id", table_name="attendance_adjustments")
    op.drop_table("attendance_adjustments")
