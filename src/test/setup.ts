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

/*
 * Every component renders inside the intl provider, from this one place.
 *
 * A component that reads a catalog throws without a provider, and wrapping forty test files
 * by hand would have every new test file forget it. Patching `render` here means the suite
 * cannot drift: the wrapper is not something a test opts into. A test that renders with its
 * own `wrapper` still wins, because the spread below lets `options` override ours.
 */
vi.mock("@testing-library/react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@testing-library/react")>();
  const { TestI18nProvider } = await import("./i18n");
  return {
    ...actual,
    render: (
      ui: Parameters<typeof actual.render>[0],
      options?: Parameters<typeof actual.render>[1],
    ) => actual.render(ui, { wrapper: TestI18nProvider, ...options }),
  };
});
