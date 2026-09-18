"""Store Slack ts on signup_requests so decline can chat.update

Revision ID: c3a1e9d04b22
Revises: e2819cf41a01
Create Date: 2026-09-12 11:30:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "c3a1e9d04b22"
down_revision: Union[str, Sequence[str], None] = "e2819cf41a01"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("signup_requests", schema=None) as batch_op:
        batch_op.add_column(sa.Column("slack_message_ts", sa.String(length=32), nullable=True))
        batch_op.add_column(sa.Column("slack_channel_id", sa.String(length=32), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("signup_requests", schema=None) as batch_op:
        batch_op.drop_column("slack_channel_id")
        batch_op.drop_column("slack_message_ts")
