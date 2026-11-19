from datetime import date
from typing import Annotated, Literal

from pydantic import BaseModel, EmailStr, Field, StringConstraints

Name = Annotated[str, StringConstraints(min_length=1, max_length=160, strip_whitespace=True)]
Description = Annotated[str, Field(max_length=4000)]
Password = Annotated[str, Field(min_length=12, max_length=128)]
Status = Literal["TODO", "IN_PROGRESS", "IN_REVIEW", "COMPLETED", "CANCELLED"]


class Login(BaseModel):
    email: EmailStr
    password: Annotated[str, Field(max_length=128)]


class Recovery(BaseModel):
    email: EmailStr


class Reset(BaseModel):
    token: Annotated[str, Field(min_length=32, max_length=100)]
    password: Password


class DepartmentInput(BaseModel):
    name: Name


class EmployeeInput(BaseModel):
    name: Name
    email: EmailStr
    role: Literal["HR", "MANAGER", "EMPLOYEE"] = "EMPLOYEE"
    department_id: int
    manager_id: int | None = None
    position: Annotated[str, Field(max_length=120)]
    leave_days: Annotated[int, Field(ge=0, le=365)] = 24


class EmployeeCreate(EmployeeInput):
    password: Password


class ProfileInput(BaseModel):
    phone: Annotated[str, Field(max_length=40)]


class ProjectInput(BaseModel):
    name: Name
    description: Description = ""
    deadline: date
    department_id: int


class TaskInput(BaseModel):
    name: Name
    description: Description = ""
    deadline: date
    priority: Literal["LOW", "MEDIUM", "HIGH"]
    user_id: int
    project_id: int


class TaskUpdate(BaseModel):
    status: Status


class Message(BaseModel):
    text: Annotated[str, Field(min_length=1, max_length=4000)]


class Decision(BaseModel):
    status: Literal["APPROVED", "REJECTED", "RETURNED"]
    reason: Description = ""


class ShiftInput(BaseModel):
    user_id: int
    day: date
    kind: Literal["DAY", "NIGHT", "OFF"]

