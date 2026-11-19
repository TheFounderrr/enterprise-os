import hashlib
import os
import secrets
import smtplib
import ssl
import time
from email.message import EmailMessage

from argon2 import PasswordHasher
from argon2.exceptions import VerificationError
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from sqlalchemy import delete, select
from sqlalchemy.orm import Session as DbSession

from . import schemas
from .config import database, origin, secure
from .models import Attempt, Session, User
from .policy import audit

router = APIRouter(prefix="/auth")
hasher = PasswordHasher()
dummy = hasher.hash(secrets.token_urlsafe(24))
cookie = "enterprise_session"
lifetime = 8 * 3600


def digest(token):
    return hashlib.sha256(token.encode()).hexdigest()


def issue(db, user, duration, purpose):
    token = secrets.token_urlsafe(32)
    db.add(Session(id=digest(token), user_id=user.id, expires=int(time.time()) + duration,
                   purpose=purpose))
    return token


def current(request: Request, db: DbSession = Depends(database)):
    token = request.cookies.get(cookie, "")
    item = db.get(Session, digest(token))
    if not item or item.purpose != "login" or item.expires <= time.time():
        raise HTTPException(401, "Войдите в систему")
    user = db.get(User, item.user_id)
    if user is None:
        raise HTTPException(401, "Войдите в систему")
    return user


def throttle(db, key, limit):
    key = digest(key)
    now = int(time.time())
    values = dict(id=key, count=1, expires=now + 900)
    dialect = db.bind.dialect.name
    if dialect == "postgresql":
        from sqlalchemy.dialects.postgresql import insert
    else:
        from sqlalchemy.dialects.sqlite import insert
    from sqlalchemy import case
    expired = Attempt.expires <= now
    statement = insert(Attempt).values(**values).on_conflict_do_update(
        index_elements=[Attempt.id],
        set_={"count": case((expired, 1), else_=Attempt.count + 1),
              "expires": case((expired, now + 900), else_=Attempt.expires)},
        where=expired | (Attempt.count < limit),
    ).returning(Attempt.count)
    count = db.scalar(statement)
    db.commit()
    if count is None:
        raise HTTPException(429, "Слишком много попыток. Повторите позже.")


@router.post("/login")
def login(data: schemas.Login, request: Request, response: Response, db=Depends(database)):
    email = data.email.lower()
    throttle(db, f"login:{request.client.host}", 50)
    throttle(db, f"account:{email}", 8)
    user = db.scalar(select(User).where(User.email == email))
    try:
        hasher.verify(user.password if user else dummy, data.password)
    except VerificationError:
        raise HTTPException(401, "Неверный email или пароль") from None
    if not user:
        raise HTTPException(401, "Неверный email или пароль")
    if request.cookies.get(cookie):
        db.execute(delete(Session).where(Session.id == digest(request.cookies[cookie])))
    db.execute(delete(Attempt).where(Attempt.id == digest(f"account:{email}")))
    token = issue(db, user, lifetime, "login")
    audit(db, user, "session", user.id, "LOGIN")
    db.commit()
    response.set_cookie(cookie, token, httponly=True, samesite="lax", secure=secure, max_age=lifetime, path="/api")
    return {"ok": True}


@router.post("/logout")
def logout(request: Request, response: Response, db=Depends(database)):
    db.execute(delete(Session).where(Session.id == digest(request.cookies.get(cookie, ""))))
    db.commit()
    response.delete_cookie(cookie, path="/api")
    return {"ok": True}


@router.post("/recover")
def recover(data: schemas.Recovery, request: Request, db=Depends(database)):
    throttle(db, f"reset:{request.client.host}", 8)
    host = os.getenv("SMTP_HOST")
    sender = os.getenv("SMTP_SENDER")
    if not host or not sender:
        raise HTTPException(503, "Сброс пароля по почте пока недоступен")
    user = db.scalar(select(User).where(User.email == data.email.lower()).with_for_update())
    if user:
        db.execute(delete(Session).where(Session.user_id == user.id, Session.purpose == "reset"))
        token = issue(db, user, 1800, "reset")
        db.commit()
        message = EmailMessage()
        message["From"], message["To"], message["Subject"] = sender, user.email, "Enterprise OS — сброс пароля"
        message.set_content(f"Ссылка действует 30 минут: {origin}/#reset={token}")
        try:
            with smtplib.SMTP(host, int(os.getenv("SMTP_PORT", "587")), timeout=10) as smtp:
                smtp.starttls(context=ssl.create_default_context())
                if os.getenv("SMTP_USERNAME"):
                    smtp.login(os.environ["SMTP_USERNAME"], os.environ["SMTP_PASSWORD"])
                smtp.send_message(message)
        except (OSError, smtplib.SMTPException) as error:
            # The account-independent response avoids disclosing registered addresses.
            import logging
            logging.getLogger(__name__).warning("Reset email delivery failed: %s", type(error).__name__)
    return {"ok": True}


@router.post("/reset")
def reset(data: schemas.Reset, db=Depends(database)):
    key = digest(data.token)
    item = db.get(Session, key)
    if not item or item.purpose != "reset" or item.expires <= time.time():
        raise HTTPException(400, "Ссылка недействительна или истекла")
    user = db.scalar(select(User).where(User.id == item.user_id).with_for_update())
    claimed = db.execute(delete(Session).where(Session.id == key, Session.expires > int(time.time())))
    if not claimed.rowcount:
        raise HTTPException(400, "Ссылка недействительна или истекла")
    user.password = hasher.hash(data.password)
    db.execute(delete(Session).where(Session.user_id == user.id))
    audit(db, user, "session", user.id, "RESET")
    db.commit()
    return {"ok": True}

