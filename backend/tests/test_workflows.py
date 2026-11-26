import os
import secrets
from datetime import timedelta
from unittest.mock import Mock

import pytest
from fastapi.testclient import TestClient

os.environ["DATABASE_URL"] = "sqlite://"
os.environ["COOKIE_SECURE"] = "false"

from app import health
from app.auth import digest, hasher, issue
from app.config import database
from app.main import app
from app.models import Base, Company, Department, Project, Session, User
from app.services import today
from sqlalchemy import create_engine, select
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import sessionmaker

password = secrets.token_urlsafe(24)


@pytest.fixture(scope="module")
def workspace(tmp_path_factory):
    postgres_url = os.environ.get("ENTERPRISE_TEST_DATABASE_URL")
    if postgres_url:
        engine = create_engine(postgres_url)
        if engine.dialect.name != "postgresql" or engine.url.database != "enterprise_test":
            pytest.fail("Integration tests require a disposable PostgreSQL database named enterprise_test.")
    else:
        path = tmp_path_factory.mktemp("db") / "test.db"
        engine = create_engine(f"sqlite:///{path}")
        Base.metadata.create_all(engine)
    sessions = sessionmaker(engine, expire_on_commit=False)
    with sessions.begin() as db:
        if postgres_url and db.scalar(select(Company.id).limit(1)) is not None:
            pytest.fail("Use a fresh migrated enterprise_test database for each integration test run.")
        a, b = Company(name="A"), Company(name="B")
        db.add_all([a, b])
        db.flush()
        dept = Department(company_id=a.id, name="Operations")
        db.add(dept)
        db.flush()
        encoded = hasher.hash(password)
        ids = {"department": dept.id}
        for login, role, company in [("director", "DIRECTOR", a), ("hr", "HR", a),
                                      ("manager", "MANAGER", a), ("staff", "EMPLOYEE", a),
                                      ("peer", "EMPLOYEE", a), ("other", "HR", b)]:
            user = User(company_id=company.id, name=login, email=f"{login}@demo.example", role=role,
                        password=encoded, department_id=dept.id if company == a else None,
                        manager_id=ids.get("manager") if login == "staff" else None)
            db.add(user)
            db.flush()
            ids[login] = user.id
        project = Project(company_id=a.id, name="Project", description="", department_id=dept.id,
                          deadline=(today() + timedelta(days=10)).isoformat())
        db.add(project)
        db.flush()
        ids["project"] = project.id

    def override():
        with sessions() as db:
            yield db

    app.dependency_overrides[database] = override
    yield ids, sessions
    app.dependency_overrides.clear()
    engine.dispose()


def client(role=None):
    session = TestClient(app)
    if role:
        response = session.post("/api/auth/login", json={"email": f"{role}@demo.example", "password": password})
        assert response.status_code == 200, response.text
    return session


def test_health(workspace, monkeypatch):
    _, sessions = workspace
    engine = sessions.kw["bind"]
    monkeypatch.setattr(health, "engine", engine)
    anonymous = client()
    assert anonymous.get("/api/health").json() == {"ok": True}
    assert anonymous.get("/api/health/live").json() == {"ok": True}
    response = anonymous.get("/api/health/ready")
    if engine.dialect.name == "postgresql":
        assert response.status_code == 200
        assert response.json() == {"ok": True}
        monkeypatch.setattr(health, "schema_heads", lambda: {"different_revision"})
        response = anonymous.get("/api/health/ready")
    assert response.status_code == 503
    assert response.json() == {"ok": False}
    offline = Mock()
    offline.connect.side_effect = OperationalError(None, None, RuntimeError("Database offline"))
    monkeypatch.setattr(health, "engine", offline)
    assert anonymous.get("/api/health/live").status_code == 200
    response = anonymous.get("/api/health/ready")
    assert response.status_code == 503
    assert response.json() == {"ok": False}


