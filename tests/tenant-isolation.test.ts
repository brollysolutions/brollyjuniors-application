/**
 * The cross-tenant abuse suite.
 *
 * This runs against the database directly, with no application code in the way,
 * so it proves isolation layers 3 (row-level security) and 4 (composite foreign
 * keys) rather than layers 1 and 2. If someone bypasses the ORM, deletes a
 * guard, or writes raw SQL, these still hold.
 *
 * The two META tests at the end are the highest-leverage tests in the codebase:
 * they fail when somebody adds a TABLE incorrectly, which is how this class of
 * bug actually enters a system.
 *
 *   npm test
 */

import { test, before, after, describe } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { withAdmin, withTenant, withPlatform, closeDb, type Conn } from '@brolly/db'

type Ctx = { a: string; b: string; aStudent: string; bStudent: string; aClass: string; bClass: string }
let ctx: Ctx

before(async () => {
  ctx = await withAdmin(async c => {
    const schools = await c.query<{ id: string; school_code: string }>(
      `SELECT id, school_code FROM tenant WHERE is_platform = false ORDER BY school_code LIMIT 2`)
    assert.equal(schools.length, 2, 'seed the database first: npm run db:reset')
    const [a, b] = schools

    const studentOf = async (tenantId: string) => (await c.query<{ id: string }>(
      `SELECT u.id FROM app_user u
         JOIN user_role ur ON ur.user_id = u.id
         JOIN role r ON r.id = ur.role_id AND r.key = 'STUDENT'
        WHERE u.tenant_id = $1 LIMIT 1`, [tenantId]))[0].id
    const classOf = async (tenantId: string) => (await c.query<{ id: string }>(
      `SELECT id FROM school_class WHERE tenant_id = $1 LIMIT 1`, [tenantId]))[0].id

    return {
      a: a.id, b: b.id,
      aStudent: await studentOf(a.id), bStudent: await studentOf(b.id),
      aClass: await classOf(a.id), bClass: await classOf(b.id),
    }
  })
})

after(async () => { await closeDb() })

const count = async (c: Conn, sql: string, params: any[] = []) =>
  Number((await c.query<{ n: string }>(sql, params))[0].n)

// ---------------------------------------------------------------------------

describe('Layer 3 — row-level security', () => {
  test('a tenant reads only its own rows, even with no WHERE clause', async () => {
    const aRows = await withTenant(ctx.a, null, c => c.query('SELECT id, tenant_id FROM school_class'))
    const bRows = await withTenant(ctx.b, null, c => c.query('SELECT id, tenant_id FROM school_class'))

    assert.ok(aRows.length > 0 && bRows.length > 0, 'both schools should have classes')
    assert.ok(aRows.every((r: any) => r.tenant_id === ctx.a), 'School A saw a row it does not own')
    assert.ok(bRows.every((r: any) => r.tenant_id === ctx.b), 'School B saw a row it does not own')
    const aIds = new Set(aRows.map((r: any) => r.id))
    assert.ok(!bRows.some((r: any) => aIds.has(r.id)), 'the two schools share a class row')
  })

  test('asking for another school’s row by id returns nothing', async () => {
    const rows = await withTenant(ctx.a, null, c =>
      c.query('SELECT id FROM school_class WHERE id = $1', [ctx.bClass]))
    assert.equal(rows.length, 0, 'School A could fetch School B’s class by id')
  })

  test('a student row from another school is invisible', async () => {
    const rows = await withTenant(ctx.a, null, c =>
      c.query('SELECT id FROM app_user WHERE id = $1', [ctx.bStudent]))
    assert.equal(rows.length, 0)
  })

  test('writing a row into another school is rejected by the database', async () => {
    await assert.rejects(
      () => withTenant(ctx.a, null, c => c.query(
        `INSERT INTO announcement (id, tenant_id, class_id, created_by, body)
         VALUES ($1, $2, $3, $4, 'cross-tenant write')`,
        [randomUUID(), ctx.b, ctx.bClass, ctx.bStudent])),
      /row-level security/i,
      'a WITH CHECK policy should have refused this insert',
    )
  })

  test('updating another school’s row affects nothing', async () => {
    const changed = await withTenant(ctx.a, null, async c => {
      await c.query(`UPDATE school_class SET name = 'HACKED' WHERE id = $1`, [ctx.bClass])
      return c.query('SELECT id FROM school_class WHERE name = $1', ['HACKED'])
    })
    assert.equal(changed.length, 0)
    const still = await withTenant(ctx.b, null, c =>
      c.query('SELECT name FROM school_class WHERE id = $1', [ctx.bClass]))
    assert.notEqual(still[0]?.name, 'HACKED', 'School A renamed School B’s class')
  })
})

