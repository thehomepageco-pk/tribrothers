import { useCallback, useMemo, useState } from 'react'

export function useSelection<T extends { _id: string }>(items: T[]) {
  const [selected, setSelected] = useState<Set<string>>(() => new Set())

  const ids = useMemo(() => items.map((i) => i._id), [items])

  const toggle = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const toggleAll = useCallback(() => {
    setSelected((prev) => {
      if (ids.length === 0) return new Set()
      const allSelected = ids.every((id) => prev.has(id))
      return allSelected ? new Set() : new Set(ids)
    })
  }, [ids])

  const clear = useCallback(() => setSelected(new Set()), [])

  const allSelected = ids.length > 0 && ids.every((id) => selected.has(id))
  const someSelected = ids.some((id) => selected.has(id)) && !allSelected

  return {
    selected,
    count: selected.size,
    has: (id: string) => selected.has(id),
    toggle,
    toggleAll,
    clear,
    allSelected,
    someSelected,
    selectedIds: [...selected],
  }
}