def test_auth_and_origin(workspace):
    anonymous = client()
    assert anonymous.get("/api/me").status_code == 401
    assert anonymous.post("/api/auth/login", json={"email": "nobody@demo.example", "password": "wrong"}).status_code == 401
    staff = client("staff")
    assert staff.get("/api/me").json()["role"] == "EMPLOYEE"
    assert staff.patch("/api/me", headers={"Origin": "https://elsewhere.example"}, json={"phone": "100"}).status_code == 403
    assert staff.post("/api/auth/logout").status_code == 200
    assert staff.get("/api/me").status_code == 401


def test_employees_and_tasks(workspace):
    ids, _ = workspace
    director, manager, staff, other = [client(role) for role in ("director", "manager", "staff", "other")]
    assert director.get("/api/overview").json()["counts"]["employees"] == 5
    assert staff.post("/api/departments", json={"name":"New Department"}).status_code == 403
    department = director.post("/api/departments", json={"name":"New Department"})
    assert department.status_code == 201
    assert department.json() in director.get("/api/departments").json()
    assert department.json() not in other.get("/api/departments").json()
    fields = dict(email="new@demo.example", name="New Staff", role="EMPLOYEE", password=password,
                  department_id=ids["department"], manager_id=ids["manager"], position="Engineer")
    assert staff.post("/api/employees", json=fields).status_code == 403
    assert director.post("/api/employees", json=fields).status_code == 201
    assert other.get(f"/api/projects/{ids['project']}").status_code == 404
    data = dict(name="Check", deadline=today().isoformat(), priority="HIGH",
                project_id=ids["project"], user_id=ids["peer"])
    assert manager.post("/api/tasks", json=data).status_code == 404
    data["user_id"] = ids["staff"]
    result = manager.post("/api/tasks", json=data)
    assert result.status_code == 201, result.text
    key = result.json()["id"]
    for _ in range(2):
        assert staff.post("/api/notifications/deadlines").status_code == 200
    notes = staff.get("/api/notifications").json()
    assert sum(item["message"].startswith("Скоро срок задачи") for item in notes) == 1
    assert staff.patch(f"/api/tasks/{key}", json={"status":"COMPLETED"}).status_code == 200
    assert staff.post(f"/api/tasks/{key}/comments", json={"text":"Ready"}).status_code == 201
    assert len(staff.get(f"/api/tasks/{key}").json()["history"]) == 3
    assert other.get(f"/api/tasks/{key}").status_code == 404
    notification = staff.get("/api/notifications").json()[0]
    assert staff.patch(f"/api/notifications/{notification['id']}").status_code == 200


def test_request_workflow_and_private_documents(workspace):
    staff, peer, hr, director, manager, other = [client(role) for role in
                                                  ("staff", "peer", "hr", "director", "manager", "other")]
    day = today()
    data = {"kind":"LEAVE", "start":day.isoformat(), "end":(day+timedelta(days=1)).isoformat()}
    result = staff.post("/api/requests", data=data)
    assert result.status_code == 201, result.text
    key = result.json()["id"]
    assert manager.post(f"/api/requests/{key}/decision", json={"status":"APPROVED"}).status_code == 403
    assert hr.post(f"/api/requests/{key}/decision", json={"status":"RETURNED"}).status_code == 422
    assert hr.post(f"/api/requests/{key}/decision", json={"status":"RETURNED","reason":"Проверьте даты"}).status_code == 200
    assert staff.post(f"/api/requests/{key}/resubmit", data=data).status_code == 200
    assert hr.post(f"/api/requests/{key}/decision", json={"status":"APPROVED"}).status_code == 200
    assert staff.get(f"/api/requests/{key}").json()["status"] == "APPROVED"
    assert staff.get("/api/me").json()["leave_days"] == 22
    sick = {"kind":"SICK", "start":(day+timedelta(days=3)).isoformat(), "end":(day+timedelta(days=4)).isoformat()}
    invalid = staff.post("/api/requests", data=sick, files={"file":("bad.pdf",b"<html>","application/pdf")})
    assert invalid.status_code == 415
    content = b"%PDF-1.7\n%%EOF\n"
    valid = staff.post("/api/requests", data=sick, files={"file":("../../private.pdf",content,"application/pdf")})
    assert valid.status_code == 201, valid.text
    sick_id = valid.json()["id"]
    path = f"/api/requests/{sick_id}/document"
    for viewer in (peer,director,manager,other):
        assert viewer.get(path).status_code == 404
    for viewer in (staff,hr):
        response = viewer.get(path)
        assert response.content == content
        assert response.headers["content-disposition"] == 'attachment; filename="document.pdf"'
    assert hr.post(f"/api/requests/{sick_id}/decision", json={"status":"APPROVED"}).status_code == 200
    calendar = manager.get("/api/schedule", params={"start":sick["start"],"end":sick["end"]}).json()
    assert len(calendar["absences"]) == 1 and "kind" not in calendar["absences"][0]


