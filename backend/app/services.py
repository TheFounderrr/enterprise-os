from collections import Counter, defaultdict
from datetime import date, timedelta
from zoneinfo import ZoneInfo

from sqlalchemy import or_, select
from fastapi import HTTPException

from .models import Department, Event, Project, Request, Shift, Task, User, now
from .policy import DIRECTOR, HR, MANAGER, scoped, visible, people


def today():
    return now().astimezone(ZoneInfo("Asia/Almaty")).date()


def record(item, *fields):
    return {field: getattr(item, field) for field in ("id", *fields)}


def employee(item):
    return record(item, "name", "role", "department_id", "manager_id", "position")


def task(item):
    return record(item, "name", "description", "deadline", "status", "priority", "user_id", "project_id")


def history(db, user, entity, key):
    query = scoped(Event, user).where(Event.entity == entity, Event.entity_id == key).order_by(Event.id)
    return [record(row, "actor_id", "action", "detail", "created_at") for row in db.scalars(query)]


def remaining(db, user):
    rows = db.scalars(scoped(Request, user).where(Request.user_id == user.id,
                      Request.kind == "LEAVE", Request.subtype == "ANNUAL", Request.status == "APPROVED"))
    year = today().year
    first, last = date(year, 1, 1), date(year, 12, 31)
    used = sum(max(0, (min(last, date.fromisoformat(row.end)) -
                      max(first, date.fromisoformat(row.start))).days + 1) for row in rows)
    return max(0, user.leave_days - used)


def span_days(start, end):
    year = today().year
    return max(0, (min(date(year, 12, 31), end) - max(date(year, 1, 1), start)).days + 1)


def absence(db, user, employee_ids, start, end):
    rows = db.scalars(scoped(Request, user).where(Request.user_id.in_(employee_ids),
                      Request.status == "APPROVED", Request.start <= end, Request.end >= start))
    return [record(row, "user_id", "start", "end", * (("kind",) if user.role in (DIRECTOR, HR) or row.user_id == user.id else ())) for row in rows]


def working_status(employee_id, absent_ids, working_ids):
    if employee_id in absent_ids:
        return "ABSENT"
    return "WORKING" if employee_id in working_ids else "OFF"


def staff_status(db, user, ids):
    day = today().isoformat()
    absent_ids = {row["user_id"] for row in absence(db, user, ids, day, day)}
    working_ids = set(db.scalars(visible(Shift, user).with_only_columns(Shift.user_id).where(
        Shift.user_id.in_(ids), Shift.day == day, Shift.kind != "OFF")))
    return {key: working_status(key, absent_ids, working_ids) for key in ids}


def project_info(project, tasks, day):
    total = len(tasks)
    done = sum(t.status == "COMPLETED" for t in tasks)
    overdue = sum(t.status != "COMPLETED" and t.deadline < day for t in tasks)
    status = "DONE" if total and total == done else "LATE" if project.deadline < day else (
        "RISK" if any(t.status != "COMPLETED" and t.deadline < day for t in tasks) else "ON_TRACK")
    return {**record(project, "name", "description", "deadline", "department_id"),
            "progress": round(done * 100 / total) if total else 0, "status": status,
            "task_count": total, "overdue_count": overdue,
            "assignee_ids": sorted({item.user_id for item in tasks})}


def projects_with_stats(projects, tasks, day):
    by_project = defaultdict(list)
    for item in tasks:
        by_project[item.project_id].append(item)
    return [project_info(project, by_project[project.id], day) for project in projects]


