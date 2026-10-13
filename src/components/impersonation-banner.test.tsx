// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  stopImpersonation: vi.fn(),
  invalidate: vi.fn(),
  navigate: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("@/lib/admin/functions", () => ({ stopImpersonation: mocks.stopImpersonation }));
vi.mock("sonner", () => ({ toast: { error: mocks.toastError, success: vi.fn() } }));
vi.mock("@tanstack/react-router", () => ({
  useRouter: () => ({ invalidate: mocks.invalidate, navigate: mocks.navigate }),
}));

const { ImpersonationBanner } = await import("./impersonation-banner");

function renderBanner(operatorName: string | null = "E2E Admin") {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <ImpersonationBanner
        impersonation={{ operatorId: "operator-1", operatorName }}
        viewedName="E2E Member"
      />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.stopImpersonation.mockResolvedValue({ success: true });
  mocks.invalidate.mockResolvedValue(undefined);
  mocks.navigate.mockResolvedValue(undefined);
});

afterEach(cleanup);

describe("ImpersonationBanner", () => {
  it("names the account being viewed and that it is read-only", () => {
    renderBanner();
    expect(screen.getByText(/Viewing as E2E Member, read-only/)).toBeTruthy();
    expect(screen.getByText(/Signed in as E2E Admin/)).toBeTruthy();
  });

  it("falls back to a generic operator label when the name is unknown", () => {
    renderBanner(null);
    expect(screen.getByText(/Signed in as your operator account/)).toBeTruthy();
  });

  it("returns to the operator account and lands on the operator screen", async () => {
    renderBanner();
    fireEvent.click(screen.getByRole("button", { name: "Return to operator account" }));

    expect(mocks.stopImpersonation).toHaveBeenCalledOnce();
    await vi.waitFor(() => expect(mocks.navigate).toHaveBeenCalledWith({ to: "/admin" }));
    expect(mocks.invalidate).toHaveBeenCalledOnce();
  });

  it("says how to get out when the operator session cannot be restored", async () => {
    mocks.stopImpersonation.mockRejectedValue(new Error("Could not find admin session"));
    renderBanner();
    fireEvent.click(screen.getByRole("button", { name: "Return to operator account" }));

    // Being stuck inside someone else's account must never be silent.
    await vi.waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    expect(screen.getByRole("alert").textContent).toMatch(/sign out and sign back in/i);
    expect(mocks.toastError).toHaveBeenCalledWith("Could not find admin session");
    expect(mocks.navigate).not.toHaveBeenCalled();
    await vi.waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Return to operator account" }).hasAttribute("disabled"),
      ).toBe(false),
    );
  });
});
