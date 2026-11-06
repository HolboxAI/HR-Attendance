"""employee monthly leave max

Revision ID: c9e2f4a18b03
Revises: a7c3e91b04d2
Create Date: 2026-10-16 15:40:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "c9e2f4a18b03"
down_revision: Union[str, Sequence[str], None] = "a7c3e91b04d2"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("employees", schema=None) as batch_op:
        batch_op.add_column(sa.Column("monthly_leave_max", sa.Numeric(6, 2), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("employees", schema=None) as batch_op:
        batch_op.drop_column("monthly_leave_max")
