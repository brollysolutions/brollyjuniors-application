"""
The shared resource library.

Admins share resources with a course or selected individuals. PostgreSQL
row-level security checks current course membership on every read/download.

Both halves live here rather than in admin.py: the rule that makes writing and
reading different is the whole feature, and it is easier to see when the two
sides are a screen apart.
"""
from __future__ import annotations

import uuid
from typing import Any

from fastapi import APIRouter, Depends, File, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel

from ..audit import AuditEntry
from ..deps import Actor, requires
from ..errors import bad_request, not_found
from ..media import (
    UPLOAD_TYPES, media_store, sha256_bytes, storage_key_for,
)
from ..config import settings

router = APIRouter()

#: The shelf as the UI groups it. Free text in the column on purpose — a new
#: kind of thing to file should not be a migration — but the ones we offer are
#: fixed here so the filter chips mean something.
CATEGORIES = ("syllabus", "textbook", "recording", "notes", "handout", "policy", "link", "other")

MAX_TITLE = 200


class ResourceBody(BaseModel):
    title: str = ""
    description: str = ""
    category: str = "notes"
    courseId: uuid.UUID | None = None
    body: Any = None
    mediaAssetId: str | None = None
    externalUrl: str = ""
    position: int | None = None
    recipientIds: list[uuid.UUID] | None = None


class ResourceStatusBody(BaseModel):
    status: str = ""


def _clean_url(value: str) -> str:
    """
    A link the admin types is rendered into an href, so the scheme is checked
    before it is stored. `javascript:` in an href is script execution in every
    reader's browser, and the safest place to refuse it is the one place it can
    get in.
    """
    url = (value or "").strip()
    if not url:
        return ""
    if not url.lower().startswith(("http://", "https://")):
        raise bad_request("A link has to start with http:// or https://")
    return url[:2000]


def _fields(body: ResourceBody) -> dict[str, Any]:
    title = body.title.strip()
    if not title:
        raise bad_request("Give the resource a title.")
    if body.body is not None and not isinstance(body.body, list):
        raise bad_request("Notes must be a list of blocks.")
    category = (body.category or "notes").strip().lower()
    return {
        "title": title[:MAX_TITLE],
        "description": body.description.strip(),
        "category": category if category in CATEGORIES else "other",
        "course_id": body.courseId or None,
        "body": body.body if isinstance(body.body, list) else [],
        "media_asset_id": body.mediaAssetId or None,
        "external_url": _clean_url(body.externalUrl),
        "position": body.position or 0,
    }


#: Resource content and attachment metadata; file access uses an authenticated route.
SELECT_RESOURCE = """
    SELECT r.id, r.title, r.description, r.category, r.status, r.position,
           r.body, r.external_url, r.course_id, r.created_at, r.updated_at,
           c.title AS course,
           r.media_asset_id, ma.storage_key, ma.file_name, ma.mime_type,
           ma.bytes, ma.kind, ma.duration_ms, ma.visibility
      FROM resource r
      LEFT JOIN course c ON c.id = r.course_id
      LEFT JOIN media_asset ma ON ma.id = r.media_asset_id
"""


# Same active enrolment/teacher rules as the resource policy in migration 009.
# Used only by admins for recipient previews and counts, never to grant access.
COURSE_RECIPIENTS = """
    SELECT DISTINCT m.course_id, u.id AS user_id
      FROM (
        SELECT e.course_id, e.user_id, 'STUDENT' AS role FROM enrollment e
         WHERE e.status = 'active' AND (e.expires_on IS NULL OR e.expires_on >= current_date)
        UNION
        SELECT ct.course_id, ct.user_id, 'TEACHER' AS role FROM course_teacher ct
      ) m
      JOIN app_user u ON u.id = m.user_id
     WHERE u.status = 'active' AND u.deleted_at IS NULL
       AND EXISTS (SELECT 1 FROM user_role ur JOIN role r ON r.id = ur.role_id
                    WHERE ur.user_id = u.id AND r.key = m.role)
"""


async def _validate_course(c, course_id: uuid.UUID | None) -> None:
    if course_id and not await c.value("SELECT EXISTS (SELECT 1 FROM course WHERE id = $1)", course_id):
        raise bad_request("Select an existing course.")


