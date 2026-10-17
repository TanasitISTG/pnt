import type { ReactNode } from "react";
import { useLocale, useTranslations } from "use-intl";

import { legalDocument } from "@/lib/legal/copy";
import type { LegalDocumentId } from "@/lib/legal/types";

interface LegalDocumentPageProps {
  /** Which document this page is. Its words come from `lib/legal/copy.ts`, in both languages. */
  id: LegalDocumentId;
  /** The sentence that hands the reader to the other two documents, as rich text with links. */
  footer: ReactNode;
  /**
   * The version a reader is accepting, which only the terms carry. Passed in because the number
   * belongs to the acceptance the app records (`lib/terms.ts`), not to the prose.
   */
  version?: string;
}

/**
 * A legal page, rendered from the document that holds its words.
 *
 * The three pages differ only in which document they show and which two documents they link to, so
 * the layout is written once. That is also what keeps the prose out of the layout: a paragraph is
 * data from `lib/legal/copy.ts`, present in both languages, and nothing here can quietly keep an
 * English sentence that only English has.
 *
 * A Thai page carries the notice that the English text governs. The documents are English-authored
 * and translated so a Thai reader can read the policy itself rather than a summary of it, and the
 * notice is what says which of the two is authoritative if the translation is ever read against it.
 */
export function LegalDocumentPage({ id, footer, version }: LegalDocumentPageProps) {
  const locale = useLocale();
  const t = useTranslations("legal");
  const document = legalDocument(id, locale);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-section text-foreground">{document.title}</h1>
        <p className="mt-1.5 text-body text-pretty text-muted-foreground">{document.summary}</p>
        {version ? (
          <p className="mt-1 text-caption text-muted-foreground">{t("version", { version })}</p>
        ) : null}
      </div>

      {locale === "en" ? null : (
        <p className="rounded-md border border-border bg-surface px-4 py-3 text-caption text-pretty text-muted-foreground">
          {t("englishGoverns")}
        </p>
      )}

      {document.sections.map((section) => (
        <section key={section.heading} className="space-y-3">
          <h2 className="text-card-title font-semibold text-foreground">{section.heading}</h2>
          {section.paragraphs.map((paragraph) => (
            <p key={paragraph} className="text-body text-pretty text-foreground">
              {paragraph}
            </p>
          ))}
          {section.cards?.map((card) => (
            <div key={card.name} className="rounded-md border border-border bg-surface p-4">
              <div className="font-semibold text-foreground">{card.name}</div>
              <div className="mt-1 text-caption text-muted-foreground">{card.detail}</div>
            </div>
          ))}
          {section.bullets ? (
            <ul className="list-disc space-y-1.5 pl-5 text-body text-muted-foreground">
              {section.bullets.map((bullet) => (
                <li key={bullet.lead}>
                  <strong className="text-foreground">{bullet.lead}</strong>: {bullet.text}
                </li>
              ))}
            </ul>
          ) : null}
          {section.closing ? (
            <p className="text-body text-pretty text-foreground">{section.closing}</p>
          ) : null}
        </section>
      ))}

      <p className="border-t border-border pt-4 text-caption text-muted-foreground">{footer}</p>
    </div>
  );
}
