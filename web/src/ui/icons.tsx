import type { ReactNode } from 'react'

const base = { width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round' } as const

function I({ children, size }: { children: ReactNode; size?: number }) {
  return (
    <svg {...base} width={size ?? 18} height={size ?? 18} aria-hidden>
      {children}
    </svg>
  )
}

export const Icon = {
  foldedMap: (p: { size?: number }) => (<I {...p}><path d="m3 5 6-2 6 2 6-2v16l-6 2-6-2-6 2V5Zm6-2v16m6-14v16" /></I>),
  textPin: (p: { size?: number }) => (<I {...p}><path d="M3 5h6M3 10h5M3 15h5M21 9c0 4-5 10-5 10S11 13 11 9a5 5 0 0 1 10 0Z" /><circle cx="16" cy="9" r="1.5" /></I>),
  slides: (p: { size?: number }) => (<I {...p}><rect x="3" y="3" width="18" height="13" rx="1.5" /><path d="M12 16v5m-4 0 4-3 4 3M7 8h10M7 11h6" /></I>),
  globe: (p: { size?: number }) => (
    <I {...p}><circle cx="12" cy="12" r="9" /><ellipse cx="12" cy="12" rx="4" ry="9" /><path d="M3 12h18" /></I>
  ),
  palette: (p: { size?: number }) => (
    <I {...p}>
      <path d="M12 3a9 9 0 1 0 0 18h1a2 2 0 0 0 1.4-3.4 1.6 1.6 0 0 1 1.1-2.7H17a4 4 0 0 0 4-4C21 6.5 17 3 12 3Z" />
      <circle cx="7.5" cy="10" r=".8" /><circle cx="10" cy="6.8" r=".8" /><circle cx="14.3" cy="6.8" r=".8" /><circle cx="17" cy="10" r=".8" />
    </I>
  ),
  mindmap: (p: { size?: number }) => (
    <I {...p}><rect x="2" y="9" width="6" height="6" rx="1.5" /><path d="M8 12h5M13 5v14M13 5h3M13 12h3M13 19h3" /><rect x="16" y="3" width="6" height="4" rx="1" /><rect x="16" y="10" width="6" height="4" rx="1" /><rect x="16" y="17" width="6" height="4" rx="1" /></I>
  ),
  tilt: (p: { size?: number }) => (
    <I {...p}>
      <path d="M3.5 17.5 7 8h10l3.5 9.5z" />
      <path d="M12 8v9.5M5.2 13h13.6" opacity="0.55" />
    </I>
  ),
  library: (p: { size?: number }) => (
    <I {...p}>
      <path d="M4 4h4v16H4zM10 4h4v16h-4z" />
      <path d="m16.2 5.6 3.8-.9 3 14.5-3.8.9z" transform="translate(-1.4 0)" />
    </I>
  ),
  list: (p: { size?: number }) => (
    <I {...p}>
      <path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01" />
    </I>
  ),
  up: (p: { size?: number }) => (
    <I {...p}>
      <path d="m6 14 6-6 6 6" />
    </I>
  ),
  left: (p: { size?: number }) => (
    <I {...p}>
      <path d="m15 5-7 7 7 7" />
    </I>
  ),
  right: (p: { size?: number }) => (
    <I {...p}>
      <path d="m9 5 7 7-7 7" />
    </I>
  ),
  plus: (p: { size?: number }) => (
    <I {...p}>
      <path d="M12 5v14M5 12h14" />
    </I>
  ),
  minus: (p: { size?: number }) => (
    <I {...p}>
      <path d="M5 12h14" />
    </I>
  ),
  fit: (p: { size?: number }) => (
    <I {...p}>
      <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />
    </I>
  ),
  frameBook: (p: { size?: number }) => (
    <I {...p}>
      <rect x="2" y="3" width="20" height="18" rx="2" />
      <path d="M6 8c2-1 4-.7 6 .4 2-1.1 4-1.4 6-.4v8c-2-1-4-.7-6 .4-2-1.1-4-1.4-6-.4V8ZM12 8.4v8" />
    </I>
  ),
  shrink: (p: { size?: number }) => (
    <I {...p}>
      <path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" />
    </I>
  ),
  book: (p: { size?: number }) => (
    <I {...p}>
      <path d="M4 5.5C6.5 4.4 9.5 4.4 12 6c2.5-1.6 5.5-1.6 8-.5V19c-2.5-1.1-5.5-1.1-8 .5-2.5-1.6-5.5-1.6-8-.5z" />
      <path d="M12 6v13.5" />
    </I>
  ),
  bookClosed: (p: { size?: number }) => (
    <I {...p}>
      <path d="M6 4h12v16H6z" />
      <path d="M6 4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2M10 8h5" />
    </I>
  ),
  highlight: (p: { size?: number }) => (
    <I {...p}>
      <path d="m4 20 4.5-1 9.8-9.8-3.5-3.5L5 15.5z" />
      <path d="m13.5 6.5 3.5 3.5M4 20h6" />
    </I>
  ),
  underline: (p: { size?: number }) => (
    <I {...p}>
      <path d="M7 4v7a5 5 0 0 0 10 0V4M5 20h14" />
    </I>
  ),
    judou: (p: { size?: number }) => (
        <I {...p}>
            <path d="M6 4v16"/>
            <path d="m11 15 5-9"/>
        </I>
    ),
  note: (p: { size?: number }) => (
    <I {...p}>
      <path d="M5 4h14v10l-5 6H5z" />
      <path d="M14 20v-5a1 1 0 0 1 1-1h4M8.5 9h7M8.5 12.5h4" />
    </I>
  ),
  sparkle: (p: { size?: number }) => (
    <I {...p}>
      <path d="M12 3c.6 4.3 2.7 6.4 7 7-4.3.6-6.4 2.7-7 7-.6-4.3-2.7-6.4-7-7 4.3-.6 6.4-2.7 7-7z" />
      <path d="M19 16.5c.2 1.5.9 2.2 2.4 2.5-1.5.2-2.2.9-2.4 2.5-.2-1.5-.9-2.2-2.4-2.5 1.5-.3 2.2-1 2.4-2.5z" />
    </I>
  ),
  copy: (p: { size?: number }) => (
    <I {...p}>
      <rect x="8" y="8" width="12" height="12" rx="2" />
      <path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" />
    </I>
  ),
  trash: (p: { size?: number }) => (
    <I {...p}>
      <path d="M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13M10 11v6M14 11v6" />
    </I>
  ),
  close: (p: { size?: number }) => (
    <I {...p}>
      <path d="m6 6 12 12M18 6 6 18" />
    </I>
  ),
  send: (p: { size?: number }) => (
    <I {...p}>
      <path d="M5 12 20 5l-4 15-4-6z" />
      <path d="m12 14 8-9" />
    </I>
  ),
  upload: (p: { size?: number }) => (
    <I {...p}>
      <path d="M12 16V4M7 9l5-5 5 5M5 20h14" />
    </I>
  ),
  stop: (p: { size?: number }) => (
    <I {...p}>
      <rect x="6" y="6" width="12" height="12" rx="2" />
    </I>
  ),
}
