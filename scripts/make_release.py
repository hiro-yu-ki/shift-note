"""Build two allowlisted distribution archives without local data, secrets or test mail hooks."""
import argparse
import hashlib
import json
from pathlib import Path
from urllib.parse import urlsplit
from zipfile import ZIP_DEFLATED, ZipFile

parser = argparse.ArgumentParser()
parser.add_argument("--public-origin", default="")
args = parser.parse_args()
origin = args.public_origin.rstrip("/")
if origin:
    u = urlsplit(origin)
    if u.scheme != "https" or not u.hostname or u.path or u.query or u.fragment or u.username:
        raise SystemExit("Use an HTTPS origin without a path")
root = Path(__file__).resolve().parent.parent
out = root / "releases"
out.mkdir(exist_ok=True)
files = set()
for directory in ("backend", "frontend/src", "frontend/public", "frontend/dist", "docs", "licenses", "cloudflare-worker"):
    for p in (root / directory).rglob("*"):
        if p.is_file() and not any(v in p.parts for v in ("__pycache__", "tests", ".wrangler", "node_modules")) and ".test." not in p.name:
            files.add(p.relative_to(root).as_posix())
for name in ("Dockerfile", ".dockerignore", "alembic.ini", ".env.example", "THIRD_PARTY_NOTICES.md", "pyproject.toml",
             "frontend/package.json", "frontend/package-lock.json", "frontend/index.html", "frontend/tsconfig.json", "frontend/tsconfig.app.json", "frontend/tsconfig.node.json", "frontend/vite.config.ts", "frontend/eslint.config.js",
             "scripts/serve_release.py", "scripts/configure-gmail.ps1", "scripts/get-cloudflared.ps1", "scripts/start-cloudflare-preview.ps1", "scripts/register-cloudflare-autostart.ps1", "scripts/backup.py", "scripts/backup_suite.py", "scripts/restore_copy.py", "scripts/start.ps1", "scripts/setup.ps1"):
    if (root / name).is_file():
        files.add(name)
if not (root / "frontend/dist/index.html").is_file():
    raise SystemExit("Build the frontend first")
manifest = {name: hashlib.sha256((root / name).read_bytes()).hexdigest() for name in sorted(files)}
manager = out / "shift-note-1.5.0-operator.zip"
with ZipFile(manager, "w", ZIP_DEFLATED) as z:
    for name in sorted(files):
        assert not name.endswith((".db", ".db-wal", ".db-shm")) and name != ".env"
        z.write(root / name, name)
    z.writestr("MANIFEST.sha256.json", json.dumps(manifest, indent=2))
    z.writestr("README.md", "# シフトノート 1.5.0 運営者用\n\n公開URLは https://shift-note.yuki-nova.workers.dev/platform です。運営手順は docs/PLATFORM.md、再起動は docs/CLOUDFLARE_FREE.md を読んでください。加盟店ごとの管理・従業員・勤怠URLは運営画面で自動発行します。既存DBや秘密値は含みません。\n")
employee = out / "shift-note-1.5.0-employee-guide.zip"
with ZipFile(employee, "w", ZIP_DEFLATED) as z:
    manual = (root / "frontend/public/help/employee.html").read_text(encoding="utf-8")
    manual = manual.replace('href="../employee"', 'href="#login"')
    z.writestr("employee.html", manual)
    z.write(root / "frontend/public/help/help.css", "help.css")
    z.write(root / "docs/templates/LICENSE", "TEMPLATE-LICENSE.txt")
    z.writestr("はじめに.txt", "シフトノート 従業員向け利用手順\n\n加盟店ごとに専用URLが異なります。勤務先の管理者から渡されたURLを開いてください。管理者に登録された本人のメールアドレスが必要です。employee.html に操作手順があります。アプリのインストールは不要です。\n")
for path in (manager, employee):
    with ZipFile(path) as z:
        assert z.testzip() is None
        assert not any("e2e_app" in name or name.endswith(".db") for name in z.namelist())
    print(f"{path.name}: {path.stat().st_size} bytes, SHA256 {hashlib.sha256(path.read_bytes()).hexdigest()}")
