"""Read-only database preflight for the Windows launcher."""

import sys
from alembic.migration import MigrationContext
from sqlalchemy.exc import SQLAlchemyError

from .settings import ConfigurationError, database_url


def main():
    try:
        url = database_url()
        if (url.get_backend_name() != "postgresql" or url.host != "127.0.0.1"
                or url.port != 55432 or not url.password or not url.database):
            raise ConfigurationError(
                "The Windows launcher expects a password-protected PostgreSQL URL "
                "on 127.0.0.1:55432. Check .env or .local/dev.env."
            )
        if "--config" not in sys.argv:
            from .config import engine
            from .health import schema_heads

            with engine.connect() as connection:
                current = set(MigrationContext.configure(connection).get_current_heads())
                if current != schema_heads():
                    raise ConfigurationError("Database schema is not current. Review and run scripts/migrate.ps1.")
    except ConfigurationError as exc:
        print(f"Configuration error: {exc}", file=sys.stderr)
        return 1
    except (ImportError, SQLAlchemyError):
        print("PostgreSQL connection failed. Check the database name, password and role in .env or .local/dev.env.",
              file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

