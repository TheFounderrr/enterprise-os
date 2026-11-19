from datetime import date, timedelta
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import JSONResponse, Response
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from . import auth, schemas as s
from .config import database, origin
from .models import Company, Department, Document, Event, Notification, Project, Request, Shift, Task, User
from .policy import DIRECTOR, EMPLOYEE, HR, MANAGER, audit, notify, people, read, require, scoped, visible
from .services import absence, dashboard, employee, history, media_type, project_info, projects_with_stats, record, remaining, span_days, staff_status, task, today

app = FastAPI(title="Enterprise OS Professional Edition", version="0.2.0")
api = APIRouter()
DB = Annotated[Session, Depends(database)]
Actor = Annotated[User, Depends(auth.current)]


@app.middleware("http")
async def security(request, call_next):
    supplied = request.headers.get("origin")
    if request.method not in ("GET", "HEAD", "OPTIONS") and supplied and supplied != origin:
        return JSONResponse({"detail": "Запрос отклонён"}, status_code=403)
    if request.headers.get("content-type", "").startswith("multipart/form-data"):
        size = request.headers.get("content-length", "")
        if not size.isdigit() or int(size) > 11 * 1024 * 1024:
            return JSONResponse({"detail": "Размер загрузки превышает допустимый предел"}, status_code=413)
    response = await call_next(request)
    response.headers["Cache-Control"] = "no-store"
    response.headers["X-Content-Type-Options"] = "nosniff"
    return response


@app.exception_handler(IntegrityError)
def conflict(request, error):
    return JSONResponse({"detail": "Такая запись уже существует или изменена другим пользователем"},
                        status_code=409)


def insert(db, user, model, entity, fields):
    item = model(company_id=user.company_id, **fields)
    db.add(item)
    db.flush()
    audit(db, user, entity, item.id, "CREATED")
    return item


@api.get("/me")
def me(db: DB, user: Actor):
    company = db.get(Company, user.company_id)
    manager = db.scalar(scoped(User, user).where(User.id == user.manager_id))
    return {**employee(user), "email": user.email, "phone": user.phone, "leave_days": remaining(db, user),
            "company": company.name, "demo": company.demo, "manager": manager.name if manager else None}


@api.patch("/me")
def profile(data: s.ProfileInput, db: DB, user: Actor):
    user.phone = data.phone
    audit(db, user, "profile", user.id, "UPDATED")
    db.commit()
    return {"ok": True}


@api.get("/overview")
def overview(db: DB, user: Actor, start: date | None = None, end: date | None = None,
             department: int | None = None):
    end = end or today()
    start = start or end - timedelta(days=29)
    if start > end or (end - start).days > 365:
        raise HTTPException(422, "Укажите период до 366 дней")
    return dashboard(db, user, start, end, department)


@api.get("/departments")
def departments(db: DB, user: Actor):
    return [record(row, "name") for row in db.scalars(scoped(Department, user).order_by(Department.name))]


@api.post("/departments", status_code=201)
def create_department(data: s.DepartmentInput, db: DB, user: Actor):
    require(user, DIRECTOR, HR)
    item = insert(db, user, Department, "department", data.model_dump())
    db.commit()
    return record(item, "name")


@api.get("/employees")
def employees(db: DB, user: Actor):
    rows = list(db.scalars(people(user).order_by(User.name)))
    statuses = staff_status(db, user, [row.id for row in rows])
    return [{**employee(row), "working_status": statuses[row.id]} for row in rows]


def validate_employee(db, user, data):
    read(db, scoped(Department, user), Department, data.department_id)
    if user.role == HR and data.role == HR:
        raise HTTPException(403, "Роль HR назначает директор")
    if data.manager_id:
        manager = read(db, scoped(User, user), User, data.manager_id)
        require(manager, DIRECTOR, MANAGER)


@api.post("/employees", status_code=201)
def create_employee(data: s.EmployeeCreate, db: DB, user: Actor):
    require(user, DIRECTOR, HR)
    validate_employee(db, user, data)
    fields = data.model_dump(exclude={"password"})
    fields.update(email=data.email.lower(), password=auth.hasher.hash(data.password))
    item = insert(db, user, User, "employee", fields)
    db.commit()
    return employee(item)


