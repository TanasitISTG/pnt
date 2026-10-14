import { createFileRoute, Link } from "@tanstack/react-router";

import { AppShell } from "@/components/app-shell";

export const Route = createFileRoute("/{-$locale}/cookie-policy")({
  head: () => ({
    meta: [
      { title: "Cookie Policy | Pnt - Personal Novel Translator" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: CookiePolicyPage,
});

function CookiePolicyPage() {
  const { user } = Route.useRouteContext();

  return (
    <AppShell user={user}>
      <div className="mx-auto max-w-3xl space-y-6">
        <div>
          <h1 className="text-section text-foreground">Cookie Policy</h1>
          <p className="mt-1.5 text-body text-pretty text-muted-foreground">
            This policy explains how Pnt uses cookies and local storage to operate the platform.
          </p>
        </div>

        <section className="space-y-3">
          <h2 className="text-card-title font-semibold text-foreground">1. Essential cookies</h2>
          <p className="text-body text-pretty text-foreground">
            We use the essential cookies that signing in requires. They cannot be switched off, and
            they do not require consent.
          </p>
          <div className="rounded-md border border-border bg-surface p-4">
            <div className="font-semibold text-foreground">better-auth.session_token</div>
            <div className="text-caption text-muted-foreground mt-1">
              Purpose: Authenticates signed-in sessions. Duration: Session / 30 days.
            </div>
          </div>
        </section>

        <section className="space-y-3">
          <h2 className="text-card-title font-semibold text-foreground">
            2. Optional analytics cookies
          </h2>
          <p className="text-body text-pretty text-foreground">
            When you grant consent, we use PostHog for product analytics and error tracking to help
            improve service performance and stability.
          </p>
          <div className="rounded-md border border-border bg-surface p-4">
            <div className="font-semibold text-foreground">ph_* (PostHog)</div>
            <div className="text-caption text-muted-foreground mt-1">
              Purpose: Anonymous usage statistics and exception monitoring. Status: Only active if
              you click "Accept all" on the consent banner.
            </div>
          </div>
        </section>

        <section className="space-y-3">
          <h2 className="text-card-title font-semibold text-foreground">
            3. Browser local storage
          </h2>
          <p className="text-body text-pretty text-foreground">
            We store functional preferences directly in your browser. This data never leaves your
            device:
          </p>
          <ul className="list-disc pl-5 space-y-1.5 text-body text-muted-foreground">
            <li>
              <strong className="text-foreground">pnt-reader-settings</strong>: Font size, typeface,
              line height, text width, view mode, and reader page theme.
            </li>
            <li>
              <strong className="text-foreground">pnt-reader-progress</strong>: Reading position
              across chapters for guests.
            </li>
            <li>
              <strong className="text-foreground">pnt-reader-bookmarks</strong>: Reader bookmarks
              and notes for guests.
            </li>
            <li>
              <strong className="text-foreground">pnt-consent-v1</strong>: Your cookie consent
              selection.
            </li>
            <li>
              <strong className="text-foreground">theme</strong>: Dark mode / light mode appearance
              setting.
            </li>
          </ul>
          <p className="text-body text-pretty text-foreground">
            When you sign in, your reading position, read chapters, and bookmarks are stored with
            your account instead of the browser, so they follow you across devices.
          </p>
        </section>

        <p className="border-t border-border pt-4 text-caption text-muted-foreground">
          See also the{" "}
          <Link to="/{-$locale}/privacy" className="underline underline-offset-4 text-foreground">
            Privacy Policy
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
