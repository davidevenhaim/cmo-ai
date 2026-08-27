from fastapi import FastAPI
from app.routers import brain

app = FastAPI(title="AI CMO Brain", version="0.1.0")
app.include_router(brain.router)

@app.get("/health")
def health():
    return {"status": "ok"}