describe('Layer 4 — composite foreign keys', () => {
  test('another school’s student cannot be enrolled into your class', async () => {
    // RLS stops you READING their rows; the composite FK stops you LINKING to
    // them, which is the subtler bug.
    await assert.rejects(
      () => withAdmin(c => c.query(
        `INSERT INTO class_student (tenant_id, class_id, user_id) VALUES ($1, $2, $3)`,
        [ctx.a, ctx.aClass, ctx.bStudent])),
      /foreign key|violates/i,
      'a composite FK should have refused this pairing',
    )
  })

  test('a class id from another school cannot be attached to your assignment', async () => {
    await assert.rejects(
      () => withAdmin(c => c.query(
        `INSERT INTO assignment (id, tenant_id, class_id, created_by, title)
         VALUES ($1, $2, $3, $4, 'x')`,
        [randomUUID(), ctx.a, ctx.bClass, ctx.aStudent])),
      /foreign key|violates/i,
    )
  })
})

describe('Platform scope cannot read a student’s work', () => {
  const PRIVATE = ['lab_submission', 'exam_answer', 'exam_question', 'video_note',
    'practice_attempt', 'student_profile', 'announcement', 'teacher_material']

  for (const table of PRIVATE) {
    test(`Brolly admin sees zero rows in ${table}`, async () => {
      const n = await withPlatform(null, c => count(c, `SELECT count(*)::text AS n FROM ${table}`))
      const real = await withAdmin(c => count(c, `SELECT count(*)::text AS n FROM ${table}`))
      assert.ok(real > 0, `${table} has no seed rows, so this test proves nothing — seed it`)
      assert.equal(n, 0, `platform scope could read ${table}; there should be no policy granting it`)
    })
  }

  test('Brolly admin CAN still read the counts it needs', async () => {
    const tenants = await withPlatform(null, c => count(c, 'SELECT count(*)::text AS n FROM tenant'))
    const progress = await withPlatform(null, c => count(c, 'SELECT count(*)::text AS n FROM progress'))
    assert.ok(tenants >= 5, 'platform scope must see the schools it manages')
    assert.ok(progress > 0, 'platform scope must see progress rows to compute completion rates')
  })
})

describe('Master curriculum is read-only outside the Content Hub', () => {
  test('a school can read the curriculum', async () => {
    const n = await withTenant(ctx.a, null, c => count(c, 'SELECT count(*)::text AS n FROM video'))
    assert.ok(n > 0)
  })

  test('a school cannot edit the curriculum', async () => {
    const changed = await withTenant(ctx.a, null, async c => {
      await c.query(`UPDATE video SET title = 'EDITED BY A SCHOOL'`)
      return count(c, `SELECT count(*)::text AS n FROM video WHERE title = 'EDITED BY A SCHOOL'`)
    })
    assert.equal(changed, 0, 'a school was able to rewrite Brolly content')
  })

  test('a school cannot insert into the curriculum', async () => {
    await assert.rejects(
      () => withTenant(ctx.a, null, async c => {
        const unit = (await c.query<{ id: string }>('SELECT id FROM unit LIMIT 1'))[0].id
        return c.query(`INSERT INTO video (id, unit_id, title) VALUES ($1, $2, 'sneaked in')`,
          [randomUUID(), unit])
      }),
      /row-level security/i,
    )
  })

  test('unpublished content versions are invisible to schools', async () => {
    await withAdmin(c => c.query(
      `INSERT INTO content_version (id, content_item_id, version_no, locale, status, body)
       SELECT $1, id, 99, 'en', 'draft', '[]'::jsonb FROM content_item LIMIT 1`, [randomUUID()]))
    const visible = await withTenant(ctx.a, null, c =>
      count(c, `SELECT count(*)::text AS n FROM content_version WHERE status = 'draft'`))
    assert.equal(visible, 0, 'a school could read a draft that has not been published')
  })
})

