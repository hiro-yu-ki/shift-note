"""E2E always uses a temporary database, never the user's shift.db."""
import os
from pathlib import Path
import subprocess
import sys
import tempfile

root = Path(__file__).resolve().parent.parent
os.chdir(root)
with tempfile.TemporaryDirectory(prefix='shift-e2e-') as directory:
    os.environ['SHIFT_DB'] = 'sqlite:///'+str(Path(directory)/'e2e.db').replace('\\', '/')
    os.environ['SHIFT_PLATFORM_DB'] = 'sqlite:///'+str(Path(directory)/'platform.db').replace('\\', '/')
    os.environ['SHIFT_TENANT_ROOT'] = str(Path(directory)/'tenants')
    subprocess.run([sys.executable, '-m', 'alembic', 'upgrade', 'head'], check=True)
    subprocess.run([sys.executable, 'scripts/e2e_app.py'], check=True)

