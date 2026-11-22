import type { SortDir } from '@/hooks/useSort'

export function SortTh<K extends string>({
  label,
  sortKey,
  active,
  dir,
  onSort,
}: {
  label: string
  sortKey: K
  active: K
  dir: SortDir
  onSort: (key: K) => void
}) {
  const isActive = active === sortKey
  return (
    <th
      style={{ cursor: 'pointer', userSelect: 'none' }}
      aria-sort={isActive ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'}
      onClick={() => onSort(sortKey)}
    >
      {label}
      <span style={{ marginLeft: 4, opacity: isActive ? 1 : 0.25 }}>
        {isActive ? (dir === 'asc' ? '▲' : '▼') : '↕'}
      </span>
    </th>
  )
}
