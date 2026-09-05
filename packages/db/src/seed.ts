/**
 * Seed: one master curriculum, five schools, and enough real activity that
 * every dashboard number in the app is computed rather than hard-coded.
 *
 * Demo passwords are deliberately uniform so the seed runs in seconds rather
 * than minutes — see DEMO_STAFF_PW / DEMO_STUDENT_PW below. In production every
 * password gets its own salt, which is what hashPassword() does per call.
 */

import { randomUUID } from 'node:crypto'
import { withAdmin, closeDb, driverName, type Conn } from './client.ts'
import { hashPassword, sha256 } from './password.ts'
import { UNITS, VIDEOS, MATERIALS, PRACTICE, GRADED_LABS, QUESTIONS, BLUEPRINTS } from './seed-curriculum.ts'
import { PERMISSIONS, ROLES, FEATURES, FEATURE_DEFAULTS } from '@brolly/shared'

const DEMO_STAFF_PW = 'brolly'
const DEMO_STUDENT_PW = 'student'

// Deterministic pseudo-random, so two runs of the seed produce the same school.
let _s = 20260821
const rnd = () => ((_s = (_s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff)
const pick = <T,>(a: T[]) => a[Math.floor(rnd() * a.length)]
const int = (lo: number, hi: number) => lo + Math.floor(rnd() * (hi - lo + 1))

const FIRST = ['Aarav', 'Divya', 'Karthik', 'Sana', 'Rahul', 'Meghana', 'Ishaan', 'Ananya', 'Vikram', 'Priya',
  'Rohan', 'Sneha', 'Arjun', 'Nisha', 'Aditya', 'Kavya', 'Manish', 'Pooja', 'Siddharth', 'Lakshmi',
  'Tanvi', 'Harsha', 'Neha', 'Varun', 'Shreya', 'Nikhil', 'Deepa', 'Sanjay', 'Ritu', 'Akhil',
  'Bhavya', 'Chandan', 'Farhan', 'Gayatri', 'Imran', 'Jyoti', 'Kiran', 'Madhu', 'Naveen', 'Ojas']
const LAST = ['Reddy', 'Rao', 'Sharma', 'Fatima', 'Verma', 'Prasad', 'Kumar', 'Nair', 'Iyer', 'Gupta',
  'Menon', 'Chowdary', 'Naidu', 'Joshi', 'Patel', 'Das', 'Bose', 'Shetty', 'Pillai', 'Varma']

const nowISO = () => new Date().toISOString()
const daysAgo = (d: number) => new Date(Date.now() - d * 864e5).toISOString()
const daysAhead = (d: number) => new Date(Date.now() + d * 864e5).toISOString()

/** Chunked multi-row INSERT. Keeps a 7,000-row seed to a handful of statements. */
async function insertMany(c: Conn, table: string, cols: string[], rows: any[][], chunk = 150) {
  for (let i = 0; i < rows.length; i += chunk) {
    const slice = rows.slice(i, i + chunk)
    const params: any[] = []
    const tuples = slice.map(r => {
      const ph = r.map(v => { params.push(v); return `$${params.length}` })
      return `(${ph.join(',')})`
    })
    await c.query(`INSERT INTO ${table} (${cols.join(',')}) VALUES ${tuples.join(',')}`, params)
  }
}

async function seed(c: Conn) {
  const staffHash = await hashPassword(DEMO_STAFF_PW)
  const studentHash = await hashPassword(DEMO_STUDENT_PW)

  // =========================================================================
  // 1. Access-control vocabulary
  // =========================================================================
  await insertMany(c, 'feature', ['key', 'name', 'description'],
    Object.entries(FEATURES).map(([k, v]) => [k, v, v]))

  await insertMany(c, 'permission', ['key', 'description', 'feature_key'],
    PERMISSIONS.map(p => [p.key, p.description, p.feature ?? null]))

  const roleIds: Record<string, string> = {}
  for (const [key, def] of Object.entries(ROLES)) {
    const id = randomUUID()
    roleIds[key] = id
    await c.query(
      'INSERT INTO role (id, tenant_id, key, name, level, is_system) VALUES ($1,NULL,$2,$3,$4,true)',
      [id, key, def.name, def.level])
    await insertMany(c, 'role_permission', ['role_id', 'permission_key'],
      def.permissions.map(p => [id, p]))
  }
  console.log(`  roles ${Object.keys(roleIds).length}  ·  permissions ${PERMISSIONS.length}`)

  // =========================================================================
  // 2. Master curriculum (platform-owned; one copy for every school)
  // =========================================================================
  const subjectId = randomUUID()
  await c.query('INSERT INTO subject (id, key, name) VALUES ($1,$2,$3)', [subjectId, 'ai', 'Artificial Intelligence'])
  const pySubjectId = randomUUID()
  await c.query('INSERT INTO subject (id, key, name) VALUES ($1,$2,$3)', [pySubjectId, 'python', 'Python'])

  const courseId = randomUUID()
  await c.query(
    `INSERT INTO course (id, subject_id, slug, title, level_label, board, code, status)
     VALUES ($1,$2,'ai-417-class9','Artificial Intelligence','Class 9','CBSE','417','published')`,
    [courseId, subjectId])

  const ct8 = randomUUID()
  await c.query(
    `INSERT INTO course (id, subject_id, slug, title, level_label, board, code, status)
     VALUES ($1,$2,'ct-ai-class8','Computational Thinking & AI','Class 8','CBSE','','published')`,
    [ct8, subjectId])

  const unitIds: Record<string, string> = {}
  await insertMany(c, 'unit', ['id', 'course_id', 'position', 'code', 'title', 'hours_label', 'marks', 'status'],
    UNITS.map((u, i) => {
      const id = randomUUID(); unitIds[u.code] = id
      return [id, courseId, i + 1, u.code, u.title, u.hours, u.marks, u.status]
    }))

  const videoIds: string[] = []
  await insertMany(c, 'video', ['id', 'unit_id', 'position', 'title', 'duration_seconds', 'summary'],
    VIDEOS.map((v, i) => {
      const id = randomUUID(); videoIds.push(id)
      return [id, unitIds[v.unit], i, v.title, v.seconds, JSON.stringify(v.summary)]
    }))

  // content_item must exist before material references it
  const materialIds: string[] = []
  const civRows: any[][] = []
  const cvRows: any[][] = []
  const materialRows = MATERIALS.map((m, i) => {
    const id = randomUUID(); materialIds.push(id)
    const itemId = randomUUID()
    civRows.push([itemId, `material:${id}`, 'material'])
    cvRows.push([randomUUID(), itemId, 1, 'en', 'published', JSON.stringify(m.body), sha256(JSON.stringify(m.body)),
      'First published edition', nowISO()])
    return [id, unitIds[m.unit], i, m.title, m.kind, m.pages, itemId]
  })
  await insertMany(c, 'content_item', ['id', 'key', 'content_type'], civRows)
  await insertMany(c, 'content_version',
    ['id', 'content_item_id', 'version_no', 'locale', 'status', 'body', 'body_hash', 'changelog', 'published_at'], cvRows)
  await insertMany(c, 'material', ['id', 'unit_id', 'position', 'title', 'kind', 'pages', 'content_item_id'], materialRows)

  const practiceIds: string[] = []
  await insertMany(c, 'practice_lab',
    ['id', 'unit_id', 'position', 'title', 'level', 'brief', 'starter_code', 'hints', 'solution', 'test_cases'],
    PRACTICE.map((p, i) => {
      const id = randomUUID(); practiceIds.push(id)
      return [id, unitIds[p.unit], i, p.title, p.level, p.brief, p.starter,
        JSON.stringify(p.hints), p.solution, JSON.stringify(p.tests)]
    }))

  const RUBRIC = JSON.stringify([
    { key: 'output', label: 'Correct output', max: 4 },
    { key: 'construct', label: 'Uses the required construct', max: 3 },
    { key: 'readable', label: 'Readable, commented', max: 2 },
    { key: 'ontime', label: 'Submitted on time', max: 1 },
  ])
  const gradedIds: Record<number, string> = {}
  await insertMany(c, 'graded_lab',
    ['id', 'course_id', 'unit_id', 'program_no', 'title', 'brief', 'mode', 'max_score', 'rubric', 'starter_code', 'test_cases'],
    GRADED_LABS.map(g => {
      const id = randomUUID(); gradedIds[g.no] = id
      return [id, courseId, unitIds[g.unit], g.no, g.title, g.brief, g.mode, 10, RUBRIC, g.starter, JSON.stringify(g.tests)]
    }))

  const questionIds: Array<{ id: string; unit: string; kind: string; marks: number }> = []
  await insertMany(c, 'question',
    ['id', 'unit_id', 'kind', 'text', 'options', 'answer_index', 'model_answer', 'marks', 'topic'],
    QUESTIONS.map(q => {
      const id = randomUUID()
      questionIds.push({ id, unit: q.unit, kind: q.kind, marks: q.marks })
      return [id, unitIds[q.unit], q.kind, q.text, JSON.stringify(q.options ?? []),
        q.answer ?? null, q.model ?? '', q.marks, q.topic]
    }))

  const blueprintIds: Record<string, string> = {}
  const bpq: any[][] = []
  await insertMany(c, 'exam_blueprint', ['id', 'unit_id', 'title', 'duration_minutes', 'objective_marks', 'written_marks'],
    BLUEPRINTS.map(b => {
      const id = randomUUID(); blueprintIds[b.unit] = id
      questionIds.filter(q => q.unit === b.unit).forEach((q, i) => bpq.push([id, q.id, i + 1]))
      return [id, unitIds[b.unit], b.title, b.duration, b.objectiveMarks, b.writtenMarks]
    }))
  await insertMany(c, 'exam_blueprint_question', ['blueprint_id', 'question_id', 'position'], bpq)

  // Publish release 1 of the course: one pointer, flipped in one statement.
  await c.query(
    `INSERT INTO content_release (id, scope, scope_id, release_no, status, manifest, published_at)
     VALUES ($1,'course',$2,1,'published',$3,now())`,
    [randomUUID(), courseId, JSON.stringify({
      course: 'ai-417-class9',
      units: UNITS.map(u => u.code),
      counts: { videos: VIDEOS.length, materials: MATERIALS.length, practice: PRACTICE.length, gradedLabs: GRADED_LABS.length, questions: QUESTIONS.length },
    })])

  // Hub change feed — what the sync client has already pulled.
  const hubRows: any[][] = []
  videoIds.forEach(id => hubRows.push(['video', id, 'upsert', JSON.stringify({})]))
  materialIds.forEach(id => hubRows.push(['material', id, 'upsert', JSON.stringify({})]))
  practiceIds.forEach(id => hubRows.push(['practice_lab', id, 'upsert', JSON.stringify({})]))
  Object.values(gradedIds).forEach(id => hubRows.push(['graded_lab', id, 'upsert', JSON.stringify({})]))
  await insertMany(c, 'hub_change', ['entity_type', 'entity_id', 'op', 'payload'], hubRows)
  const maxSeq = (await c.query<{ m: string }>('SELECT coalesce(max(seq),0)::text AS m FROM hub_change'))[0].m
  await c.query(
    `INSERT INTO hub_sync_state (id, cursor_seq, last_run_at, last_ok_at, items_held, failed_runs)
     VALUES (1,$1,now(),now(),$2,0)`,
    [maxSeq, hubRows.length])

  console.log(`  curriculum: ${UNITS.length} units · ${VIDEOS.length} videos · ${MATERIALS.length} materials · ${PRACTICE.length} practice · ${GRADED_LABS.length} graded labs · ${QUESTIONS.length} questions`)

  // =========================================================================
  // 3. Platform tenant + Brolly admin
  // =========================================================================
  const platformTenant = randomUUID()
  await c.query(
    `INSERT INTO tenant (id, school_code, name, area, board, tenant_type, status, is_platform, contact, joined_on)
     VALUES ($1,'BROLLY','Brolly Software Solutions','Hyderabad, Telangana','','INTERNAL','active',true,$2,'2026-01-01')`,
    [platformTenant, JSON.stringify({ email: 'admin@brollysoftware.com', phone: '+91 98••• •••••', person: 'Brolly Admin' })])
  await c.query(
    `INSERT INTO tenant_branding (tenant_id, display_name, short_name, logo_text, primary_color, secondary_color, welcome_message)
     VALUES ($1,'Brolly Software Solutions','Brolly','B','#FFC93C','#2B6CB0','The platform behind every school')`,
    [platformTenant])
  await insertMany(c, 'tenant_feature', ['tenant_id', 'feature_key', 'enabled'],
    Object.entries(FEATURE_DEFAULTS.INTERNAL).map(([k, v]) => [platformTenant, k, v]))

  const brollyAdminId = randomUUID()
  await c.query(
    `INSERT INTO app_user (id, tenant_id, email, username, password_hash, full_name, phone, status)
     VALUES ($1,$2,'admin@brollysoftware.com','brollyadmin',$3,'Brolly Admin','+91 98••• •••••','active')`,
    [brollyAdminId, platformTenant, staffHash])
  await c.query('INSERT INTO user_role (tenant_id, user_id, role_id) VALUES ($1,$2,$3)',
    [platformTenant, brollyAdminId, roleIds.BROLLY_ADMIN])

  // =========================================================================
  // 4. Schools
  // =========================================================================
  type SchoolSpec = {
    code: string; name: string; area: string; seats: number; students: number
    levels: string; usage: number; completion: number; status: string
    admin: string; adminEmail: string; primary: string; secondary: string
  }

  const SCHOOLS: SchoolSpec[] = [
    { code: 'VVHS-KUK', name: 'Vidya Vihar High School', area: 'Kukatpally, Hyderabad', seats: 250, students: 214,
      levels: 'Class 8, 9', usage: 78, completion: 64, status: 'active',
      admin: 'Lakshmi Prasad', adminEmail: 'principal@vidyavihar.edu.in', primary: '#FFC93C', secondary: '#2B6CB0' },
    { code: 'SPS-MYP', name: 'Sunrise Public School', area: 'Miyapur, Hyderabad', seats: 180, students: 176,
      levels: 'Class 9', usage: 83, completion: 71, status: 'active',
      admin: 'Ravi Shankar', adminEmail: 'principal@sunrisepublic.edu.in', primary: '#F97316', secondary: '#0F766E' },
    { code: 'RGS-SEC', name: 'Rockwell Grammar School', area: 'Secunderabad', seats: 300, students: 122,
      levels: 'Class 8, 9', usage: 41, completion: 29, status: 'active',
      admin: 'Grace Fernandes', adminEmail: 'principal@rockwellgrammar.edu.in', primary: '#1D4ED8', secondary: '#B45309' },
    { code: 'NV-GCB', name: 'Nalanda Vidyalaya', area: 'Gachibowli, Hyderabad', seats: 150, students: 148,
      levels: 'Class 9', usage: 69, completion: 55, status: 'active',
      admin: 'Suresh Babu', adminEmail: 'principal@nalandavidyalaya.edu.in', primary: '#15803D', secondary: '#7C2D12' },
    { code: 'CHS-NZM', name: 'Crescent Heights School', area: 'Nizampet, Hyderabad', seats: 120, students: 34,
      levels: 'Class 9', usage: 12, completion: 8, status: 'provisioning',
      admin: 'Farida Begum', adminEmail: 'principal@crescentheights.edu.in', primary: '#7C3AED', secondary: '#0891B2' },
  ]

  // Interleaved, not grouped: a student part-way through the course should have
  // watched some videos, read some notes and tried some practice — not finished
  // every video on the platform before opening a single worksheet.
  const contentNodes: Array<{ id: string; type: string }> = []
  {
    const lanes = [
      videoIds.map(id => ({ id, type: 'video' })),
      materialIds.map(id => ({ id, type: 'material' })),
      practiceIds.map(id => ({ id, type: 'practice_lab' })),
    ]
    for (let i = 0; contentNodes.length < lanes.flat().length; i++) {
      for (const lane of lanes) if (lane[i]) contentNodes.push(lane[i])
    }
  }

  let totalStudents = 0, totalTeachers = 0
  const vidyaVihar = { tenantId: '', classes: {} as Record<string, string>, teachers: {} as Record<string, string>, students: [] as any[] }

  for (const s of SCHOOLS) {
    const tid = randomUUID()
    await c.query(
      `INSERT INTO tenant (id, school_code, name, area, board, tenant_type, status, contact, joined_on)
       VALUES ($1,$2,$3,$4,'CBSE','B2B',$5,$6,$7)`,
      [tid, s.code, s.name, s.area, s.status,
        JSON.stringify({ person: s.admin, email: s.adminEmail, phone: '+91 98••• •••••' }),
        s.code === 'VVHS-KUK' ? '2026-06-12' : '2026-07-01'])

    await c.query(
      `INSERT INTO tenant_branding (tenant_id, display_name, short_name, logo_text, primary_color, secondary_color, welcome_message)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [tid, s.name, s.name.split(' ')[0], s.name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase(),
        s.primary, s.secondary, `Welcome to ${s.name}`])

    await insertMany(c, 'tenant_feature', ['tenant_id', 'feature_key', 'enabled'],
      Object.entries(FEATURE_DEFAULTS.B2B).map(([k, v]) => [tid, k, v]))

    await c.query(
      `INSERT INTO licence (id, tenant_id, seats, levels, valid_from, valid_until, status)
       VALUES ($1,$2,$3,$4,'2026-04-01','2027-03-31','active')`,
      [randomUUID(), tid, s.seats, s.levels])

    await c.query(
      `INSERT INTO tenant_entitlement (id, tenant_id, resource_type, resource_id, source, status)
       VALUES ($1,$2,'course',$3,'licence','active')`, [randomUUID(), tid, courseId])
    if (s.levels.includes('8')) {
      await c.query(
        `INSERT INTO tenant_entitlement (id, tenant_id, resource_type, resource_id, source, status)
         VALUES ($1,$2,'course',$3,'licence','active')`, [randomUUID(), tid, ct8])
    }

    const yearId = randomUUID()
    await c.query(
      `INSERT INTO academic_year (id, tenant_id, name, starts_on, ends_on, is_current)
       VALUES ($1,$2,'2026–27','2026-04-01','2027-03-31',true)`, [yearId, tid])

    // --- school admin ------------------------------------------------------
    const adminId = randomUUID()
    await c.query(
      `INSERT INTO app_user (id, tenant_id, email, username, password_hash, full_name, phone, status)
       VALUES ($1,$2,$3,$4,$5,$6,'+91 98••• •••••','active')`,
      [adminId, tid, s.adminEmail, s.code.toLowerCase() + '-admin', staffHash, s.admin])
    await c.query('INSERT INTO user_role (tenant_id, user_id, role_id) VALUES ($1,$2,$3)',
      [tid, adminId, roleIds.SCHOOL_ADMIN])

    // --- classes and teachers ---------------------------------------------
    const isVV = s.code === 'VVHS-KUK'
    const classPlan = isVV
      ? [['9-A Python & AI', '9', 'A', courseId, 38], ['9-B Python & AI', '9', 'B', courseId, 38],
         ['9-C Python & AI', '9', 'C', courseId, 38], ['8-A Computational Thinking', '8', 'A', ct8, 36],
         ['8-B Computational Thinking', '8', 'B', ct8, 35], ['8-C Computational Thinking', '8', 'C', ct8, 29]]
      : s.levels.includes('8')
        ? [['9-A Python & AI', '9', 'A', courseId, Math.ceil(s.students * 0.4)],
           ['9-B Python & AI', '9', 'B', courseId, Math.ceil(s.students * 0.3)],
           ['8-A Computational Thinking', '8', 'A', ct8, Math.floor(s.students * 0.3)]]
        : s.students > 60
          ? [['9-A Python & AI', '9', 'A', courseId, Math.ceil(s.students / 2)],
             ['9-B Python & AI', '9', 'B', courseId, Math.floor(s.students / 2)]]
          : [['9-A Python & AI', '9', 'A', courseId, s.students]]

    const teacherPlan = isVV
      ? [['Sneha Reddy', 'sneha.r@vidyavihar.edu.in', ['9-A Python & AI', '9-B Python & AI'], 'Python & AI'],
         ['Ramesh Kumar', 'ramesh.k@vidyavihar.edu.in', ['8-A Computational Thinking', '8-B Computational Thinking', '8-C Computational Thinking'], 'Computational Thinking'],
         ['Anil Varma', 'anil.v@vidyavihar.edu.in', ['9-C Python & AI'], 'Python & AI']]
      : classPlan.map((cp, i) => [
          `${pick(FIRST)} ${pick(LAST)}`,
          `teacher${i + 1}@${s.code.toLowerCase().replace('-', '')}.edu.in`,
          [cp[0] as string], 'Python & AI'])

    const classIds: Record<string, string> = {}
    await insertMany(c, 'school_class',
      ['id', 'tenant_id', 'academic_year_id', 'course_id', 'name', 'grade_level', 'section_label', 'status'],
      classPlan.map(cp => {
        const id = randomUUID(); classIds[cp[0] as string] = id
        return [id, tid, yearId, cp[3], cp[0], cp[1], cp[2], 'active']
      }))

    await insertMany(c, 'course_assignment', ['id', 'tenant_id', 'class_id', 'course_id', 'assigned_by', 'starts_on', 'ends_on'],
      classPlan.map(cp => [randomUUID(), tid, classIds[cp[0] as string], cp[3], adminId, '2026-06-15', '2027-03-15']))

    const teacherIds: Record<string, string> = {}
    for (const t of teacherPlan) {
      const [name, email, teaches] = t as [string, string, string[], string]
      const uid = randomUUID()
      teacherIds[name] = uid
      totalTeachers++
      await c.query(
        `INSERT INTO app_user (id, tenant_id, email, username, password_hash, full_name, phone, status, last_login_at)
         VALUES ($1,$2,$3,$4,$5,$6,'+91 99••• •••••','active',$7)`,
        [uid, tid, email, email.split('@')[0], staffHash, name,
          name === 'Anil Varma' ? daysAgo(3) : daysAgo(0)])
      await c.query('INSERT INTO user_role (tenant_id, user_id, role_id) VALUES ($1,$2,$3)', [tid, uid, roleIds.TEACHER])
      await c.query('INSERT INTO teacher_profile (tenant_id, user_id, employee_code, subject) VALUES ($1,$2,$3,$4)',
        [tid, uid, 'T-' + int(100, 999), (t as any)[3]])
      await insertMany(c, 'class_teacher', ['tenant_id', 'class_id', 'user_id', 'role_in_class'],
        teaches.filter(cn => classIds[cn]).map(cn => [tid, classIds[cn], uid, 'lead']))
    }

    // --- students ----------------------------------------------------------
    const NAMED_9A = [
      { name: 'Aarav Reddy', roll: '9A-04', done: 9, exam: 78, labs: 11, mins: 312, lastDays: 0 },
      { name: 'Divya Rao', roll: '9A-07', done: 13, exam: 91, labs: 15, mins: 405, lastDays: 0 },
      { name: 'Karthik M', roll: '9A-12', done: 2, exam: 34, labs: 2, mins: 64, lastDays: 9 },
      { name: 'Sana Fatima', roll: '9A-18', done: 8, exam: 72, labs: 9, mins: 288, lastDays: 0 },
      { name: 'Rahul Verma', roll: '9A-21', done: 6, exam: 61, labs: 6, mins: 198, lastDays: 1 },
      { name: 'Meghana P', roll: '9A-26', done: 11, exam: 84, labs: 13, mins: 356, lastDays: 0 },
    ]

    const userRows: any[][] = [], roleRows: any[][] = [], profRows: any[][] = []
    const csRows: any[][] = [], enrRows: any[][] = [], progRows: any[][] = []
    const studentsHere: any[] = []

    for (const cp of classPlan) {
      const [className, grade, section, cId, count] = cp as [string, string, string, string, number]
      const classId = classIds[className]
      const named = isVV && className === '9-A Python & AI' ? NAMED_9A : []
      const usedRolls = new Set(named.map(n => n.roll))
      let nextRoll = 1

      for (let i = 0; i < count; i++) {
        if (totalStudents >= 800) break
        const n = named[i]
        const uid = randomUUID()
        let roll: string
        if (n) {
          roll = n.roll
        } else {
          do { roll = `${grade}${section}-${String(nextRoll++).padStart(2, '0')}` } while (usedRolls.has(roll))
          usedRolls.add(roll)
        }
        const name = n ? n.name : `${pick(FIRST)} ${pick(LAST)}`

        // Activity is generated to land on the school's target rates, so every
        // percentage on every dashboard is computed from rows, not stored.
        const active = rnd() * 100 < s.usage
        const lastDays = n ? n.lastDays : (active ? int(0, 6) : int(8, 40))
        const doneRatio = n ? n.done / 14 : Math.max(0, Math.min(1, (s.completion + int(-25, 25)) / 100))

        userRows.push([uid, tid, null, roll, studentHash, name, 'active', lastDays > 30 ? null : daysAgo(lastDays)])
        roleRows.push([tid, uid, roleIds.STUDENT])
        profRows.push([tid, uid, roll, `Class ${grade}`, section, `${pick(LAST)} (parent)`, '+91 98••• •••••'])
        csRows.push([tid, classId, uid])
        enrRows.push([randomUUID(), tid, uid, cId, classId, 'class', daysAgo(int(40, 70))])

        const nodeCount = Math.round(contentNodes.length * doneRatio)
        for (let k = 0; k < nodeCount; k++) {
          const node = contentNodes[k]
          progRows.push([randomUUID(), tid, uid, node.type, node.id, 'completed', 100,
            int(120, 900), 1, daysAgo(lastDays + int(0, 20))])
        }
        // one item part-watched, so "carry on where you stopped" has something real
        if (nodeCount < contentNodes.length) {
          const node = contentNodes[nodeCount]
          progRows.push([randomUUID(), tid, uid, node.type, node.id, 'in_progress', n ? 42 : int(10, 80),
            int(30, 200), 1, daysAgo(lastDays)])
        }

        studentsHere.push({ uid, roll, name, classId, className, named: n })
        totalStudents++
      }
    }

    await insertMany(c, 'app_user',
      ['id', 'tenant_id', 'email', 'username', 'password_hash', 'full_name', 'status', 'last_login_at'], userRows)
    await insertMany(c, 'user_role', ['tenant_id', 'user_id', 'role_id'], roleRows)
    await insertMany(c, 'student_profile',
      ['tenant_id', 'user_id', 'roll_no', 'grade_level', 'section_label', 'guardian_name', 'guardian_phone'], profRows)
    await insertMany(c, 'class_student', ['tenant_id', 'class_id', 'user_id'], csRows)
    await insertMany(c, 'enrollment', ['id', 'tenant_id', 'user_id', 'course_id', 'class_id', 'source', 'enrolled_at'], enrRows)
    await insertMany(c, 'progress',
      ['id', 'tenant_id', 'user_id', 'node_type', 'node_id', 'status', 'percent', 'seconds_spent', 'attempts', 'last_activity_at'],
      progRows, 120)

    if (isVV) {
      vidyaVihar.tenantId = tid
      vidyaVihar.classes = classIds
      vidyaVihar.teachers = teacherIds
      vidyaVihar.students = studentsHere
    }

    console.log(`  ${s.name}: ${classPlan.length} classes · ${teacherPlan.length} teachers · ${studentsHere.length} students`)
  }

  // =========================================================================
  // 5. Vidya Vihar in depth — the school the demo walks through
  // =========================================================================
  const tid = vidyaVihar.tenantId
  const c9a = vidyaVihar.classes['9-A Python & AI']
  const c9b = vidyaVihar.classes['9-B Python & AI']
  const c9c = vidyaVihar.classes['9-C Python & AI']
  const sneha = vidyaVihar.teachers['Sneha Reddy']
  const anil = vidyaVihar.teachers['Anil Varma']

  const s9a = vidyaVihar.students.filter(x => x.classId === c9a)
  const byRoll = (r: string) => s9a.find(x => x.roll === r)
  const aarav = byRoll('9A-04'), divya = byRoll('9A-07'), karthik = byRoll('9A-12')
  const sana = byRoll('9A-18'), rahul = byRoll('9A-21')

  // --- assignments ---------------------------------------------------------
  const asgId = randomUUID()
  await c.query(
    `INSERT INTO assignment (id, tenant_id, class_id, created_by, title, due_at, status, created_at)
     VALUES ($1,$2,$3,$4,'Unit 5 — Python: this week',$5,'published',$6)`,
    [asgId, tid, c9a, sneha, daysAhead(4), daysAgo(3)])
  await insertMany(c, 'assignment_item', ['tenant_id', 'assignment_id', 'resource_type', 'resource_id'], [
    ...videoIds.slice(8, 11).map(v => [tid, asgId, 'video', v]),
    [tid, asgId, 'material', materialIds[0]],
    [tid, asgId, 'material', materialIds[1]],
    [tid, asgId, 'practice_lab', practiceIds[4]],
    [tid, asgId, 'graded_lab', gradedIds[7]],
  ])

  // --- teacher-authored material (never leaves the school) ------------------
  const tmId = randomUUID()
  await c.query(
    `INSERT INTO teacher_material (id, tenant_id, created_by, unit_id, title, kind, body, status, created_at)
     VALUES ($1,$2,$3,$4,'input() mistakes we made in class','Notes',$5,'shared',$6)`,
    [tmId, tid, sneha, unitIds.U5, JSON.stringify([
      { type: 'paragraph', text: 'Yesterday almost everyone forgot that input() gives text, not a number. Here are the three mistakes I saw, and how to fix each one.' },
      { type: 'code', language: 'python', source: 'age = input("Your age? ")\nprint(age + 1)      # this breaks\nprint(int(age) + 1) # this works' },
      { type: 'list', items: ['Adding 1 to text', 'Forgetting int() before the maths', 'Using int() on a word'] },
    ]), daysAgo(2)])
  await insertMany(c, 'teacher_material_class', ['tenant_id', 'material_id', 'class_id'], [[tid, tmId, c9a], [tid, tmId, c9b]])

  const tm2 = randomUUID()
  await c.query(
    `INSERT INTO teacher_material (id, tenant_id, created_by, unit_id, title, kind, body, status, created_at)
     VALUES ($1,$2,$3,$4,'Extra practice — typing drills','Worksheet',$5,'shared',$6)`,
    [tm2, tid, sneha, unitIds.U5, JSON.stringify([
      { type: 'paragraph', text: 'Ten short programs to type out by hand. Speed matters less than getting the indentation right first time.' },
    ]), daysAgo(9)])
  await insertMany(c, 'teacher_material_class', ['tenant_id', 'material_id', 'class_id'], [[tid, tm2, c9a]])

  const tm3 = randomUUID()
  await c.query(
    `INSERT INTO teacher_material (id, tenant_id, created_by, unit_id, title, kind, body, status, created_at)
     VALUES ($1,$2,$3,$4,'Revision notes — Unit 3','Notes',$5,'draft',$6)`,
    [tm3, tid, sneha, unitIds.U3, JSON.stringify([{ type: 'paragraph', text: 'Draft — not shared with students yet.' }]), daysAgo(1)])

  // --- curriculum plan -----------------------------------------------------
  const planId = randomUUID()
  await c.query(
    `INSERT INTO curriculum_plan (id, tenant_id, class_id, created_by, name, term, weeks)
     VALUES ($1,$2,$3,$4,'9-A Term 2 — Python basics','Term 2',12)`, [planId, tid, c9a, sneha])
  await insertMany(c, 'curriculum_item', ['id', 'tenant_id', 'plan_id', 'position', 'origin', 'resource_type', 'resource_id', 'label'], [
    [randomUUID(), tid, planId, 1, 'brolly', 'video', videoIds[8], 'U5 · What a variable holds'],
    [randomUUID(), tid, planId, 2, 'mine', 'teacher_material', tm2, 'Extra practice — typing drills'],
    [randomUUID(), tid, planId, 3, 'brolly', 'video', videoIds[10], 'U5 · Taking input from the user'],
    [randomUUID(), tid, planId, 4, 'mine', 'teacher_material', tmId, 'input() mistakes we made in class'],
    [randomUUID(), tid, planId, 5, 'brolly', 'video', videoIds[11], 'U5 · Conditions: if, elif, else'],
  ])

  // --- announcements -------------------------------------------------------
  await insertMany(c, 'announcement', ['id', 'tenant_id', 'class_id', 'created_by', 'body', 'created_at'], [
    [randomUUID(), tid, c9a, sneha, 'Bring your lab notebook on Monday. We will do the flowchart for Program 8 on paper first, then type it.', daysAgo(1)],
    [randomUUID(), tid, c9a, sneha, 'Unit 3 exam is on the 25th at 10 am in the computer lab. Revise mean, median and mode.', daysAgo(3)],
  ])

  // --- lab submissions -----------------------------------------------------
  const labRows: any[][] = [
    [randomUUID(), tid, karthik.uid, c9a, gradedIds[7], 'in_app',
      'marks = [78, 65, 90, 55, 82]\n\ntotal = 0\nfor m in marks:\n    total = total + m\n\nprint("Average:", total / len(marks))',
      'Average: 74.0', 7, JSON.stringify([
        { name: 'uses a loop', passed: true, detail: 'Loop found' },
        { name: 'does not use sum()', passed: true, detail: 'sum() not used' },
        { name: 'rounded to 2 decimals', passed: false, detail: 'Hidden test expected the average rounded to 2 decimals.' },
      ]), '', 'submitted', daysAgo(0)],
    [randomUUID(), tid, sana.uid, c9a, gradedIds[15], 'uploaded', '', '', null, '[]',
      'lab-sheet-3-sana.pdf', 'submitted', daysAgo(0)],
    [randomUUID(), tid, rahul.uid, c9a, gradedIds[6], 'in_app',
      'n = 2\nwhile n <= 20:\n    print(n)\n    n = n + 2', '2\n4\n6\n8\n10\n12\n14\n16\n18\n20', 10,
      JSON.stringify([{ name: 'uses a while loop', passed: true, detail: 'while found' },
        { name: 'prints 20', passed: true, detail: 'found in output' }]), '', 'submitted', daysAgo(1)],
  ]
  await insertMany(c, 'lab_submission',
    ['id', 'tenant_id', 'user_id', 'class_id', 'graded_lab_id', 'mode', 'code', 'stdout', 'auto_score', 'auto_detail', 'file_name', 'status', 'submitted_at'],
    labRows)

  await insertMany(c, 'lab_submission',
    ['id', 'tenant_id', 'user_id', 'class_id', 'graded_lab_id', 'mode', 'code', 'stdout', 'auto_score', 'auto_detail', 'status', 'rubric_scores', 'score', 'feedback', 'graded_by', 'submitted_at', 'graded_at'],
    [
      [randomUUID(), tid, aarav.uid, c9a, gradedIds[5], 'in_app',
        'a = int(input())\nb = int(input())\nc = int(input())\nif a > b and a > c:\n    print(a)\nelif b > c:\n    print(b)\nelse:\n    print(c)', '9', 10, '[]',
        'graded', JSON.stringify({ output: 4, construct: 3, readable: 1, ontime: 1 }), 9,
        'Neat use of elif. Add one comment line next time.', sneha, daysAgo(2), daysAgo(1)],
      [randomUUID(), tid, divya.uid, c9a, gradedIds[14], 'uploaded', '', '', null, '[]',
        'graded', JSON.stringify({ output: 4, construct: 3, readable: 2, ontime: 1 }), 10,
        'Complete and clearly laid out. Good work.', sneha, daysAgo(4), daysAgo(3)],
    ])

  // --- exams ---------------------------------------------------------------
  const u1q = questionIds.filter(q => q.unit === 'U1')
  const u2q = questionIds.filter(q => q.unit === 'U2')
  const u3q = questionIds.filter(q => q.unit === 'U3')

  async function makeExam(classId: string, unitCode: string, qs: typeof questionIds, title: string,
                          startsAt: string, status: string, createdBy: string, released: string | null) {
    const examId = randomUUID()
    await c.query(
      `INSERT INTO exam (id, tenant_id, class_id, blueprint_id, title, starts_at, duration_minutes, status, created_by, released_at, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,45,$7,$8,$9,$10)`,
      [examId, tid, classId, blueprintIds[unitCode], title, startsAt, status, createdBy, released, daysAgo(30)])
    const eqIds: Array<{ id: string; kind: string; marks: number; answer: number | null }> = []
    // Snapshot the paper at schedule time, so editing the bank later can never
    // change a paper students have already sat.
    const bank = await c.query<any>(
      `SELECT id, kind, text, options, answer_index, marks FROM question WHERE id = ANY($1::uuid[]) ORDER BY kind DESC, id`,
      [qs.map(q => q.id)])
    const eqRows = bank.map((q, i) => {
      const id = randomUUID()
      eqIds.push({ id, kind: q.kind, marks: q.marks, answer: q.answer_index })
      return [id, tid, examId, q.id, i + 1, q.kind, q.text, JSON.stringify(q.options), q.answer_index, q.marks]
    })
    await insertMany(c, 'exam_question',
      ['id', 'tenant_id', 'exam_id', 'question_id', 'position', 'kind', 'text', 'options', 'answer_index', 'marks'], eqRows)
    return { examId, eqIds }
  }

  const examU1 = await makeExam(c9a, 'U1', u1q, 'Unit 1 — Ethics', daysAgo(21), 'released', sneha, daysAgo(20))
  const examU2 = await makeExam(c9a, 'U2', u2q, 'Unit 2 — Data literacy', daysAgo(7), 'marking', sneha, null)
  const examU3 = await makeExam(c9a, 'U3', u3q, 'Unit 3 — Maths for AI', daysAhead(4), 'scheduled', sneha, null)
  const examU2c = await makeExam(c9c, 'U2', u2q, 'Unit 2 — Data literacy', daysAgo(7), 'marking', anil, null)

  // attempts for the two exams that have been sat
  for (const { exam, ratioBase, sat } of [
    { exam: examU1, ratioBase: 0.79, sat: 1.0 },
    { exam: examU2, ratioBase: 0.74, sat: 1.0 },
  ]) {
    const attRows: any[][] = [], ansRows: any[][] = []
    const maxScore = exam.eqIds.reduce((a, q) => a + q.marks, 0)
    for (const st of s9a) {
      if (rnd() > sat) continue
      const target = st.named ? st.named.exam / 100 : Math.max(0.2, Math.min(1, ratioBase + (rnd() - 0.5) * 0.5))
      const attId = randomUUID()
      let objScore = 0, wrScore = 0
      for (const q of exam.eqIds) {
        const ansId = randomUUID()
        if (q.kind === 'objective') {
          const right = rnd() < target
          if (right) objScore += q.marks
          ansRows.push([ansId, tid, attId, q.id, right ? q.answer : ((q.answer ?? 0) + 1) % 4, '', right, right ? q.marks : 0, sneha, daysAgo(6)])
        } else {
          // Unit 2 written answers are the ones still waiting to be marked
          const marked = exam === examU1
          const m = marked ? Math.round(q.marks * target) : null
          if (marked) wrScore += m!
          const text = st.named
            ? (st.roll === '9A-07' ? 'Mean adds all and divides by count. Median is the centre value. Use median when data has outliers.'
              : st.roll === '9A-12' ? 'Mean is average.'
              : 'Mean is the average of all values. Median is the middle value when arranged in order. Median is better when there are very large or very small values that pull the mean.')
            : 'The mean is the average and the median is the middle value once sorted. Median is safer when one value is unusual.'
          ansRows.push([ansId, tid, attId, q.id, null, text, null, m, marked ? sneha : null, marked ? daysAgo(19) : null])
        }
      }
      const total = exam === examU1 ? objScore + wrScore : objScore
      attRows.push([attId, tid, exam.examId, st.uid, exam === examU1 ? 'marked' : 'submitted',
        daysAgo(exam === examU1 ? 21 : 7), daysAgo(exam === examU1 ? 21 : 7),
        exam === examU1 ? objScore : objScore, exam === examU1 ? wrScore : null, total, maxScore])
    }
    await insertMany(c, 'exam_attempt',
      ['id', 'tenant_id', 'exam_id', 'user_id', 'status', 'started_at', 'submitted_at', 'objective_score', 'written_score', 'total_score', 'max_score'], attRows)
    await insertMany(c, 'exam_answer',
      ['id', 'tenant_id', 'attempt_id', 'exam_question_id', 'choice_index', 'text_answer', 'is_correct', 'marks_awarded', 'marked_by', 'marked_at'], ansRows, 120)
  }

  // --- practice attempts ---------------------------------------------------
  // Practice is unlimited and never marked, so a realistic student has several
  // attempts against the same lab, including failed ones.
  {
    const rows: any[][] = []
    for (const st of s9a.filter((x: any) => x.named)) {
      const tries = Math.max(1, Math.round((st.named.done / 14) * 5))
      for (let i = 0; i < tries; i++) {
        const lab = practiceIds[i % practiceIds.length]
        const solved = i < tries - 1 || st.named.done > 7
        const good = ['for i in range(1, 11):', '    print(5, "x", i, "=", 5 * i)'].join('\n')
        const bad = ['print(5)', 'print(10)'].join('\n')
        rows.push([randomUUID(), tid, st.uid, lab,
          solved ? good : bad,
          solved ? '5 x 1 = 5' : '5', solved ? 3 : 1, 3, daysAgo(int(1, 20))])
      }
    }
    await insertMany(c, 'practice_attempt',
      ['id', 'tenant_id', 'user_id', 'practice_lab_id', 'code', 'stdout', 'passed_count', 'total_count', 'created_at'],
      rows)
  }

  // --- notes, badges -------------------------------------------------------
  await c.query(
    `INSERT INTO video_note (id, tenant_id, user_id, video_id, body) VALUES ($1,$2,$3,$4,$5)`,
    [randomUUID(), tid, aarav.uid, videoIds[10], 'input() always gives text. Use int() before adding.'])

  await insertMany(c, 'achievement', ['id', 'tenant_id', 'user_id', 'badge_key', 'earned_at'], [
    [randomUUID(), tid, aarav.uid, 'first_program', daysAgo(40)],
    [randomUUID(), tid, aarav.uid, 'ten_programs', daysAgo(12)],
    [randomUUID(), tid, aarav.uid, 'six_day_streak', daysAgo(2)],
    [randomUUID(), tid, divya.uid, 'first_program', daysAgo(42)],
    [randomUUID(), tid, divya.uid, 'ten_programs', daysAgo(20)],
    [randomUUID(), tid, divya.uid, 'all_programs', daysAgo(4)],
    [randomUUID(), tid, divya.uid, 'exam_90', daysAgo(20)],
  ])

  // --- audit ---------------------------------------------------------------
  await insertMany(c, 'audit_log',
    ['id', 'tenant_id', 'actor_user_id', 'actor_scope', 'action', 'entity_type', 'summary', 'occurred_at'], [
      [randomUUID(), null, brollyAdminId, 'platform', 'content.release.published', 'course', 'Published release 1 of Artificial Intelligence (417)', daysAgo(60)],
      [randomUUID(), null, brollyAdminId, 'platform', 'tenant.created', 'tenant', 'Created school — Crescent Heights School', daysAgo(1)],
      [randomUUID(), null, brollyAdminId, 'platform', 'licence.updated', 'licence', 'Set licence — Crescent Heights School, 120 seats', daysAgo(1)],
      [randomUUID(), tid, sneha, 'tenant', 'assignment.created', 'assignment', 'Assigned Unit 5 material to 9-A', daysAgo(3)],
      [randomUUID(), tid, sneha, 'tenant', 'exam.scheduled', 'exam', 'Scheduled Unit 3 — Maths for AI for 9-A', daysAgo(5)],
      [randomUUID(), tid, sneha, 'tenant', 'submission.graded', 'lab_submission', 'Graded Program 5 for Aarav Reddy', daysAgo(1)],
    ])

  console.log(`\n  totals: ${totalStudents} students · ${totalTeachers} teachers · 5 schools`)
}

async function main() {
  console.log(`Seeding (driver=${driverName}) ...\n`)
  const t0 = Date.now()
  await withAdmin(seed)
  console.log(`\nSeed complete in ${((Date.now() - t0) / 1000).toFixed(1)}s`)
  console.log(`\n  Brolly admin   admin@brollysoftware.com / ${DEMO_STAFF_PW}`)
  console.log(`  School admin   principal@vidyavihar.edu.in / ${DEMO_STAFF_PW}`)
  console.log(`  Teacher        sneha.r@vidyavihar.edu.in / ${DEMO_STAFF_PW}`)
  console.log(`  Student        school code VVHS-KUK · username 9A-04 · ${DEMO_STUDENT_PW}\n`)
  await closeDb()
}

main().catch(err => {
  console.error('\nSeed failed:\n', err)
  process.exit(1)
})
