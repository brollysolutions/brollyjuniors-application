import type { CapacitorConfig } from '@capacitor/cli'

/**
 * Capacitor — the iOS/Android shell around the exported Next bundle.
 *
 * webDir is `out`, which only exists after `npm run build:mobile` (MOBILE=1,
 * so next.config.ts switches to output: 'export'). `npx cap sync` copies that
 * directory into the native projects; there is no bundler of Capacitor's own.
 *
 * CAP_SERVER_URL turns on live reload: point the shell at a dev server on the
 * LAN instead of the copied files, e.g.
 *
 *   CAP_SERVER_URL=http://192.168.1.20:3000 npm run cap:run:android
 *
 * It must be a LAN address, not localhost — on a device or emulator localhost
 * is the phone. cleartext is allowed only in that mode, and only because a dev
 * server is plain http; shipped builds are HTTPS-only.
 */
const devServer = process.env.CAP_SERVER_URL

const config: CapacitorConfig = {
  appId: 'in.brollyjuniors.app',
  appName: 'Brolly Juniors',
  webDir: 'out',

  server: {
    // https://localhost rather than http://: it counts as a secure context, so
    // the WebView will not withhold APIs the app needs, and it matches the
    // origin the API's CORS list names.
    androidScheme: 'https',
    ...(devServer ? { url: devServer, cleartext: true } : {}),
  },

  ios: {
    contentInset: 'always',
  },

  plugins: {
    // Routes fetch/XHR through the native HTTP stack instead of the WebView's.
    //
    // This is what makes the existing auth design survive the move to a phone.
    // The refresh token is an HttpOnly cookie, and from capacitor://localhost
    // the API is a third party: iOS WKWebView's tracking prevention drops such
    // cookies, so a WebView-issued /auth/refresh would silently stop restoring
    // sessions. The native stack has its own cookie jar, which is not subject
    // to that, and skips CORS preflight entirely.
    CapacitorHttp: { enabled: true },

    SplashScreen: {
      // Held open until App.tsx has restored the session, so the first painted
      // frame is the real screen rather than a flash of the signed-out shop.
      launchAutoHide: false,
      backgroundColor: '#FAF7F0',
      androidScaleType: 'CENTER_CROP',
      showSpinner: false,
    },
    // Keyboard is left at its defaults — both platforms already resize the
    // WebView natively. The one change worth making, hiding iOS's accessory
    // bar, is a runtime call in src/lib/native.ts.
  },
}

export default config
