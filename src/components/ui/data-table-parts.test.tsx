// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  DataTableBody,
  DataTableCells,
  DataTableHeaderGroups,
  DataTablePagination,
  DataTableRowActions,
  DataTableSortableHeader,
  DataTableToolbar,
  formatTableRange,
  resolveTableUpdater,
  type DataTablePaginationTable,
} from "./data-table-parts";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function paginationTable(
  overrides: Partial<DataTablePaginationTable> = {},
): DataTablePaginationTable {
  return {
    firstPage: vi.fn(),
    previousPage: vi.fn(),
    nextPage: vi.fn(),
    lastPage: vi.fn(),
    getCanPreviousPage: () => true,
    getCanNextPage: () => true,
    getCanLastPage: () => true,
    getPageCount: () => 3,
    ...overrides,
  };
}

describe("table helpers", () => {
  it("resolves functional and direct updaters", () => {
    expect(resolveTableUpdater((current: number) => current + 1, 4)).toBe(5);
    expect(resolveTableUpdater(9, 4)).toBe(9);
  });

  it("formats empty and populated ranges with the noun", () => {
    expect(formatTableRange(0, 0, 0, "terms")).toBe("0 terms");
    expect(formatTableRange(1, 25, 1200, "terms")).toBe("1–25 of 1,200 terms");
  });
});

describe("DataTableToolbar", () => {
  it("debounces the search input and sends the typed query once", async () => {
    vi.useFakeTimers();
    const onSearchChange = vi.fn();
    render(
      <DataTableToolbar
        searchValue=""
        searchLabel="Search jobs"
        searchPlaceholder="Search jobs"
        onSearchChange={onSearchChange}
        filters={[]}
        clearLabel="Clear filters"
        filtered={false}
        onClearFilters={vi.fn()}
        description="All runs"
      />,
    );

    fireEvent.change(screen.getByRole("textbox", { name: "Search jobs" }), {
      target: { value: "older" },
    });
    expect(onSearchChange).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(onSearchChange).toHaveBeenCalledExactlyOnceWith("older");
  });

  it("clears the pending debounce when filters are cleared", async () => {
    vi.useFakeTimers();
    const onSearchChange = vi.fn();
    const onClearFilters = vi.fn();
    function Harness() {
      const [searchValue, setSearchValue] = useState("original");
      return (
        <DataTableToolbar
          searchValue={searchValue}
          searchLabel="Search jobs"
          searchPlaceholder="Search jobs"
          onSearchChange={onSearchChange}
          filters={[]}
          clearLabel="Clear filters"
          filtered
          onClearFilters={() => {
            onClearFilters();
            setSearchValue("");
          }}
          description="All runs"
        />
      );
    }
    render(<Harness />);

    fireEvent.change(screen.getByRole("textbox", { name: "Search jobs" }), {
      target: { value: "stale" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });

    expect(onClearFilters).toHaveBeenCalledOnce();
    expect(onSearchChange).not.toHaveBeenCalled();
    expect((screen.getByRole("textbox", { name: "Search jobs" }) as HTMLInputElement).value).toBe(
      "",
    );
  });

  it("reports filter changes and column visibility toggles", () => {
    const onChange = vi.fn();
    const toggleVisibility = vi.fn();
    render(
      <DataTableToolbar
        searchValue=""
        searchLabel="Search jobs"
        searchPlaceholder="Search jobs"
        onSearchChange={vi.fn()}
        filters={[
          {
            ariaLabel: "Filter by type",
            value: "all",
            items: { all: "All types", scrape: "Scrapes" },
            onChange,
          },
        ]}
        columns={{
          table: {
            getAllLeafColumns: () => [
              { id: "note", getCanHide: () => true, getIsVisible: () => false, toggleVisibility },
              { id: "source", getCanHide: () => false, getIsVisible: () => true, toggleVisibility },
            ],
          },
          labels: { note: "Note" },
        }}
        clearLabel="Clear filters"
        filtered={false}
        onClearFilters={vi.fn()}
        description="All runs"
      />,
    );

    fireEvent.click(screen.getByRole("combobox", { name: "Filter by type" }));
    fireEvent.pointerDown(screen.getByRole("option", { name: "Scrapes" }), {
      pointerType: "mouse",
    });
    fireEvent.click(screen.getByRole("option", { name: "Scrapes" }));
    expect(onChange).toHaveBeenCalledWith("scrape");

    fireEvent.click(screen.getByRole("button", { name: "Columns" }));
    expect(screen.queryByRole("menuitemcheckbox", { name: "source" })).toBeNull();
    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: "Note" }));
    expect(toggleVisibility).toHaveBeenCalledWith(true);
  });

  it("shows the updating status and busy banner from the query state", () => {
    const { rerender } = render(
      <DataTableToolbar
        searchValue=""
        searchLabel="Search jobs"
        searchPlaceholder="Search jobs"
        onSearchChange={vi.fn()}
        filters={[]}
        clearLabel="Clear filters"
        filtered={false}
        onClearFilters={vi.fn()}
        description="All runs"
        query={{ isFetching: true, isPlaceholderData: false }}
      />,
    );
    expect(screen.getByRole("status").textContent).toContain("Updating…");
    expect(screen.queryByText("Loading job page…")).toBeNull();

    rerender(
      <DataTableToolbar
        searchValue=""
        searchLabel="Search jobs"
        searchPlaceholder="Search jobs"
        onSearchChange={vi.fn()}
        filters={[]}
        clearLabel="Clear filters"
        filtered={false}
        onClearFilters={vi.fn()}
        description="All runs"
        query={{ isFetching: true, isPlaceholderData: true }}
        busyMessage="Loading job page…"
      />,
    );
    expect(screen.getByText("Loading job page…")).toBeTruthy();
  });
});

