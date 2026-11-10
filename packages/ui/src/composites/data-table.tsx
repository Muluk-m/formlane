import { useI18n } from '@atoms-demo/i18n/react'
import type { ReactTable, RowData, TableFeatures } from '@tanstack/react-table'
import { FlexRender } from '@tanstack/react-table'
import { cn } from 'cn'
import type * as React from 'react'
import { Skeleton } from '#components/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '#components/table'

/**
 * Renders a TanStack Table v9 instance with the product's table rules:
 * sticky header, numeric columns right-aligned in tabular mono, skeleton rows while loading,
 * and an explicit empty state (never a blank body).
 */
export function DataTable<TFeatures extends TableFeatures, TData extends RowData>({
  table,
  numericColumns = [],
  loading = false,
  empty,
  className,
}: {
  // biome-ignore lint/suspicious/noExplicitAny: the selector type is irrelevant to rendering
  table: ReactTable<TFeatures, TData, any>
  /** Column ids rendered as right-aligned tabular numbers. */
  numericColumns?: readonly string[]
  loading?: boolean
  empty?: React.ReactNode
  className?: string
}) {
  const { t } = useI18n()
  const headerGroups = table.getHeaderGroups()
  const rows = table.getRowModel().rows
  const columnCount = headerGroups.at(-1)?.headers.length ?? 1
  const isNumeric = (id: string) => numericColumns.includes(id)

  return (
    <div className={cn('relative overflow-auto rounded-lg border bg-card', className)}>
      <Table>
        <TableHeader className="sticky top-0 z-10 bg-surface-sunken">
          {headerGroups.map((group) => (
            <TableRow key={group.id}>
              {group.headers.map((header) => (
                <TableHead
                  key={header.id}
                  className={cn(
                    'h-9 text-xs font-medium',
                    isNumeric(header.column.id) && 'text-right',
                  )}
                >
                  {header.isPlaceholder ? null : <FlexRender header={header} />}
                </TableHead>
              ))}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody>
          {loading
            ? Array.from({ length: 5 }, (_, i) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: placeholder rows have no identity
                <TableRow key={i}>
                  <TableCell colSpan={columnCount} className="h-10">
                    <Skeleton className="h-4 w-full" />
                  </TableCell>
                </TableRow>
              ))
            : rows.map((row) => (
                <TableRow key={row.id} className="h-10">
                  {row.getAllCells().map((cell) => (
                    <TableCell
                      key={cell.id}
                      className={cn(isNumeric(cell.column.id) && 'num text-right')}
                    >
                      <FlexRender cell={cell} />
                    </TableCell>
                  ))}
                </TableRow>
              ))}
          {!loading && rows.length === 0 ? (
            <TableRow>
              <TableCell colSpan={columnCount} className="h-24 text-center text-muted-foreground">
                {empty ?? t('ui.table.empty')}
              </TableCell>
            </TableRow>
          ) : null}
        </TableBody>
      </Table>
    </div>
  )
}
