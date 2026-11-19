"""Project configuration shared by FastAPI, Alembic and the launcher."""

import os
from pathlib import Path

from dotenv import dotenv_values
from sqlalchemy.engine import make_url
from sqlalchemy.exc import ArgumentError

ROOT = Path(__file__).resolve().parents[2]


class ConfigurationError(RuntimeError):
    pass


def database_url(root=ROOT):
    shell = os.environ.get("DATABASE_URL")
    dev_file = root / ".local" / "dev.env"
    if shell is not None:
        value = shell
    elif dev_file.is_file():
        value = dotenv_values(dev_file).get("DATABASE_URL")
    else:
        value = dotenv_values(root / ".env").get("DATABASE_URL")
    if not value or not value.strip():
        raise ConfigurationError(
            "Set DATABASE_URL in .env or .local/dev.env. See README.md for Windows PostgreSQL setup."
        )
    try:
        url = make_url(value.strip())
        url.get_dialect()
    except (ArgumentError, ValueError):
        raise ConfigurationError("DATABASE_URL is invalid. Check the database driver and URL format.") from None
    return url

