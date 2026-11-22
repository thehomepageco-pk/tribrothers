import { useCallback, useState } from 'react'

export type SortDir = 'asc' | 'desc'

export function useSort<K extends string>(initialKey: K, initialDir: SortDir = 'asc') {
  const [key, setKey] = useState<K>(initialKey)
  const [dir, setDir] = useState<SortDir>(initialDir)

  const toggle = useCallback(
    (next: K) => {
      if (next === key) {
        setDir((d) => (d === 'asc' ? 'desc' : 'asc'))
      } else {
        setKey(next)
        setDir('asc')
      }
    },
    [key],
  )

  return { key, dir, toggle, setKey, setDir }
}
