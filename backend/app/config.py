import os

from dotenv import load_dotenv
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from .settings import ROOT, database_url

url = database_url()
load_dotenv(ROOT / ".env")
origin = os.getenv("APP_ORIGIN", "http://localhost:3000")
secure = os.getenv("COOKIE_SECURE", "true").lower() == "true"
engine = create_engine(url, pool_pre_ping=True)
Database = sessionmaker(engine, expire_on_commit=False)


def database():
    with Database() as session:
        yield session

