/** SVG path sets matching public/nav-auth.js ICON map */
export const NAV_ICONS: Record<string, string> = {
  dashboard:
    '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 10v10h14V10"/>',
  products:
    '<path d="M21 16V8a2 2 0 0 0-1-1.73L13 2.27a2 2 0 0 0-2 0L4 6.27A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/>',
  suppliers: '<path d="M3 7h13v10H3z"/><path d="M16 10h3l2 2v5h-5z"/>',
  clients: '<path d="M16 11a4 4 0 1 0-8 0"/><path d="M2 21a8 8 0 0 1 20 0"/>',
  mail: '<path d="M4 6h16v12H4z"/><path d="M4 7l8 6 8-6"/>',
  quotes:
    '<path d="M14 2H7a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7z"/><path d="M14 2v5h5"/>',
  contract:
    '<path d="M14 2H7a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7z"/><path d="M8 13h8"/><path d="M8 17h5"/>',
  indent:
    '<path d="M14 2H7a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7z"/><path d="M8 13h8"/><path d="M8 17h6"/>',
  shipment:
    '<path d="M3 7h11v10H3z"/><path d="M14 10h4l3 3v4h-7z"/><path d="M7 17a2 2 0 1 0 4 0"/><path d="M17 17a2 2 0 1 0 4 0"/>',
  invoice:
    '<path d="M14 2H7a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7z"/><path d="M14 2v5h5"/><path d="M8 13h8"/><path d="M8 17h5"/>',
  commissions:
    '<path d="M12 2v20"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7H14a3.5 3.5 0 0 1 0 7H6"/>',
  sessions:
    '<path d="M12 8v5l3 2"/><path d="M21 12a9 9 0 1 1-9-9"/>',
  reports:
    '<path d="M4 19V5"/><path d="M4 19h16"/><path d="M8 17V9"/><path d="M12 17V7"/><path d="M16 17v-4"/>',
  admin:
    '<path d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z"/><path d="M19.4 15a8 8 0 0 0 .1-1l2-1.2-2-3.4-2.3.6a7.9 7.9 0 0 0-1.7-1L15 6h-6l-.5 2a7.9 7.9 0 0 0-1.7 1L4 8.4 2 11.8 4 13a8 8 0 0 0 .1 1L2 15.2l2 3.4 2.3-.6a7.9 7.9 0 0 0 1.7 1L9 22h6l.5-2a7.9 7.9 0 0 0 1.7-1l2.3.6 2-3.4-2.1-1.2Z"/>',
  settings:
    '<path d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z"/><path d="M19.4 15a8 8 0 0 0 .1-1l2-1.2-2-3.4-2.3.6a7.9 7.9 0 0 0-1.7-1L15 6h-6l-.5 2a7.9 7.9 0 0 0-1.7 1L4 8.4 2 11.8 4 13a8 8 0 0 0 .1 1L2 15.2l2 3.4 2.3-.6a7.9 7.9 0 0 0 1.7 1L9 22h6l.5-2a7.9 7.9 0 0 0 1.7-1l2.3.6 2-3.4-2.1-1.2Z"/>',
  logout: '<path d="M10 17l5-5-5-5"/><path d="M15 12H3"/><path d="M21 3v18"/>',
  menu: '<path d="M4 6h16"/><path d="M4 12h16"/><path d="M4 18h16"/>',
  close: '<path d="M6 6l12 12"/><path d="M18 6 6 18"/>',
}

export function NavIcon({ name }: { name: string }) {
  const paths = NAV_ICONS[name] || ''
  return (
    <span className="nav-icon" aria-hidden="true">
      <svg viewBox="0 0 24 24" dangerouslySetInnerHTML={{ __html: paths }} />
    </span>
  )
}

export function Icon({ name }: { name: string }) {
  const paths = NAV_ICONS[name] || ''
  return (
    <span className="icon" aria-hidden="true">
      <svg viewBox="0 0 24 24" dangerouslySetInnerHTML={{ __html: paths }} />
    </span>
  )
}
