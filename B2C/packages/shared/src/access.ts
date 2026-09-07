/**
 * Roles, permissions and features — defined once, imported by the API and the
 * web app so a permission string cannot drift between them.
 *
 * Three roles, and no school anywhere:
 *
 *     Brolly Admin  →  Teachers        (employed by Brolly)
 *     Brolly Admin  →  Students        (customers of Brolly)
 *     Teacher  ←→  Student             ONLY through a course
 *
 * Code checks PERMISSIONS, never role names, so a fourth role (a content
 * editor, a support agent, a future School Admin) is a data change.
 */

export type RoleKey = 'BROLLY_ADMIN' | 'TEACHER' | 'STUDENT'

export const FEATURES = {
  catalog: 'Public course catalogue',
  checkout: 'Buying a course',
  live_classes: 'Live teacher-led sessions',
  recordings: 'Recorded tutorials',
  textbooks: 'Textbooks and reading',
  materials: 'Downloadable learning materials',
  exercises: 'Practice exercises',
  quizzes: 'Quizzes and scoring',
  assignments: 'Assignments and grading',
  certificates: 'Certificates and achievements',
  content_hub: 'Authoring and publishing curriculum',
  analytics: 'Platform reporting',
} as const

export type FeatureKey = keyof typeof FEATURES

type PermDef = { key: string; description: string; feature?: FeatureKey }

export const PERMISSIONS: PermDef[] = [
  { key: 'me:read', description: 'Read your own account' },

  // --- platform administration ---------------------------------------------
  { key: 'user:read', description: 'View accounts' },
  { key: 'user:create', description: 'Create a teacher account' },
  { key: 'user:update', description: 'Edit an account' },
  { key: 'user:deactivate', description: 'Deactivate an account' },
  { key: 'role:assign', description: 'Grant a role' },
  { key: 'audit:read', description: 'Read the audit log' },
  { key: 'analytics:read:platform', description: 'Platform-wide reporting', feature: 'analytics' },

  // --- course and curriculum -----------------------------------------------
  { key: 'course:read', description: 'Read course structure' },
  { key: 'course:create', description: 'Create a course' },
  { key: 'course:update', description: 'Edit a course' },
  { key: 'course:publish', description: 'Publish or unpublish a course' },
  { key: 'course:price', description: 'Set course pricing', feature: 'checkout' },
  { key: 'course:assign_teacher', description: 'Put a teacher on a course' },

  // --- content hub ---------------------------------------------------------
  { key: 'content:read', description: 'Read published content', feature: 'textbooks' },
  { key: 'content:create', description: 'Author content', feature: 'content_hub' },
  { key: 'content:update', description: 'Edit a draft', feature: 'content_hub' },
  { key: 'content:review', description: 'Move a draft into review', feature: 'content_hub' },
  { key: 'content:publish', description: 'Publish a content version', feature: 'content_hub' },
  { key: 'media:upload', description: 'Upload media', feature: 'content_hub' },
  { key: 'media:delete', description: 'Remove media', feature: 'content_hub' },
  { key: 'material:manage', description: 'Manage learning materials', feature: 'materials' },

  // --- live and recorded ---------------------------------------------------
  { key: 'live:read', description: 'See live sessions', feature: 'live_classes' },
  { key: 'live:manage', description: 'Schedule and edit live sessions', feature: 'live_classes' },
  { key: 'live:host', description: 'Join a session as the teacher', feature: 'live_classes' },
  { key: 'live:attend', description: 'Join a session as a student', feature: 'live_classes' },
  { key: 'live:attendance', description: 'Mark attendance', feature: 'live_classes' },
  { key: 'recording:read', description: 'Watch recordings', feature: 'recordings' },
  { key: 'recording:manage', description: 'Upload and publish recordings', feature: 'recordings' },

  // --- learning ------------------------------------------------------------
  { key: 'enrollment:read', description: 'See enrolments' },
  { key: 'enrollment:create', description: 'Enrol a student' },
  { key: 'exercise:attempt', description: 'Attempt an exercise', feature: 'exercises' },
  { key: 'quiz:attempt', description: 'Sit a quiz', feature: 'quizzes' },
  { key: 'quiz:manage', description: 'Create and edit quizzes', feature: 'quizzes' },
  { key: 'assignment:read', description: 'See assignments', feature: 'assignments' },
  { key: 'assignment:manage', description: 'Create and edit assignments', feature: 'assignments' },
  { key: 'assignment:submit', description: 'Submit an assignment', feature: 'assignments' },
  { key: 'assignment:grade', description: 'Grade a submission', feature: 'assignments' },

  // --- progress, scoped ----------------------------------------------------
  { key: 'progress:read:self', description: 'See your own progress' },
  { key: 'progress:read:course', description: 'See progress for courses you teach' },
  { key: 'progress:read:platform', description: 'See progress across the platform', feature: 'analytics' },
  { key: 'certificate:read', description: 'See certificates', feature: 'certificates' },
  { key: 'certificate:issue', description: 'Issue a certificate', feature: 'certificates' },

  // --- commerce ------------------------------------------------------------
  { key: 'order:create', description: 'Buy a course', feature: 'checkout' },
  { key: 'order:read:self', description: 'See your own orders', feature: 'checkout' },
  { key: 'order:read:platform', description: 'See all orders', feature: 'checkout' },
]