@api.get("/employees/{key}/edit")
def employee_edit(key: int, db: DB, user: Actor):
    require(user, DIRECTOR, HR)
    item = read(db, scoped(User, user), User, key)
    if item.role == DIRECTOR or item.id == user.id or (user.role == HR and item.role == HR):
        raise HTTPException(403, "Этот профиль защищён")
    return {**employee(item), "email": item.email, "leave_days": item.leave_days}


@api.patch("/employees/{key}")
def update_employee(key: int, data: s.EmployeeInput, db: DB, user: Actor):
    require(user, DIRECTOR, HR)
    item = read(db, scoped(User, user), User, key, lock=True)
    if item.role == DIRECTOR or item.id == user.id or (user.role == HR and item.role == HR):
        raise HTTPException(403, "Этот профиль защищён")
    validate_employee(db, user, data)
    ancestor = data.manager_id
    visited = {item.id}
    while ancestor:
        if ancestor in visited:
            raise HTTPException(422, "Проверьте подчинённость")
        visited.add(ancestor)
        ancestor = read(db, scoped(User, user), User, ancestor).manager_id
    for field, value in data.model_dump(exclude={"email"}).items():
        setattr(item, field, value)
    item.email = data.email.lower()
    audit(db, user, "employee", key, "UPDATED")
    db.commit()
    return employee(item)


@api.get("/projects")
def projects(db: DB, user: Actor):
    tasks = list(db.scalars(visible(Task, user).where(Task.status != "CANCELLED")))
    return projects_with_stats(db.scalars(visible(Project, user).order_by(Project.deadline)), tasks, today().isoformat())


@api.post("/projects", status_code=201)
def create_project(data: s.ProjectInput, db: DB, user: Actor):
    require(user, DIRECTOR)
    read(db, scoped(Department, user), Department, data.department_id)
    item = insert(db, user, Project, "project", data.model_dump(mode="json"))
    db.commit()
    return project_info(item, [], today().isoformat())


@api.get("/projects/{key}")
def project(key: int, db: DB, user: Actor):
    row = read(db, visible(Project, user), Project, key)
    tasks = list(db.scalars(visible(Task, user).where(Task.project_id == key)))
    return {**project_info(row, [t for t in tasks if t.status != "CANCELLED"], today().isoformat()),
            "tasks": [task(t) for t in tasks]}


@api.get("/tasks")
def tasks(db: DB, user: Actor):
    return [task(row) for row in db.scalars(visible(Task, user).order_by(Task.deadline, Task.id))]


@api.post("/tasks", status_code=201)
def create_task(data: s.TaskInput, db: DB, user: Actor):
    require(user, DIRECTOR, MANAGER)
    read(db, people(user), User, data.user_id)
    read(db, visible(Project, user), Project, data.project_id)
    item = insert(db, user, Task, "task", data.model_dump(mode="json"))
    notify(db, user, item.user_id, f"Назначена задача: {item.name}")
    db.commit()
    return task(item)


@api.get("/tasks/{key}")
def task_detail(key: int, db: DB, user: Actor):
    row = read(db, visible(Task, user), Task, key)
    return {**task(row), "history": history(db, user, "task", key)}


@api.patch("/tasks/{key}")
def change_task(key: int, data: s.TaskUpdate, db: DB, user: Actor):
    require(user, DIRECTOR, MANAGER, EMPLOYEE)
    row = read(db, visible(Task, user), Task, key, lock=True)
    if user.role == EMPLOYEE and (data.status == "CANCELLED" or row.status == "CANCELLED"):
        raise HTTPException(403, "Статус доступен только руководителю")
    if row.status != data.status:
        audit(db, user, "task", key, "STATUS", previous=row.status, status=data.status)
        row.status = data.status
        row.completed_on = today().isoformat() if data.status == "COMPLETED" else None
        db.commit()
    return task(row)


@api.post("/tasks/{key}/comments", status_code=201)
def comment(key: int, data: s.Message, db: DB, user: Actor):
    row = read(db, visible(Task, user), Task, key)
    audit(db, user, "task", key, "COMMENT", text=data.text, author=user.name)
    if row.user_id != user.id:
        notify(db, user, row.user_id, f"Новый комментарий: {row.name}")
    else:
        creator = db.scalar(scoped(Event, user).where(Event.entity == "task", Event.entity_id == key,
                            Event.action == "CREATED").order_by(Event.id))
        if creator and creator.actor_id != user.id:
            notify(db, user, creator.actor_id, f"Новый комментарий: {row.name}")
    db.commit()
    return {"ok": True}


