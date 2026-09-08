"""
Seed: the Brolly Juniors catalogue, four teachers, 180 students, and enough
real activity that every dashboard number is computed rather than written down.

Demo passwords are uniform so the seed runs in seconds rather than minutes. In
production every password gets its own salt — that is what hash_password() does
on each call.

The generator is the same seeded LCG the previous build used, so the same
distribution of paces, scores and attendance comes out the other side.
"""
from __future__ import annotations

import asyncio
import json
import sys
import time
import uuid
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import asyncpg  # noqa: E402

from app.config import settings  # noqa: E402
from app.core.passwords import hash_password, sha256  # noqa: E402
from app.shared.access import PERMISSIONS, ROLES  # noqa: E402

SEED_DATA = Path(__file__).resolve().parent.parent / "seed_data"

DEMO_PW = "brolly"
STUDENT_PW = "learn"

# --- deterministic generator ------------------------------------------------
_s = 20260906


def rnd() -> float:
    global _s
    _s = (_s * 1103515245 + 12345) & 0x7FFFFFFF
    return _s / 0x7FFFFFFF


def pick(items: list) -> Any:
    return items[int(rnd() * len(items))]


def rint(lo: int, hi: int) -> int:
    return lo + int(rnd() * (hi - lo + 1))


def chance(pct: float) -> bool:
    return rnd() * 100 < pct


FIRST = ["Aarav", "Divya", "Karthik", "Sana", "Rahul", "Meghana", "Ishaan", "Ananya", "Vikram", "Priya",
         "Rohan", "Nisha", "Arjun", "Aditya", "Kavya", "Manish", "Pooja", "Siddharth", "Lakshmi", "Tanvi",
         "Harsha", "Neha", "Varun", "Shreya", "Nikhil", "Deepa", "Sanjay", "Ritu", "Akhil", "Bhavya",
         "Farhan", "Gayatri", "Imran", "Jyoti", "Kiran", "Madhu", "Naveen", "Ojas", "Riya", "Zoya"]
LAST = ["Reddy", "Rao", "Sharma", "Fatima", "Verma", "Prasad", "Kumar", "Nair", "Iyer", "Gupta",
        "Menon", "Chowdary", "Naidu", "Joshi", "Patel", "Das", "Bose", "Shetty", "Pillai", "Varma"]

NOW = datetime.now(timezone.utc)


def days_ago(d: float) -> datetime:
    return NOW - timedelta(days=d)


def days_ahead(d: float) -> datetime:
    return NOW + timedelta(days=d)


def uid() -> str:
    return str(uuid.uuid4())


def dec(v: Any) -> Decimal | None:
    return None if v is None else Decimal(str(v))


async def insert_many(
    c: asyncpg.Connection, table: str, cols: list[str], rows: list[list], chunk: int = 140
) -> None:
    if not rows:
        return
    for i in range(0, len(rows), chunk):
        slice_ = rows[i:i + chunk]
        params: list[Any] = []
        tuples = []
        for r in slice_:
            placeholders = []
            for v in r:
                params.append(v)
                placeholders.append(f"${len(params)}")
            tuples.append("(" + ",".join(placeholders) + ")")
        await c.execute(
            f"INSERT INTO {table} ({','.join(cols)}) VALUES {','.join(tuples)}", *params
        )


