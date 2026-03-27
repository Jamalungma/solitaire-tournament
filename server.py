from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
import json
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

STORAGE_FILE = "participants.json"

def load_participants():
    if not os.path.exists(STORAGE_FILE):
        return []
    with open(STORAGE_FILE, "r", encoding="utf-8") as f:
        return json.load(f)

def save_participants(data):
    with open(STORAGE_FILE, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


# POST /register — принять заявку
@app.post("/register")
def register(participant: Participant):
    participants = load_participants()

    # Проверка на дубликат email
    for p in participants:
        if p["email"] == participant.email:
            return {"success": False, "message": "Этот email уже зарегистрирован"}

    participants.append(participant.dict())
    save_participants(participants)

    return {"success": True, "message": f"{participant.name}, заявка принята!"}


# GET /participants — список всех участников
@app.get("/participants")
def get_participants():
    return load_participants()


# DELETE /participants/{email} — удалить участника
@app.delete("/participants/{email}")
def delete_participant(email: str):
    participants = load_participants()
    filtered = [p for p in participants if p["email"] != email]
    if len(filtered) == len(participants):
        return {"success": False, "message": "Участник не найден"}
    save_participants(filtered)
    return {"success": True, "message": "Участник удалён"}


# Раздаём статические файлы (HTML, CSS, JS)
app.mount("/", StaticFiles(directory=".", html=True), name="static")
