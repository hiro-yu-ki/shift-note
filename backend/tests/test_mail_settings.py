import os
import subprocess

import pytest

from backend import employee_auth, mail_settings


def test_environment_sender_and_secure_smtp(monkeypatch):
    for key in mail_settings.KEYS:
        monkeypatch.setenv(
            key,
            {
                "SHIFT_SMTP_HOST": "smtp.gmail.com",
                "SHIFT_SMTP_PORT": "465",
                "SHIFT_SMTP_USER": "sender@example.com",
                "SHIFT_SMTP_PASSWORD": "fake app password",
                "SHIFT_MAIL_FROM": "sender@example.com",
            }[key],
        )
    sent = []

    class SMTP:
        def __init__(self, host, port, **kwargs):
            assert host == "smtp.gmail.com" and port == 465 and kwargs["context"]

        def __enter__(self):
            return self

        def __exit__(self, *args):
            pass

        def login(self, user, password):
            assert user == "sender@example.com" and password == "fakeapppassword"

        def send_message(self, msg):
            sent.append(msg)

    monkeypatch.setattr(employee_auth.smtplib, "SMTP_SSL", SMTP)
    assert employee_auth.email_ready()
    employee_auth.send_code("receiver@example.com", "12345678")
    assert sent[0]["To"] == "receiver@example.com"
    assert "12345678" in sent[0].get_content()


@pytest.mark.skipif(os.name != "nt", reason="Windows DPAPI integration")
def test_windows_encrypted_local_config(monkeypatch, tmp_path):
    for key in mail_settings.KEYS:
        monkeypatch.delenv(key, raising=False)
    monkeypatch.setenv("SHIFT_ENV", "local")
    monkeypatch.setenv("LOCALAPPDATA", str(tmp_path))
    command = "$d=Join-Path $env:LOCALAPPDATA 'ShiftNote'; New-Item -ItemType Directory -Force $d | Out-Null; [PSCustomObject]@{Host='smtp.gmail.com';Port=465;User='test@example.com';From='test@example.com';Password=(ConvertTo-SecureString 'fake-test-only-secret' -AsPlainText -Force)} | Export-Clixml -LiteralPath (Join-Path $d 'mail.xml')"
    subprocess.run(
        ["powershell.exe", "-NoProfile", "-NonInteractive", "-Command", command],
        check=True,
        capture_output=True,
    )
    assert "fake-test-only-secret" not in (tmp_path / "ShiftNote/mail.xml").read_text()
    config = mail_settings.settings()
    assert config["SHIFT_SMTP_PASSWORD"] == "fake-test-only-secret"
    assert employee_auth.email_ready()
    monkeypatch.setenv("SHIFT_ENV", "production")
    assert not employee_auth.email_ready()
