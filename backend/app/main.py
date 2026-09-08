"""
Brolly Juniors B2C API.

FastAPI + asyncpg + Redis, on PostgreSQL 16 and Redis 7.
"""
from __future__ import annotations

import logging
import secrets
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from starlette.exceptions import HTTPException as StarletteHTTPException

from . import db
from .config import settings
from .core import redis_client
from .deps import assert_every_route_guarded
from .errors import HttpError, http_code, problem_response
from .routers import auth, catalog, student

log = logging.getLogger("brolly")


@asynccontextmanager
async def lifespan(app: FastAPI):
    await db.connect()
    await redis_client.connect()
    # Deny by default: a route that declares neither a permission nor
    # public_route is a boot failure, not a hole found in production.
    assert_every_route_guarded(app, exempt={"/health"})
    print(
        f"\n  Brolly Juniors B2C API   http://{settings.host}:{settings.port}"
        f"\n  Postgres {settings.database_url}"
        f"\n  Redis    {settings.redis_url}\n"
    )
    yield
    await redis_client.close()
    await db.close()


app = FastAPI(
    title="Brolly Juniors B2C API",
    version="1.0.0",
    lifespan=lifespan,
    docs_url="/docs",
    openapi_url="/openapi.json",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.web_origin] if settings.is_prod else ["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def request_context(request: Request, call_next):
    request.state.request_id = secrets.token_hex(5)
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
    if settings.is_prod:
        response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
    return response


# ---------------------------------------------------------------------------
# Errors — every failure is problem+json, never a stack trace
# ---------------------------------------------------------------------------

@app.exception_handler(HttpError)
async def handle_http_error(request: Request, exc: HttpError):
    return problem_response(exc.status, exc.code, exc.detail, request.state.request_id)


@app.exception_handler(StarletteHTTPException)
async def handle_starlette_error(request: Request, exc: StarletteHTTPException):
    detail = exc.detail if isinstance(exc.detail, str) else "No such endpoint."
    return problem_response(
        exc.status_code, http_code(exc.status_code), detail,
        getattr(request.state, "request_id", "-"),
    )


@app.exception_handler(RequestValidationError)
async def handle_validation_error(request: Request, exc: RequestValidationError):
    return problem_response(
        400, "bad_request", "That request could not be read.",
        getattr(request.state, "request_id", "-"),
    )


@app.exception_handler(Exception)
async def handle_unexpected(request: Request, exc: Exception):
    log.exception("request failed: %s %s", request.method, request.url.path)
    return problem_response(
        500, "internal_error",
        "Something went wrong at our end. Try again in a moment.",
        getattr(request.state, "request_id", "-"),
    )


app.include_router(auth.router)
app.include_router(catalog.router)
app.include_router(student.router)


@app.get("/health")
async def health():
    return {"ok": True, "driver": "postgres"}
