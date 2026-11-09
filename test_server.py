"""Тесты API лиги. Запуск: python -m pytest test_server.py -v

Если задан DATABASE_URL, тесты идут через Postgres (так в CI), иначе — через временный JSON-файл.
"""

import os

import pytest
from fastapi.testclient import TestClient

os.environ["ADMIN_PASSWORD"] = "secret"

import server  # noqa: E402

client = TestClient(server.app)
AUTH = {"X-Admin-Password": "secret"}


@pytest.fixture(autouse=True)
def fresh_store(tmp_path, monkeypatch):
    """Каждый тест начинает с пустой лиги."""
    if isinstance(server.store, server.FileStore):
        monkeypatch.setattr(server, "store", server.FileStore(tmp_path / "league.json"))
    else:
        with server.store.connect() as conn, conn.cursor() as cur:
            cur.execute("UPDATE league SET data = %s, version = 0, live = NULL WHERE id = 1",
                        (server.store.Json(server.EMPTY_LEAGUE),))
    monkeypatch.setenv("ADMIN_PASSWORD", "secret")
    yield


def league(**extra):
    return {**server.EMPTY_LEAGUE, **extra}


def test_get_empty_league():
    r = client.get("/api/league")
    assert r.status_code == 200
    body = r.json()
    assert body["version"] == 0
    assert body["data"]["players"] == []
    assert body["live"] is None
    assert body["editable"] is True


def test_login():
    assert client.post("/api/login", json={"password": "secret"}).status_code == 200
    assert client.post("/api/login", json={"password": "nope"}).status_code == 401


def test_save_requires_password():
    r = client.put("/api/league", json={"data": league(), "version": 0})
    assert r.status_code == 401
    r = client.put("/api/league", json={"data": league(), "version": 0}, headers={"X-Admin-Password": "bad"})
    assert r.status_code == 401


def test_save_and_read_back():
    data = league(name="Лига четвергов", players=[{"name": "Илья", "gk": False}])
    r = client.put("/api/league", json={"data": data, "version": 0}, headers=AUTH)
    assert r.status_code == 200
    assert r.json()["version"] == 1
    body = client.get("/api/league").json()
    assert body["data"]["name"] == "Лига четвергов"
    assert body["data"]["players"][0]["name"] == "Илья"
    assert body["version"] == 1


def test_stale_version_is_rejected():
    client.put("/api/league", json={"data": league(name="A"), "version": 0}, headers=AUTH)
    r = client.put("/api/league", json={"data": league(name="B"), "version": 0}, headers=AUTH)
    assert r.status_code == 409
    assert client.get("/api/league").json()["data"]["name"] == "A"


def test_invalid_league_is_rejected():
    r = client.put("/api/league", json={"data": {"name": "x"}, "version": 0}, headers=AUTH)
    assert r.status_code == 422


def test_live_match():
    live = {"tourId": "t1", "a": "R", "b": "B", "events": [{"team": "R", "scorer": "Илья"}]}
    assert client.put("/api/live", json={"live": live}).status_code == 401
    assert client.put("/api/live", json={"live": live}, headers=AUTH).status_code == 200
    assert client.get("/api/live").json()["live"]["events"][0]["scorer"] == "Илья"
    assert client.put("/api/live", json={"live": None}, headers=AUTH).status_code == 200
    assert client.get("/api/live").json()["live"] is None


def test_editing_disabled_without_password(monkeypatch):
    monkeypatch.setenv("ADMIN_PASSWORD", "")
    assert client.get("/api/league").json()["editable"] is False
    r = client.put("/api/league", json={"data": league(), "version": 0}, headers=AUTH)
    assert r.status_code == 503


def test_static_page_served_but_not_project_files():
    r = client.get("/")
    assert r.status_code == 200
    assert "league.js" in r.text
    assert client.get("/league.js").status_code == 200
    assert client.get("/server.py").status_code == 404
