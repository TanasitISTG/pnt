import { createElement, type ComponentType, type ReactNode } from "react";
import { vi } from "vitest";

if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = "postgres://test:test@localhost:5432/pnt_test";
}
if (!process.env.BETTER_AUTH_SECRET) {
  process.env.BETTER_AUTH_SECRET = "test-secret-for-vitest-only-1234567890";
}
if (!process.env.BETTER_AUTH_URL) {
  process.env.BETTER_AUTH_URL = "http://localhost:3000";
}
if (!process.env.APP_ENCRYPTION_KEY) {
  process.env.APP_ENCRYPTION_KEY = "test-encryption-key-for-vitest-only-32";
}

type TestWrapper = ComponentType<{ children: ReactNode }>;

/*
 * Every component — and every hook — renders inside the intl provider, from this one place.
 *
 * A component or hook that reads a catalog throws without a provider, and wrapping forty test
 * files by hand would have every new test file forget it. Patching `render` and `renderHook`
 * here means the suite cannot drift: the wrapper is not something a test opts into. A test that
 * passes its own `wrapper` still gets it, *inside* the provider, so a hook test that needs a
 * Query client reads copy through the same catalog the component does.
 */
vi.mock("@testing-library/react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@testing-library/react")>();
  const { TestI18nProvider } = await import("./i18n");

  const withCatalog = (wrapper: TestWrapper | undefined): TestWrapper => {
    if (!wrapper) return TestI18nProvider;
    return function ComposedProviders({ children }: { children: ReactNode }) {
      return createElement(TestI18nProvider, null, createElement(wrapper, null, children));
    };
  };

  return {
    ...actual,
    render: (
      ui: Parameters<typeof actual.render>[0],
      options?: Omit<Parameters<typeof actual.render>[1], "wrapper"> & { wrapper?: TestWrapper },
    ) =>
      actual.render(ui, {
        ...options,
        wrapper: withCatalog(options?.wrapper),
      }),
    renderHook: (
      hook: Parameters<typeof actual.renderHook>[0],
      options?: Omit<Parameters<typeof actual.renderHook>[1], "wrapper"> & {
        wrapper?: TestWrapper;
      },
    ) => actual.renderHook(hook, { ...options, wrapper: withCatalog(options?.wrapper) }),
  };
});
