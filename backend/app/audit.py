"""
Audit. Append-only; redaction is applied on write, by whitelist.

Redaction is a WHITELIST, not a blacklist. Only fields named here are ever
serialised into an audit row, so adding a `reset_token` column tomorrow cannot
silently start leaking it — which is exactly how blacklists fail.

Note what is absent: nothing payment-related beyond a provider reference and an
amount. Card data never reaches this process, so it cannot reach this log.
"""
from __future__ import annotations


from dataclasses import dataclass
from typing import Any

from .db import Conn

AUDITABLE: set[str] = {
    "id", "title", "name", "full_name", "email", "status", "slug", "level",
    "price_minor", "currency", "amount_minor", "provider", "provider_ref",
    "course_id", "module_id", "lesson_id", "role", "role_id", "score",
    "due_at", "starts_at", "ends_at", "meeting_url", "version_no", "release_no",
    "published_at", "feedback", "max_score", "duration_hours",
}


def _redact(obj: dict[str, Any] | None) -> dict[str, Any] | None:
    """Returns a dict, not a string: the jsonb codec in db.py does the encoding."""
    if not obj:
        return None
    out = {k: v for k, v in obj.items() if k in AUDITABLE}
    return out or None


@dataclass(slots=True)
class AuditEntry:
    action: str
    summary: str
    entity_type: str = ""
    entity_id: str | None = None
    before: dict[str, Any] | None = None
    after: dict[str, Any] | None = None


@dataclass(slots=True)
class Who:
    user_id: str | None
    role: str
    ip: str = ""
    ua: str = ""
    request_id: str = ""


async def audit(c: Conn, who: Who, entry: AuditEntry) -> None:
    await c.execute(
        """INSERT INTO audit_log (actor_user_id, actor_role, action, entity_type, entity_id,
                                  summary, before_data, after_data, ip, user_agent, request_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)""",
        who.user_id,
        who.role,
        entry.action,
        entry.entity_type or "",
        entry.entity_id,
        entry.summary,
        _redact(entry.before),
        _redact(entry.after),
        who.ip or "",
        (who.ua or "")[:250],
        who.request_id or "",
    )
