"""Add signup_requests table

Revision ID: e2819cf41a01
Revises: f16cdec5d72f
Create Date: 2026-09-10 18:30:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

import app.db.types


# revision identifiers, used by Alembic.
revision: str = 'e2819cf41a01'
down_revision: Union[str, Sequence[str], None] = 'f16cdec5d72f'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table('signup_requests',
        sa.Column('id', app.db.types.GUID(), nullable=False),
        sa.Column('org_id', app.db.types.GUID(), nullable=False),
        sa.Column('full_name', sa.String(length=160), nullable=False),
        sa.Column('email', sa.String(length=200), nullable=False),
        sa.Column('phone', sa.String(length=20), nullable=True),
        sa.Column('password_hash', sa.String(length=255), nullable=False),
        sa.Column('desired_department', sa.String(length=120), nullable=True),
        sa.Column('desired_designation', sa.String(length=120), nullable=True),
        sa.Column('status', sa.Enum('PENDING', 'APPROVED', 'REJECTED', name='signupstatus'), nullable=False),
        sa.Column('decided_by_id', app.db.types.GUID(), nullable=True),
        sa.Column('decided_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('rejection_reason', sa.String(length=500), nullable=True),
        sa.Column('created_employee_id', app.db.types.GUID(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('(CURRENT_TIMESTAMP)'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('(CURRENT_TIMESTAMP)'), nullable=False),
        sa.Column('deleted_at', sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(['created_employee_id'], ['employees.id'], ),
        sa.ForeignKeyConstraint(['decided_by_id'], ['users.id'], ),
        sa.ForeignKeyConstraint(['org_id'], ['organizations.id'], ),
        sa.PrimaryKeyConstraint('id')
    )
    with op.batch_alter_table('signup_requests', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_signup_requests_email'), ['email'], unique=False)
        batch_op.create_index(batch_op.f('ix_signup_requests_org_id'), ['org_id'], unique=False)
        batch_op.create_index(batch_op.f('ix_signup_requests_status'), ['status'], unique=False)


def downgrade() -> None:
    op.drop_table('signup_requests')
