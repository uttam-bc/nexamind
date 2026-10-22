FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PYTHONPATH=/app \
    PIP_NO_CACHE_DIR=1 \
    UPLOAD_DIR=/data/uploads

WORKDIR /app

COPY requirements.txt .
RUN pip install -r requirements.txt

# Run as an unprivileged user; uploads go to /data (mount a persistent disk there).
RUN useradd --create-home --uid 10001 nexamind && mkdir -p /data/uploads && chown -R nexamind /data
COPY --chown=nexamind . .
USER nexamind

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
    CMD python -c "import os, urllib.request; urllib.request.urlopen(f'http://127.0.0.1:{os.getenv(\"PORT\", \"8000\")}/health', timeout=4)"

CMD ["sh", "-c", "alembic upgrade head && exec uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000} --no-server-header"]
