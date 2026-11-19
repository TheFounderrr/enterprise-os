from fastapi import HTTPException
from sqlalchemy import select

from .models import Department, Event, Notification, Project, Request, Shift, Task, User

DIRECTOR, HR, MANAGER, EMPLOYEE = "DIRECTOR", "HR", "MANAGER", "EMPLOYEE"


def require(user, *roles):
    if user.role not in roles:
        raise HTTPException(403, "Недостаточно прав")


def scoped(model, user):
    return select(model).where(model.company_id == user.company_id)


def people(user):
    query = scoped(User, user)
    if user.role == EMPLOYEE:
        return query.where(User.id == user.id)
    if user.role == MANAGER:
        return query.where((User.manager_id == user.id) | (User.id == user.id))
    return query


def visible(model, user):
    query = scoped(model, user)
    team = people(user).with_only_columns(User.id)
    if model in (Task, Shift):
        return query.where(model.user_id.in_(team))
    if model is Request:
        return query if user.role == HR else query.where(Request.user_id == user.id)
    if model is Project and user.role in (EMPLOYEE, MANAGER):
        assigned = visible(Task, user).with_only_columns(Task.project_id)
        return query.where((Project.id.in_(assigned)) | (Project.department_id == user.department_id))
    return query


def read(db, query, model, key, *, lock=False):
    query = query.where(model.id == key)
    item = db.scalar(query.with_for_update() if lock else query)
    if item is None:
        raise HTTPException(404, "Запись не найдена")
    return item


def audit(db, user, entity, key, action, **detail):
    db.add(Event(company_id=user.company_id, actor_id=user.id, entity=entity,
                 entity_id=key, action=action, detail=detail))


def notify(db, user, recipient, message):
    db.add(Notification(company_id=user.company_id, user_id=recipient, message=message))

