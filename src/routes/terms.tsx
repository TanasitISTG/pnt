import { createFileRoute, Link } from "@tanstack/react-router";

import { AppShell } from "@/components/app-shell";

export const Route = createFileRoute("/terms")({
  component: TermsPage,
});

function TermsPage() {
  const { user } = Route.useRouteContext();

  return (
    <AppShell user={user}>
      <div className="mx-auto max-w-3xl space-y-6">
        <div>
          <h1 className="text-display font-bold text-foreground">Terms of Service</h1>
          <p className="mt-2 text-body text-muted-foreground">
            Terms governing access to Personal Novel Translator (Pnt).
          </p>
        </div>

        <section className="space-y-3">
          <h2 className="text-card-title font-semibold text-foreground">1. Service Scope</h2>
          <p className="text-body text-foreground">
            Pnt is a personal translation management tool designed for self-hosted and personal
            novel reading. Guest access is provided for reading published chapters.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-card-title font-semibold text-foreground">
            2. Machine Translation Disclaimer
          </h2>
          <p className="text-body text-foreground">
            Translations displayed on Pnt are generated using automated machine-translation models
            (LLMs). Translations are provided "as is" without warranty of any kind, express or
            implied, regarding accuracy, completeness, or suitability.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-card-title font-semibold text-foreground">
            3. Intellectual Property
          </h2>
          <p className="text-body text-foreground">
            Original web novel texts and content remain the intellectual property of their
            respective authors and copyright holders. Pnt is intended solely for personal study,
            translation assistance, and private reading.
          </p>
        </section>

        <p className="text-caption text-muted-foreground pt-4 border-t border-border">
          Back to{" "}
          <Link to="/" className="underline underline-offset-4 text-foreground">
            Library
          </Link>
          .
        </p>
      </div>
    </AppShell>
  );
}
