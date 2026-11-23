from fastapi.testclient import TestClient

from app.main import app


client = TestClient(app)


def test_health() -> None:
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"
    assert response.json()["storage"] == "disabled"


def test_rejects_invalid_image() -> None:
    response = client.post("/v1/analyze", content=b"not-an-image", headers={"Content-Type": "image/jpeg"})
    assert response.status_code == 400