def _shape(row: dict[str, Any]) -> dict[str, Any]:
    """One resource, with a usable link for its file if it has one."""
    file_info = None
    if row.get("storage_key"):
        file_info = {
            "fileName": row.get("file_name"),
            "mimeType": row.get("mime_type"),
            "bytes": row.get("bytes"),
            "kind": row.get("kind"),
            "url": f"/resources/{row['id']}/file",
        }
    return {
        "id": str(row["id"]),
        "title": row["title"],
        "description": row["description"],
        "category": row["category"],
        "status": row["status"],
        "body": row["body"],
        "externalUrl": row["external_url"],
        "courseId": str(row["course_id"]) if row["course_id"] else None,
        # Round-tripped so an edit that only changes the title does not
        # silently drop the attachment.
        "mediaAssetId": str(row["media_asset_id"]) if row["media_asset_id"] else None,
        "course": row.get("course"),
        "createdAt": row["created_at"],
        "updatedAt": row["updated_at"],
        "file": file_info,
    }


# ===========================================================================
# Reading - selected recipients and admins
# ===========================================================================

@router.get("/api/v1/resources")
async def list_resources(actor: Actor = Depends(requires("resource:read"))):
    async with actor.db() as c:
        # RLS checks current course membership or an explicit recipient selection.
        rows = await c.query(SELECT_RESOURCE + """
             WHERE r.status = 'published'
             ORDER BY r.position, r.created_at DESC""")
        return {
            "resources": [_shape(r) for r in rows],
            "categories": list(CATEGORIES),
        }


@router.get("/api/v1/resources/{resource_id}")
async def read_resource(resource_id: str, actor: Actor = Depends(requires("resource:read"))):
    async with actor.db() as c:
        row = await c.one(SELECT_RESOURCE + " WHERE r.id = $1", resource_id)
        if row is None or (row["status"] != "published" and actor.role != "BROLLY_ADMIN"):
            raise not_found("No such resource.")
        return {"resource": _shape(row)}


@router.get("/api/v1/resources/{resource_id}/file")
async def download_resource(
    resource_id: uuid.UUID, actor: Actor = Depends(requires("resource:read")),
):
    # Use the current session and RLS on every download, including after a
    # recipient is removed or a resource is hidden. No transferable media URL.
    async with actor.db() as c:
        row = await c.one(SELECT_RESOURCE + " WHERE r.id = $1", resource_id)
        if row is None or not row.get("storage_key"):
            raise not_found("No such resource file.")
    path = media_store.open(row["storage_key"])
    if path is None:
        raise not_found("This file has not been uploaded yet.")
    return FileResponse(
        path, media_type=row["mime_type"] or "application/octet-stream",
        filename=row["file_name"], content_disposition_type="inline",
        headers={"Cache-Control": "private, no-store"},
    )


async def _set_recipients(c, resource_id: str, recipients: list[uuid.UUID]) -> None:
    ids = list(dict.fromkeys(recipients))
    valid = await c.value("""
        SELECT count(*) FROM app_user u
         WHERE u.id = ANY($1::uuid[]) AND (
           (u.deleted_at IS NULL AND u.status = 'active') OR EXISTS (
             SELECT 1 FROM resource_recipient rr WHERE rr.resource_id = $2 AND rr.user_id = u.id
           ))
           AND EXISTS (SELECT 1 FROM user_role ur JOIN role r ON r.id = ur.role_id
                        WHERE ur.user_id = u.id AND r.key IN ('TEACHER', 'STUDENT'))
    """, ids, resource_id)
    if valid != len(ids):
        raise bad_request("Select active teachers or students as recipients.")
    await c.execute("DELETE FROM resource_recipient WHERE resource_id = $1", resource_id)
    await c.execute("""
        INSERT INTO resource_recipient (resource_id, user_id)
        SELECT $1::uuid, unnest($2::uuid[])
    """, resource_id, ids)


async def _validate_attachment(c, asset_id: str | None) -> None:
    if not asset_id:
        return
    row = await c.one("""
        SELECT id FROM media_asset WHERE id = $1 AND library_only
    """, asset_id)
    if row is None:
        raise bad_request("Upload this file through the shared library before attaching it.")


# ===========================================================================
# Managing — Brolly Admin alone
# ===========================================================================

