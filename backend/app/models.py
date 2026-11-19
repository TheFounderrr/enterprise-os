from datetime import datetime, timezone

from sqlalchemy import DateTime, ForeignKey, JSON, LargeBinary, String, UniqueConstraint
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


def now():
    return datetime.now(timezone.utc)


class Base(DeclarativeBase):
    pass


class Company(Base):
    __tablename__ = "companies"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(160), unique=True)
    demo: Mapped[bool] = mapped_column(default=False)


class Tenant:
    id: Mapped[int] = mapped_column(primary_key=True)
    company_id: Mapped[int] = mapped_column(ForeignKey("companies.id"), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now, onupdate=now)


class Department(Tenant, Base):
    __tablename__ = "departments"
    __table_args__ = (UniqueConstraint("company_id", "name"),)
    name: Mapped[str] = mapped_column(String(160))


class User(Tenant, Base):
    __tablename__ = "users"
    email: Mapped[str] = mapped_column(String(254), unique=True)
    password: Mapped[str] = mapped_column(String(255))
    name: Mapped[str] = mapped_column(String(160))
    role: Mapped[str] = mapped_column(String(20))
    department_id: Mapped[int | None] = mapped_column(ForeignKey("departments.id"))
    manager_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    position: Mapped[str] = mapped_column(String(120), default="")
    phone: Mapped[str] = mapped_column(String(40), default="")
    leave_days: Mapped[int] = mapped_column(default=24)


class Session(Base):
    __tablename__ = "sessions"
    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    expires: Mapped[int]
    purpose: Mapped[str] = mapped_column(String(10))


class Attempt(Base):
    __tablename__ = "login_attempts"
    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    count: Mapped[int]
    expires: Mapped[int]


class Project(Tenant, Base):
    __tablename__ = "projects"
    name: Mapped[str] = mapped_column(String(160))
    description: Mapped[str]
    deadline: Mapped[str] = mapped_column(String(10))
    department_id: Mapped[int] = mapped_column(ForeignKey("departments.id"))


class Task(Tenant, Base):
    __tablename__ = "tasks"
    name: Mapped[str] = mapped_column(String(160))
    description: Mapped[str]
    deadline: Mapped[str] = mapped_column(String(10))
    status: Mapped[str] = mapped_column(String(20), default="TODO")
    priority: Mapped[str] = mapped_column(String(10))
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id"))
    completed_on: Mapped[str | None] = mapped_column(String(10))


class Request(Tenant, Base):
    __tablename__ = "requests"
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    kind: Mapped[str] = mapped_column(String(12))
    subtype: Mapped[str] = mapped_column(String(30), default="")
    start: Mapped[str] = mapped_column(String(10))
    end: Mapped[str] = mapped_column(String(10))
    comment: Mapped[str] = mapped_column(default="")
    status: Mapped[str] = mapped_column(String(15), default="PENDING")


class Document(Tenant, Base):
    __tablename__ = "documents"
    request_id: Mapped[int] = mapped_column(ForeignKey("requests.id"), unique=True)
    media: Mapped[str] = mapped_column(String(30))
    content: Mapped[bytes] = mapped_column(LargeBinary)


class Shift(Tenant, Base):
    __tablename__ = "shifts"
    __table_args__ = (UniqueConstraint("user_id", "day"),)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    day: Mapped[str] = mapped_column(String(10))
    kind: Mapped[str] = mapped_column(String(10))


class Event(Tenant, Base):
    __tablename__ = "audit_events"
    actor_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    entity: Mapped[str] = mapped_column(String(30), index=True)
    entity_id: Mapped[int]
    action: Mapped[str] = mapped_column(String(30))
    detail: Mapped[dict] = mapped_column(JSON, default=dict)


class Notification(Tenant, Base):
    __tablename__ = "notifications"
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    message: Mapped[str] = mapped_column(String(250))
    read: Mapped[bool] = mapped_column(default=False)

