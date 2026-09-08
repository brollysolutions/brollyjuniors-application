'use client'

import { Note, useSession } from '@/components/ui'

/**
 * The teacher and admin portals have not been ported to Next.js yet.
 *
 * This is a deliberate placeholder rather than a broken screen: the backend
 * endpoints behind these portals are not in this slice either, so pretending
 * the UI existed would mean a page that renders and then fails on every fetch.
 */
export default function NotPorted({ role }: { role: string }) {
  const { me, signOut } = useSession()
  return (
    <div style={{ maxWidth: 720 }}>
      <h2 style={{ marginTop: 0 }}>The {role} portal is not in this build yet</h2>
      <Note>
        <p style={{ marginTop: 0 }}>
          You are signed in correctly as <strong>{me.user.fullName}</strong>, and the API granted
          you {me.permissions.length} permissions — authentication, roles and the permission model
          all work for this account.
        </p>
        <p style={{ marginBottom: 0 }}>
          What is missing is the {role} screens and the endpoints behind them. This build ports the
          public site and the student portal; the {role} portal is the next stage.
        </p>
      </Note>
      <div style={{ marginTop: 18 }}>
        <button className="btn ghost" onClick={signOut}>Sign out</button>
      </div>
    </div>
  )
}