describe("DataTableSortableHeader", () => {
  it("toggles sort direction from the current sorted state", () => {
    const toggleSorting = vi.fn();
    const { rerender } = render(
      <DataTableSortableHeader
        column={{ getIsSorted: () => false, toggleSorting }}
        label="Start"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Sort by Start" }));
    expect(toggleSorting).toHaveBeenCalledWith(false);

    rerender(
      <DataTableSortableHeader
        column={{ getIsSorted: () => "asc", toggleSorting }}
        label="Start"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Sort by Start" }));
    expect(toggleSorting).toHaveBeenLastCalledWith(true);
  });
});

describe("DataTableRowActions", () => {
  it("renders items in order with destructive actions last", async () => {
    const onSelect = vi.fn();
    const onDelete = vi.fn();
    render(
      <DataTableRowActions
        triggerLabel="Actions for alpha"
        menuLabel="Entry actions"
        items={[
          { label: "Edit", onSelect },
          { label: "Restore", onSelect },
          { label: "Delete", variant: "destructive", onSelect: onDelete },
        ]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Actions for alpha" }));
    await waitFor(() => expect(screen.getByRole("menu")).toBeTruthy());
    const items = screen.getAllByRole("menuitem").map((item) => item.textContent);
    expect(items).toEqual(["Edit", "Restore", "Delete"]);

    fireEvent.click(screen.getByRole("menuitem", { name: "Delete" }));
    expect(onDelete).toHaveBeenCalledOnce();
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("disables every action while pending", () => {
    render(
      <DataTableRowActions
        triggerLabel="Actions for alpha"
        menuLabel="Entry actions"
        pending
        items={[{ label: "Edit", onSelect: vi.fn() }]}
      />,
    );
    expect(
      (screen.getByRole("button", { name: "Actions for alpha" }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });
});

describe("DataTablePagination", () => {
  it("drives navigation through the table adapter", () => {
    const table = paginationTable();
    render(
      <DataTablePagination
        table={table}
        firstRow={1}
        lastRow={25}
        rowCount={120}
        currentPage={1}
        busy={false}
        pageSize={25}
        pageSizeOptions={[10, 25, 50]}
        noun="jobs"
        onPageSizeChange={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Next page" }));
    expect(table.nextPage).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: "Last page" }));
    expect(table.lastPage).toHaveBeenCalledOnce();
    expect(screen.getByText("1–25 of 120 jobs")).toBeTruthy();
    expect(screen.getByText("Page 1 of 3")).toBeTruthy();
  });

  it("only reports page sizes offered by the table", () => {
    const onPageSizeChange = vi.fn();
    render(
      <DataTablePagination
        table={paginationTable()}
        firstRow={0}
        lastRow={0}
        rowCount={0}
        currentPage={1}
        busy
        pageSize={10}
        pageSizeOptions={[10, 25]}
        noun="terms"
        onPageSizeChange={onPageSizeChange}
      />,
    );

    expect(screen.getByText("0 terms")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Next page" }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    fireEvent.click(screen.getByRole("combobox", { name: "Rows per page" }));
    fireEvent.pointerDown(screen.getByRole("option", { name: "25" }), { pointerType: "mouse" });
    fireEvent.click(screen.getByRole("option", { name: "25" }));
    expect(onPageSizeChange).toHaveBeenCalledWith(25);
  });
});

describe("DataTableBody", () => {
  it("renders skeleton rows while the first page loads", () => {
    const { container } = render(
      <table>
        <DataTableBody
          initialLoading
          noRows={false}
          filtered={false}
          visibleColumnCount={2}
          rows={
            <tr>
              <td>row</td>
            </tr>
          }
          emptyTitle="Nothing here"
          filteredTitle="Nothing matches"
          emptyDescription="Add one."
          filteredDescription="Clear filters."
          onClearFilters={vi.fn()}
        />
      </table>,
    );
    expect(container.querySelectorAll("tbody tr").length).toBe(7);
  });

  it("falls back to the filtered empty state and clears filters", () => {
    const onClearFilters = vi.fn();
    render(
      <table>
        <DataTableBody
          initialLoading={false}
          noRows
          filtered
          visibleColumnCount={2}
          rows={null}
          emptyTitle="Nothing here"
          filteredTitle="Nothing matches"
          emptyDescription="Add one."
          filteredDescription="Clear filters."
          onClearFilters={onClearFilters}
        />
      </table>,
    );

    expect(screen.getByText("Nothing matches")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(onClearFilters).toHaveBeenCalledOnce();
  });
});

describe("desktop scaffolds", () => {
  it("pins the actions column and forwards header/cell rendering", () => {
    const { container } = render(
      <table>
        <thead>
          <DataTableHeaderGroups
            groups={[
              {
                id: "group-1",
                headers: [
                  { id: "name", isPlaceholder: false, column: { id: "name" } },
                  { id: "actions", isPlaceholder: false, column: { id: "actions" } },
                ],
              },
            ]}
            renderHeader={(header) => <span>{header.id}</span>}
          />
        </thead>
        <tbody>
          <tr>
            <DataTableCells
              cells={[
                { id: "name-cell", column: { id: "name" } },
                { id: "actions-cell", column: { id: "actions" } },
              ]}
              renderCell={(cell) => cell.id}
            />
          </tr>
        </tbody>
      </table>,
    );

    const heads = container.querySelectorAll("th");
    expect(heads[0]?.className).not.toContain("sticky");
    expect(heads[1]?.className).toContain("sticky right-0");
    const cells = container.querySelectorAll("td");
    expect(cells[1]?.className).toContain("sticky right-0");
  });
});
