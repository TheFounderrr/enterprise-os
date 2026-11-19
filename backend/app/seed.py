import os
from datetime import timedelta

from sqlalchemy import select

from .auth import hasher
from .config import Database
from .models import Company, Department, Notification, Project, Request, Shift, Task, User
from .services import today


def main():
    password = os.environ.get("DEMO_PASSWORD", "")
    if len(password) < 12:
        raise SystemExit("Set DEMO_PASSWORD to a local password with at least 12 characters.")
    day = today()
    with Database.begin() as db:
        if db.scalar(select(User).where(User.email == "director@demo.example")):
            print("Demo data already installed.")
            return
        company = Company(name="ТОО «СтройИнвест»", demo=True)
        db.add(company)
        db.flush()

        def add(model, **fields):
            row = model(company_id=company.id, **fields)
            db.add(row)
            db.flush()
            return row

        leadership = add(Department, name="Управление")
        construction = add(Department, name="Строительный отдел")
        supply = add(Department, name="Снабжение")
        encoded = hasher.hash(password)

        def person(login, name, role, department, position, manager=None):
            return add(User, email=f"{login}@demo.example", name=name, role=role,
                       department_id=department.id, position=position, password=encoded,
                       manager_id=manager.id if manager else None)

        director = person("director", "Ильяс Кайратов", "DIRECTOR", leadership, "Генеральный директор")
        hr = person("hr", "Айгерим Нурланова", "HR", leadership, "HR-специалист", director)
        manager = person("manager", "Даурен Тлеубеков", "MANAGER", construction, "Руководитель проектов", director)
        staff = [
            person("employee", "Арман Серикулы", "EMPLOYEE", construction, "Инженер ПТО", manager),
            person("madina", "Мадина Алиева", "EMPLOYEE", supply, "Специалист по закупкам", manager),
            person("timur", "Тимур Асанов", "EMPLOYEE", construction, "Мастер участка", manager),
            person("dana", "Дана Жумабаева", "EMPLOYEE", construction, "Сметчик", manager),
        ]
        projects = [
            add(Project, name="ЖК «River Park»", description="Строительство жилого комплекса, Алматы",
                department_id=construction.id, deadline=(day + timedelta(days=32)).isoformat()),
            add(Project, name="Производственный комплекс", description="Модернизация завода ЖБК, Астана",
                department_id=construction.id, deadline=(day - timedelta(days=2)).isoformat()),
            add(Project, name="ТЦ «Bright Mall»", description="Подготовка коммерческого объекта",
                department_id=supply.id, deadline=(day + timedelta(days=55)).isoformat()),
        ]
        names = ["Проверка проектной документации", "Поставка материалов", "Согласование сметы",
                 "Подготовка отчёта по участку", "Проверка графика работ", "Приёмка этапа"]
        for index in range(24):
            deadline = day + timedelta(days=index - 21)
            done = deadline < day and (index % 5 != 0 or index % 3 == 2)
            add(Task, name=names[index % len(names)], description="Демонстрационная задача проекта",
                status="COMPLETED" if done else "IN_PROGRESS" if index % 2 else "TODO",
                deadline=deadline.isoformat(), completed_on=deadline.isoformat() if done else None,
                priority=["HIGH", "MEDIUM", "LOW"][index % 3], user_id=staff[index % 4].id,
                project_id=projects[index % 3].id)
        for offset in range(-7, 24):
            for index, user in enumerate([director, hr, manager, *staff]):
                add(Shift, user_id=user.id, day=(day + timedelta(days=offset)).isoformat(),
                    kind=["DAY", "DAY", "NIGHT", "OFF"][(offset + index) % 4])
        for index, user in enumerate(staff):
            start = day + timedelta(days=index * 3)
            add(Request, user_id=user.id, kind="LEAVE", subtype="ANNUAL", start=start.isoformat(),
                end=(start + timedelta(days=2)).isoformat(), status="APPROVED" if index == 0 else "PENDING")
            add(Notification, user_id=user.id, message="Демонстрационная учётная запись готова к работе")
        add(Notification, user_id=hr.id, message="В очереди есть новые заявления")
    print("Demo data installed.")


if __name__ == "__main__":
    main()

