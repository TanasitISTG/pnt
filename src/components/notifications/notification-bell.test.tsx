// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TestI18nProvider } from "@/test/i18n";
import { NotificationBell } from "./notification-bell";

const serverFunctions = vi.hoisted(() => ({
  listNotifications: vi.fn(),
  markNotificationsRead: vi.fn(),
  getNovelFollow: vi.fn(),
  setNovelFollow: vi.fn(),
}));

const navigate = vi.hoisted(() => vi.fn());

vi.mock("@/lib/notifications/functions", () => serverFunctions);
vi.mock("./use-notification-stream", () => ({ useNotificationStream: vi.fn() }));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));
/**
 * The router's `Link` builds a real href from the route's params, so the row is queryable by
 * role and the suite can assert where it points.
 */
vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    params,
    to,
    ...props
  }: {
    children: ReactNode;
    params?: { novelId?: string; chapterId?: string };
    to?: string;
  }) => (
    <a
      href={`${typeof to === "string" ? to : ""}/${params?.novelId ?? ""}/${params?.chapterId ?? ""}`}
      {...props}
    >
      {children}
    </a>
  ),
  useNavigate: () => navigate,
}));

/** Noon on the day `daysAgo` days back, so a day heading does not depend on the hour of the run. */
function dayAt(daysAgo: number): string {
  const date = new Date();
  date.setDate(date.getDate() - daysAgo);
  date.setHours(12, 0, 0, 0);
  return date.toISOString();
}

const ITEM = {
  id: "notification-1",
  kind: "chapter_published" as const,
  novelId: "novel-1",
  chapterId: "chapter-1",
  commentId: null,
  reportId: null,
  novelTitle: "The Hidden Map",
  chapterTitle: "Chapter 12",
  detail: "Chapter 12",
  outcome: null,
  createdAt: dayAt(0),
  readAt: null,
};

const COMMENT = {
  ...ITEM,
  id: "notification-2",
  kind: "novel_comment" as const,
  commentId: "comment-1",
  chapterTitle: "The Long Road",
  detail: "Loved the pacing here.",
  createdAt: dayAt(1),
};

const REPORT = {
  ...ITEM,
  id: "notification-3",
  kind: "report_decided" as const,
  novelId: null,
  chapterId: null,
  reportId: "report-1",
  novelTitle: "",
  chapterTitle: null,
  detail: null,
  outcome: "upheld" as const,
};

function renderBell(): void {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <TestI18nProvider>
      <QueryClientProvider client={queryClient}>
        <NotificationBell userId="user-1" />
      </QueryClientProvider>
    </TestI18nProvider>,
  );
}

beforeEach(() => {
  serverFunctions.listNotifications.mockResolvedValue({ items: [ITEM], unreadCount: 1 });
  serverFunctions.markNotificationsRead.mockResolvedValue({ unreadCount: 0 });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("NotificationBell", () => {
  it("names the unread count in the trigger's accessible name", async () => {
    renderBell();

    expect(await screen.findByRole("button", { name: "1 unread notification" })).toBeTruthy();
  });

  it("separates the kind, the chapter and the novel in one row", async () => {
    renderBell();

    fireEvent.click(await screen.findByRole("button", { name: /unread notification/ }));

    expect(await screen.findByText("New chapter")).toBeTruthy();
    expect(screen.getByText("Chapter 12")).toBeTruthy();
    expect(screen.getByText("The Hidden Map")).toBeTruthy();
    expect(screen.getByText("Today")).toBeTruthy();
    expect(screen.getByRole("link").getAttribute("href")).toMatch(/novel-1\/chapter-1$/);
  });

  it("quotes a comment and groups it under its day", async () => {
    serverFunctions.listNotifications.mockResolvedValue({
      items: [ITEM, COMMENT],
      unreadCount: 2,
    });
    renderBell();

    fireEvent.click(await screen.findByRole("button", { name: /unread notifications/ }));

    expect(await screen.findByText("New comment")).toBeTruthy();
    expect(screen.getByText("The Long Road")).toBeTruthy();
    expect(screen.getByText("Loved the pacing here.")).toBeTruthy();
    expect(screen.getByText("Yesterday")).toBeTruthy();
  });

  it("marks one notification read when it is opened", async () => {
    renderBell();

    fireEvent.click(await screen.findByRole("button", { name: /unread notification/ }));
    fireEvent.click(await screen.findByRole("link"));

    await waitFor(() => {
      expect(serverFunctions.markNotificationsRead).toHaveBeenCalledWith({
        data: { ids: ["notification-1"] },
      });
    });
  });

  it("clears a report from its row, since it has no chapter to open", async () => {
    serverFunctions.listNotifications.mockResolvedValue({ items: [REPORT], unreadCount: 1 });
    renderBell();

    fireEvent.click(await screen.findByRole("button", { name: /unread notification/ }));
    fireEvent.click(await screen.findByRole("button", { name: /Report upheld/ }));

    await waitFor(() => {
      expect(serverFunctions.markNotificationsRead).toHaveBeenCalledWith({
        data: { ids: ["notification-3"] },
      });
    });
  });

  it("clears everything with mark all read", async () => {
    renderBell();

    fireEvent.click(await screen.findByRole("button", { name: /unread notification/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Mark all read" }));

    await waitFor(() => {
      expect(serverFunctions.markNotificationsRead).toHaveBeenCalledWith({
        data: { ids: undefined },
      });
    });
  });

  it("shows the empty state when there is nothing new", async () => {
    serverFunctions.listNotifications.mockResolvedValue({ items: [], unreadCount: 0 });
    renderBell();

    fireEvent.click(await screen.findByRole("button", { name: "No unread notifications" }));

    expect(await screen.findByText("Nothing new")).toBeTruthy();
  });
});
