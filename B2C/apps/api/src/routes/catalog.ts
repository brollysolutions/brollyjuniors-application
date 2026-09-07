/**
 * The public catalogue and the bootstrap.
 *
 * A shopper must be able to read the curriculum before paying for it, so module
 * and lesson TITLES are public. Lesson bodies, textbook sections, recordings and
 * materials are not — that line is drawn in the RLS policies, so these handlers
 * do not have to remember it.
 */

import type { FastifyInstance } from 'fastify'
import { withAnon } from '@brolly/b2c-db'
import { notFound } from '../http.ts'
import { publicRoute, requires } from '../guards.ts'
import { boundaryLine, can } from '../access.ts'
import { BROLLY_JUNIORS, type NavItem } from '@brolly/b2c-shared'

function buildNav(access: any, badges: Record<string, number>): NavItem[] {
  const nav: NavItem[] = []
  const add = (key: string, label: string, icon: string, permission?: string, badge?: number) => {
    if (permission && !can(access, permission)) return
    nav.push({ key, label, icon, ...(badge ? { badge } : {}) })
  }

  if (access.role === 'BROLLY_ADMIN') {
    add('overview', 'Overview', '▤')
    add('courses', 'Courses', '▦', 'course:read')
    add('content', 'Content Hub', '✎', 'content:create')
    add('teachers', 'Teachers', '◈', 'user:read')
    add('students', 'Students', '▧', 'user:read')
    add('live', 'Live classes', '◉', 'live:manage')
    add('orders', 'Orders', '₹', 'order:read:platform')
    add('audit', 'Activity log', '◧', 'audit:read')
    add('profile', 'My profile', '◔')
    return nav
  }

  if (access.role === 'TEACHER') {
    add('overview', 'Dashboard', '▤')
    add('courses', 'My courses', '▦', 'course:read')
    add('students', 'My students', '▧', 'progress:read:course')
    add('live', 'Live classes', '◉', 'live:read')
    add('grading', 'Grading', '✓', 'assignment:grade', badges.pendingGrading)
    add('recordings', 'Recordings', '▶', 'recording:read')
    add('profile', 'My profile', '◔')
    return nav
  }

  add('home', 'Home', '▤')
  add('mycourses', 'My courses', '▦', 'enrollment:read')
  add('browse', 'Browse courses', '◎')
  add('live', 'Live classes', '◉', 'live:attend')
  add('recordings', 'Recordings', '▶', 'recording:read')
  add('assignments', 'Assignments', '✎', 'assignment:submit', badges.dueAssignments)
  add('progress', 'My progress', '◫', 'progress:read:self')
  add('certificates', 'Certificates', '★', 'certificate:read')
  add('profile', 'My profile', '◔')
  return nav
}

