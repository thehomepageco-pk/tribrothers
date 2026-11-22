import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Link } from 'react-router-dom'

export type RowAction = {
  label: string
  onClick?: () => void
  href?: string
  danger?: boolean
  hidden?: boolean
}

export function RowActionsMenu({ items, label = 'Actions' }: { items: RowAction[]; label?: string }) {
  const [open, setOpen] = useState(false)
  const [coords, setCoords] = useState<{ top: number; left: number; openUp: boolean } | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const menuId = useId()
  const visible = items.filter((i) => !i.hidden)

  function placeMenu() {
    const trigger = triggerRef.current
    if (!trigger) return
    const rect = trigger.getBoundingClientRect()
    const menuH = menuRef.current?.offsetHeight || 120
    const spaceBelow = window.innerHeight - rect.bottom
    const openUp = spaceBelow < menuH + 12 && rect.top > menuH + 12
    const width = Math.max(menuRef.current?.offsetWidth || 150, 150)
    let left = rect.right - width
    left = Math.max(8, Math.min(left, window.innerWidth - width - 8))
    setCoords({
      top: openUp ? rect.top - 4 : rect.bottom + 4,
      left,
      openUp,
    })
  }

  useLayoutEffect(() => {
    if (!open) {
      setCoords(null)
      return
    }
    placeMenu()
  }, [open])

  useEffect(() => {
    if (!open) return
    function onDoc(e: MouseEvent) {
      const t = e.target as Node
      if (rootRef.current?.contains(t) || menuRef.current?.contains(t)) return
      setOpen(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    function onReposition() {
      placeMenu()
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    window.addEventListener('resize', onReposition)
    window.addEventListener('scroll', onReposition, true)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('resize', onReposition)
      window.removeEventListener('scroll', onReposition, true)
    }
  }, [open])

  if (!visible.length) return null

  const menu =
    open && coords
      ? createPortal(
          <div
            ref={menuRef}
            className={`row-actions-dropdown is-fixed${coords.openUp ? ' open-up' : ''}`}
            role="menu"
            id={menuId}
            style={{
              position: 'fixed',
              top: coords.openUp ? undefined : coords.top,
              bottom: coords.openUp ? window.innerHeight - coords.top : undefined,
              left: coords.left,
              zIndex: 4000,
            }}
          >
            {visible.map((item) => {
              const className = `action-menu-item${item.danger ? ' is-danger' : ''}`
              if (item.href) {
                return (
                  <Link
                    key={item.label}
                    role="menuitem"
                    className={className}
                    to={item.href}
                    onClick={() => setOpen(false)}
                  >
                    {item.label}
                  </Link>
                )
              }
              return (
                <button
                  key={item.label}
                  type="button"
                  role="menuitem"
                  className={className}
                  onClick={() => {
                    setOpen(false)
                    item.onClick?.()
                  }}
                >
                  {item.label}
                </button>
              )
            })}
          </div>,
          document.body,
        )
      : null

  return (
    <div className={`row-actions-menu${open ? ' is-open' : ''}`} ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className="action-btn action-menu-trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => setOpen((v) => !v)}
      >
        {label}
        <span className="action-menu-caret" aria-hidden="true">
          ▾
        </span>
      </button>
      {menu}
    </div>
  )
}

export function RowActionsSlot({ children }: { children: ReactNode }) {
  return <div className="row-actions">{children}</div>
}
