import type { FastifyInstance } from 'fastify'
import { withAdmin } from '@brolly/db'
import { boundaryLine, can } from '../access.ts'
import { requires, publicRoute } from '../guards.ts'
import type { NavItem } from '@brolly/shared'

/**
 * Navigation is computed on the SERVER from permissions and features, so the
 * client never renders a link the user cannot use and never ships the nav tree
 * of every other role.
 */
function buildNav(access: any, badges: Record<string, number>): NavItem[] {
  const nav: NavItem[] = []
  const add = (key: string, label: string, icon: string, permission?: string, badge?: number) => {
    if (permission && !can(access, permission)) return
    nav.push({ key, label, icon, ...(badge ? { badge } : {}) })
  }

  if (access.isPlatform) {
    add('overview', 'Overview', '▤')
    add('schools', 'Schools', '▦', 'tenant:read')
    add('content', 'Content (from Hub)', '▧', 'content:read')
    add('licences', 'Licences & seats', '▩', 'licence:manage')
    add('reports', 'Reports', '◫', 'report:read:platform')
    add('audit', 'Activity log', '◧', 'audit:read:platform')
    add('profile', 'My profile', '◈')
    return nav
  }

  if (access.roles.includes('SCHOOL_ADMIN')) {
    add('overview', 'Overview', '▤')
    add('teachers', 'Teachers', '▦', 'user:read')
    add('students', 'Students', '▧', 'user:read')
    add('classes', 'Classes', '▩', 'class:read')
    add('exams', 'Exams', '◫', 'exam:read')
    add('reports', 'Reports', '◧', 'report:read:tenant')
    add('profile', 'School profile', '◈')
    return nav
  }

  if (access.roles.includes('TEACHER')) {
    add('classes', 'My classes', '▤', 'class:read')
    add('library', 'Library', '▤', 'content:read')
    add('create', 'Create material', '✎', 'material:create')
    add('assign', 'Assign', '▦', 'assignment:create')
    add('labs', 'Lab submissions', '▧', 'lab:read:class', badges.pendingLabs)
    add('exams', 'Exams', '▩', 'exam:read', badges.pendingMarking)
    add('reports', 'Exam reports', '◫', 'report:read:class')
    add('announce', 'Announcements', '◧', 'announcement:create')
    add('profile', 'My profile', '◈')
    return nav
  }

  add('home', 'Home', '▤')
  add('videos', 'Videos', '▶', 'content:read')
  add('materials', 'Materials', '▤', 'content:read')
  add('practice', 'Practice labs', '▧', 'practice:attempt')
  add('labs', 'Graded labs', '◧', 'lab:submit')
  add('exams', 'Exams', '▩', 'exam:read')
  add('results', 'Results', '◫')
  add('profile', 'My profile', '◈')
  return nav
}

export default async function meRoutes(app: FastifyInstance) {
  /** Branding for the login screen, resolved from the school code alone. */
  app.get('/api/v1/public/branding', publicRoute, async req => {
    const code = String((req.query as any)?.schoolCode ?? '').trim()
    if (!code) return { branding: null }
    const rows = await withAdmin(c => c.query<any>(
      `SELECT t.name, t.area, t.status, b.display_name, b.short_name, b.logo_text,
              b.primary_color, b.secondary_color, b.welcome_message
         FROM tenant t JOIN tenant_branding b ON b.tenant_id = t.id
        WHERE lower(t.school_code) = lower($1) AND t.is_platform = false`, [code]))
    if (!rows.length) return { branding: null }
    const b = rows[0]
    return {
      branding: {
        name: b.name, area: b.area,
        displayName: b.display_name, shortName: b.short_name, logoText: b.logo_text,
        primaryColor: b.primary_color, secondaryColor: b.secondary_color,
        welcomeMessage: b.welcome_message,
      },
    }
  })

  app.get('/api/v1/me/bootstrap', requires('me:read'), async req => {
    const a = req.access
    return req.db(async c => {
      const u = (await c.query<any>(
        `SELECT id, full_name, email, username, must_change_pw FROM app_user WHERE id = $1`,
        [a.userId]))[0]

      const t = (await c.query<any>(
        `SELECT t.id, t.name, t.school_code, t.area, t.board, t.tenant_type, t.is_platform,
                b.display_name, b.short_name, b.logo_text, b.primary_color, b.secondary_color, b.welcome_message
           FROM tenant t JOIN tenant_branding b ON b.tenant_id = t.id WHERE t.id = $1`,
        [a.tenantId]))[0]

      const badges: Record<string, number> = {}
      let boundaryExtra: string | undefined

      if (a.roles.includes('TEACHER')) {
        const mine = await c.query<{ class_id: string; name: string }>(
          `SELECT ct.class_id, sc.name FROM class_teacher ct
             JOIN school_class sc ON sc.id = ct.class_id
            WHERE ct.user_id = $1`, [a.userId])
        const ids = mine.map(m => m.class_id)
        boundaryExtra = `Your ${ids.length} class${ids.length === 1 ? '' : 'es'} at ${t.name}`
        if (ids.length) {
          badges.pendingLabs = Number((await c.query<{ n: string }>(
            `SELECT count(*)::text AS n FROM lab_submission
              WHERE class_id = ANY($1::uuid[]) AND status = 'submitted'`, [ids]))[0].n)
          badges.pendingMarking = Number((await c.query<{ n: string }>(
            `SELECT count(*)::text AS n FROM exam_answer ea
               JOIN exam_attempt at ON at.id = ea.attempt_id
               JOIN exam e ON e.id = at.exam_id
               JOIN exam_question eq ON eq.id = ea.exam_question_id
              WHERE e.class_id = ANY($1::uuid[]) AND eq.kind = 'written' AND ea.marks_awarded IS NULL`,
            [ids]))[0].n)
        }
      }

      return {
        user: {
          id: u.id, fullName: u.full_name, email: u.email, username: u.username,
          mustChangePassword: u.must_change_pw,
        },
        tenant: {
          id: t.id, name: t.name, schoolCode: t.school_code, area: t.area, board: t.board,
          type: t.tenant_type, isPlatform: t.is_platform,
        },
        branding: {
          displayName: t.display_name, shortName: t.short_name, logoText: t.logo_text,
          primaryColor: t.primary_color, secondaryColor: t.secondary_color,
          welcomeMessage: t.welcome_message,
        },
        roles: a.roles,
        permissions: [...a.permissions],
        features: [...a.features],
        scope: req.scope,
        boundary: boundaryLine(a, boundaryExtra),
        nav: buildNav(a, badges),
      }
    })
  })

  app.patch('/api/v1/me', requires('me:read'), async req => {
    const { fullName, phone } = (req.body ?? {}) as any
    return req.db(async c => {
      await c.query(
        `UPDATE app_user SET full_name = coalesce($1, full_name), phone = coalesce($2, phone)
          WHERE id = $3`,
        [fullName ?? null, phone ?? null, req.access.userId])
      await req.log_audit(c, {
        action: 'user.updated', entityType: 'app_user', entityId: req.access.userId,
        summary: 'Updated own profile', after: { full_name: fullName },
      })
      return { ok: true }
    })
  })
}
