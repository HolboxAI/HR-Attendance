"""Column types that work on SQLite and Postgres alike.

The prototype runs on a SQLite file. Production will run on Postgres. Rather
than writing the models twice, these two types resolve to the native Postgres
type when the dialect is postgresql and to a portable equivalent otherwise.

The point: moving to Postgres later is a connection-string change, not a
migration of the model layer.
"""

import uuid

from sqlalchemy import CHAR, JSON, TypeDecorator
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