def request_row(row):
    return record(row, "user_id", "kind", "subtype", "start", "end", "status")


@api.get("/requests")
def requests(db: DB, user: Actor):
    return [request_row(row) for row in db.scalars(visible(Request, user).order_by(Request.id.desc()))]


async def save_request(db, user, kind, start, end, subtype, comment, file, key=None):
    user = read(db, scoped(User, user), User, user.id, lock=True)
    if end < start or (end - start).days > 365:
        raise HTTPException(422, "Проверьте даты заявления")
    if kind == "LEAVE" and subtype == "ANNUAL" and span_days(start, end) > remaining(db, user):
        raise HTTPException(422, "Недостаточно дней отпуска")
    row = None
    if key:
        row = read(db, visible(Request, user).where(Request.user_id == user.id), Request, key, lock=True)
        if row.status != "RETURNED" or row.kind != kind:
            raise HTTPException(409, "Редактировать можно заявление, возвращённое на исправление")
    query = scoped(Request, user).where(Request.user_id == user.id, Request.status.in_(["PENDING", "APPROVED"]),
                                        Request.start <= end.isoformat(), Request.end >= start.isoformat())
    if db.scalar(query.limit(1)):
        raise HTTPException(409, "На эти даты уже есть заявление")
    document = None
    if kind == "SICK":
        if not file:
            raise HTTPException(422, "Приложите медицинский документ")
        content = await file.read(10 * 1024 * 1024 + 1)
        if len(content) > 10 * 1024 * 1024:
            raise HTTPException(413, "Размер документа превышает 10 МБ")
        media = media_type(content)
        if media != file.content_type:
            raise HTTPException(415, "Тип файла не соответствует содержимому")
        document = {"media": media, "content": content}
    values = dict(start=start.isoformat(), end=end.isoformat(),
                  subtype=subtype if kind == "LEAVE" else "", comment=comment, status="PENDING")
    if row:
        for field, value in values.items():
            setattr(row, field, value)
        audit(db, user, "request", row.id, "RESUBMITTED")
    else:
        row = insert(db, user, Request, "request", dict(user_id=user.id, kind=kind, **values))
    if document:
        stored = db.scalar(scoped(Document, user).where(Document.request_id == row.id))
        if stored:
            stored.media, stored.content = document["media"], document["content"]
        else:
            db.add(Document(company_id=user.company_id, request_id=row.id, **document))
    for hr in db.scalars(scoped(User, user).where(User.role == HR, User.id != user.id)):
        notify(db, user, hr.id, "Новое заявление на рассмотрение")
    notify(db, user, user.id, "Заявление отправлено")
    db.commit()
    return request_row(row)


@api.post("/requests", status_code=201)
async def submit(db: DB, user: Actor, kind: Annotated[Literal["LEAVE", "SICK"], Form()],
                 start: Annotated[date, Form()], end: Annotated[date, Form()],
                 subtype: Annotated[Literal["ANNUAL", "UNPAID"], Form()] = "ANNUAL",
                 comment: Annotated[str, Form(max_length=4000)] = "", file: UploadFile | None = File(None)):
    return await save_request(db, user, kind, start, end, subtype, comment, file)


@api.post("/requests/{key}/resubmit")
async def resubmit(key: int, db: DB, user: Actor, kind: Annotated[Literal["LEAVE", "SICK"], Form()],
                   start: Annotated[date, Form()], end: Annotated[date, Form()],
                   subtype: Annotated[Literal["ANNUAL", "UNPAID"], Form()] = "ANNUAL",
                   comment: Annotated[str, Form(max_length=4000)] = "", file: UploadFile | None = File(None)):
    return await save_request(db, user, kind, start, end, subtype, comment, file, key)


@api.get("/requests/{key}")
def request_detail(key: int, db: DB, user: Actor):
    row = read(db, visible(Request, user), Request, key)
    exists = db.scalar(scoped(Document, user).with_only_columns(Document.id).where(Document.request_id == key))
    return {**request_row(row), "comment": row.comment, "document": bool(exists),
            "history": history(db, user, "request", key)}


