"""Сервер футбольной лиги.

Вся лига хранится одним JSON-документом (игроки, туры, матчи).
Читать может кто угодно, менять — только организатор с паролем из ADMIN_PASSWORD.

Где хранятся данные:
- если задан DATABASE_URL — в Postgres (так работает на Railway);
- иначе — в файле league.json рядом с сервером (удобно для запуска на своём компьютере).
"""

import hmac
import json
import os
import threading
from contextlib import contextmanager
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, Header, HTTPException
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

app = FastAPI(title="Football League")

DATABASE_URL = os.environ.get("DATABASE_URL")
DATA_FILE = Path(os.environ.get("LEAGUE_FILE", Path(__file__).with_name("league.json")))
MAX_BYTES = 2_000_000

EMPTY_LEAGUE = {
    "name": "Моя лига",
    "season": "",
    "teamNames": {"R": "Красные", "B": "Синие", "G": "Зелёные", "Y": "Жёлтые"},
    "players": [],
    "tours": [],
}


# ---------- Хранилище ----------

class FileStore:
    """Хранит лигу в JSON-файле."""

    def __init__(self, path: Path):
        self.path = path
        self.lock = threading.Lock()

    def read(self):
        if not self.path.exists():
            return {"data": EMPTY_LEAGUE, "version": 0, "live": None}
        return json.loads(self.path.read_text(encoding="utf-8"))

    def write(self, doc):
        tmp = self.path.with_suffix(".tmp")
        tmp.write_text(json.dumps(doc, ensure_ascii=False), encoding="utf-8")
        tmp.replace(self.path)

    def get(self):
        with self.lock:
            return self.read()

    def save_data(self, data, base_version):
        with self.lock:
            doc = self.read()
            if doc["version"] != base_version:
                return None
            doc["data"] = data
            doc["version"] += 1
            self.write(doc)
            return doc["version"]

    def save_live(self, live):
        with self.lock:
            doc = self.read()
            doc["live"] = live
            self.write(doc)


class PostgresStore:
    """Хранит лигу в одной строке таблицы league."""

    def __init__(self, url: str):
        import psycopg2
        from psycopg2.extras import Json, RealDictCursor

        self.psycopg2 = psycopg2
        self.Json = Json
        self.cursor_factory = RealDictCursor
        self.url = url
        with self.connect() as conn, conn.cursor() as cur:
            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS league (
                    id INTEGER PRIMARY KEY,
                    data JSONB NOT NULL,
                    version INTEGER NOT NULL DEFAULT 0,
                    live JSONB
                )
                """
            )
            cur.execute(
                "INSERT INTO league (id, data, version) VALUES (1, %s, 0) ON CONFLICT (id) DO NOTHING",
                (Json(EMPTY_LEAGUE),),
            )

    @contextmanager
    def connect(self):
        """Открывает соединение, сохраняет изменения и всегда закрывает его."""
        conn = self.psycopg2.connect(self.url, cursor_factory=self.cursor_factory)
        try:
            with conn:
                yield conn
        finally:
            conn.close()

    def get(self):
        with self.connect() as conn, conn.cursor() as cur:
            cur.execute("SELECT data, version, live FROM league WHERE id = 1")
            row = cur.fetchone()
            return {"data": row["data"], "version": row["version"], "live": row["live"]}

    def save_data(self, data, base_version):
        with self.connect() as conn, conn.cursor() as cur:
            cur.execute(
                "UPDATE league SET data = %s, version = version + 1 WHERE id = 1 AND version = %s RETURNING version",
                (self.Json(data), base_version),
            )
            row = cur.fetchone()
            return row["version"] if row else None

    def save_live(self, live):
        with self.connect() as conn, conn.cursor() as cur:
            cur.execute("UPDATE league SET live = %s WHERE id = 1", (self.Json(live) if live is not None else None,))


store = PostgresStore(DATABASE_URL) if DATABASE_URL else FileStore(DATA_FILE)


# ---------- Проверка пароля ----------

def admin_password():
    return os.environ.get("ADMIN_PASSWORD", "")


def require_admin(password):
    expected = admin_password()
    if not expected:
        raise HTTPException(503, "Редактирование выключено: на сервере не задан ADMIN_PASSWORD")
    if not password or not hmac.compare_digest(password.encode(), expected.encode()):
        raise HTTPException(401, "Неверный пароль")


# ---------- API ----------

class LoginBody(BaseModel):
    password: str


class SaveBody(BaseModel):
    data: dict
    version: int


class LiveBody(BaseModel):
    live: Optional[dict] = None


def validate_league(data: dict):
    if not isinstance(data.get("players"), list) or not isinstance(data.get("tours"), list):
        raise HTTPException(422, "В данных лиги должны быть списки players и tours")
    if len(json.dumps(data, ensure_ascii=False).encode()) > MAX_BYTES:
        raise HTTPException(413, "Слишком большой объём данных")


@app.get("/api/league")
def get_league():
    doc = store.get()
    return {**doc, "editable": bool(admin_password())}


@app.get("/api/live")
def get_live():
    doc = store.get()
    return {"live": doc["live"], "version": doc["version"]}


@app.post("/api/login")
def login(body: LoginBody):
    require_admin(body.password)
    return {"ok": True}


@app.put("/api/league")
def save_league(body: SaveBody, x_admin_password: Optional[str] = Header(default=None)):
    require_admin(x_admin_password)
    validate_league(body.data)
    version = store.save_data(body.data, body.version)
    if version is None:
        raise HTTPException(409, "Данные уже изменились на сервере. Обновите страницу.")
    return {"ok": True, "version": version}


@app.put("/api/live")
def save_live(body: LiveBody, x_admin_password: Optional[str] = Header(default=None)):
    require_admin(x_admin_password)
    if body.live is not None and len(json.dumps(body.live).encode()) > 200_000:
        raise HTTPException(413, "Слишком большой объём данных")
    store.save_live(body.live)
    return {"ok": True}


# Раздаём только папку public (страница, стили, скрипты), чтобы наружу не попали служебные файлы
app.mount("/", StaticFiles(directory=Path(__file__).with_name("public"), html=True), name="static")
