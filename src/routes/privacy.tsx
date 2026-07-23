import { createFileRoute, Link } from "@tanstack/react-router";

import { AppShell } from "@/components/app-shell";

export const Route = createFileRoute("/privacy")({
  component: PrivacyPage,
});

function PrivacyPage() {
  const { user } = Route.useRouteContext();

  return (
    <AppShell user={user}>
      <div className="mx-auto max-w-3xl space-y-6">
        <div>
          <h1 className="text-display font-bold text-foreground">Privacy Policy</h1>
          <p className="mt-2 text-body text-muted-foreground">
            Information on how data is handled on Personal Novel Translator (Pnt).
          </p>
        </div>

        <section className="space-y-3">
          <h2 className="text-card-title font-semibold text-foreground">1. Data Storage & Usage</h2>
          <p className="text-body text-foreground">
            Pnt is a single-admin novel translation workspace. Guest access is read-only.
          </p>
          <ul className="list-disc pl-5 space-y-1 text-body text-muted-foreground">
            <li>
              <strong className="text-foreground">Local Storage</strong>: Reader preferences, font
              sizes, theme, and reading progress are stored locally on your device.
            </li>
            <li>
              <strong className="text-foreground">Session Data</strong>: Admin sessions are
              authenticated securely via HttpOnly cookies.
            </li>
            <li>
              <strong className="text-foreground">AI Configuration</strong>: API keys configured by
              the admin are encrypted at rest using AES-GCM and never exposed to guests.
            </li>
          </ul>
        </section>

        <section className="space-y-3">
          <h2 className="text-card-title font-semibold text-foreground">2. Third-Party Services</h2>
          <p className="text-body text-foreground">
            We do not sell data or run advertising trackers.
          </p>
          <ul className="list-disc pl-5 space-y-1 text-body text-muted-foreground">
            <li>
              <strong className="text-foreground">PostHog</strong>: Optional product analytics and
              crash reports, active only with explicit user consent.
            </li>
            <li>
              <strong className="text-foreground">Translation Providers</strong>: Novel raw text is
              sent to user-configured LLM providers (e.g. OpenAI / OpenRouter) solely for
              translation processing.
            </li>
          </ul>
        </section>

        <section className="space-y-3">
          <h2 className="text-card-title font-semibold text-foreground">3. Data Retention</h2>
          <p className="text-body text-foreground">
            Novels, chapters, glossaries, and reader progress remain stored until deleted by the
            admin or cleared from your local browser storage.
          </p>
        </section>

        <p className="text-caption text-muted-foreground pt-4 border-t border-border">
          See also our{" "}
          <Link to="/cookie-policy" className="underline underline-offset-4 text-foreground">
            Cookie Policy
          </Link>{" "}
          and{" "}
          <Link to="/terms" className="underline underline-offset-4 text-foreground">
            Terms of Service
          </Link>
          .
        </p>
      </div>
    </AppShell>
  );
}
