from pathlib import Path

from alembic.config import Config
from alembic.migration import MigrationContext
from alembic.script import ScriptDirectory
from fastapi import APIRouter
from fastapi.responses import JSONResponse
from sqlalchemy.exc import SQLAlchemyError

from .config import engine

router = APIRouter(tags=["health"])


def schema_heads():
    config = Config(str(Path(__file__).resolve().parents[1] / "alembic.ini"))
    return set(ScriptDirectory.from_config(config).get_heads())


@router.get("/health", include_in_schema=False)
@router.get("/health/live")
def liveness():
    return {"ok": True}


@router.get("/health/ready")
def readiness():
    try:
        with engine.connect() as connection:
            current = set(MigrationContext.configure(connection).get_current_heads())
    except SQLAlchemyError:
        return JSONResponse({"ok": False}, status_code=503)
    if current != schema_heads():
        return JSONResponse({"ok": False}, status_code=503)
    return {"ok": True}
