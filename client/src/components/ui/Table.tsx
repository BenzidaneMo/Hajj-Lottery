import type { ReactNode } from 'react'

export interface TableColumn<T> {
  key: string
  header: string
  render: (row: T) => ReactNode
}

export interface TableProps<T> {
  columns: TableColumn<T>[]
  rows: T[]
  getRowKey: (row: T) => string
  emptyMessage?: string
  /**
   * The id of the heading that names this table.
   *
   * Worth passing whenever a page carries more than one: without it a reader
   * moving between tables hears "table" twice and has to read a row to work out
   * which is which. Undefined emits no attribute at all.
   */
  labelledBy?: string
}

export function Table<T>({ columns, rows, getRowKey, emptyMessage, labelledBy }: TableProps<T>) {
  return (
    <div className="overflow-x-auto rounded-xl border border-border">
      <table aria-labelledby={labelledBy} className="w-full min-w-full divide-y divide-border text-sm">
        <thead className="bg-stone-50">
          <tr>
            {columns.map((column) => (
              <th
                key={column.key}
                scope="col"
                className="px-4 py-3 text-start text-xs font-semibold tracking-wide text-stone-500 uppercase"
              >
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border bg-card">
          {rows.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className="px-4 py-8 text-center text-stone-500">
                {emptyMessage}
              </td>
            </tr>
          ) : (
            rows.map((row) => (
              <tr key={getRowKey(row)} className="transition-colors hover:bg-stone-50">
                {columns.map((column) => (
                  <td key={column.key} className="px-4 py-3 text-start text-stone-700">
                    {column.render(row)}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  )
}
