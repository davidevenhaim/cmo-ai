from fastapi import FastAPI
from app.routers import brain
from app.adapters.factory import llm_health

app = FastAPI(title="AI CMO Brain", version="0.1.0")
app.include_router(brain.router)


@app.get("/health")
def health():
    llm = llm_health()
    return {
        "status": "ok",
        "llm": llm,
    }
