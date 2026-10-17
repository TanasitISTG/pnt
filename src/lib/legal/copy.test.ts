import { describe, expect, it } from "vitest";

import { legalCopy } from "./copy";
import type { LegalDocument, LegalSection } from "./types";

/**
 * What the legal pages promise a reader, held against the copy.
 *
 * `bun run typecheck` already proves both languages have a document of the right shape, which is
 * the reason the copy is a module. These are the two things it cannot see: that a translation did
 * not quietly drop the list a section had, and that nothing on the Thai side is still the English
 * — the same failure a nearly-translated page ships with, and the one nobody reads twice.
 */

const LOCALES = ["en", "th"] as const;
const DOCUMENT_IDS = ["terms", "privacy", "cookiePolicy"] as const;

/**
 * A name rather than a sentence: a storage key, which is what the browser stores, or a product's
 * own name. Both are the same word in every language — translating them would name something that
 * does not exist, which is why the catalog keeps the same kind of exception for its own names.
 */
const NAME = /^(?:pnt-[\w-]+|theme|PostHog)$/;

function sectionShape(section: LegalSection) {
  return {
    paragraphs: section.paragraphs.length,
    bullets: section.bullets?.length ?? 0,
    cards: section.cards?.length ?? 0,
    closing: section.closing === undefined ? 0 : 1,
  };
}

/** Every sentence a document holds, with where it is, so a failure names the place to fix. */
function sentences(document: LegalDocument): Array<{ where: string; text: string }> {
  return document.sections.flatMap((section, index) => [
    { where: `section ${index + 1} heading`, text: section.heading },
    ...section.paragraphs.map((text, position) => ({
      where: `section ${index + 1} paragraph ${position + 1}`,
      text,
    })),
    ...(section.bullets ?? []).flatMap((bullet, position) => [
      { where: `section ${index + 1} bullet ${position + 1} lead`, text: bullet.lead },
      { where: `section ${index + 1} bullet ${position + 1} text`, text: bullet.text },
    ]),
    ...(section.cards ?? []).map((card, position) => ({
      where: `section ${index + 1} card ${position + 1}`,
      text: card.detail,
    })),
    ...(section.closing === undefined
      ? []
      : [{ where: `section ${index + 1} closing`, text: section.closing }]),
  ]);
}

describe("legalCopy", () => {
  it.each(DOCUMENT_IDS)("%s has both languages, with the same sections and lists", (id) => {
    const english = legalCopy[id].en;
    const thai = legalCopy[id].th;

    expect(thai.sections).toHaveLength(english.sections.length);
    expect(thai.sections.map(sectionShape)).toEqual(english.sections.map(sectionShape));
  });

  it.each(DOCUMENT_IDS)("%s says every sentence in both languages", (id) => {
    for (const locale of LOCALES) {
      const document = legalCopy[id][locale];
      expect(document.title.trim()).not.toBe("");
      expect(document.summary.trim()).not.toBe("");
      for (const { where, text } of sentences(document)) {
        expect(`${id} ${locale} ${where}: ${text.trim()}`).not.toMatch(/: $/);
      }
    }
  });

  it.each(DOCUMENT_IDS)("%s does not ship English on the Thai side", (id) => {
    const english = sentences(legalCopy[id].en);
    const thai = sentences(legalCopy[id].th);

    thai.forEach((sentence, index) => {
      const source = english[index];
      if (!source) return;
      // A bullet's lead can be a name, and a card's detail is a sentence about one; the names
      // themselves are compared by the case below.
      if (NAME.test(sentence.text)) return;
      expect(`${id} ${sentence.where}: ${sentence.text}`).not.toBe(
        `${id} ${sentence.where}: ${source.text}`,
      );
    });
  });

  it("names every cookie and storage key exactly as the browser writes it", () => {
    const englishKeys = legalCopy.cookiePolicy.en.sections.flatMap((section) => [
      ...(section.cards ?? []).map((card) => card.name),
      ...(section.bullets ?? []).map((bullet) => bullet.lead),
    ]);
    const thaiKeys = legalCopy.cookiePolicy.th.sections.flatMap((section) => [
      ...(section.cards ?? []).map((card) => card.name),
      ...(section.bullets ?? []).map((bullet) => bullet.lead),
    ]);

    expect(englishKeys.length).toBeGreaterThan(0);
    expect(thaiKeys).toEqual(englishKeys);
  });

  it("writes the Thai headings as Thai", () => {
    for (const id of DOCUMENT_IDS) {
      for (const section of legalCopy[id].th.sections) {
        // Every heading is numbered, and the number is not what makes it a heading.
        expect(section.heading.replace(/^\d+\.\s*/, "")).toMatch(/[\u0E00-\u0E7F]/);
      }
    }
  });
});
