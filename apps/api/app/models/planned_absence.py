"""A date someone has said they will not come.

This is a notice. It does not spend leave, and it does not mark the day as
leave. If they come in anyway, the punch still counts.
"""

import uuid
from datetime import date

from sqlalchemy import Date, ForeignKey, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin
from app.db.types import GUID


class PlannedAbsence(Base, TimestampMixin):
    __tablename__ = "planned_absences"
    __table_args__ = (
        UniqueConstraint("employee_id", "absent_on", name="uq_planned_absence_employee_day"),
    )

    id: Mapped[uuid.UUID] = mapped_column(GUID(), primary_key=True, default=uuid.uuid4)
    org_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("organizations.id"), index=True, nullable=False
    )
    employee_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("employees.id"), index=True, nullable=False
    )
    absent_on: Mapped[date] = mapped_column(Date, nullable=False)