def dashboard(db, user, start, end, department):
    current_day = today()
    day = current_day.isoformat()
    scope = people(user)
    if department:
        scope = scope.where(User.department_id == department)
    employees = list(db.scalars(scope))
    ids = [row.id for row in employees]
    tasks = list(db.scalars(visible(Task, user).where(Task.user_id.in_(ids), Task.status != "CANCELLED")))
    shifts = list(db.scalars(visible(Shift, user).where(Shift.user_id.in_(ids), Shift.day >= day,
                            Shift.kind != "OFF").order_by(Shift.day)))
    absent = absence(db, user, ids, day, day)
    absent_ids = {item["user_id"] for item in absent}
    personal_absences = absence(db, user, [user.id], day, (current_day + timedelta(days=366)).isoformat())
    available = next((s for s in shifts if s.user_id == user.id and not any(
        a["start"] <= s.day <= a["end"] for a in personal_absences)), None)
    project_query = visible(Project, user)
    if department:
        project_query = project_query.where(Project.department_id == department)
    projects = projects_with_stats(db.scalars(project_query.order_by(Project.deadline)), tasks, day)
    period = [t for t in tasks if start.isoformat() <= t.deadline <= end.isoformat()]
    finished = sum(t.status == "COMPLETED" for t in period)
    pending_scope = scoped(Request, user) if user.role == DIRECTOR else visible(Request, user)
    pending = len(list(db.scalars(pending_scope.with_only_columns(Request.id).where(
        Request.user_id.in_(ids), Request.status == "PENDING"))))
    width = max(1, ((end - start).days + 7) // 7)
    trend = []
    for index in range(7):
        first = start + timedelta(days=index * width)
        if first > end:
            break
        last = min(end, first + timedelta(days=width - 1)).isoformat()
        due = [t for t in period if first.isoformat() <= t.deadline <= last]
        trend.append({"day": first.strftime("%d.%m"), "planned": len(due),
                      "done": sum(t.status == "COMPLETED" for t in due)})
    active = sorted((t for t in tasks if t.status != "COMPLETED"), key=lambda t: (t.deadline, t.id))
    overdue = [t for t in active if t.deadline < day]
    due_today = [t for t in active if t.deadline == day]
    working_ids = {s.user_id for s in shifts if s.day == day}
    statuses = {key: working_status(key, absent_ids, working_ids) for key in ids}
    extras = {}
    if user.role in (DIRECTOR, HR):
        department_rows = db.scalars(scoped(Department, user).order_by(Department.name))
        staff_counts = Counter(row.department_id for row in employees)
        planned_counts = Counter(t.user_id for t in period)
        done_counts = Counter(t.user_id for t in period if t.status == "COMPLETED")
        department_totals = {}
        for person in employees:
            totals = department_totals.setdefault(person.department_id, [0, 0])
            totals[0] += planned_counts[person.id]
            totals[1] += done_counts[person.id]
        extras["department_stats"] = [
            {"id": row.id, "name": row.name, "people": staff_counts[row.id],
             "planned": department_totals.get(row.id, [0, 0])[0], "done": department_totals.get(row.id, [0, 0])[1]}
            for row in department_rows if not department or row.id == department
        ]
        extras["staff_status"] = dict(Counter(statuses.values()))
    if user.role in (HR, MANAGER):
        calendar_end = (current_day + timedelta(days=13)).isoformat()
        extras["absences"] = sorted(absence(db, user, ids, day, calendar_end),
                                    key=lambda row: (row["start"], row["id"]))
        extras["team_shifts"] = [record(row, "user_id", "day", "kind") for row in shifts
                                 if row.day <= (current_day + timedelta(days=6)).isoformat()]
    if user.role == MANAGER:
        workload = Counter(row.user_id for row in active)
        extras["workload"] = [{"id": row.id, "name": row.name, "active": workload[row.id],
                               "status": statuses[row.id]} for row in employees]
    if user.role == DIRECTOR:
        # Only operational audit categories within this company are shown.
        categories = {"task": "Задача", "project": "Проект", "employee": "Профиль сотрудника",
                      "department": "Отдел", "shift": "График смен"}
        event_scope = scoped(Event, user).where(Event.entity.in_(categories))
        if department:
            keys = {"task": [item.id for item in tasks], "project": [item["id"] for item in projects],
                    "employee": ids, "department": [department], "shift": [item.id for item in shifts]}
            event_scope = event_scope.where(or_(*((Event.entity == category) & Event.entity_id.in_(keys[category])
                                                   for category in categories)))
        extras["activity"] = [
            {**record(row, "action", "created_at"), "label": categories[row.entity]}
            for row in db.scalars(event_scope.order_by(Event.id.desc()).limit(5))
        ]
    own_shift = db.scalar(visible(Shift, user).where(Shift.user_id == user.id, Shift.day == day))
    return {
        **extras, "today": day, "today_shift": record(own_shift, "day", "kind") if own_shift else None,
        "due_today": [task(t) for t in due_today[:5]],
        "counts": {"employees": len(ids), "working": len({s.user_id for s in shifts if s.day == day} - absent_ids),
                   "leave": len({row["user_id"] for row in absent if row.get("kind") == "LEAVE"}),
                   "absent": len(absent_ids), "active": sum(t.status != "COMPLETED" for t in tasks),
                   "completion": round(finished * 100 / len(period)) if period else 0,
                   "completed": sum(t.status == "COMPLETED" for t in tasks), "pending": pending,
                   "overdue": len(overdue), "today": len(due_today), "planned": len(period), "finished": finished,
                   "projects": sum(p["status"] != "DONE" for p in projects)},
        "trend": trend, "projects": projects, "project_status": dict(Counter(p["status"] for p in projects)),
        "overdue": [task(t) for t in overdue[:5]],
        "tasks": [task(t) for t in active[:5]],
        "upcoming": [task(t) for t in active if t.deadline >= day][:4],
        "next_shift": record(available, "day", "kind") if available else None,
        "working_status": "ABSENT" if user.id in absent_ids else "WORKING" if any(s.user_id == user.id and s.day == day for s in shifts) else "OFF",
    }


def media_type(data):
    if data.startswith(b"%PDF-") and b"%%EOF" in data[-1024:]:
        return "application/pdf"
    if data.startswith(b"\xff\xd8\xff") and data.endswith(b"\xff\xd9"):
        return "image/jpeg"
    if data.startswith(b"\x89PNG\r\n\x1a\n") and data.endswith(b"IEND\xaeB\x60\x82"):
        return "image/png"
    raise HTTPException(415, "Поддерживаются PDF, JPG и PNG")