@router.get("/api/v1/admin/resources")
async def admin_list_resources(actor: Actor = Depends(requires("resource:manage"))):
    async with actor.db() as c:
        rows = await c.query(SELECT_RESOURCE + " ORDER BY r.position, r.created_at DESC")
        course_recipients: dict[str, list[str]] = {}
        for member in await c.query(COURSE_RECIPIENTS):
            course_recipients.setdefault(str(member["course_id"]), []).append(str(member["user_id"]))
        courses = await c.query("SELECT id, title FROM course ORDER BY title")
        assignments = await c.query("SELECT resource_id, user_id FROM resource_recipient")
        recipients_by_resource: dict[str, list[str]] = {}
        for assignment in assignments:
            recipients_by_resource.setdefault(str(assignment["resource_id"]), []).append(str(assignment["user_id"]))
        return {
            "resources": [{**_shape(r), "recipientIds": (course_recipients.get(str(r["course_id"]), []) if r["course_id"]
                                                       else recipients_by_resource.get(str(r["id"]), []))} for r in rows],
            "recipients": await c.query("""
                SELECT u.id, u.full_name AS name, u.email, r.key AS role,
                       CASE WHEN u.deleted_at IS NOT NULL THEN 'disabled' ELSE u.status END AS status
                  FROM app_user u JOIN user_role ur ON ur.user_id = u.id
                  JOIN role r ON r.id = ur.role_id
                 WHERE r.key IN ('TEACHER', 'STUDENT') AND (u.deleted_at IS NULL OR EXISTS (
                   SELECT 1 FROM resource_recipient rr WHERE rr.user_id = u.id))
                 ORDER BY u.full_name, u.email
            """),
            "categories": list(CATEGORIES),
            "courses": [{**course, "recipientIds": course_recipients.get(str(course["id"]), [])} for course in courses],
        }


@router.post("/api/v1/admin/resources")
async def create_resource(
    body: ResourceBody, actor: Actor = Depends(requires("resource:manage"))
):
    f = _fields(body)
    resource_id = str(uuid.uuid4())
    async with actor.db() as c:
        await _validate_course(c, f["course_id"])
        await _validate_attachment(c, f["media_asset_id"])
        await c.execute(
            """INSERT INTO resource (id, title, description, category, course_id, body,
                                     media_asset_id, external_url, position, status, created_by)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'published',$10)""",
            resource_id, f["title"], f["description"], f["category"], f["course_id"],
            f["body"], f["media_asset_id"], f["external_url"], f["position"], actor.user_id,
        )
        # A course selection replaces manual sharing, including stale selections.
        selected = [] if f["course_id"] else body.recipientIds or []
        await _set_recipients(c, resource_id, selected)
        visible_to = len(set(selected))
        if f["course_id"]:
            visible_to = len(await c.query(COURSE_RECIPIENTS + " AND m.course_id = $1", f["course_id"]))
        await actor.log_audit(c, AuditEntry(
            action="resource.created", entity_type="resource", entity_id=resource_id,
            summary=f'Added "{f["title"]}" to the shared library',
            after={"title": f["title"], "status": "published", "recipientIds": selected},
        ))
        return {"id": resource_id, "visibleTo": visible_to}


@router.patch("/api/v1/admin/resources/{resource_id}")
async def update_resource(
    resource_id: str, body: ResourceBody, actor: Actor = Depends(requires("resource:manage"))
):
    f = _fields(body)
    async with actor.db() as c:
        before = await c.one("SELECT title, status FROM resource WHERE id = $1 FOR UPDATE", resource_id)
        if before is None:
            raise not_found("No such resource.")
        await _validate_course(c, f["course_id"])
        await _validate_attachment(c, f["media_asset_id"])
        if f["course_id"] or body.recipientIds is not None:
            await _set_recipients(c, resource_id, [] if f["course_id"] else body.recipientIds)
        await c.execute(
            """UPDATE resource SET title = $1, description = $2, category = $3, course_id = $4,
                      body = $5, media_asset_id = $6, external_url = $7, position = $8,
                      updated_at = now()
                WHERE id = $9""",
            f["title"], f["description"], f["category"], f["course_id"], f["body"],
            f["media_asset_id"], f["external_url"], f["position"], resource_id,
        )
        await actor.log_audit(c, AuditEntry(
            action="resource.updated", entity_type="resource", entity_id=resource_id,
            summary=f'Updated "{f["title"]}" in the shared library',
            before=before, after={"title": f["title"], "recipientIds": body.recipientIds},
        ))
        return {"ok": True}


