// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CURRENT_TERMS_VERSION } from "@/lib/terms";

const mocks = vi.hoisted(() => ({
  acceptCurrentTerms: vi.fn(),
  invalidate: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("@/lib/account/terms.functions", () => ({
  acceptCurrentTerms: mocks.acceptCurrentTerms,
}));
vi.mock("sonner", () => ({ toast: { error: mocks.toastError, success: vi.fn() } }));
vi.mock("@tanstack/react-router", () => ({
  useRouter: () => ({ invalidate: mocks.invalidate }),
  // The band links to the terms themselves; a plain anchor is all this test needs.
  Link: ({ to, children }: { to: string; children: React.ReactNode }) => (
    <a href={to}>{children}</a>
  ),
}));

const { TermsNotice } = await import("./terms-notice");

function renderNotice(stale: boolean) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <TermsNotice stale={stale} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.acceptCurrentTerms.mockResolvedValue({ success: true, termsVersion: "test" });
  mocks.invalidate.mockResolvedValue(undefined);
});

afterEach(cleanup);

describe("TermsNotice", () => {
  it("stays out of the way while the account is on the current version", () => {
    const { container } = renderNotice(false);
    expect(container.textContent).toBe("");
    expect(screen.queryByRole("button", { name: "I accept" })).toBeNull();
  });

  it("names the current version and offers the terms and the acceptance", () => {
    renderNotice(true);
    expect(screen.getByLabelText("Updated terms")).toBeTruthy();
    expect(screen.getByText(new RegExp(CURRENT_TERMS_VERSION))).toBeTruthy();
    expect(screen.getByRole("link", { name: "read the terms" }).getAttribute("href")).toBe(
      "/terms",
    );
  });

  it("records the acceptance and refetches the viewer so the band goes away", async () => {
    renderNotice(true);
    fireEvent.click(screen.getByRole("button", { name: "I accept" }));

    expect(mocks.acceptCurrentTerms).toHaveBeenCalledOnce();
    await vi.waitFor(() => expect(mocks.invalidate).toHaveBeenCalledOnce());
    expect(mocks.toastError).not.toHaveBeenCalled();
  });

  it("keeps the band and says so when the acceptance cannot be recorded", async () => {
    mocks.acceptCurrentTerms.mockRejectedValue(new Error("Actions are unavailable"));
    renderNotice(true);
    fireEvent.click(screen.getByRole("button", { name: "I accept" }));

    await vi.waitFor(() =>
      expect(mocks.toastError).toHaveBeenCalledWith("Actions are unavailable"),
    );
    expect(mocks.invalidate).not.toHaveBeenCalled();
    // A refusal has to leave the button usable rather than stuck mid-flight.
    await vi.waitFor(() =>
      expect(screen.getByRole("button", { name: "I accept" }).hasAttribute("disabled")).toBe(false),
    );
  });
});
