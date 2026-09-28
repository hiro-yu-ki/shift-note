FROM node:24-bookworm-slim AS frontend
WORKDIR /build
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

FROM python:3.13-slim-bookworm
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 SHIFT_ENV=production
WORKDIR /app
COPY backend/requirements-lock.txt ./backend/requirements-lock.txt
RUN pip install --no-cache-dir -r backend/requirements-lock.txt
COPY backend/ ./backend/
COPY alembic.ini ./
COPY scripts/serve_release.py ./scripts/serve_release.py
COPY scripts/backup.py ./scripts/backup.py
COPY scripts/restore_copy.py ./scripts/restore_copy.py
COPY --from=frontend /build/dist ./frontend/dist/
RUN useradd --uid 10001 --create-home shift && mkdir /data && chown shift:shift /data
EXPOSE 8000
CMD ["python", "scripts/serve_release.py"]
