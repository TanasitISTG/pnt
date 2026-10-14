import type { ReactNode } from "react";

export interface SettingsSectionProps {
  /** The same words the section nav shows, so the landmark and the link agree. */
  title: string;
  description: string;
  children: ReactNode;
}

/**
 * One settings section: its `h2`, a sentence saying what lives here, and the cards.
 *
 * The page has a single `h1` ("Settings"), so each section names itself one step down and
 * carries that name as its landmark label — a screen reader moving by landmark hears
 * "Account", "Provider", "Security", exactly the words that were on screen.
 */
export function SettingsSection({ title, description, children }: SettingsSectionProps) {
  const headingId = `settings-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-5">
      <div className="min-w-0">
        <h2 id={headingId} className="text-sub text-foreground">
          {title}
        </h2>
        <p className="mt-1 max-w-2xl text-body text-muted-foreground">{description}</p>
      </div>
      {children}
    </section>
  );
}
