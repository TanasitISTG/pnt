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

const ITEM = {
  id: "notification-1",
  kind: "chapter_published" as const,
  novelId: "novel-1",
  chapterId: "chapter-1",
  commentId: null,
  reportId: null,
  novelTitle: "The Hidden Map",
  detail: "Chapter 12",
  outcome: null,
  createdAt: new Date(Date.now() - 60_000).toISOString(),
  readAt: null,
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

  it("lists the newest notification and links it to its chapter", async () => {
    renderBell();

    fireEvent.click(await screen.findByRole("button", { name: /unread notification/ }));

    expect(await screen.findByText("New chapter in The Hidden Map")).toBeTruthy();
    expect(screen.getByText("Chapter 12")).toBeTruthy();
    expect(screen.getByRole("link").getAttribute("href")).toMatch(/novel-1\/chapter-1$/);
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
