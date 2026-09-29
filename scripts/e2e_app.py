"""Test-only mail transport, never imported by the release entrypoint."""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import uvicorn

from backend import auth, employee_auth
from backend.main import app


def capture(email, code):
    path = Path("frontend/test-results/mailbox.json")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps({"email": email, "code": code}), encoding="utf-8")


employee_auth.email_ready = lambda: True
employee_auth.send_code = capture
auth.email_ready = lambda: True


def capture_manager(email, link):
    path = Path("frontend/test-results/manager-mailbox.json")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps({"email": email, "link": link}), encoding="utf-8")


auth.send_manager_setup_mail = capture_manager
uvicorn.run(app, host="127.0.0.1", port=8001, access_log=False)
