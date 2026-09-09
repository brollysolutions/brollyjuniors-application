'use client'

/**
 * Changing your own password.
 *
 * One component, used by all three profile screens and by the banner a new
 * teacher sees on their first sign-in, so the rules and the wording cannot
 * drift between them.
 *
 * The API signs this device back in as part of the change and hands back a
 * fresh access token; every other device is signed out. Taking that token is
 * what keeps the screen usable afterwards — without it the next request would
 * 401, because changing a password deliberately invalidates every token minted
 * before it.
 */

import React, { useState } from 'react'
import * as client from '@/lib/api'
import { Action, Field, useSession } from '@/components/ui'

const MIN = 8

export function ChangePassword({ onDone }: { onDone?: () => void }) {
  const { me, toast, reload } = useSession()
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [err, setErr] = useState('')
  const [confirmErr, setConfirmErr] = useState('')

  const save = async () => {
    setErr(''); setConfirmErr('')
    if (!current) return setErr('Enter your current password.')
    if (next.length < MIN) return setErr(`Use at least ${MIN} characters.`)
    if (next === current) return setErr('That is the password you already have.')
    // Checked here as well as on the server: a typed-once password you cannot
    // see is the one way to lock yourself out of an account you own.
    if (next !== confirm) return setConfirmErr('These two do not match.')

    try {
      const r = await client.post('/auth/change-password', {
        currentPassword: current, newPassword: next,
      })
      // Before reload(), which would otherwise go out with the token this
      // change just invalidated.
      if (r.accessToken) client.setToken(r.accessToken)
      await reload()
      setCurrent(''); setNext(''); setConfirm('')
      toast(r.signedOutElsewhere
        ? `Password changed — signed out on ${r.signedOutElsewhere} other device${r.signedOutElsewhere > 1 ? 's' : ''}`
        : 'Password changed')
      onDone?.()
    } catch (e: any) {
      setErr(e.message)
    }
  }

  return (
    <>
      <div className="sub" style={{ marginBottom: 12 }}>
        At least {MIN} characters. A phrase you will remember beats symbols you will forget.
        Changing it signs you out everywhere else.
      </div>
      {/* A form, so a password manager offers to update the saved entry and
          Enter submits from the last field. */}
      <form onSubmit={e => { e.preventDefault(); void save() }}>
        {/* Hidden but present: without a username field, browsers save the new
            password against no account and cannot offer it back at sign-in. */}
        <input type="text" autoComplete="username" value={me.user.email}
          readOnly hidden aria-hidden="true" tabIndex={-1} />
        <Field label="Current password" error={err}>
          <input type="password" autoComplete="current-password"
            value={current} onChange={e => setCurrent(e.target.value)} />
        </Field>
        <div className="fieldpair">
          <Field label="New password" help={`At least ${MIN} characters.`}>
            <input type="password" autoComplete="new-password"
              value={next} onChange={e => setNext(e.target.value)} />
          </Field>
          <Field label="Confirm new password" error={confirmErr}>
            <input type="password" autoComplete="new-password"
              value={confirm} onChange={e => setConfirm(e.target.value)} />
          </Field>
        </div>
        <Action label="Change password" working="Changing" onClick={save} />
      </form>
    </>
  )
}

/** The same thing as a card, which is how every profile screen wants it. */
export function PasswordCard() {
  return (
    <div className="card">
      <h3>Password</h3>
      <ChangePassword />
    </div>
  )
}