export const PERMISSION_KEYS = PERMISSIONS.map(p => p.key)
export const PERMISSION_FEATURE: Record<string, FeatureKey | undefined> =
  Object.fromEntries(PERMISSIONS.map(p => [p.key, p.feature]))

export const ROLES: Record<RoleKey, { name: string; level: number; permissions: string[] }> = {
  BROLLY_ADMIN: {
    name: 'Brolly admin',
    level: 100,
    permissions: [
      'me:read',
      'user:read', 'user:create', 'user:update', 'user:deactivate', 'role:assign',
      'audit:read', 'analytics:read:platform',
      'course:read', 'course:create', 'course:update', 'course:publish', 'course:price', 'course:assign_teacher',
      'content:read', 'content:create', 'content:update', 'content:review', 'content:publish',
      'media:upload', 'media:delete', 'material:manage',
      'live:read', 'live:manage', 'live:attendance',
      'recording:read', 'recording:manage',
      'enrollment:read', 'enrollment:create',
      'assignment:read', 'assignment:manage', 'assignment:grade',
      'quiz:manage',
      'progress:read:platform', 'certificate:read', 'certificate:issue',
      'order:read:platform',
    ],
  },
  TEACHER: {
    name: 'Teacher',
    level: 50,
    permissions: [
      'me:read',
      'user:read',
      'course:read', 'content:read',
      'live:read', 'live:host', 'live:attendance',
      'recording:read',
      'enrollment:read',
      'assignment:read', 'assignment:manage', 'assignment:grade',
      'quiz:manage',
      'progress:read:course',
      'certificate:read',
    ],
  },
  STUDENT: {
    name: 'Student',
    level: 10,
    permissions: [
      'me:read',
      'course:read', 'content:read',
      'live:read', 'live:attend',
      'recording:read',
      'enrollment:read',
      'exercise:attempt', 'quiz:attempt',
      'assignment:read', 'assignment:submit',
      'progress:read:self', 'certificate:read',
      'order:create', 'order:read:self',
    ],
  },
}

export const ROLE_THEME: Record<RoleKey, { accent: string; accentSoft: string; label: string }> = {
  BROLLY_ADMIN: { accent: '#2B6CB0', accentSoft: '#E7EFF9', label: 'Brolly admin' },
  TEACHER: { accent: '#157D77', accentSoft: '#D8F2EE', label: 'Teacher' },
  STUDENT: { accent: '#96630A', accentSoft: '#FBEFD3', label: 'Student' },
}
