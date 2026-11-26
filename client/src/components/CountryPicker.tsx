import { useEffect, useMemo, useRef, useState } from 'react'
import { COUNTRIES, getDialCode } from '@/lib/countries'

export function CountryPicker({
  id,
  name,
  value,
  required,
  disabled,
  placeholder = 'Search country…',
  onChange,
  onSelect,
}: {
  id?: string
  name?: string
  value: string
  required?: boolean
  disabled?: boolean
  placeholder?: string
  onChange: (country: string) => void
  /** Called when a country is chosen from the list (includes dial code). */
  onSelect?: (country: string, dial: string) => void
}) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [highlight, setHighlight] = useState(-1)
  const [query, setQuery] = useState(value)

  useEffect(() => {
    setQuery(value)
  }, [value])

  const list = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return COUNTRIES
    return COUNTRIES.filter((c) => c.name.toLowerCase().includes(q) || c.dial.includes(q))
  }, [query])

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) {
        setOpen(false)
        setHighlight(-1)
        setQuery(value)
      }
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [value])

  function pick(name: string) {
    const dial = getDialCode(name)
    onChange(name)
    onSelect?.(name, dial)
    setQuery(name)
    setOpen(false)
    setHighlight(-1)
  }

  return (
    <div className="country-picker-wrap" ref={wrapRef}>
      <input
        id={id}
        name={name}
        type="text"
        autoComplete="off"
        required={required}
        disabled={disabled}
        placeholder={placeholder}
        value={query}
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          setQuery(e.target.value)
          onChange(e.target.value)
          setOpen(true)
          setHighlight(-1)
        }}
        onKeyDown={(e) => {
          if (!open && (e.key === 'ArrowDown' || e.key === 'Enter')) {
            setOpen(true)
            return
          }
          if (!open) return
          if (e.key === 'ArrowDown') {
            e.preventDefault()
            setHighlight((i) => Math.min(i + 1, list.length - 1))
          } else if (e.key === 'ArrowUp') {
            e.preventDefault()
            setHighlight((i) => Math.max(i - 1, 0))
          } else if (e.key === 'Enter' && highlight >= 0 && list[highlight]) {
            e.preventDefault()
            pick(list[highlight].name)
          } else if (e.key === 'Escape') {
            setOpen(false)
            setHighlight(-1)
            setQuery(value)
          }
        }}
      />
      <div className={`country-picker-dropdown${open ? ' open' : ''}`} role="listbox">
        {list.length === 0 ? (
          <div className="country-picker-empty">No countries found</div>
        ) : (
          list.map((c, i) => (
            <div
              key={c.name}
              className={`country-picker-option${i === highlight ? ' highlighted' : ''}`}
              role="option"
              aria-selected={value === c.name}
              onMouseDown={(e) => {
                e.preventDefault()
                pick(c.name)
              }}
            >
              {c.name}
              <span className="dial">{c.dial}</span>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
