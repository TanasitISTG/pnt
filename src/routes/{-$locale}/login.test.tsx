// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { TurnstileRenderOptions } from "@/lib/auth/captcha";

const routerState = vi.hoisted(() => ({
  search: {} as { redirect?: string },
  navigate: vi.fn(),
  invalidate: vi.fn(),
}));

const authMethods = vi.hoisted(() => ({
  value: {
    emailPassword: true,
    google: false,
    discord: false,
    turnstileSiteKey: null as string | null,
  },
}));

const signInEmail = vi.hoisted(() => vi.fn());

/**
 * The route module owns the wiring under test, so the router is mocked down to the
 * three calls the page makes. `Route` is the same object the factory returns, which
 * lets the test render the component the loader-driven route would mount.
 */
vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-router")>();
  const route = {
    options: {} as { component?: React.ComponentType },
    useSearch: () => routerState.search,
    useLoaderData: () => ({ methods: authMethods.value }),
  };
  return {
    ...actual,
    Link: ({ children }: { children: React.ReactNode }) => <a href="#">{children}</a>,
    useNavigate: () => routerState.navigate,
    useRouter: () => ({ invalidate: routerState.invalidate }),
    createFileRoute: () => (options: { component?: React.ComponentType }) => {
      route.options = options;
      return route;
    },
  };
});

vi.mock("@/lib/auth/functions", () => ({ getAuthMethods: vi.fn() }));
vi.mock("@/lib/auth/auth-client", () => ({ signIn: { email: signInEmail } }));
vi.mock("@/components/auth/provider-buttons", () => ({ ProviderButtons: () => null }));

import { Route } from "@/routes/{-$locale}/login";

let renderOptions: TurnstileRenderOptions[];

function installTurnstile() {
  renderOptions = [];
  window.turnstile = {
    render: vi.fn((_container: HTMLElement, options: TurnstileRenderOptions) => {
      renderOptions.push(options);
      return "widget-1";
    }),
    remove: vi.fn(),
    reset: vi.fn(),
  };
}

type RouteComponent = React.ComponentType & { preload?: () => Promise<unknown> };

/**
 * The route file's `component` is the router's lazy wrapper, which renders nothing
 * until the loader has been asked to preload it - awaiting that is what makes each
 * test start from a mounted page rather than an empty container.
 */
async function renderLogin() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const LoginPage = (Route.options as { component: RouteComponent }).component;
  await LoginPage.preload?.();
  return render(
    <QueryClientProvider client={client}>
      <LoginPage />
    </QueryClientProvider>,
  );
}

function fillCredentials() {
  fireEvent.change(screen.getByLabelText("Email"), { target: { value: "reader@example.test" } });
  fireEvent.change(screen.getByLabelText("Password"), { target: { value: "correct-horse" } });
}

function signInButton() {
  return screen.getByRole("button", { name: /^Sign in$/i }) as HTMLButtonElement;
}

beforeEach(() => {
  routerState.navigate.mockReset();
  routerState.invalidate.mockReset();
  signInEmail.mockReset().mockResolvedValue({ error: null });
  authMethods.value = {
    emailPassword: true,
    google: false,
    discord: false,
    turnstileSiteKey: null,
  };
  installTurnstile();
});

afterEach(() => {
  cleanup();
  delete window.turnstile;
});

describe("login page captcha wiring", () => {
  /**
   * The captcha plugin verifies /sign-in/email, so a deployment with a site key must
   * challenge sign-in too. Omitting the widget here is how every sign-in came back
   * "Missing CAPTCHA response" while sign-up worked.
   */
  it("renders the challenge and withholds the answer token until it is solved", async () => {
    authMethods.value.turnstileSiteKey = "site-key";
    await renderLogin();

    await waitFor(() => expect(renderOptions).toHaveLength(1));
    expect(renderOptions[0]).toMatchObject({ sitekey: "site-key" });

    fillCredentials();
    expect(signInButton().disabled).toBe(true);

    fireEvent.click(signInButton());
    await waitFor(() => expect(signInEmail).not.toHaveBeenCalled());

    renderOptions[0].callback("answer-token");
    await waitFor(() => expect(signInButton().disabled).toBe(false));
  });

  it("sends the solved challenge with the credentials", async () => {
    authMethods.value.turnstileSiteKey = "site-key";
    await renderLogin();

    await waitFor(() => expect(renderOptions).toHaveLength(1));
    renderOptions[0].callback("answer-token");
    fillCredentials();

    fireEvent.click(signInButton());

    await waitFor(() =>
      expect(signInEmail).toHaveBeenCalledWith(
        { email: "reader@example.test", password: "correct-horse" },
        { headers: { "x-captcha-response": "answer-token" } },
      ),
    );
  });

  it("asks for no challenge, and sends no header, when Turnstile is not configured", async () => {
    await renderLogin();

    expect(screen.queryByText(/verification check/i)).toBeNull();
    expect(window.turnstile?.render).not.toHaveBeenCalled();

    fillCredentials();
    expect(signInButton().disabled).toBe(false);
    fireEvent.click(signInButton());

    await waitFor(() =>
      expect(signInEmail).toHaveBeenCalledWith(
        { email: "reader@example.test", password: "correct-horse" },
        undefined,
      ),
    );
  });

  it("clears a consumed challenge so a rejected attempt asks for a fresh one", async () => {
    authMethods.value.turnstileSiteKey = "site-key";
    signInEmail.mockResolvedValue({ error: { message: "Invalid credentials", code: "x" } });
    await renderLogin();

    await waitFor(() => expect(renderOptions).toHaveLength(1));
    renderOptions[0].callback("answer-token");
    fillCredentials();
    fireEvent.click(signInButton());

    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("Invalid"));
    // Dropping the consumed token re-arms the gate rather than re-rendering the
    // widget, so the next click cannot replay the same answer.
    expect(renderOptions).toHaveLength(1);
    expect(signInButton().disabled).toBe(true);
  });
});
