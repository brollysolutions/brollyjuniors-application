import React from 'react'
import type { Block } from '@brolly/shared'

/**
 * The block renderer.
 *
 * Authored content is a validated block document, never HTML, so there is
 * nowhere for a script to live: this component only knows a fixed set of types.
 * An unknown type renders as a quiet placeholder rather than breaking the page,
 * which is what lets an author use a new block before every client ships
 * support for it.
 */
export function Blocks({ blocks }: { blocks: Block[] | null | undefined }) {
  if (!Array.isArray(blocks) || !blocks.length) {
    return <p className="muted">Nothing here yet.</p>
  }
  return (
    <>
      {blocks.map((b, i) => <BlockView key={i} block={b} />)}
    </>
  )
}

function BlockView({ block }: { block: any }) {
  switch (block?.type) {
    case 'heading': {
      const level = Math.min(4, Math.max(2, Number(block.level) || 3))
      const Tag = (`h${level}`) as 'h2' | 'h3' | 'h4'
      return <Tag>{block.text}</Tag>
    }
    case 'paragraph':
      return <p>{block.text}</p>
    case 'list':
      return <ul>{(block.items ?? []).map((it: string, i: number) => <li key={i}>{it}</li>)}</ul>
    case 'code':
      return <pre><code>{block.source}</code></pre>
    case 'callout':
      return <div className={'callout' + (block.variant === 'warning' ? ' warning' : '')}>{block.text}</div>
    case 'image':
      // Media is referenced by id and resolved to a signed URL at delivery time.
      return (
        <figure style={{ margin: '0 0 12px' }}>
          <div className="dropzone" style={{ padding: 34 }}>▤ {block.alt || 'Image'}</div>
          {block.caption ? <figcaption className="tiny muted" style={{ marginTop: 6 }}>{block.caption}</figcaption> : null}
        </figure>
      )
    default:
      return (
        <p className="muted tiny">
          This part of the page needs a newer version of the app. Everything else is up to date.
        </p>
      )
  }
}