@api.get("/requests/{key}/document")
def download(key: int, db: DB, user: Actor):
    read(db, visible(Request, user), Request, key)
    document = db.scalar(scoped(Document, user).where(Document.request_id == key))
    if not document:
        raise HTTPException(404, "Документ не найден")
    audit(db, user, "document", document.id, "DOWNLOADED")
    db.commit()
    extension = {"application/pdf": "pdf", "image/jpeg": "jpg", "image/png": "png"}[document.media]
    return Response(document.content, media_type=document.media, headers={
        "Content-Disposition": f'attachment; filename="document.{extension}"',
        "Content-Security-Policy": "sandbox",
    })


@api.post("/requests/{key}/decision")
def decide(key: int, data: s.Decision, db: DB, user: Actor):
    require(user, HR)
    row = read(db, visible(Request, user), Request, key)
    applicant = read(db, scoped(User, user), User, row.user_id, lock=True)
    row = read(db, visible(Request, user), Request, key, lock=True)
    db.refresh(row)
    if row.user_id == user.id:
        raise HTTPException(403, "Собственное заявление рассматривает другой специалист")
    if row.status != "PENDING":
        raise HTTPException(409, "Решение по заявлению уже принято")
    if data.status != "APPROVED" and not data.reason.strip():
        raise HTTPException(422, "Укажите причину решения")
    if data.status == "APPROVED" and row.kind == "LEAVE" and row.subtype == "ANNUAL":
        if span_days(date.fromisoformat(row.start), date.fromisoformat(row.end)) > remaining(db, applicant):
            raise HTTPException(409, "Недостаточно дней отпуска")
    row.status = data.status
    audit(db, user, "request", key, data.status, reason=data.reason)
    notify(db, user, row.user_id, {"APPROVED": "Заявление одобрено", "REJECTED": "Заявление отклонено",
                                 "RETURNED": "Заявление возвращено на исправление"}[data.status])
    db.commit()
    return request_row(row)


@api.get("/schedule")
def schedule(db: DB, user: Actor, start: date, end: date):
    if end < start or (end - start).days > 62:
        raise HTTPException(422, "Укажите период до 63 дней")
    first, last = start.isoformat(), end.isoformat()
    shifts = db.scalars(visible(Shift, user).where(Shift.day >= first, Shift.day <= last))
    ids = people(user).with_only_columns(User.id)
    return {"shifts": [record(row, "user_id", "day", "kind") for row in shifts],
            "absences": absence(db, user, ids, first, last)}


@api.put("/schedule")
def assign_shift(data: s.ShiftInput, db: DB, user: Actor):
    require(user, DIRECTOR, HR, MANAGER)
    read(db, people(user), User, data.user_id, lock=True)
    day = data.day.isoformat()
    row = db.scalar(visible(Shift, user).where(Shift.user_id == data.user_id, Shift.day == day))
    if row:
        row.kind = data.kind
        audit(db, user, "shift", row.id, "UPDATED")
    else:
        row = insert(db, user, Shift, "shift", data.model_dump(mode="json"))
    notify(db, user, row.user_id, f"Обновлён график на {day}")
    db.commit()
    return record(row, "user_id", "day", "kind")


@api.post("/notifications/deadlines")
def deadline_reminders(db: DB, user: Actor):
    day = today()
    due = scoped(Task, user).where(
        Task.user_id == user.id, Task.status.in_(["TODO", "IN_PROGRESS", "IN_REVIEW"]),
        Task.deadline >= day.isoformat(), Task.deadline <= (day + timedelta(days=2)).isoformat(),
    ).order_by(Task.id).with_for_update()
    for item in db.scalars(due):
        sent = scoped(Event, user).where(Event.entity == "task_reminder", Event.entity_id == item.id,
                                        Event.action == "SENT")
        if not db.scalar(sent.limit(1)):
            audit(db, user, "task_reminder", item.id, "SENT")
            notify(db, user, user.id, f"Скоро срок задачи: {item.name}")
    db.commit()
    return {"ok": True}


@api.get("/notifications")
def notifications(db: DB, user: Actor):
    rows = db.scalars(scoped(Notification, user).where(Notification.user_id == user.id)
                      .order_by(Notification.id.desc()).limit(100))
    return [record(row, "message", "read", "created_at") for row in rows]


@api.patch("/notifications/{key}")
def mark_read(key: int, db: DB, user: Actor):
    query = scoped(Notification, user).where(Notification.user_id == user.id)
    row = read(db, query, Notification, key)
    row.read = True
    db.commit()
    return {"ok": True}


@api.get("/health")
def health():
    return {"ok": True}


api.include_router(auth.router)
app.include_router(api, prefix="/api")

