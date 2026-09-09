# syntax=docker/dockerfile:1

# Brolly Juniors B2C — FastAPI image.
#
# Two stages so the compiler toolchain never reaches the runtime image: the
# builder may fall back to building a wheel from source (asyncpg, cryptography
# and pydantic-core all ship cp314 wheels today, but that is not a guarantee
# for every future pin), while the runtime carries only the built venv.

# --- builder ---------------------------------------------------------------
FROM python:3.14-slim AS builder

ENV PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_NO_CACHE_DIR=1

# build-essential covers a source build; it is discarded with this stage.
RUN apt-get update \
 && apt-get install -y --no-install-recommends build-essential \
 && rm -rf /var/lib/apt/lists/*

RUN python -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

WORKDIR /app
COPY requirements.txt ./
RUN pip install -r requirements.txt

# --- runtime ---------------------------------------------------------------
FROM python:3.14-slim AS runtime

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PATH="/opt/venv/bin:$PATH"

# Non-root. uvicorn binds 8000, which needs no privilege.
RUN useradd --create-home --uid 10001 app

COPY --from=builder /opt/venv /opt/venv

WORKDIR /app
COPY --chown=app:app . .

# The RS256 signing keys are generated on first boot and live here. Compose
# mounts a named volume over it, and Docker seeds a fresh volume from the
# image path — including this ownership, which is why the chown matters.
RUN mkdir -p /app/.data/keys && chown -R app:app /app/.data \
 && chmod +x /app/docker-entrypoint.sh

USER app

EXPOSE 8000

ENTRYPOINT ["/app/docker-entrypoint.sh"]
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