export default async function catalogRoutes(app: FastifyInstance) {
  app.get('/api/v1/public/brand', publicRoute, async () => ({ brand: BROLLY_JUNIORS }))

  /** The shop window. Published courses only, no protected content. */
  app.get('/api/v1/public/courses', publicRoute, async () =>
    withAnon(async c => ({
      brand: BROLLY_JUNIORS,
      subjects: await c.query('SELECT id, key, name, blurb FROM subject ORDER BY name'),
      courses: await c.query(`
        SELECT c.id, c.slug, c.title, c.subtitle, c.level, c.age_range, c.duration_hours,
               c.price_minor, c.currency, s.name AS subject, s.key AS subject_key,
               (SELECT count(*)::int FROM module m WHERE m.course_id = c.id) AS modules,
               (SELECT count(*)::int FROM lesson l JOIN module m ON m.id = l.module_id
                 WHERE m.course_id = c.id) AS lessons,
               public_learner_count(c.id) AS learners,
               coalesce((SELECT array_agg(u.full_name ORDER BY ct.role, u.full_name)
                           FROM course_teacher ct JOIN app_user u ON u.id = ct.user_id
                          WHERE ct.course_id = c.id), '{}') AS teachers
          FROM course c JOIN subject s ON s.id = c.subject_id
         WHERE c.status = 'published'
         ORDER BY c.price_minor`),
    })))

  /** A course page a stranger can read: outline yes, contents no. */
  app.get('/api/v1/public/courses/:slug', publicRoute, async req => {
    const slug = (req.params as any).slug
    return withAnon(async c => {
      const course = (await c.query<any>(`
        SELECT c.id, c.slug, c.title, c.subtitle, c.description, c.outcomes, c.requirements,
               c.level, c.age_range, c.duration_hours, c.price_minor, c.currency,
               s.name AS subject, s.key AS subject_key
          FROM course c JOIN subject s ON s.id = c.subject_id
         WHERE c.slug = $1 AND c.status = 'published'`, [slug]))[0]
      if (!course) throw notFound('No such course.')

      return {
        brand: BROLLY_JUNIORS,
        course,
        // Structure only. Every one of these lessons is a title with no body
        // until somebody buys the course.
        modules: await c.query(`
          SELECT m.id, m.position, m.title, m.summary,
                 coalesce((SELECT json_agg(json_build_object(
                     'id', l.id, 'title', l.title, 'position', l.position, 'minutes', l.est_minutes)
                   ORDER BY l.position) FROM lesson l WHERE l.module_id = m.id), '[]'::json) AS lessons
            FROM module m WHERE m.course_id = $1 ORDER BY m.position`, [course.id]),
        teachers: await c.query(`
          SELECT u.full_name, tp.headline, tp.bio, tp.expertise, tp.years_exp, ct.role
            FROM course_teacher ct
            JOIN app_user u ON u.id = ct.user_id
            LEFT JOIN teacher_profile tp ON tp.user_id = u.id
           WHERE ct.course_id = $1 ORDER BY ct.role, u.full_name`, [course.id]),
        // Every one of these is an aggregate over rows a shopper cannot read,
        // so all five come from the SECURITY DEFINER counters in 004 and 006.
        // Counted directly here they would all be zero for a stranger.
        stats: (await c.query<any>(`
          SELECT public_learner_count($1) AS learners,
                 public_completion_count($1) AS completed,
                 cc.recordings, cc.quizzes, cc.materials
            FROM public_course_contents($1) cc`,
        [course.id]))[0],
      }
    })
  })

  /** Anyone can check a certificate is real, without signing in. */
  app.get('/api/v1/public/certificates/:code', publicRoute, async req => {
    const code = String((req.params as any).code ?? '').toUpperCase()
    return withAnon(async c => {
      // Deliberately read through the admin-free path: certificates are private,
      // so verification returns a confirmation, never the row.
      const rows = await c.query<any>('SELECT * FROM public_verify_certificate($1)', [code])
      if (!rows.length) return { valid: false }
      return {
        valid: true,
        holder: rows[0].holder,
        course: rows[0].course,
        serial: rows[0].serial,
        issuedAt: rows[0].issued_at,
      }
    })
  })

  // -------------------------------------------------------------------------
  app.get('/api/v1/me/bootstrap', requires('me:read'), async req => {
    const a = req.access
    return req.db(async c => {
      const badges: Record<string, number> = {}

      if (a.role === 'TEACHER') {
        badges.pendingGrading = Number((await c.query<{ n: string }>(`
          SELECT count(*)::text AS n FROM submission s
            JOIN assignment asg ON asg.id = s.assignment_id
            JOIN course_teacher ct ON ct.course_id = asg.course_id AND ct.user_id = $1
           WHERE s.status = 'submitted'`, [a.userId]))[0].n)
      }
      if (a.role === 'STUDENT') {
        badges.dueAssignments = Number((await c.query<{ n: string }>(`
          SELECT count(*)::text AS n FROM assignment asg
            JOIN enrollment e ON e.course_id = asg.course_id AND e.user_id = $1 AND e.status = 'active'
           WHERE asg.status = 'published'
             AND NOT EXISTS (SELECT 1 FROM submission s
                              WHERE s.assignment_id = asg.id AND s.user_id = $1)`, [a.userId]))[0].n)
      }

      const initials = a.fullName.split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase()
      return {
        user: {
          id: a.userId, fullName: a.fullName, email: a.email,
          avatarInitials: initials, mustChangePassword: a.mustChangePassword,
        },
        role: a.role,
        roles: a.roles,
        permissions: [...a.permissions],
        features: [...a.features],
        brand: BROLLY_JUNIORS,
        boundary: boundaryLine(a),
        nav: buildNav(a, badges),
      }
    })
  })

  app.patch('/api/v1/me', requires('me:read'), async req => {
    const { fullName, phone } = (req.body ?? {}) as any
    return req.db(async c => {
      await c.query(
        `UPDATE app_user SET full_name = coalesce($1, full_name), phone = coalesce($2, phone) WHERE id = $3`,
        [fullName ?? null, phone ?? null, req.access.userId])
      await req.log_audit(c, {
        action: 'user.updated', entityType: 'app_user', entityId: req.access.userId,
        summary: 'Updated own profile', after: { full_name: fullName },
      })
      return { ok: true }
    })
  })

  app.get('/api/v1/me/notifications', requires('me:read'), async req =>
    req.db(async c => ({
      notifications: await c.query(
        `SELECT id, kind, title, body, link_screen, link_param, read_at, created_at
           FROM notification WHERE user_id = $1 ORDER BY created_at DESC LIMIT 30`, [req.access.userId]),
    })))

  app.post('/api/v1/me/notifications/read', requires('me:read'), async req =>
    req.db(async c => {
      await c.query('UPDATE notification SET read_at = now() WHERE user_id = $1 AND read_at IS NULL',
        [req.access.userId])
      return { ok: true }
    }))
}
