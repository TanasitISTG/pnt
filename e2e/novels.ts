import { expect, type Page } from "@playwright/test";

import { waitForHydration } from "./sessions";

/**
 * A novel a spec writes for itself: creating one, filling its chapters, and reading it.
 *
 * Four specs open a novel of their own through the same form, add chapters to it through the same
 * three fields, walk into it from the studio's own chapter list, and reach the reader's appearance
 * panel the same way. What each spec then *does* with the novel - a chapter's fields, a translation,
 * a bookmark - differs, and that stays in the spec; the sequence they have in common is here, in the
 * app's own words, so that a change to the form is one change and not four.
 *
 * Nothing here navigates somewhere of its own accord to start, with one exception a caller needs: a
 * helper acts where the caller has brought the page, because where a spec starts is part of what it
 * is asserting (the reading home and the shelf both offer "New novel", and a spec that starts on one
 * of them says so). `createNovel` is that exception - it hands back the id of the novel it made,
 * read from the studio address the form lands on, so no spec has to take an address apart by hand.
 */

/** A language pair, named in the pickers the way the options read. */
export interface NovelPair {
  readonly source: string;
  readonly target: string;
}

/** What the novel form takes: a title, and a pair only from the specs that are about a pair. */
export interface NewNovel {
  readonly title: string;
  readonly pair?: NovelPair;
}

/**
 * Creates a novel through the form, and hands back its id.
 *
 * The caller brings the page to a screen that offers "New novel" - the reading home, or the shelf
 * this spec has just been looking at - and keeps whatever it asserts about that screen. The steps
 * the form is made of are the same everywhere: the control, the title, the pair when there is one,
 * and the studio's add-chapters section, which is where a novel with no chapters lands.
 */
export async function createNovel(page: Page, novel: NewNovel): Promise<string> {
  await page.getByRole("button", { name: "New novel" }).click();
  // Typing before hydration only writes the DOM: React then replaces the value with its own
  // state, and the form submits the title it had before.
  await waitForHydration(page);
  await page.getByLabel("Title *").fill(novel.title);
  if (novel.pair) {
    await selectLanguage(page, "#sourceLang", novel.pair.source);
    await selectLanguage(page, "#targetLang", novel.pair.target);
  }
  await page.getByRole("button", { name: "Create Novel" }).click();
  // A brand-new novel has nothing to read yet, and importing is the next step, so the studio
  // opens on the add-chapters section. The reading page is a separate address the trail links to.
  await expect(page.getByRole("heading", { name: "Add chapters" })).toBeVisible();
  return novelIdIn(page.url());
}

/** The novel's id, taken from the address of one of its studio pages - the only place it is named. */
function novelIdIn(address: string): string {
  const [, , id] = new URL(address).pathname.split("/");
  if (!id) throw new Error(`The studio address names no novel: ${address}`);
  return id;
}

/**
 * Choose a language in one of the form's two pickers.
 *
 * Base UI keeps a closed Select mounted, so an unscoped `getByRole("option", …)` can also match the
 * *other* picker's copy of the same language — which is what a target picker sees whenever the
 * source picker lists the language too. The open select is the only one whose trigger points at its
 * list, so the option is addressed through `aria-controls`. The studio's settings section carries
 * the same two triggers, which is why this is here rather than inside the novel form's own helper.
 */
export async function selectLanguage(
  page: Page,
  trigger: "#sourceLang" | "#targetLang",
  name: string,
): Promise<void> {
  const triggerLocator = page.locator(trigger);
  await triggerLocator.click();
  // Base UI writes `aria-controls` on the render after the click, and a just-closed
  // picker keeps a stale one, so wait for a live pointer at the open list.
  await expect(triggerLocator).toHaveAttribute("aria-controls", /./);
  const listId = await triggerLocator.getAttribute("aria-controls");
  if (!listId) throw new Error(`The ${trigger} picker did not open`);
  await page.locator(`#${listId}`).getByRole("option", { name }).click();
}