describe('Without a tenant set, nothing is readable', () => {
  test('an empty tenant context returns zero rows', async () => {
    // Deny by default: current_setting returns NULL, the policy compares NULL,
    // and NULL is not true — so the row is filtered out.
    const n = await withTenant('00000000-0000-0000-0000-000000000000', null, c =>
      count(c, 'SELECT count(*)::text AS n FROM app_user'))
    assert.equal(n, 0)
  })
})

// ---------------------------------------------------------------------------
// Meta tests — these fail when someone adds a table incorrectly.
// ---------------------------------------------------------------------------

describe('Meta — the schema itself', () => {
  /** Platform-owned tables: shared by every school, so no tenant_id by design. */
  const PLATFORM_TABLES = new Set([
    'feature', 'permission', 'role', 'role_permission',
    'subject', 'course', 'unit', 'video', 'material', 'practice_lab', 'graded_lab',
    'question', 'exam_blueprint', 'exam_blueprint_question',
    'content_item', 'content_version', 'content_release', 'media_asset',
    'hub_change', 'hub_sync_state', 'schema_migration',
  ])

  test('every non-platform table has a tenant_id column', async () => {
    const offenders = await withAdmin(async c => {
      const tables = await c.query<{ table_name: string }>(
        `SELECT table_name FROM information_schema.tables
          WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`)
      const bad: string[] = []
      for (const { table_name } of tables) {
        if (PLATFORM_TABLES.has(table_name)) continue
        const cols = await c.query(
          `SELECT 1 FROM information_schema.columns
            WHERE table_schema='public' AND table_name=$1 AND column_name IN ('tenant_id','id')
              AND ($1 <> 'tenant' OR column_name = 'id')`, [table_name])
        const hasTenant = await c.query(
          `SELECT 1 FROM information_schema.columns
            WHERE table_schema='public' AND table_name=$1 AND column_name='tenant_id'`, [table_name])
        if (table_name === 'tenant') continue           // is its own tenant
        if (!hasTenant.length) bad.push(table_name)
        void cols
      }
      return bad
    })
    assert.deepEqual(offenders, [],
      `these tables have no tenant_id. Add one, or add them to PLATFORM_TABLES if they are genuinely shared.`)
  })

  test('every table has row-level security enabled and forced', async () => {
    const offenders = await withAdmin(c => c.query<{ relname: string }>(
      `SELECT c.relname FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind = 'r'
          AND c.relname <> 'schema_migration'
          AND (c.relrowsecurity = false OR c.relforcerowsecurity = false)`))
    assert.deepEqual(offenders.map(o => o.relname), [],
      'these tables are missing ENABLE / FORCE ROW LEVEL SECURITY')
  })

  test('every table has at least one policy', async () => {
    const offenders = await withAdmin(c => c.query<{ relname: string }>(
      `SELECT c.relname FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind = 'r'
          AND c.relname <> 'schema_migration'
          AND NOT EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = c.oid)`))
    assert.deepEqual(offenders.map(o => o.relname), [], 'these tables have RLS on but no policy')
  })

  test('the application role is not a superuser and cannot bypass RLS', async () => {
    const role = await withAdmin(c => c.query<{ rolsuper: boolean; rolbypassrls: boolean }>(
      `SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = 'brolly_app'`))
    assert.equal(role.length, 1, 'the brolly_app role is missing')
    assert.equal(role[0].rolsuper, false)
    assert.equal(role[0].rolbypassrls, false)
  })
})
