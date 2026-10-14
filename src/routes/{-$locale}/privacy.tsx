import { createFileRoute, Link } from "@tanstack/react-router";

import { AppShell } from "@/components/app-shell";

export const Route = createFileRoute("/{-$locale}/privacy")({
  head: () => ({
    meta: [
      { title: "Privacy Policy | Pnt - Personal Novel Translator" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: PrivacyPage,
});

function PrivacyPage() {
  const { user } = Route.useRouteContext();

  return (
    <AppShell user={user}>
      <div className="mx-auto max-w-3xl space-y-6">
        <div>
          <h1 className="text-section text-foreground">Privacy Policy</h1>
          <p className="mt-1.5 text-body text-pretty text-muted-foreground">
            Information on how data is handled on Personal Novel Translator (Pnt).
          </p>
        </div>

        <section className="space-y-3">
          <h2 className="text-card-title font-semibold text-foreground">1. Data storage & usage</h2>
          <p className="text-body text-pretty text-foreground">
            Every account on Pnt keeps its own workspace: its own novels, chapters and glossary,
            which no other account can read or edit. Guest access is read-only.
          </p>
          <ul className="list-disc pl-5 space-y-1.5 text-body text-muted-foreground">
            <li>
              <strong className="text-foreground">Local storage</strong>: Reader preferences, font
              sizes, line height, text width, page theme, and reading progress for guests are stored
              locally on your device.
            </li>
            <li>
              <strong className="text-foreground">Account reader state</strong>: For a signed-in
              account, reading position, read chapters, and bookmarks are stored with the account
              instead of the browser.
            </li>
            <li>
              <strong className="text-foreground">Session data</strong>: Sessions are authenticated
              with HttpOnly cookies.
            </li>
            <li>
              <strong className="text-foreground">AI configuration</strong>: Translation provider
              API keys are encrypted at rest using AES-GCM and are never exposed to another account.
            </li>
          </ul>
        </section>

        <section className="space-y-3">
          <h2 className="text-card-title font-semibold text-foreground">2. Third-party services</h2>
          <p className="text-body text-pretty text-foreground">
            We do not sell data or run advertising trackers.
          </p>
          <ul className="list-disc pl-5 space-y-1.5 text-body text-muted-foreground">
            <li>
              <strong className="text-foreground">PostHog</strong>: Optional page-view analytics and
              crash reports, active only with explicit user consent. Session replay and automatic
              page-content capture are disabled.
            </li>
            <li>
              <strong className="text-foreground">Translation providers</strong>: Novel raw text is
              sent to user-configured LLM providers (e.g. OpenAI / OpenRouter) solely for
              translation processing.
            </li>
          </ul>
        </section>

        <section className="space-y-3">
          <h2 className="text-card-title font-semibold text-foreground">3. Data retention</h2>
          <p className="text-body text-pretty text-foreground">
            Novels, chapters, glossaries, and reader progress remain stored until you delete them or
            delete your account. Progress a guest keeps in the browser is cleared by clearing
            browser storage.
          </p>
        </section>

        <p className="border-t border-border pt-4 text-caption text-muted-foreground">
          See also the{" "}
          <Link
            to="/{-$locale}/cookie-policy"
            className="underline underline-offset-4 text-foreground"
          >
            Cookie Policy
          </Link>{" "}
          and the{" "}
          <Link to="/{-$locale}/terms" className="underline underline-offset-4 text-foreground">
            Terms of Service
          </Link>
          .
        </p>
      </div>
    </AppShell>
  );
}
