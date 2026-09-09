'use client'

import { App as CapApp } from '@capacitor/app'
import { Keyboard } from '@capacitor/keyboard'
import { SplashScreen } from '@capacitor/splash-screen'
import { StatusBar, Style } from '@capacitor/status-bar'

import { isNative, platform } from './platform'

/**
 * The parts of the app that only exist on a phone.
 *
 * Every call is behind isNative(), so importing this module on the web costs a
 * few kilobytes and does nothing. The plugins themselves would throw
 * "not implemented" in a browser, which is why none of them is called blind.
 */

/** Chrome the browser gives us for free and a native shell does not. */
export async function initNative(): Promise<void> {
  if (!isNative()) return
  try {
    // --paper. Style.Light means dark text, which is what a cream bar needs.
    await StatusBar.setStyle({ style: Style.Light })
    if (platform() === 'android') {
      await StatusBar.setBackgroundColor({ color: '#FAF7F0' })
      // Own strip rather than drawn under: the layout was written for a
      // browser viewport and has no allowance for a notch.
      await StatusBar.setOverlaysWebView({ overlay: false })
    }
    if (platform() === 'ios') {
      // The Prev/Next/Done bar adds nothing to single-field forms.
      await Keyboard.setAccessoryBarVisible({ isVisible: false })
    }
  } catch {
    // A missing status bar is not a reason to fail to start.
  }
}

/**
 * Reveal the app.
 *
 * The splash is configured launchAutoHide: false, so this is the only thing
 * that ends it — call it once the first real screen can be painted.
 */
export async function hideSplash(): Promise<void> {
  if (!isNative()) return
  try {
    await SplashScreen.hide()
  } catch { /* already gone */ }
}

/**
 * Android's hardware back button.
 *
 * Without this the button leaves the app from any screen, because this app
 * navigates by state and never touches browser history — so the WebView has
 * nothing to go back to. `handler` returns true if it consumed the press;
 * when it does not, the app goes to the background rather than exiting, which
 * is what the platform's own apps do at a root screen.
 */
export function onBackButton(handler: () => boolean): () => void {
  if (!isNative()) return () => {}

  const pending = CapApp.addListener('backButton', () => {
    if (handler()) return
    CapApp.minimizeApp().catch(() => {})
  })

  return () => { pending.then(l => l.remove()).catch(() => {}) }
}