/** A chapter as the paste form takes it: the number a reader sees, a title, and the source text. */
export interface NewChapter {
  readonly number: string;
  readonly title: string;
  readonly source: string;
}

/**
 * Fills the paste form's three fields where the reader is, and proves the form took the number.
 *
 * The number is the field worth checking: the form commits it when focus leaves it and moves on to
 * the title, and a value React has not taken back is a chapter submitted with the number of the one
 * before it.
 */
export async function fillChapterForm(page: Page, chapter: NewChapter): Promise<void> {
  const number = page.getByLabel("Chapter number *");
  await expect(number).toBeVisible();
  await number.fill(chapter.number);
  await expect(number).toHaveValue(chapter.number);
  await page.getByLabel("Chapter title *").fill(chapter.title);
  await page.getByLabel("Source text *").fill(chapter.source);
}

/**
 * Adds one chapter through the paste form, and proves the studio took it.
 *
 * "Chapter added successfully" is the app's own word for the write, and sonner stacks the newest
 * toast first: the first element carrying that text is the one this click raised, which matters
 * when a spec adds several in a row and a previous toast is still on screen. The emptied fields are
 * what says the form is ready for the next chapter, which is how those specs keep going.
 *
 * The add-chapters section is opened rather than assumed, because that is where the paste form
 * lives: a spec that has just been reading a chapter is one click away from it either way.
 */
export async function addChapter(page: Page, chapter: NewChapter): Promise<void> {
  await studioSection(page, "Add chapters").click();
  await fillChapterForm(page, chapter);
  await page.getByRole("button", { name: "Add chapter", exact: true }).click();
  await expect(page.getByText("Chapter added successfully", { exact: true }).first()).toBeVisible();
  await expect(page.getByLabel("Chapter title *")).toHaveValue("");
  await expect(page.getByLabel("Source text *")).toHaveValue("");
}

/**
 * The studio's own sub-navigation, as opposed to the site header and the reader's controls.
 *
 * Two things make the way here deliberate. The nav is what the link is scoped to, because the page
 * around it links on too: the progress card also links to the glossary (and only names it
 * "Glossary" until its counts load), and the reader has chapter controls of its own. And the name
 * is matched exactly, because the sections are named for each other: "Chapters" is a substring of
 * "Add chapters", and an owner visits both from the same bar.
 */
export function studioSection(page: Page, name: string) {
  return page
    .getByRole("navigation", { name: "Novel studio" })
    .getByRole("link", { name, exact: true });
}

/**
 * Opens a chapter from the studio's chapter list, and proves the reader is on it.
 *
 * The link carries the title the reader shows, which is the translated one once a chapter has been
 * translated: each caller passes the title its own novel has. The list is loaded data, so the link
 * is given a bound of its own rather than the spec's whole timeout, and the heading afterwards is
 * what says the reader really opened the chapter and not a neighbouring one.
 */
export async function openChapter(page: Page, title: string): Promise<void> {
  await studioSection(page, "Chapters").click();
  const chapter = page.getByRole("link", { name: title, exact: true });
  await expect(chapter).toBeVisible({ timeout: 30_000 });
  await chapter.click();
  await expect(page.getByRole("heading", { name: title })).toBeVisible();
}

/**
 * Reading appearance opens from the toolbar's settings button: a popover on a pointer screen, a
 * sheet under a thumb.
 */
export async function openReaderAppearance(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Reading settings" }).click();
}

/** Each preference is a pressed button inside a labelled group, not a radio. */
export function appearanceGroup(page: Page, label: string) {
  return page.getByRole("group", { name: label });
}

/**
 * Closes it again. The panel has no close button, so the trigger that opened it toggles it shut -
 * and the Page group is what says the panel is gone, whichever group the caller was using.
 */
export async function closeReaderAppearance(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Reading settings" }).click();
  await expect(page.getByRole("group", { name: "Page" })).toHaveCount(0);
}
