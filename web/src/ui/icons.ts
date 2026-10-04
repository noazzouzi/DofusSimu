/** Icônes SVG inline (pleines, 24×24). */
const svg = (d: string) => `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${d}"/></svg>`

export const ICONS = {
  play: svg('M8 5.6v12.8a1 1 0 0 0 1.53.85l10.1-6.4a1 1 0 0 0 0-1.7L9.53 4.75A1 1 0 0 0 8 5.6Z'),
  pause: svg('M6.5 5.5A1.5 1.5 0 0 1 8 4h1.5A1.5 1.5 0 0 1 11 5.5v13A1.5 1.5 0 0 1 9.5 20H8a1.5 1.5 0 0 1-1.5-1.5Zm6.5 0A1.5 1.5 0 0 1 14.5 4H16a1.5 1.5 0 0 1 1.5 1.5v13A1.5 1.5 0 0 1 16 20h-1.5a1.5 1.5 0 0 1-1.5-1.5Z'),
  replay: svg('M12 4a8 8 0 1 1-7.75 10h2.1A6 6 0 1 0 8 7.76V10H3V5h2v1.36A7.97 7.97 0 0 1 12 4Z'),
  next: svg('M6 6.2v11.6a.8.8 0 0 0 1.24.66l8.1-5.8a.8.8 0 0 0 0-1.32l-8.1-5.8A.8.8 0 0 0 6 6.2ZM16.5 6h2v12h-2Z'),
  prev: svg('M18 6.2v11.6a.8.8 0 0 1-1.24.66l-8.1-5.8a.8.8 0 0 1 0-1.32l8.1-5.8A.8.8 0 0 1 18 6.2ZM5.5 6h2v12h-2Z'),
  nextTurn: svg('M3.5 6.6v10.8a.7.7 0 0 0 1.1.57L12 12.7v4.7a.7.7 0 0 0 1.1.57l7.6-5.4a.7.7 0 0 0 0-1.14L13.1 6.03A.7.7 0 0 0 12 6.6v4.7L4.6 6.03A.7.7 0 0 0 3.5 6.6Z'),
  prevTurn: svg('M20.5 6.6v10.8a.7.7 0 0 1-1.1.57L12 12.7v4.7a.7.7 0 0 1-1.1.57l-7.6-5.4a.7.7 0 0 1 0-1.14l7.6-5.4A.7.7 0 0 1 12 6.6v4.7l7.4-5.27a.7.7 0 0 1 1.1.57Z'),
  start: svg('M4 5h2.2v14H4ZM20 6.6v10.8a.7.7 0 0 1-1.1.57L13.2 13v4.4a.7.7 0 0 1-1.1.57l-5.4-5.4a.7.7 0 0 1 0-1.14l5.4-5.4a.7.7 0 0 1 1.1.57V11l5.7-4.97A.7.7 0 0 1 20 6.6Z'),
  end: svg('M17.8 5H20v14h-2.2ZM4 6.6v10.8a.7.7 0 0 0 1.1.57L10.8 13v4.4a.7.7 0 0 0 1.1.57l5.4-5.4a.7.7 0 0 0 0-1.14l-5.4-5.4a.7.7 0 0 0-1.1.57V11L5.1 6.03A.7.7 0 0 0 4 6.6Z'),
}

/** Icônes du bouton de zoom (au trait). */
export const ZOOM_ICONS = {
  follow: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6"/><path d="M15 15l5 5M10.5 8v5M8 10.5h5"/></svg>',
  overview: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>',
}

/** Icônes du sélecteur de thème (au trait). */
export const THEME_ICONS = {
  auto: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8"/><path d="M12 4a8 8 0 0 1 0 16Z" fill="currentColor"/></svg>',
  light:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5.3 5.3l1.6 1.6M17.1 17.1l1.6 1.6M5.3 18.7l1.6-1.6M17.1 6.9l1.6-1.6"/></svg>',
  dark: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19.5 14.2A7.8 7.8 0 0 1 9.8 4.5a7.8 7.8 0 1 0 9.7 9.7Z"/></svg>',
}
