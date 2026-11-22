import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'

/** Seed list search from `?q=` (and optional highlight id) then strip those params. */
export function useUrlSearch() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [search, setSearch] = useState(() => searchParams.get('q') || '')
  const [highlightId, setHighlightId] = useState(() => searchParams.get('highlight') || '')

  useEffect(() => {
    const q = searchParams.get('q')
    const highlight = searchParams.get('highlight')
    if (q == null && highlight == null) return
    if (q != null) setSearch(q)
    if (highlight != null) setHighlightId(highlight)
    const next = new URLSearchParams(searchParams)
    next.delete('q')
    next.delete('highlight')
    setSearchParams(next, { replace: true })
  }, [searchParams, setSearchParams])

  return { search, setSearch, highlightId, setHighlightId }
}