async def seed(c: asyncpg.Connection) -> None:
    courses_spec = json.loads((SEED_DATA / "courses.json").read_text(encoding="utf-8"))

    staff_hash = hash_password(DEMO_PW)
    student_hash = hash_password(STUDENT_PW)

    # =======================================================================
    # 1. Roles and permissions
    # =======================================================================
    await insert_many(c, "permission", ["key", "description", "feature_key"],
                      [[p["key"], p["description"], p.get("feature")] for p in PERMISSIONS])

    role_ids: dict[str, str] = {}
    for key, d in ROLES.items():
        rid = uid()
        role_ids[key] = rid
        await c.execute("INSERT INTO role (id, key, name, level) VALUES ($1,$2,$3,$4)",
                        rid, key, d["name"], d["level"])
        await insert_many(c, "role_permission", ["role_id", "permission_key"],
                          [[rid, p] for p in d["permissions"]])
    print(f"  roles {len(role_ids)} · permissions {len(PERMISSIONS)}")

    # =======================================================================
    # 2. People — three roles, no school anywhere
    # =======================================================================
    async def mk_user(email: str, name: str, role: str, pw: str,
                      phone: str = "+91 98••• •••••", last_login: datetime | None = None) -> str:
        uid_ = uid()
        await c.execute(
            """INSERT INTO app_user (id, email, password_hash, full_name, phone, status,
                                     email_verified, last_login_at)
               VALUES ($1,$2,$3,$4,$5,'active',$6,$7)""",
            uid_, email, pw, name, phone, True,
            last_login if last_login is not None else days_ago(rint(0, 3)))
        await c.execute("INSERT INTO user_role (user_id, role_id) VALUES ($1,$2)", uid_, role_ids[role])
        return uid_

    admin_id = await mk_user("admin@brollyjuniors.com", "Brolly Admin", "BROLLY_ADMIN",
                             staff_hash, last_login=days_ago(0))

    TEACHERS = [
        {"email": "sneha.reddy@brollyjuniors.com", "name": "Sneha Reddy",
         "headline": "Python & AI educator",
         "bio": "Ten years teaching programming to teenagers. Believes nobody learns to code by watching someone else code.",
         "expertise": ["Python", "Data literacy"], "years": 10},
        {"email": "ramesh.kumar@brollyjuniors.com", "name": "Ramesh Kumar",
         "headline": "Software engineer turned teacher",
         "bio": "Built payment systems for eight years, then discovered he preferred explaining them.",
         "expertise": ["Python", "Web basics"], "years": 8},
        {"email": "anita.menon@brollyjuniors.com", "name": "Anita Menon",
         "headline": "AI and data science",
         "bio": "Research background in machine learning; teaches AI without the arm-waving.",
         "expertise": ["Artificial Intelligence", "Statistics"], "years": 6},
        {"email": "vikram.joshi@brollyjuniors.com", "name": "Vikram Joshi",
         "headline": "Live class specialist",
         "bio": "Runs the evening live sessions. Known for answering the question a student was too shy to ask.",
         "expertise": ["Python", "Artificial Intelligence"], "years": 5},
    ]
    teacher_ids: dict[str, str] = {}
    for t in TEACHERS:
        tid = await mk_user(t["email"], t["name"], "TEACHER", staff_hash)
        teacher_ids[t["name"]] = tid
        await c.execute(
            "INSERT INTO teacher_profile (user_id, headline, bio, expertise, years_exp) VALUES ($1,$2,$3,$4,$5)",
            tid, t["headline"], t["bio"], t["expertise"], t["years"])
    print(f"  1 admin · {len(TEACHERS)} teachers")

    # =======================================================================
    # 3. Catalogue
    # =======================================================================
    subject_ids: dict[str, str] = {}
    for key, name, blurb in [
        ("python", "Python", "The language most people should learn first."),
        ("ai", "Artificial Intelligence", "How machines learn from data, and where that goes wrong."),
    ]:
        sid = uid()
        subject_ids[key] = sid
        await c.execute("INSERT INTO subject (id, key, name, blurb) VALUES ($1,$2,$3,$4)",
                        sid, key, name, blurb)

    built: list[dict[str, Any]] = []

    for spec in courses_spec:
        course_id = uid()
        await c.execute(
            """INSERT INTO course (id, subject_id, slug, title, subtitle, description, outcomes,
                                   requirements, level, age_range, duration_hours, price_minor,
                                   status, published_at)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'published',$13)""",
            course_id, subject_ids[spec["subject"]], spec["slug"], spec["title"], spec["subtitle"],
            spec["description"], spec["outcomes"], spec["requirements"], spec["level"],
            spec["ageRange"], spec["durationHours"], spec["priceMinor"], days_ago(90))

        # A course has one or more teachers. This join is the whole of the
        # student/teacher relationship, one hop removed.
        teachers = (["Sneha Reddy", "Ramesh Kumar", "Vikram Joshi"]
                    if spec["subject"] == "python" else ["Anita Menon", "Vikram Joshi"])
        await insert_many(c, "course_teacher", ["course_id", "user_id", "role"],
                          [[course_id, teacher_ids[n], "lead" if i == 0 else "assistant"]
                           for i, n in enumerate(teachers)])

        module_ids: list[str] = []
        lesson_ids: list[str] = []
        exercise_ids: list[str] = []
        content_items: list[list] = []
        content_versions: list[list] = []

        for mi, m in enumerate(spec["modules"]):
            module_id = uid()
            module_ids.append(module_id)
            await c.execute(
                "INSERT INTO module (id, course_id, position, title, summary) VALUES ($1,$2,$3,$4,$5)",
                module_id, course_id, mi + 1, m["title"], m["summary"])

            for li, l in enumerate(m["lessons"]):
                item_id = uid()
                body = l["body"]
                content_items.append([item_id, f'lesson:{spec["slug"]}:{mi}:{li}', "lesson",
                                      l["title"], course_id])
                content_versions.append([uid(), item_id, 1, "en", "published", body,
                                         sha256(json.dumps(body, separators=(",", ":"))),
                                         "First published edition", admin_id, days_ago(90)])

                lesson_id = uid()
                lesson_ids.append(lesson_id)
                await c.execute(
                    """INSERT INTO lesson (id, module_id, position, title, est_minutes, content_item_id)
                       VALUES ($1,$2,$3,$4,$5,$6)""",
                    lesson_id, module_id, li + 1, l["title"], l["minutes"], item_id)

                for ei, ex in enumerate(l.get("exercises") or []):
                    ex_id = uid()
                    exercise_ids.append(ex_id)
                    await c.execute(
                        """INSERT INTO exercise (id, lesson_id, position, title, level, brief,
                                                 starter_code, hints, solution, test_cases)
                           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)""",
                        ex_id, lesson_id, ei, ex["title"], ex["level"], ex["brief"], ex["starter"],
                        ex["hints"], ex["solution"], ex["tests"])

        # Lesson bodies land before anything references them.
        await insert_many(c, "content_item", ["id", "key", "content_type", "title", "course_id"],
                          content_items)
        await insert_many(c, "content_version",
                          ["id", "content_item_id", "version_no", "locale", "status", "body",
                           "body_hash", "changelog", "created_by", "published_at"],
                          content_versions)

        # --- textbook ------------------------------------------------------
        tb = spec["textbook"]
        textbook_id = uid()
        await c.execute("INSERT INTO textbook (id, course_id, slug, title, edition) VALUES ($1,$2,$3,$4,$5)",
                        textbook_id, course_id, tb["slug"], tb["title"], tb["edition"])
        section_count = 0
        for ci, ch in enumerate(tb["chapters"]):
            chapter_id = uid()
            await c.execute("INSERT INTO chapter (id, textbook_id, position, title) VALUES ($1,$2,$3,$4)",
                            chapter_id, textbook_id, ci + 1, ch["title"])
            for si, sec in enumerate(ch["sections"]):
                section_count += 1
                item_id = uid()
                body = sec["body"]
                await c.execute(
                    "INSERT INTO content_item (id, key, content_type, title, course_id) VALUES ($1,$2,$3,$4,$5)",
                    item_id, f'section:{tb["slug"]}:{ci}:{si}', "section", sec["title"], course_id)
                await c.execute(
                    """INSERT INTO content_version (id, content_item_id, version_no, locale, status,
                                                    body, body_hash, changelog, created_by, published_at)
                       VALUES ($1,$2,1,'en','published',$3,$4,'First published edition',$5,$6)""",
                    uid(), item_id, body, sha256(json.dumps(body, separators=(",", ":"))),
                    admin_id, days_ago(90))
                await c.execute(
                    "INSERT INTO section (id, chapter_id, position, title, content_item_id) VALUES ($1,$2,$3,$4,$5)",
                    uid(), chapter_id, si + 1, sec["title"], item_id)

        # The pointer. Publishing later flips this in one transaction.
        await c.execute(
            """INSERT INTO content_release (id, scope, scope_id, release_no, status, manifest,
                                            published_by, published_at)
               VALUES ($1,'course',$2,1,'published',$3,$4,$5)""",
            uid(), course_id,
            {"course": spec["slug"], "modules": len(spec["modules"]),
             "lessons": len(lesson_ids), "sections": section_count},
            admin_id, days_ago(90))

        # --- quizzes -------------------------------------------------------
        quiz_ids: list[str] = []
        for q in spec["quizzes"]:
            quiz_id = uid()
            quiz_ids.append(quiz_id)
            await c.execute(
                """INSERT INTO quiz (id, course_id, module_id, title, description, pass_mark_pct,
                                     time_limit_min, max_attempts)
                   VALUES ($1,$2,$3,$4,$5,$6,15,3)""",
                quiz_id, course_id, module_ids[q["moduleIndex"]], q["title"], q["description"],
                q["passMark"])
            await insert_many(c, "question",
                              ["id", "quiz_id", "position", "kind", "text", "options",
                               "answer_index", "explanation", "marks", "topic"],
                              [[uid(), quiz_id, i + 1, "mcq", qq["text"], qq["options"],
                                qq["answer"], qq["explanation"], 1, qq["topic"]]
                               for i, qq in enumerate(q["questions"])])

        # --- media, materials, recordings ----------------------------------
        material_ids: list[str] = []
        for i, m in enumerate(spec["materials"]):
            sha = sha256(f'{spec["slug"]}:material:{i}')
            media_id = uid()
            safe = "".join(ch if ch.isalnum() else "-" for ch in m["title"].lower()).strip("-")
            await c.execute(
                """INSERT INTO media_asset (id, sha256, storage_key, file_name, kind, mime_type,
                                            bytes, visibility, uploaded_by)
                   VALUES ($1,$2,$3,$4,$5,$6,$7,'protected',$8)""",
                media_id, sha, f"media/{sha[:2]}/{sha}/{safe}.pdf", f'{m["title"]}.pdf',
                "code" if m["kind"] == "code" else "pdf",
                "text/x-python" if m["kind"] == "code" else "application/pdf",
                rint(80_000, 2_400_000), admin_id)
            mat_id = uid()
            material_ids.append(mat_id)
            await c.execute(
                """INSERT INTO learning_material (id, course_id, module_id, position, title,
                                                  description, kind, media_asset_id)
                   VALUES ($1,$2,$3,$4,$5,$6,$7,$8)""",
                mat_id, course_id,
                module_ids[m["moduleIndex"]] if m.get("moduleIndex") is not None else None,
                i, m["title"], m["description"], m["kind"], media_id)

        recording_ids: list[str] = []
        for i, r in enumerate(spec["recordings"]):
            sha = sha256(f'{spec["slug"]}:recording:{i}')
            media_id = uid()
            await c.execute(
                """INSERT INTO media_asset (id, sha256, storage_key, file_name, kind, mime_type,
                                            bytes, duration_ms, visibility, uploaded_by)
                   VALUES ($1,$2,$3,$4,'video','video/mp4',$5,$6,'protected',$7)""",
                media_id, sha, f"media/{sha[:2]}/{sha}/recording-{i + 1}.mp4",
                f'{r["title"]}.mp4', r["minutes"] * 8_000_000, r["minutes"] * 60_000, admin_id)
            rec_id = uid()
            recording_ids.append(rec_id)
            await c.execute(
                """INSERT INTO recording (id, course_id, module_id, position, title, description,
                                          duration_seconds, media_asset_id, status, recorded_on)
                   VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'published',$9)""",
                rec_id, course_id, module_ids[r["moduleIndex"]], i, r["title"], r["description"],
                r["minutes"] * 60, media_id, days_ago(60 - i * 7).date())

        built.append({
            "spec": spec, "course_id": course_id, "module_ids": module_ids,
            "lesson_ids": lesson_ids, "exercise_ids": exercise_ids, "quiz_ids": quiz_ids,
            "recording_ids": recording_ids, "material_ids": material_ids,
        })
        print(f'  {spec["title"]}: {len(module_ids)} modules · {len(lesson_ids)} lessons · '
              f'{len(exercise_ids)} exercises · {len(quiz_ids)} quizzes · '
              f'{len(recording_ids)} recordings')

    # =======================================================================
    # 4. Live sessions — past and upcoming
    # =======================================================================
    for b in built:
        subject = b["spec"]["subject"]
        hosts = ([teacher_ids["Sneha Reddy"], teacher_ids["Vikram Joshi"]] if subject == "python"
                 else [teacher_ids["Anita Menon"], teacher_ids["Vikram Joshi"]])
        titles = (["Week 4 live class — lists in practice",
                   "Week 5 live class — building a small project",
                   "Doubt-clearing session", "Week 3 live class — loops"] if subject == "python"
                  else ["Week 3 live class — describing a dataset",
                        "Week 5 live class — evaluating a model",
                        "Ethics discussion", "Week 2 live class — cleaning data"])
        offsets = [2, 6, 9, -5]   # negative = already happened
        for i, title in enumerate(titles):
            sid = uid()
            start = days_ahead(offsets[i]) if offsets[i] > 0 else days_ago(-offsets[i])
            end = start + timedelta(hours=1)
            await c.execute(
                """INSERT INTO live_session (id, course_id, module_id, teacher_id, title, description,
                                             starts_at, ends_at, provider, meeting_url, capacity,
                                             status, created_by)
                   VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'manual',$9,60,$10,$11)""",
                sid, b["course_id"], b["module_ids"][min(i, len(b["module_ids"]) - 1)],
                hosts[i % len(hosts)], title,
                "Bring your questions. The recording appears here afterwards.",
                start, end, f"https://meet.brollyjuniors.com/{sid[:8]}",
                "scheduled" if offsets[i] > 0 else "ended", admin_id)

    # =======================================================================
    # 5. Assignments
    # =======================================================================
    RUBRIC = [
        {"key": "correct", "label": "Does what was asked", "max": 4},
        {"key": "approach", "label": "Sensible approach", "max": 3},
        {"key": "readable", "label": "Readable and commented", "max": 2},
        {"key": "ontime", "label": "Submitted on time", "max": 1},
    ]
    assignment_ids: dict[str, list[str]] = {}
    for b in built:
        ids: list[str] = []
        subject = b["spec"]["subject"]
        specs = ([("Build a marks calculator",
                   "Write a program that asks for five marks, then prints the total, the average rounded to two decimal places, and the highest.", 0),
                  ("Number guessing game",
                   "The computer picks a number from 1 to 50. The player guesses; you tell them higher or lower until they get it. Use a while loop.", 2)]
                 if subject == "python" else
                 [("Clean the travel survey",
                   "Take the sample dataset, remove impossible and missing values, and report how many rows you dropped and why.", 1),
                  ("Find the bias",
                   "Pick one AI system you use. Describe what data it likely learned from, and name one group it might work worse for.", 3)])
        for title, instructions, mi in specs:
            aid = uid()
            ids.append(aid)
            await c.execute(
                """INSERT INTO assignment (id, course_id, module_id, created_by, title, instructions,
                                           rubric, max_score, due_at, status, created_at)
                   VALUES ($1,$2,$3,$4,$5,$6,$7,10,$8,'published',$9)""",
                aid, b["course_id"], b["module_ids"][mi],
                teacher_ids["Sneha Reddy"] if subject == "python" else teacher_ids["Anita Menon"],
                title, [{"type": "paragraph", "text": instructions}], RUBRIC,
                days_ahead(rint(3, 12)), days_ago(rint(5, 20)))
        assignment_ids[b["course_id"]] = ids

    # =======================================================================
    # 6. Students, orders, enrolments and activity
    # =======================================================================
    NAMED = [
        {"name": "Aarav Reddy", "email": "aarav@example.com",
         "courses": ["python-foundations", "ai-for-beginners"], "pace": 0.62, "active": 0},
        {"name": "Divya Rao", "email": "divya@example.com",
         "courses": ["python-foundations"], "pace": 0.95, "active": 0},
        {"name": "Karthik M", "email": "karthik@example.com",
         "courses": ["python-foundations"], "pace": 0.14, "active": 11},
        {"name": "Sana Fatima", "email": "sana@example.com",
         "courses": ["ai-for-beginners"], "pace": 0.71, "active": 1},
    ]

    user_rows: list[list] = []
    role_rows: list[list] = []
    prof_rows: list[list] = []
    order_rows: list[list] = []
    enrol_rows: list[list] = []
    prog_rows: list[list] = []
    students: list[dict[str, Any]] = []

    by_slug = {b["spec"]["slug"]: b for b in built}

    def add_student(name: str, email: str, course_slugs: list[str], pace: float, active_days: int) -> str:
        sid = uid()
        user_rows.append([sid, email, student_hash, name, "active", True,
                          None if active_days > 40 else days_ago(active_days)])
        role_rows.append([sid, role_ids["STUDENT"]])
        prof_rows.append([sid, pick(["Class 8", "Class 9", "Class 10", "Class 11"]),
                          f"{pick(LAST)} (parent)", f"parent.{email}", "+91 98••• •••••",
                          "guardian_given" if chance(70) else "adult"])
        students.append({"id": sid, "name": name, "courses": course_slugs,
                         "pace": pace, "active": active_days})
        return sid

    for n in NAMED:
        add_student(n["name"], n["email"], n["courses"], n["pace"], n["active"])

    # 176 more, so the dashboards have a real distribution to report on
    for i in range(176):
        name = f"{pick(FIRST)} {pick(LAST)}"
        email = f"student{i + 1}@example.com"
        courses = (["python-foundations", "ai-for-beginners"] if chance(22)
                   else ["python-foundations"] if chance(65) else ["ai-for-beginners"])
        add_student(name, email, courses, max(0.02, min(1, rnd() * 1.15)),
                    rint(0, 6) if chance(64) else rint(8, 60))

    await insert_many(c, "app_user",
                      ["id", "email", "password_hash", "full_name", "status", "email_verified",
                       "last_login_at"], user_rows)
    await insert_many(c, "user_role", ["user_id", "role_id"], role_rows)
    await insert_many(c, "student_profile",
                      ["user_id", "grade_level", "guardian_name", "guardian_email",
                       "guardian_phone", "consent_status"], prof_rows)

    # Orders then enrolments — an enrolment always has a paid order behind it.
    enrolments: list[dict[str, Any]] = []
    for s in students:
        for slug in s["courses"]:
            b = by_slug[slug]
            order_id = uid()
            bought_ago = rint(20, 85)
            order_rows.append([order_id, s["id"], b["course_id"], b["spec"]["priceMinor"], "INR",
                               "paid", "mock", f"mock_{order_id[:12]}",
                               days_ago(bought_ago), days_ago(bought_ago)])
            enrol_rows.append([uid(), s["id"], b["course_id"], "active", "purchase", order_id,
                               days_ago(bought_ago)])
            enrolments.append({"user_id": s["id"], "course_id": b["course_id"], "slug": slug,
                               "pace": s["pace"], "active": s["active"]})

    await insert_many(c, "course_order",
                      ["id", "user_id", "course_id", "amount_minor", "currency", "status",
                       "provider", "provider_ref", "created_at", "paid_at"], order_rows)
    await insert_many(c, "enrollment",
                      ["id", "user_id", "course_id", "status", "source", "order_id", "enrolled_at"],
                      enrol_rows)

    # Progress, interleaved across lessons / exercises / recordings so a student
    # part-way through the course looks part-way through it, not "all videos, no
    # reading".
    for e in enrolments:
        b = by_slug[e["slug"]]
        lanes = [
            [{"id": i, "type": "lesson"} for i in b["lesson_ids"]],
            [{"id": i, "type": "exercise"} for i in b["exercise_ids"]],
            [{"id": i, "type": "recording"} for i in b["recording_ids"]],
        ]
        total = sum(len(lane) for lane in lanes)
        ordered: list[dict[str, str]] = []
        i = 0
        while len(ordered) < total:
            for lane in lanes:
                if i < len(lane):
                    ordered.append(lane[i])
            i += 1

        done = round(len(ordered) * min(1, e["pace"]))
        for j in range(done):
            prog_rows.append([uid(), e["user_id"], b["course_id"], ordered[j]["type"],
                              ordered[j]["id"], "completed", dec(100), rint(180, 1400), 1,
                              days_ago(e["active"] + rint(0, 25))])
        if done < len(ordered):
            prog_rows.append([uid(), e["user_id"], b["course_id"], ordered[done]["type"],
                              ordered[done]["id"], "in_progress", dec(rint(15, 85)),
                              rint(60, 400), 1, days_ago(e["active"])])

    await insert_many(c, "progress",
                      ["id", "user_id", "course_id", "node_type", "node_id", "status", "percent",
                       "seconds_spent", "attempts", "last_activity_at"], prog_rows, 120)

    # =======================================================================
    # 7. Quiz attempts, submissions, attendance, certificates
    # =======================================================================
    attempt_rows: list[list] = []
    answer_rows: list[list] = []
    for e in [x for x in enrolments if x["pace"] > 0.25]:
        b = by_slug[e["slug"]]
        quizzes = await c.fetch("SELECT id FROM quiz WHERE course_id = $1 ORDER BY title",
                                b["course_id"])
        take = max(1, round(len(quizzes) * min(1, e["pace"])))
        for quiz in quizzes[:take]:
            qs = await c.fetch(
                "SELECT id, answer_index, marks FROM question WHERE quiz_id = $1 ORDER BY position",
                quiz["id"])
            attempt_id = uid()
            target = max(0.25, min(1, e["pace"] + (rnd() - 0.45) * 0.4))
            score = 0
            for q in qs:
                right = rnd() < target
                if right:
                    score += q["marks"]
                answer_rows.append([uid(), attempt_id, q["id"],
                                    q["answer_index"] if right else (q["answer_index"] + 1) % 4,
                                    "", right, dec(q["marks"] if right else 0),
                                    days_ago(rint(2, 30))])
            max_score = sum(q["marks"] for q in qs)
            attempt_rows.append([attempt_id, quiz["id"], e["user_id"], 1, "submitted", dec(score),
                                 dec(max_score), max_score > 0 and score / max_score >= 0.6,
                                 days_ago(rint(2, 30)), days_ago(rint(2, 30))])

    await insert_many(c, "quiz_attempt",
                      ["id", "quiz_id", "user_id", "attempt_no", "status", "score", "max_score",
                       "passed", "started_at", "submitted_at"], attempt_rows, 120)
    await insert_many(c, "quiz_answer",
                      ["id", "attempt_id", "question_id", "choice_index", "text_answer",
                       "is_correct", "marks_awarded", "saved_at"], answer_rows, 120)

    sub_rows: list[list] = []
    graded_rows: list[list] = []
    for e in [x for x in enrolments if x["pace"] > 0.35]:
        b = by_slug[e["slug"]]
        for aid in assignment_ids[b["course_id"]]:
            if not chance(e["pace"] * 90):
                continue
            graded = chance(55)
            row = [uid(), aid, e["user_id"], 1,
                   "My answer is attached. I used a loop for the totals and rounded with round(x, 2).",
                   "total = 0\nfor m in marks:\n    total = total + m\nprint(round(total / len(marks), 2))",
                   "graded" if graded else "submitted"]
            if graded:
                s = rint(6, 10)
                graded_rows.append(row + [
                    {"correct": min(4, s - 3), "approach": 3, "readable": 2, "ontime": 1}, dec(s),
                    pick(["Neat and readable. Watch the rounding next time.",
                          "Good approach. Add a comment above the loop.",
                          "Correct. Try doing it without the extra variable."]),
                    teacher_ids["Sneha Reddy"] if b["spec"]["subject"] == "python"
                    else teacher_ids["Anita Menon"],
                    days_ago(rint(4, 18)), days_ago(rint(1, 3))])
            else:
                sub_rows.append(row + [days_ago(rint(0, 5))])

    await insert_many(c, "submission",
                      ["id", "assignment_id", "user_id", "attempt_no", "body", "code", "status",
                       "submitted_at"], sub_rows)
    await insert_many(c, "submission",
                      ["id", "assignment_id", "user_id", "attempt_no", "body", "code", "status",
                       "rubric_scores", "score", "feedback", "graded_by", "submitted_at",
                       "graded_at"], graded_rows, 120)

    att_rows: list[list] = []
    sessions = await c.fetch("SELECT id, course_id, status FROM live_session")
    for s in sessions:
        for e in [x for x in enrolments if by_slug[x["slug"]]["course_id"] == s["course_id"]]:
            if s["status"] == "ended":
                if chance(72):
                    att_rows.append([s["id"], e["user_id"], "attended", days_ago(5), days_ago(5)])
                else:
                    att_rows.append([s["id"], e["user_id"], "absent", None, None])
            elif chance(58):
                att_rows.append([s["id"], e["user_id"], "registered", None, None])

    await insert_many(c, "session_attendance",
                      ["live_session_id", "user_id", "status", "joined_at", "left_at"],
                      att_rows, 120)

    # Certificates for the students who finished
    cert_rows: list[list] = []
    ach_rows: list[list] = []
    for e in [x for x in enrolments if x["pace"] >= 0.95]:
        b = by_slug[e["slug"]]
        serial = f'BJ-{b["spec"]["subject"].upper()}-{rint(10000, 99999)}'
        cert_rows.append([uid(), e["user_id"], b["course_id"], serial,
                          uuid.uuid4().hex[:12].upper(), dec(rint(72, 98)), days_ago(rint(1, 20))])
        await c.execute(
            "UPDATE enrollment SET status='completed', completed_at=$1 WHERE user_id=$2 AND course_id=$3",
            days_ago(rint(1, 20)), e["user_id"], b["course_id"])

    await insert_many(c, "certificate",
                      ["id", "user_id", "course_id", "serial", "verification_code", "final_score",
                       "issued_at"], cert_rows)

    for s in students[:60]:
        ach_rows.append([uid(), s["id"], None, "first_lesson", days_ago(rint(20, 60))])
        if s["pace"] > 0.3:
            ach_rows.append([uid(), s["id"], None, "first_exercise", days_ago(rint(10, 40))])
        if s["pace"] > 0.6:
            ach_rows.append([uid(), s["id"], None, "quiz_passed", days_ago(rint(4, 25))])
        if s["pace"] > 0.9:
            ach_rows.append([uid(), s["id"], None, "course_complete", days_ago(rint(1, 10))])

    await insert_many(c, "achievement", ["id", "user_id", "course_id", "badge_key", "earned_at"],
                      ach_rows)

    # =======================================================================
    # 8. Notifications and audit
    # =======================================================================
    notif_rows: list[list] = []
    for s in students[:40]:
        notif_rows.append([uid(), s["id"], "live", "A live class is coming up",
                           "Your next live class is this week. The link appears on the session page an hour before.",
                           "live", "", None, days_ago(1)])
        if s["pace"] > 0.4:
            notif_rows.append([uid(), s["id"], "grade", "An assignment was graded",
                               "Your teacher has left feedback on one of your assignments.",
                               "assignments", "", None, days_ago(2)])

    await insert_many(c, "notification",
                      ["id", "user_id", "kind", "title", "body", "link_screen", "link_param",
                       "read_at", "created_at"], notif_rows)

    await insert_many(c, "audit_log",
                      ["id", "actor_user_id", "actor_role", "action", "entity_type", "summary",
                       "occurred_at"], [
        [uid(), admin_id, "BROLLY_ADMIN", "content.release.published", "course",
         "Published Python Foundations release 1", days_ago(90)],
        [uid(), admin_id, "BROLLY_ADMIN", "content.release.published", "course",
         "Published AI for Beginners release 1", days_ago(90)],
        [uid(), admin_id, "BROLLY_ADMIN", "user.created", "app_user",
         "Created teacher account for Anita Menon", days_ago(70)],
        [uid(), admin_id, "BROLLY_ADMIN", "course.published", "course",
         "Published AI for Beginners to the catalogue", days_ago(88)],
        [uid(), teacher_ids["Sneha Reddy"], "TEACHER", "assignment.created", "assignment",
         'Created "Build a marks calculator"', days_ago(20)],
        [uid(), teacher_ids["Anita Menon"], "TEACHER", "submission.graded", "submission",
         "Graded a submission for Clean the travel survey", days_ago(2)],
    ])

    t = await c.fetchrow("""
        SELECT (SELECT count(*)::int FROM app_user)   AS users,
               (SELECT count(*)::int FROM enrollment) AS enrolments,
               (SELECT count(*)::int FROM progress)   AS progress,
               (SELECT count(*)::int FROM course_order WHERE status='paid') AS orders""")
    print(f'\n  {len(students)} students · {t["enrolments"]} enrolments · '
          f'{t["orders"]} paid orders · {t["progress"]} progress rows')


async def main() -> None:
    print("Seeding Brolly Juniors B2C (postgres) ...\n")
    t0 = time.time()
    conn = await asyncpg.connect(settings.database_url)
    await conn.set_type_codec("jsonb", encoder=json.dumps, decoder=json.loads, schema="pg_catalog")
    await conn.set_type_codec("json", encoder=json.dumps, decoder=json.loads, schema="pg_catalog")
    try:
        async with conn.transaction():
            await seed(conn)
    finally:
        await conn.close()

    print(f"\nSeed complete in {time.time() - t0:.1f}s")
    print(f"\n  Brolly admin   admin@brollyjuniors.com / {DEMO_PW}")
    print(f"  Teacher        sneha.reddy@brollyjuniors.com / {DEMO_PW}")
    print(f"  Student        aarav@example.com / {STUDENT_PW}   (both courses)")
    print(f"  Student        sana@example.com / {STUDENT_PW}    (AI only — try opening Python)\n")


if __name__ == "__main__":
    asyncio.run(main())
