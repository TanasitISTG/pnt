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