def test_role_overviews_use_visible_records(workspace):
    ids, _ = workspace
    director, hr, manager, staff, other = [client(role) for role in
                                            ("director", "hr", "manager", "staff", "other")]
    day = today().isoformat()
    filtered = director.get("/api/overview", params={"start": day, "end": day,
                                                     "department": ids["department"]}).json()
    assert [d["id"] for d in filtered["department_stats"]] == [ids["department"]]
    assert filtered["counts"]["planned"] == sum(row["planned"] for row in filtered["trend"])
    assert "activity" in filtered and "absences" not in filtered
    assert director.get("/api/overview", params={"start": "2026-10-02", "end": "2026-10-01"}).status_code == 422
    hr_data = hr.get("/api/overview").json()
    assert {"department_stats", "staff_status", "absences"} <= set(hr_data)
    assert "activity" not in hr_data
    manager_data = manager.get("/api/overview").json()
    team_ids = {row["id"] for row in manager_data["workload"]}
    assert {ids["manager"], ids["staff"]} <= team_ids
    assert ids["peer"] not in team_ids and ids["other"] not in team_ids
    assert team_ids == {p["id"] for p in manager.get("/api/employees").json()}
    assert all("kind" not in row or row["user_id"] == ids["manager"] for row in manager_data["absences"])
    staff_data = staff.get("/api/overview").json()
    assert staff_data["counts"]["employees"] == 1 and "workload" not in staff_data
    assert all(row["user_id"] == ids["staff"] for row in staff_data["tasks"])
    assert other.get("/api/projects").json() == []


def test_project_profile_and_schedule(workspace):
    ids, _ = workspace
    director, manager, staff = [client(role) for role in ("director", "manager", "staff")]
    day = (today() + timedelta(days=8)).isoformat()
    project = {"name": "New project", "department_id": ids["department"], "deadline": day}
    assert manager.post("/api/projects", json=project).status_code == 403
    result = director.post("/api/projects", json=project)
    assert result.status_code == 201
    assert director.get(f"/api/projects/{result.json()['id']}").json()["progress"] == 0
    shift = {"user_id": ids["peer"], "day": day, "kind": "DAY"}
    assert manager.put("/api/schedule", json=shift).status_code == 404
    shift["user_id"] = ids["staff"]
    assert manager.put("/api/schedule", json=shift).status_code == 200
    assert staff.get("/api/schedule", params={"start": day, "end": day}).json()["shifts"][0]["kind"] == "DAY"
    assert staff.patch("/api/me", json={"phone": "100"}).status_code == 200
    assert staff.get("/api/me").json()["phone"] == "100"


def test_session_expiry_and_one_time_password_reset(workspace):
    ids, sessions = workspace
    staff = client("staff")
    session = staff.cookies.get("enterprise_session")
    with sessions.begin() as db:
        db.get(Session, digest(session)).expires = 0
    assert staff.get("/api/me").status_code == 401
    peer = client("peer")
    with sessions.begin() as db:
        token = issue(db, db.get(User, ids["peer"]), 1800, "reset")
    data = {"token": token, "password": password + "-updated"}
    assert peer.post("/api/auth/reset", json=data).status_code == 200
    assert peer.get("/api/me").status_code == 401
    assert peer.post("/api/auth/reset", json=data).status_code == 400
    assert peer.post("/api/auth/login", json={"email":"peer@demo.example", "password":data["password"]}).status_code == 200

