from fastapi import FastAPI
from pydantic import BaseModel, Field

from scripts.classify import classify_text


app = FastAPI(title="Atlas Hebrew Military Terminology Filtering Engine")


class ClassificationRequest(BaseModel):
    text: str = Field(..., min_length=1)
    audit: bool = False


@app.get("/health")
def health() -> dict:
    return {"status": "ok"}


@app.post("/classify")
def classify(request: ClassificationRequest) -> dict:
    return classify_text(request.text, audit=request.audit)
