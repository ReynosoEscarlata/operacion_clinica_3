import type { ReactNode } from 'react';

export interface DataTableColumn<T> {
  header: string;
  render: (row: T) => ReactNode;
}

interface DataTableProps<T> {
  columns: Array<DataTableColumn<T>>;
  rows: T[];
  rowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
  emptyMessage?: string;
}

export const DataTable = <T,>({
  columns,
  rows,
  rowKey,
  onRowClick,
  emptyMessage = 'No hay datos para estos filtros',
}: DataTableProps<T>): JSX.Element => (
  <div className="overflow-hidden rounded-card border border-black-300 bg-white">
    <table className="w-full text-left text-sm">
      <thead className="bg-ice">
        <tr>
          {columns.map((column) => (
            <th key={column.header} className="px-4 py-3 font-medium text-black-600">
              {column.header}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.length === 0 ? (
          <tr>
            <td colSpan={columns.length} className="px-4 py-8 text-center text-black-600">
              {emptyMessage}
            </td>
          </tr>
        ) : (
          rows.map((row) => (
            <tr
              key={rowKey(row)}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              className={`border-t border-black-300 ${onRowClick ? 'cursor-pointer hover:bg-blue-100' : ''}`}
            >
              {columns.map((column) => (
                <td key={column.header} className="px-4 py-3 text-black-900">
                  {column.render(row)}
                </td>
              ))}
            </tr>
          ))
        )}
      </tbody>
    </table>
  </div>
);