@router.post("/api/v1/admin/resources/{resource_id}/status")
async def set_resource_status(
    resource_id: str, body: ResourceStatusBody,
    actor: Actor = Depends(requires("resource:manage")),
):
    if body.status not in ("published", "hidden"):
        raise bad_request("A resource is either published or hidden.")
    async with actor.db() as c:
        before = await c.one("SELECT title, status FROM resource WHERE id = $1", resource_id)
        if before is None:
            raise not_found("No such resource.")
        await c.execute(
            "UPDATE resource SET status = $1, updated_at = now() WHERE id = $2",
            body.status, resource_id,
        )
        await actor.log_audit(c, AuditEntry(
            action="resource.published" if body.status == "published" else "resource.hidden",
            entity_type="resource", entity_id=resource_id,
            summary=f'"{before["title"]}" → {body.status}',
            before=before, after={"status": body.status},
        ))
        return {"ok": True, "status": body.status}


@router.delete("/api/v1/admin/resources/{resource_id}")
async def delete_resource(
    resource_id: str, actor: Actor = Depends(requires("resource:manage"))
):
    async with actor.db() as c:
        before = await c.one("SELECT title FROM resource WHERE id = $1", resource_id)
        if before is None:
            raise not_found("No such resource.")
        # The row goes; the uploaded file stays. Bytes are content-addressed and
        # may be shared with another resource, so deleting them here could pull
        # a file out from under something else that still points at it.
        await c.execute("DELETE FROM resource WHERE id = $1", resource_id)
        await actor.log_audit(c, AuditEntry(
            action="resource.deleted", entity_type="resource", entity_id=resource_id,
            summary=f'Removed "{before["title"]}" from the shared library',
            before=before,
        ))
        return {"ok": True}


# ---------------------------------------------------------------------------
# Upload
# ---------------------------------------------------------------------------

@router.post("/api/v1/admin/media/upload")
async def upload_media(
    file: UploadFile = File(...), actor: Actor = Depends(requires("media:upload"))
):
    """
    Take a file and record it.

    The bytes are hashed and stored under that hash, so uploading the same
    document twice costs one copy and every link to it stays valid forever.
    """
    mime = (file.content_type or "").split(";")[0].strip().lower()
    kind = UPLOAD_TYPES.get(mime)
    if kind is None:
        raise bad_request(
            f"{mime or 'That file type'} is not one this library accepts. "
            "PDFs, images, Office documents, plain text, mp4 and mp3 are."
        )

    # Read in chunks and stop at the cap rather than after it: a caller that
    # lies about Content-Length should not be able to fill the disk.
    chunks: list[bytes] = []
    total = 0
    while True:
        chunk = await file.read(1 << 20)
        if not chunk:
            break
        total += len(chunk)
        if total > settings.media_max_upload_bytes:
            raise bad_request(
                f"That file is larger than {settings.media_max_upload_bytes // (1024 * 1024)} MB. "
                "Link to it instead, or split it up."
            )
        chunks.append(chunk)

    data = b"".join(chunks)
    if not data:
        raise bad_request("That file is empty.")

    file_name = (file.filename or "file").strip()[:200]
    # Separate the library deduplication namespace from course/public assets.
    digest = sha256_bytes(b"brolly-library\0" + data)
    key = storage_key_for(digest, file_name)

    async with actor.db() as c:
        existing = await c.one(
            "SELECT id, storage_key, file_name FROM media_asset WHERE sha256 = $1", digest
        )
        if existing:
            # Same bytes already here under whatever name they were first given.
            # Make sure they are actually on disk (a metadata-only row from the
            # seed has none) and reuse the row.
            await _validate_attachment(c, str(existing["id"]))
            media_store.write(existing["storage_key"], data)
            return {
                "id": str(existing["id"]), "fileName": existing["file_name"],
                "bytes": total, "kind": kind, "mimeType": mime, "deduplicated": True,
            }

        # Disk first: a row pointing at bytes that were never written is worse
        # than bytes nothing points at, which are merely wasted space.
        media_store.write(key, data)
        asset_id = str(uuid.uuid4())
        await c.execute(
            """INSERT INTO media_asset (id, sha256, storage_key, file_name, kind, mime_type,
                                        bytes, visibility, uploaded_by, library_only)
               VALUES ($1,$2,$3,$4,$5,$6,$7,'protected',$8,true)""",
            asset_id, digest, key, file_name, kind, mime, total, actor.user_id,
        )
        await actor.log_audit(c, AuditEntry(
            action="media.uploaded", entity_type="media_asset", entity_id=asset_id,
            summary=f"Uploaded {file_name} ({total // 1024} KB)",
        ))
        return {
            "id": asset_id, "fileName": file_name, "bytes": total,
            "kind": kind, "mimeType": mime, "deduplicated": False,
        }
