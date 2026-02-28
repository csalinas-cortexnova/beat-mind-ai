import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DataTable, type ColumnDef } from "../data-table";

interface TestItem {
  id: string;
  name: string;
  status: string;
}

const columns: ColumnDef<TestItem>[] = [
  { id: "name", header: "Name", accessorKey: "name", sortable: true },
  { id: "status", header: "Status", accessorKey: "status" },
];

const sampleData: TestItem[] = [
  { id: "1", name: "Gym Alpha", status: "active" },
  { id: "2", name: "Gym Beta", status: "suspended" },
  { id: "3", name: "Gym Gamma", status: "active" },
];

const defaultPagination = { page: 1, limit: 10, total: 3, totalPages: 1 };

describe("DataTable", () => {
  afterEach(cleanup);

  it("should render column headers", () => {
    render(<DataTable columns={columns} data={sampleData} pagination={defaultPagination} />);
    expect(screen.getByText("Name")).toBeDefined();
    expect(screen.getByText("Status")).toBeDefined();
  });

  it("should render data rows", () => {
    render(<DataTable columns={columns} data={sampleData} pagination={defaultPagination} />);
    expect(screen.getByText("Gym Alpha")).toBeDefined();
    expect(screen.getByText("Gym Beta")).toBeDefined();
    expect(screen.getByText("Gym Gamma")).toBeDefined();
  });

  it("should show empty message when data is empty", () => {
    render(
      <DataTable
        columns={columns}
        data={[]}
        pagination={{ page: 1, limit: 10, total: 0, totalPages: 0 }}
        emptyMessage="No gyms found"
      />
    );
    expect(screen.getByText("No gyms found")).toBeDefined();
  });

  it("should show default empty message when none provided", () => {
    render(
      <DataTable
        columns={columns}
        data={[]}
        pagination={{ page: 1, limit: 10, total: 0, totalPages: 0 }}
      />
    );
    expect(screen.getByText("No data available")).toBeDefined();
  });

  it("should render custom cell renderer", () => {
    const columnsWithRenderer: ColumnDef<TestItem>[] = [
      { id: "name", header: "Name", accessorKey: "name" },
      {
        id: "status",
        header: "Status",
        cell: (item) => <span data-testid="custom-cell">{item.status.toUpperCase()}</span>,
      },
    ];
    render(<DataTable columns={columnsWithRenderer} data={sampleData} pagination={defaultPagination} />);
    const customCells = screen.getAllByTestId("custom-cell");
    expect(customCells).toHaveLength(3);
    expect(customCells[0].textContent).toBe("ACTIVE");
  });

  it("should show sort indicator on sortable columns", () => {
    render(
      <DataTable
        columns={columns}
        data={sampleData}
        pagination={defaultPagination}
        sorting={{ sortBy: "name", sortOrder: "asc" }}
      />
    );
    // header + sort indicator are sibling text nodes, so use a function matcher
    const nameHeader = screen.getByText((_content, element) => {
      return element?.tagName === "TH" && element?.textContent?.includes("Name") || false;
    });
    expect(nameHeader.textContent).toContain("\u2191");
  });

  it("should call onSort when clicking sortable column header", async () => {
    const user = userEvent.setup();
    const onSort = vi.fn();
    render(
      <DataTable
        columns={columns}
        data={sampleData}
        pagination={defaultPagination}
        onSort={onSort}
      />
    );
    await user.click(screen.getByText("Name"));
    expect(onSort).toHaveBeenCalledWith("name");
  });

  it("should not call onSort when clicking non-sortable column", async () => {
    const user = userEvent.setup();
    const onSort = vi.fn();
    render(
      <DataTable
        columns={columns}
        data={sampleData}
        pagination={defaultPagination}
        onSort={onSort}
      />
    );
    await user.click(screen.getByText("Status"));
    expect(onSort).not.toHaveBeenCalled();
  });

  it("should show pagination info", () => {
    render(
      <DataTable
        columns={columns}
        data={sampleData}
        pagination={{ page: 1, limit: 10, total: 25, totalPages: 3 }}
      />
    );
    expect(screen.getByText(/1.*of.*3/i)).toBeDefined();
  });

  it("should call onPageChange when clicking next page", async () => {
    const user = userEvent.setup();
    const onPageChange = vi.fn();
    render(
      <DataTable
        columns={columns}
        data={sampleData}
        pagination={{ page: 1, limit: 10, total: 25, totalPages: 3 }}
        onPageChange={onPageChange}
      />
    );
    const nextButton = screen.getByRole("button", { name: /next/i });
    await user.click(nextButton);
    expect(onPageChange).toHaveBeenCalledWith(2);
  });

  it("should disable previous button on first page", () => {
    render(
      <DataTable
        columns={columns}
        data={sampleData}
        pagination={{ page: 1, limit: 10, total: 25, totalPages: 3 }}
      />
    );
    const prevButton = screen.getByRole("button", { name: /previous/i });
    expect(prevButton).toBeDisabled();
  });

  it("should disable next button on last page", () => {
    render(
      <DataTable
        columns={columns}
        data={sampleData}
        pagination={{ page: 3, limit: 10, total: 25, totalPages: 3 }}
      />
    );
    const nextButton = screen.getByRole("button", { name: /next/i });
    expect(nextButton).toBeDisabled();
  });

  it("should not show pagination when only one page", () => {
    render(
      <DataTable
        columns={columns}
        data={sampleData}
        pagination={defaultPagination}
      />
    );
    expect(screen.queryByRole("button", { name: /next/i })).toBeNull();
  });
});
