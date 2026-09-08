"""RFC 9457 problem+json, so every failure looks the same to the client."""
from __future__ import annotations

from fastapi import Request
from fastapi.responses import JSONResponse

TITLES: dict[int, str] = {
    400: "That request could not be read",
    401: "Sign in to continue",
    403: "Not allowed",
    404: "Not found",
    409: "That conflicts with something already here",
    423: "Locked",
    429: "Too many attempts",
    500: "Something went wrong at our end",
}

_CODES: dict[int, str] = {
    400: "bad_request", 401: "unauthenticated", 403: "forbidden", 404: "not_found",
    409: "conflict", 423: "locked", 429: "rate_limited",
}


class HttpError(Exception):
    def __init__(self, status: int, code: str, detail: str) -> None:
        super().__init__(detail)
        self.status = status
        self.code = code
        self.detail = detail


def bad_request(d: str, code: str = "bad_request") -> HttpError:
    return HttpError(400, code, d)


def unauthorized(d: str = "Sign in to continue.") -> HttpError:
    return HttpError(401, "unauthenticated", d)


def forbidden(d: str = "You do not have access to this.") -> HttpError:
    return HttpError(403, "forbidden", d)


def not_found(d: str = "Not found.") -> HttpError:
    """
    Use not_found() when the caller should not learn the thing exists — an
    unbought course, another student's submission. Use forbidden() only when
    they already know it exists and simply may not act.
    """
    return HttpError(404, "not_found", d)


def conflict(d: str, code: str = "conflict") -> HttpError:
    return HttpError(409, code, d)


def locked(d: str, code: str = "locked") -> HttpError:
    return HttpError(423, code, d)


def too_many(d: str = "Too many attempts. Wait a moment and try again.") -> HttpError:
    return HttpError(429, "rate_limited", d)


def problem(status: int, code: str, detail: str, trace_id: str) -> dict:
    return {
        "type": f"https://brollyjuniors.com/errors/{code}",
        "title": TITLES.get(status, "Error"),
        "status": status,
        "code": code,
        "detail": detail,
        "traceId": trace_id,
    }


def problem_response(status: int, code: str, detail: str, trace_id: str) -> JSONResponse:
    return JSONResponse(
        status_code=status,
        content=problem(status, code, detail, trace_id),
        media_type="application/problem+json",
    )


def http_code(status: int) -> str:
    return _CODES.get(status, "internal_error")


def trace_id_of(request: Request) -> str:
    return getattr(request.state, "request_id", "-")
