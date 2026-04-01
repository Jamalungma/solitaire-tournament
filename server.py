from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from datetime import datetime, timezone
import psycopg2
from psycopg2.extras import RealDictCursor
import os

app = FastAPI()

# Разрешаем фронтенду обращаться к серверу
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Структура данных участника
class Participant(BaseModel):
    name: str
    email: str
    level: str

DATABASE_URL = os.environ.get("DATABASE_URL")

def get_db():
    """Открывает соединение с базой данных"""
    return psycopg2.connect(DATABASE_URL, cursor_factory=RealDictCursor)

def init_db():
    """Создаёт таблицу, если её нет"""
    conn = get_db()
    cur = conn.cursor()
    cur.execute("""
        CREATE TABLE IF NOT EXISTS participants (
            id SERIAL PRIMARY KEY,
            name TEXT NOT NULL,
            email TEXT NOT NULL UNIQUE,
            level TEXT NOT NULL,
            registered_at TEXT NOT NULL
        )
    """)
    conn.commit()
    cur.close()
    conn.close()

# Инициализируем БД при запуске приложения
if DATABASE_URL:
    init_db()


# POST /register — принять заявку
@app.post("/register")
def register(participant: Participant):
    conn = get_db()
    cur = conn.cursor()

    # Проверка на дубликат email
    cur.execute("SELECT email FROM participants WHERE email = %s", (participant.email,))
    if cur.fetchone():
        cur.close()
        conn.close()
        return {"success": False, "message": "Этот email уже зарегистрирован"}

    registered_at = datetime.now(timezone.utc).isoformat()
    cur.execute(
        "INSERT INTO participants (name, email, level, registered_at) VALUES (%s, %s, %s, %s)",
        (participant.name, participant.email, participant.level, registered_at)
    )
    conn.commit()
    cur.close()
    conn.close()

    return {"success": True, "message": f"{participant.name}, заявка принята!"}


# GET /participants — список всех участников
@app.get("/participants")
def get_participants():
    conn = get_db()
    cur = conn.cursor()
    cur.execute("SELECT name, email, level, registered_at FROM participants")
    rows = cur.fetchall()
    cur.close()
    conn.close()
    return [dict(row) for row in rows]


# DELETE /participants/{email} — удалить участника
@app.delete("/participants/{email}")
def delete_participant(email: str):
    conn = get_db()
    cur = conn.cursor()
    cur.execute("DELETE FROM participants WHERE email = %s RETURNING email", (email,))
    deleted = cur.fetchone()
    conn.commit()
    cur.close()
    conn.close()

    if not deleted:
        return {"success": False, "message": "Участник не найден"}
    return {"success": True, "message": "Участник удалён"}


# Раздаём статические файлы (HTML, CSS, JS)
app.mount("/", StaticFiles(directory=".", html=True), name="static")
