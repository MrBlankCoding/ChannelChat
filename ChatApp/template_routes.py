import os

from starlette.requests import Request
from starlette.responses import HTMLResponse, FileResponse

from ChatApp.main import app, templates


@app.get("/", response_class=HTMLResponse)
async def landing(request: Request):
    """landing page."""
    return templates.TemplateResponse("index.html", {"request": request})


@app.get("/chat", response_class=HTMLResponse)
async def chat_landing(request: Request):
    """Chat landing page showing all user rooms."""
    return templates.TemplateResponse(
        "chat.html", {"request": request}
    )


@app.get("/chat/{room_id}", response_class=HTMLResponse)
async def chat_room(request: Request, room_id: str):
    """Chat room page."""
    return templates.TemplateResponse(
        "chat.html", {"request": request, "room_id": room_id}
    )


@app.get("/health")
def health_check():
    return {"status": "ok"}


@app.get("/sentry-debug")
async def trigger_error():
    division_by_zero = 1 / 0


@app.get("/login", response_class=HTMLResponse)
async def login_page(request: Request):
    """Login page."""
    return templates.TemplateResponse("login.html", {"request": request})


@app.get("/register", response_class=HTMLResponse)
async def register_page(request: Request):
    """Register page."""
    return templates.TemplateResponse("register.html", {"request": request})


@app.get("/forgot-password", response_class=HTMLResponse)
async def forgot_password(request: Request):
    """Forgot password page."""
    return templates.TemplateResponse("forgot-password.html", {"request": request})


@app.get("/settings", response_class=HTMLResponse)
async def settings_page(request: Request):
    """User settings page."""
    return templates.TemplateResponse("settings.html", {"request": request})


@app.get("/service-worker.js", response_class=FileResponse)
async def service_worker():
    file_path = os.path.join(os.getcwd(), "static", "service-worker.js")
    return FileResponse(file_path, media_type="application/javascript")


@app.get("/firebase-messaging-sw.js", response_class=FileResponse)
async def firebase_messaging_sw():
    file_path = os.path.join(os.getcwd(), "static", "firebase-messaging-sw.js")
    return FileResponse(file_path, media_type="application/javascript")
