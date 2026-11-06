"""Column types that work on SQLite and Postgres alike.

The prototype runs on a SQLite file. Production will run on Postgres. Rather
than writing the models twice, these two types resolve to the native Postgres
type when the dialect is postgresql and to a portable equivalent otherwise.

The point: moving to Postgres later is a connection-string change, not a
migration of the model layer.
"""

import enum
import uuid

from sqlalchemy import CHAR, JSON, String, TypeDecorator
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.dialects.postgresql import UUID as PGUUID


class GUID(TypeDecorator):
    """UUID on Postgres, a 36-char string everywhere else."""

    impl = CHAR
    cache_ok = True

    def load_dialect_impl(self, dialect):
        if dialect.name == "postgresql":
            return dialect.type_descriptor(PGUUID(as_uuid=True))
        return dialect.type_descriptor(CHAR(36))

    def process_bind_param(self, value, dialect):
        if value is None:
            return None
        if dialect.name == "postgresql":
            return value if isinstance(value, uuid.UUID) else uuid.UUID(str(value))
        return str(value)

    def process_result_value(self, value, dialect):
        if value is None:
            return None
        return value if isinstance(value, uuid.UUID) else uuid.UUID(str(value))


class JSONType(TypeDecorator):
    """JSONB on Postgres, plain JSON elsewhere."""

    impl = JSON
    cache_ok = True

    def load_dialect_impl(self, dialect):
        if dialect.name == "postgresql":
            return dialect.type_descriptor(JSONB())
        return dialect.type_descriptor(JSON())


class StoredEnum(TypeDecorator):
    """A Python enum stored as text, readable as either the name or the value.

    New punches are written as the member name (MOBILE_APP, IN). Imported
    history was written as the value (manual, in). SQLAlchemy's default Enum
    accepts only the name, so one old row makes every screen that loads it
    raise LookupError and return 500.
    """

    impl = String(32)
    cache_ok = True

    def __init__(self, enum_class: type[enum.Enum]):
        super().__init__()
        self.enum_class = enum_class
        lookup: dict[str, enum.Enum] = {}
        for member in enum_class:
            lookup[member.name] = member
            lookup[str(member.value)] = member
        self._lookup = lookup

    def process_bind_param(self, value, dialect):
        if value is None:
            return None
        if isinstance(value, self.enum_class):
            return value.name
        member = self._lookup.get(str(value))
        if member is None:
            raise ValueError(f"{value!r} is not a {self.enum_class.__name__}")
        return member.name

    def process_result_value(self, value, dialect):
        if value is None:
            return None
        member = self._lookup.get(str(value))
        if member is None:
            raise LookupError(
                f"{value!r} is not a {self.enum_class.__name__}. "
                f"Known: {', '.join(sorted(self._lookup))}"
            )
        return member
