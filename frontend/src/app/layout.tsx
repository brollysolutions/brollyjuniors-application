import type { Metadata, Viewport } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Brolly Juniors — Python & AI, taught properly',
  description: 'Python and AI courses for 11–16 year olds, taught by people who teach.',
}

// Zoom is deliberately left alone: this layout is shared with the marketing
// site, and pinch-to-zoom is the fallback a reader with low vision has.
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#FAF7F0',
  // Lets the layout paint under a notch and the home indicator, which is what
  // makes env(safe-area-inset-*) report anything other than 0 in the WebView.
  // Every rule that uses those insets is in globals.css, section 2.
  viewportFit: 'cover',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>{children}</body>
    </html>
  )
}
