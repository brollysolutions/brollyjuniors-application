"""Library access regressions against PostgreSQL; all database changes roll back.

Run: python -B scripts/test_resources.py
Uses DATABASE_URL and applies the library migrations inside each test transaction.
"""
from __future__ import annotations

import io
import sys
import unittest
import uuid
from contextlib import asynccontextmanager
from pathlib import Path
from unittest.mock import patch
from urllib.parse import parse_qs, urlparse

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import asyncpg
from fastapi import UploadFile
from starlette.datastructures import Headers
from starlette.requests import Request

from app import db
from app.config import settings
from app.deps import _authenticate
from app.errors import HttpError
from app.media import media_signer
from app.routers import media, resources


class TestActor:
    def __init__(self, conn, user_id, role):
        self.conn, self.user_id, self.role = conn, str(user_id) if user_id else "", role

    @asynccontextmanager
    async def db(self):
        async with self.conn.transaction():
            await self.conn.execute("SET LOCAL ROLE brolly_app")
            await self.conn.execute("SELECT set_config('app.user_id', $1, true)", self.user_id)
            await self.conn.execute("SELECT set_config('app.role', $1, true)", self.role)
            yield db.Conn(self.conn)

    async def log_audit(self, *_):
        pass


class LibraryTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.conn = await asyncpg.connect(settings.database_url)
        await db._init_connection(self.conn)
        self.tx = self.conn.transaction()
        await self.tx.start()
        self.addAsyncCleanup(self.conn.close)
        self.addAsyncCleanup(self.rollback)
        if not await self.conn.fetchval("SELECT to_regclass('resource_recipient')"):
            migration = Path(__file__).resolve().parent.parent / "sql/008_resource_recipients.sql"
            await self.conn.execute(migration.read_text(encoding="utf-8"))
        migration = Path(__file__).resolve().parent.parent / "sql/009_resource_course_sharing.sql"
        await self.conn.execute(migration.read_text(encoding="utf-8"))
        self.admin = await self.user("BROLLY_ADMIN")
        self.student = await self.user("STUDENT")
        self.other = await self.user("STUDENT")
        self.teacher = await self.user("TEACHER")
        self.stranger = await self.user("TEACHER")
        self.anon = TestActor(self.conn, None, "ANON")
        self.asset_id = str(uuid.uuid4())
        self.key = "library-test/" + self.asset_id
        async with self.admin.db() as c:
            await c.execute("""INSERT INTO media_asset
                (id, sha256, storage_key, file_name, kind, mime_type, bytes, library_only)
                VALUES ($1::uuid,$1::text,$2,'test.txt','doc','text/plain',4,true)""", self.asset_id, self.key)

    async def rollback(self):
        await self.tx.rollback()

    async def user(self, role):
        uid = str(uuid.uuid4())
        await self.conn.execute("RESET ROLE")
        await self.conn.execute("""INSERT INTO app_user (id,email,password_hash,full_name)
            VALUES ($1,$2,'unused','Library test')""", uid, uid + "@test.invalid")
        await self.conn.execute("""INSERT INTO user_role (user_id,role_id)
            SELECT $1,id FROM role WHERE key=$2""", uid, role)
        return TestActor(self.conn, uid, role)

    async def create(self, recipients=None, category="notes", course_id=None):
        return await resources.create_resource(resources.ResourceBody(
            title="Private lesson material", category=category, mediaAssetId=self.asset_id,
            recipientIds=recipients, courseId=course_id,
        ), self.admin)

    async def edit(self, rid, recipients=None, course_id=None):
        return await resources.update_resource(rid, resources.ResourceBody(
            title="Updated material", mediaAssetId=self.asset_id, recipientIds=recipients, courseId=course_id,
        ), self.admin)

    async def denied(self, awaitable, status=404):
        with self.assertRaises(HttpError) as caught:
            await awaitable
        self.assertEqual(caught.exception.status, status)

    async def course(self):
        cid = str(uuid.uuid4())
        async with self.admin.db() as c:
            await c.execute("INSERT INTO subject (id, key, name) VALUES ($1,$2,'Library test subject')", cid, cid)
            await c.execute("""INSERT INTO course (id, subject_id, slug, title, status)
                VALUES ($1,$1,$2,'Library test course','published')""", cid, cid)
        return cid

    async def enroll(self, cid, actor):
        async with self.admin.db() as c:
            await c.execute("INSERT INTO enrollment (course_id,user_id) VALUES ($1,$2)", cid, actor.user_id)

    async def assign(self, cid, actor):
        async with self.admin.db() as c:
            await c.execute("INSERT INTO course_teacher (course_id,user_id) VALUES ($1,$2)", cid, actor.user_id)

    async def test_course_automatically_shares_and_excludes_outsiders(self):
        cid = await self.course()
        await self.enroll(cid, self.student)
        await self.assign(cid, self.teacher)
        created = await self.create([self.other.user_id], course_id=cid)
        rid = created["id"]
        self.assertEqual(created["visibleTo"], 2)
        for actor in (self.student, self.teacher):
            listing = await resources.list_resources(actor)
            self.assertIn(rid, [r["id"] for r in listing["resources"]])
            await resources.read_resource(rid, actor)
            with patch.object(resources.media_store, "open", return_value=Path(__file__)):
                await resources.download_resource(uuid.UUID(rid), actor)
        # Even a stale manual assignment cannot bypass course membership.
        async with self.admin.db() as c:
            await c.execute("INSERT INTO resource_recipient VALUES ($1,$2)", rid, self.other.user_id)
        for actor in (self.other, self.stranger, self.anon):
            await self.denied(resources.read_resource(rid, actor))
            await self.denied(resources.download_resource(uuid.UUID(rid), actor))
        listing = await resources.admin_list_resources(self.admin)
        row = next(r for r in listing["resources"] if r["id"] == rid)
        self.assertCountEqual(row["recipientIds"], [self.student.user_id, self.teacher.user_id])
        course = next(c for c in listing["courses"] if str(c["id"]) == cid)
        self.assertCountEqual(course["recipientIds"], row["recipientIds"])

    async def test_course_membership_changes_apply_immediately(self):
        cid = await self.course()
        rid = (await self.create(course_id=cid))["id"]
        await self.denied(resources.read_resource(rid, self.student))
        await self.enroll(cid, self.student)
        await self.assign(cid, self.teacher)
        await resources.read_resource(rid, self.student)
        await resources.read_resource(rid, self.teacher)
        async with self.admin.db() as c:
            await c.execute("UPDATE enrollment SET status='cancelled' WHERE course_id=$1", cid)
            await c.execute("DELETE FROM course_teacher WHERE course_id=$1", cid)
        for actor in (self.student, self.teacher):
            await self.denied(resources.read_resource(rid, actor))
            await self.denied(resources.download_resource(uuid.UUID(rid), actor))

    async def test_expired_and_inactive_enrolments_cannot_read(self):
        cid = await self.course()
        await self.enroll(cid, self.student)
        rid = (await self.create(course_id=cid))["id"]
        for status in ("cancelled", "expired", "completed"):
            async with self.admin.db() as c:
                await c.execute("UPDATE enrollment SET status=$1 WHERE course_id=$2", status, cid)
            await self.denied(resources.read_resource(rid, self.student))
        async with self.admin.db() as c:
            await c.execute("UPDATE enrollment SET status='active', expires_on=current_date-1 WHERE course_id=$1", cid)
        await self.denied(resources.download_resource(uuid.UUID(rid), self.student))
        async with self.admin.db() as c:
            await c.execute("UPDATE enrollment SET expires_on=current_date WHERE course_id=$1", cid)
        await resources.read_resource(rid, self.student)

    async def test_changing_course_and_clearing_course_drops_old_recipients(self):
        first, second = await self.course(), await self.course()
        await self.enroll(first, self.student)
        await self.enroll(second, self.other)
        rid = (await self.create([self.stranger.user_id]))["id"]
        await self.edit(rid, course_id=first)
        await self.denied(resources.read_resource(rid, self.stranger))
        await resources.read_resource(rid, self.student)
        await self.edit(rid, course_id=second)
        await self.denied(resources.download_resource(uuid.UUID(rid), self.student))
        await resources.read_resource(rid, self.other)
        await self.edit(rid)
        await self.denied(resources.read_resource(rid, self.other))
        await self.denied(resources.read_resource(rid, self.stranger))
        await self.edit(rid, [self.teacher.user_id])
        await resources.read_resource(rid, self.teacher)

    async def test_hidden_course_resource_and_deleted_course_are_private(self):
        cid = await self.course()
        await self.enroll(cid, self.student)
        rid = (await self.create(course_id=cid))["id"]
        await resources.set_resource_status(rid, resources.ResourceStatusBody(status="hidden"), self.admin)
        await self.denied(resources.download_resource(uuid.UUID(rid), self.student))
        await resources.set_resource_status(rid, resources.ResourceStatusBody(status="published"), self.admin)
        async with self.admin.db() as c:
            await c.execute("DELETE FROM course WHERE id=$1", cid)
        await self.denied(resources.read_resource(rid, self.student))
        self.assertIsNone((await resources.read_resource(rid, self.admin))["resource"]["courseId"])

    async def test_nonexistent_course_is_rejected(self):
        await self.denied(self.create(course_id=str(uuid.uuid4())), 400)

    async def test_kinds_round_trip(self):
        for category in ("syllabus", "textbook", "recording", "notes"):
            created = await self.create([self.student.user_id], category)
            row = (await resources.read_resource(created["id"], self.student))["resource"]
            self.assertEqual(row["category"], category)
            self.assertNotIn("recipientIds", row)
            self.assertEqual(row["file"]["url"], f"/resources/{created['id']}/file")

    async def test_only_selected_students_and_teachers_read(self):
        created = await self.create([self.student.user_id, self.teacher.user_id, self.student.user_id])
        rid = created["id"]
        self.assertEqual(created["visibleTo"], 2)
        for actor in (self.student, self.teacher, self.admin):
            self.assertEqual((await resources.read_resource(rid, actor))["resource"]["id"], rid)
        for actor in (self.other, self.stranger, self.anon):
            self.assertNotIn(rid, [r["id"] for r in (await resources.list_resources(actor))["resources"]])
            await self.denied(resources.read_resource(rid, actor))
            await self.denied(resources.download_resource(uuid.UUID(rid), actor))
        listing = await resources.admin_list_resources(self.admin)
        saved = next(r for r in listing["resources"] if r["id"] == rid)
        self.assertCountEqual(saved["recipientIds"], [self.student.user_id, self.teacher.user_id])

    async def test_no_selection_is_private(self):
        for recipients in (None, []):
            created = await self.create(recipients)
            self.assertEqual(created["visibleTo"], 0)
            await self.denied(resources.read_resource(created["id"], self.student))
            await resources.read_resource(created["id"], self.admin)

    async def test_download_and_immediate_revocation(self):
        rid = (await self.create([self.student.user_id]))["id"]
        with patch.object(resources.media_store, "open", return_value=Path(__file__)):
            response = await resources.download_resource(uuid.UUID(rid), self.student)
            self.assertEqual(response.headers["cache-control"], "private, no-store")
        await self.edit(rid, [self.other.user_id])
        await self.denied(resources.download_resource(uuid.UUID(rid), self.student))
        await resources.read_resource(rid, self.other)
        await self.edit(rid, [])
        await self.denied(resources.read_resource(rid, self.other))

    async def test_title_edit_preserves_recipients_when_omitted(self):
        rid = (await self.create([self.student.user_id]))["id"]
        await self.edit(rid)
        await resources.read_resource(rid, self.student)
        await self.denied(resources.read_resource(rid, self.other))

    async def test_hidden_and_deleted_resources_are_inaccessible(self):
        rid = (await self.create([self.student.user_id]))["id"]
        await resources.set_resource_status(rid, resources.ResourceStatusBody(status="hidden"), self.admin)
        await self.denied(resources.read_resource(rid, self.student))
        await self.denied(resources.download_resource(uuid.UUID(rid), self.student))
        await resources.read_resource(rid, self.admin)
        await resources.set_resource_status(rid, resources.ResourceStatusBody(status="published"), self.admin)
        await resources.read_resource(rid, self.student)
        await resources.delete_resource(rid, self.admin)
        await self.denied(resources.download_resource(uuid.UUID(rid), self.student))
        async with self.admin.db() as c:
            self.assertEqual(await c.value("SELECT count(*) FROM resource_recipient WHERE resource_id=$1", rid), 0)
            self.assertTrue(await c.value("SELECT library_only FROM media_asset WHERE id=$1", self.asset_id))

    async def test_invalid_recipients_rollback_changes(self):
        rid = (await self.create([self.student.user_id]))["id"]
        for uid in (str(uuid.uuid4()), self.admin.user_id):
            await self.denied(self.edit(rid, [uid]), 400)
            await resources.read_resource(rid, self.student)
        async with self.admin.db() as c:
            await c.execute("UPDATE app_user SET status='disabled' WHERE id=$1", self.other.user_id)
        await self.denied(self.edit(rid, [self.other.user_id]), 400)

    async def test_inactive_existing_recipient_can_be_retained_or_removed(self):
        rid = (await self.create([self.student.user_id]))["id"]
        async with self.admin.db() as c:
            await c.execute("UPDATE app_user SET status='disabled' WHERE id=$1", self.student.user_id)
        await self.edit(rid, [self.student.user_id])
        await self.edit(rid, [])
        await self.denied(self.edit(rid, [self.student.user_id]), 400)

    async def test_rls_prevents_self_assignment_and_recipient_disclosure(self):
        rid = (await self.create([self.student.user_id, self.teacher.user_id]))["id"]
        async with self.student.db() as c:
            rows = await c.query("SELECT user_id FROM resource_recipient WHERE resource_id=$1", rid)
            self.assertEqual([str(r["user_id"]) for r in rows], [self.student.user_id])
        with self.assertRaises(asyncpg.InsufficientPrivilegeError):
            async with self.other.db() as c:
                await c.execute("INSERT INTO resource_recipient VALUES ($1,$2)", rid, self.other.user_id)
        await self.denied(resources.read_resource(rid, self.other))

    async def test_old_signed_urls_cannot_bypass_library_access(self):
        rid = (await self.create([self.student.user_id]))["id"]
        url, _ = media_signer.sign(self.key, self.student.user_id, 900)
        query = parse_qs(urlparse(url).query)
        args = dict(storage_key=self.key, expires=int(query["expires"][0]),
                    sig=query["sig"][0], u=self.student.user_id)
        with patch.object(media.db, "anon", self.anon.db):
            await self.denied(media.serve_media(**args))
            await self.denied(media.head_media(**args))
            await resources.delete_resource(rid, self.admin)
            await self.denied(media.serve_media(**args))
            await self.denied(media.head_media(**args))

    async def test_regular_media_still_works(self):
        async with self.admin.db() as c:
            await c.execute("UPDATE media_asset SET library_only=false WHERE id=$1", self.asset_id)
        url, _ = media_signer.sign(self.key, self.student.user_id, 900)
        query = parse_qs(urlparse(url).query)
        args = dict(storage_key=self.key, expires=int(query["expires"][0]),
                    sig=query["sig"][0], u=self.student.user_id)
        with patch.object(media.db, "anon", self.anon.db), patch.object(media.media_store, "open", return_value=Path(__file__)):
            self.assertEqual((await media.serve_media(**args)).status_code, 200)
            self.assertEqual((await media.head_media(**args)).status_code, 200)
        await self.denied(self.create([self.student.user_id]), 400)

    async def test_uploads_are_private_and_deduplicate(self):
        def upload():
            return UploadFile(io.BytesIO(b"library regression fixture"), filename="notes.txt",
                              headers=Headers({"content-type": "text/plain"}))
        with patch.object(resources.media_store, "write"):
            first = await resources.upload_media(upload(), self.admin)
            second = await resources.upload_media(upload(), self.admin)
        self.assertEqual(first["id"], second["id"])
        self.assertTrue(second["deduplicated"])
        async with self.admin.db() as c:
            self.assertTrue(await c.value("SELECT library_only FROM media_asset WHERE id=$1", first["id"]))

    async def test_file_route_requires_authentication(self):
        request = Request({"type": "http", "headers": [], "method": "GET", "path": "/api/v1/resources/id/file"})
        await self.denied(_authenticate(request), 401)
        route = next(r for r in resources.router.routes if r.path.endswith("/{resource_id}/file"))
        self.assertTrue(route.dependant.dependencies)


if __name__ == "__main__":
    unittest.main(verbosity=2)
