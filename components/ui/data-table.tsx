"use client";

import { type ReactNode } from "react";

export interface ColumnDef<T> {
  id: string;
  header: string;
  accessorKey?: keyof T;
  cell?: (item: T) => ReactNode;
  sortable?: boolean;
}

interface PaginationInfo {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

interface SortingInfo {
  sortBy: string;
  sortOrder: "asc" | "desc";
}

interface DataTableProps<T> {
  columns: ColumnDef<T>[];
  data: T[];
  pagination: PaginationInfo;
  sorting?: SortingInfo;
  onSort?: (columnId: string) => void;
  onPageChange?: (page: number) => void;
  emptyMessage?: string;
}

export function DataTable<T>({
  columns,
  data,
  pagination,
  sorting,
  onSort,
  onPageChange,
  emptyMessage = "No data available",
}: DataTableProps<T>) {
  const { page, totalPages } = pagination;

  function getCellValue(item: T, column: ColumnDef<T>): ReactNode {
    if (column.cell) return column.cell(item);
    if (column.accessorKey) return String(item[column.accessorKey] ?? "");
    return "";
  }

  function getSortIndicator(columnId: string): string {
    if (!sorting || sorting.sortBy !== columnId) return "";
    return sorting.sortOrder === "asc" ? " \u2191" : " \u2193";
  }

  if (data.length === 0) {
    return (
      <div className="rounded-lg border border-gray-200 bg-white p-12 text-center">
        <p className="text-sm text-gray-500">{emptyMessage}</p>
      </div>
    );
  }

  return (
    <div>
      <div className="overflow-x-auto rounded-lg border border-gray-200">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              {columns.map((col) => (
                <th
                  key={col.id}
                  className={`px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 ${
                    col.sortable ? "cursor-pointer select-none hover:bg-gray-100" : ""
                  }`}
                  onClick={col.sortable && onSort ? () => onSort(col.id) : undefined}
                >
                  {col.header}
                  {getSortIndicator(col.id)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200 bg-white">
            {data.map((item, rowIndex) => (
              <tr key={rowIndex} className="hover:bg-gray-50">
                {columns.map((col) => (
                  <td key={col.id} className="whitespace-nowrap px-6 py-4 text-sm text-gray-900">
                    {getCellValue(item, col)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="mt-4 flex items-center justify-between">
          <p className="text-sm text-gray-700">
            Page {page} of {totalPages}
          </p>
          <div className="flex gap-2">
            <button
              aria-label="Previous page"
              className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
              disabled={page <= 1}
              onClick={() => onPageChange?.(page - 1)}
            >
              Previous
            </button>
            <button
              aria-label="Next page"
              className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
              disabled={page >= totalPages}
              onClick={() => onPageChange?.(page + 1)}
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
