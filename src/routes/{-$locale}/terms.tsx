import { createFileRoute, Link } from "@tanstack/react-router";

import { AppShell } from "@/components/app-shell";
import { CURRENT_TERMS_VERSION } from "@/lib/terms";

export const Route = createFileRoute("/{-$locale}/terms")({
  head: () => ({
    meta: [
      { title: "Terms of Service | Pnt - Personal Novel Translator" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: TermsPage,
});

function TermsPage() {
  const { user } = Route.useRouteContext();

  return (
    <AppShell user={user}>
      <div className="mx-auto max-w-3xl space-y-6">
        <div>
          <h1 className="text-section text-foreground">Terms of Service</h1>
          <p className="mt-1.5 text-body text-pretty text-muted-foreground">
            Terms governing access to Personal Novel Translator (Pnt).
          </p>
          {/* The version a new account accepts, so the wording can always be tied to the
              acceptance recorded on the account. */}
          <p className="mt-1 text-caption text-muted-foreground">
            Version {CURRENT_TERMS_VERSION}.
          </p>
        </div>

        <section className="space-y-3">
          <h2 className="text-card-title font-semibold text-foreground">1. Service scope</h2>
          <p className="text-body text-pretty text-foreground">
            Pnt is a novel translation workspace. Every account owns its own novels, chapters and
            glossary, and nothing in one account is readable or editable from another. Guests can
            read chapters their translators have published, which is the whole of what guest access
            provides.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-card-title font-semibold text-foreground">2. Machine translation</h2>
          <p className="text-body text-pretty text-foreground">
            Translations displayed on Pnt are generated using automated machine-translation models
            (LLMs). Translations are provided "as is" without warranty of any kind, express or
            implied, regarding accuracy, completeness, or suitability.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-card-title font-semibold text-foreground">
            3. Intellectual property
          </h2>
          <p className="text-body text-pretty text-foreground">
            Original web novel texts and content remain the intellectual property of their
            respective authors and copyright holders. Pnt is intended solely for personal study,
            translation assistance, and private reading.
          </p>
        </section>

        <p className="border-t border-border pt-4 text-caption text-muted-foreground">
          See also the{" "}
          <Link to="/{-$locale}/privacy" className="underline underline-offset-4 text-foreground">
            Privacy Policy
          </Link>{" "}
          and the{" "}
          <Link
            to="/{-$locale}/cookie-policy"
            className="underline underline-offset-4 text-foreground"
          >
            Cookie Policy
          </Link>
          .
        </p>
      </div>
    </AppShell>
  );
}
