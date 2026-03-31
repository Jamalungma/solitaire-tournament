from fastapi.testclient import TestClient
from server import app
import time

client = TestClient(app)

def unique_email(prefix="test"):
    """Генерирует уникальный email используя текущее время"""
    return f"{prefix}_{int(time.time() * 1000)}@example.com"

def test_get_participants():
    """Проверяем, что GET /participants возвращает список"""
    response = client.get("/participants")
    assert response.status_code == 200
    assert isinstance(response.json(), list)
    print("✓ GET /participants работает")

def test_register_participant():
    """Проверяем, что POST /register добавляет участника"""
    response = client.post("/register", json={
        "name": "Тестовый участник",
        "email": unique_email("register"),
        "level": "beginner"
    })
    assert response.status_code == 200
    assert response.json()["success"] == True
    print("✓ POST /register работает")

def test_register_duplicate_email():
    """Проверяем, что повторная регистрация с одним email не работает"""
    # Регистрируем первый раз
    client.post("/register", json={
        "name": "Первый",
        "email": "duplicate_test@example.com",
        "level": "beginner"
    })

    # Пытаемся зарегистрировать второй раз с тем же email
    response = client.post("/register", json={
        "name": "Второй",
        "email": "duplicate_test@example.com",
        "level": "pro"
    })

    assert response.status_code == 200
    assert response.json()["success"] == False
    assert "уже зарегистрирован" in response.json()["message"]
    print("✓ Дубликаты email не проходят")

def test_delete_participant():
    """Проверяем удаление участника"""
    email = "delete_test@example.com"

    # Регистрируем участника
    client.post("/register", json={
        "name": "Удаляй меня",
        "email": email,
        "level": "intermediate"
    })

    # Удаляем его
    response = client.delete(f"/participants/{email}")
    assert response.status_code == 200
    assert response.json()["success"] == True

    # Проверяем, что его больше нет в списке
    participants = client.get("/participants").json()
    assert not any(p["email"] == email for p in participants)
    print("✓ Удаление участника работает")

def test_delete_nonexistent():
    """Проверяем, что удаление несуществующего участника не работает"""
    response = client.delete("/participants/nonexistent@example.com")
    assert response.status_code == 200
    assert response.json()["success"] == False
    assert "не найден" in response.json()["message"]
    print("✓ Удаление несуществующего участника обработано корректно")

if __name__ == "__main__":
    test_get_participants()
    test_register_participant()
    test_register_duplicate_email()
    test_delete_participant()
    test_delete_nonexistent()
    print("\nВсе тесты прошли! ✅")
