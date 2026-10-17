import { expect, test, type Page } from "@playwright/test";

import { waitForHydration } from "./sessions";

/**
 * The language rules, walked in a browser.
 *
 * Everything below is already covered in jsdom at the rule level, and the whole point of this
 * spec is the part jsdom cannot see: that the middleware, the route parameter, the document's
 * own `lang`, the stylesheet's `:lang(th)` block and the switcher agree with each other in a
 * real page load. A Thai page had never been rendered in a browser before this file existed.
 *
 * The suite pins `VITE_DEFAULT_LOCALE=en` (`scripts/e2e/run.ts`), so here the unprefixed
 * language is English and `/th` is the prefixed one — the mirror image of production. The
 * rules are written against `defaultLocale` rather than a literal, so both readings hold; what
 * this spec must not do is hardcode Thai as the unprefixed language.
 *
 * Redirects are asserted with `page.request` and `maxRedirects: 0` rather than by inspecting
 * a navigation's request chain: a page load here is `/th/catalog` -> 301/307 -> the same URL
 * with the library's default search parameters, so `redirectedFrom()` names the search
 * normalization, not the language hop. The one-shot request says exactly what the middleware
 * answered, and leaves the browser to assert where a reader ends up.
 *
 * No test here signs in. The seeded operator's remembered locale is shared state no spec may
 * change — `SHARED` (`e2e/fixtures.ts`) declares that, and why — because every other spec asserts
 * English copy, so a switch made as that account would decide the language of everything that runs
 * after this one. The language these tests walk is the cookie's and the URL's, which is exactly
 * what a guest has.
 */

const siteName = "Pnt - Personal Novel Translator";

/** The typography the stylesheet is responsible for, read off the rendered document. */
async function typography(page: Page) {
  return page.evaluate(() => {
    const root = getComputedStyle(document.documentElement);
    const heading = document.querySelector("h1");
    const body = document.querySelector("main p");
    return {
      rootLineHeightRatio: Number.parseFloat(root.lineHeight) / Number.parseFloat(root.fontSize),
      // Chrome reports a reset tracking as the keyword: `letter-spacing: 0em` computes to
      // `normal`, not to `0px`, so that is what "the negative tracking is gone" looks like.
      headingLetterSpacing: heading ? getComputedStyle(heading).letterSpacing : null,
      bodyLineHeightRatio: body
        ? Number.parseFloat(getComputedStyle(body).lineHeight) /
          Number.parseFloat(getComputedStyle(body).fontSize)
        : null,
    };
  });
}

test("the default language keeps no prefix, and its prefix redirects", async ({ page }) => {
  test.setTimeout(60_000);

  await page.goto("/catalog");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page).toHaveTitle(`Catalog | ${siteName}`);
  await expect(page.getByRole("heading", { level: 1, name: "Catalog", exact: true })).toBeVisible();

  // Two URLs for one document is what a sitemap has to avoid, so the default language never
  // keeps its prefix: `/en/catalog` is a permanent redirect, not a second copy.
  const prefixedDefault = await page.request.get("/en/catalog", { maxRedirects: 0 });
  expect(prefixedDefault.status()).toBe(301);
  expect(prefixedDefault.headers()["location"]).toBe("/catalog");
  await page.goto("/en/catalog");
  await expect(page).toHaveURL((url) => url.pathname === "/catalog");

  // An ignored path has no localized form at all, so a prefix on one is stripped the same way.
  const prefixedIgnored = await page.request.get("/th/robots.txt", { maxRedirects: 0 });
  expect(prefixedIgnored.status()).toBe(301);
  expect(prefixedIgnored.headers()["location"]).toBe("/robots.txt");
  await page.goto("/th/robots.txt");
  await expect(page).toHaveURL((url) => url.pathname === "/robots.txt");
});

test("a prefix that names no language is a page that does not exist", async ({ page }) => {
  test.setTimeout(60_000);

  // `/xx/catalog` is a 404 rather than a catalog in a language nobody speaks, which is also
  // what stops a future `/essays` from being read as a language code.
  await page.goto("/xx/catalog");
  await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
  await expect(page.locator("html")).not.toHaveAttribute("lang", "xx");
});

test("Thai is a prefixed document of its own, and a content page is never redirected", async ({
  page,
}) => {
  test.setTimeout(60_000);

  await page.goto("/th/catalog");
  await expect(page).toHaveURL((url) => url.pathname === "/th/catalog");
  await expect(page.locator("html")).toHaveAttribute("lang", "th");
  await expect(page).toHaveTitle(`แค็ตตาล็อก | ${siteName}`);
  await expect(
    page.getByRole("heading", { level: 1, name: "แค็ตตาล็อก", exact: true }),
  ).toBeVisible();

  // Reading a prefixed URL is how the choice is remembered for the pages that have no prefix
  // in their URL, so the visit has to leave the cookie behind.
  const cookies = await page.context().cookies();
  expect(cookies.find((cookie) => cookie.name === "pnt-locale")?.value).toBe("th");

  // The URL is what a shared link promises and what a crawler indexes, so a cookie that
  // disagrees with it changes nothing and redirects nobody.
  await page
    .context()
    .addCookies([{ name: "pnt-locale", value: "en", url: "http://127.0.0.1:3000" }]);
  const remembered = await page.request.get("/th/catalog", { maxRedirects: 0 });
  expect(remembered.headers()["location"] ?? "").toMatch(/^\/th\/catalog/);
  await page.goto("/th/catalog");
  await expect(page).toHaveURL((url) => url.pathname === "/th/catalog");
  await expect(
    page.getByRole("heading", { level: 1, name: "แค็ตตาล็อก", exact: true }),
  ).toBeVisible();
});

test("Thai typography is not Latin typography", async ({ page }) => {
  test.setTimeout(60_000);

  await page.goto("/catalog");
  const latin = await typography(page);
  await page.goto("/th/catalog");
  const thai = await typography(page);

  // Latin display text is tightened and set at the app's leading; Thai, where vowels and tone
  // marks stack above and below the consonant, is reset to no tracking and opened up.
  expect(latin.headingLetterSpacing).not.toBe("normal");
  expect(thai.headingLetterSpacing).toBe("normal");
  expect(thai.rootLineHeightRatio).toBeGreaterThan(latin.rootLineHeightRatio);
  expect(thai.rootLineHeightRatio).toBeCloseTo(1.7, 1);
  // The body step too, which is the leading most of a page's prose is actually set in.
  expect(latin.bodyLineHeightRatio).toBeCloseTo(1.6, 1);
  expect(thai.bodyLineHeightRatio).toBeCloseTo(1.75, 1);
});

/**
 * The legal pages, in a browser.
 *
 * They are the one pair of pages whose body is prose rather than chrome, and they are the pages a
 * reader is most likely to open in the language they did not learn. Each one used to be English
 * JSX under a translated heading, which no unit test could see: the copy was not a string literal
 * and not a catalog key, so it was simply not there to assert on. The prose now lives in
 * `lib/legal/` in both languages, and this is the check that the page a reader opens is the one
 * that language has.
 */
test("a policy page reads in the reader's language, and says which text governs", async ({
  page,
}) => {
  test.setTimeout(90_000);

  await page.goto("/terms");
  await expect(page.getByRole("heading", { level: 1, name: "Terms of Service" })).toBeVisible();
  await expect(page.getByText(/^Version \d{4}-\d{2}-\d{2}\.$/)).toBeVisible();
  // The English page is the governing text, so there is nothing for it to defer to.
  await expect(page.getByText("This page is a translation")).toHaveCount(0);

  await page.goto("/th/terms");
  await expect(
    page.getByRole("heading", { level: 1, name: "ข้อกำหนดการใช้งาน", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Pnt เป็นพื้นที่ทำงานสำหรับแปลนิยาย")).toBeVisible();
  await expect(page.getByText("หน้านี้เป็นคำแปล หากเนื้อหาขัดกัน ฉบับภาษาอังกฤษมีผลเหนือกว่า")).toBeVisible();

  await page.goto("/th/privacy");
  await expect(
    page.getByRole("heading", { level: 1, name: "นโยบายความเป็นส่วนตัว", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("เราไม่ขายข้อมูลและไม่ใช้ตัวติดตามโฆษณา")).toBeVisible();

  await page.goto("/th/cookie-policy");
  await expect(
    page.getByRole("heading", { level: 1, name: "นโยบายคุกกี้", exact: true }),
  ).toBeVisible();
  // A storage key is what the browser writes, so it reads the same on both sides of the
  // translation — a Thai key would name nothing the browser stores.
  await expect(page.getByText("pnt-reader-settings")).toBeVisible();
  await expect(page.getByText("better-auth.session_token")).toBeVisible();
});

test("the switcher moves the URL and the copy, both ways", async ({ page }) => {
  test.setTimeout(90_000);

  await page.goto("/catalog");

  // This page has no form, so the wait goes on the control under test: a click delivered before
  // hydration is a click nobody hears, and the menu simply never opens.
  const trigger = page.getByRole("button", { name: "Language: English" });
  await expect(trigger).toBeVisible();
  await waitForHydration(trigger);

  await trigger.click();
  // A language names itself in the menu: the reader who needs the Thai entry cannot read the
  // English word for it.
  await page.getByRole("menuitemradio", { name: "ไทย" }).click();

  await expect(page).toHaveURL((url) => url.pathname === "/th/catalog");
  await expect(page.locator("html")).toHaveAttribute("lang", "th");
  await expect(
    page.getByRole("heading", { level: 1, name: "แค็ตตาล็อก", exact: true }),
  ).toBeVisible();

  // And back: the default language drops the prefix again rather than keeping a second URL.
  // Switching is a full document load on purpose, so the control has to be hydrated again.
  const thaiTrigger = page.getByRole("button", { name: "ภาษา: ไทย" });
  await waitForHydration(thaiTrigger);
  await thaiTrigger.click();
  await page.getByRole("menuitemradio", { name: "English" }).click();

  await expect(page).toHaveURL((url) => url.pathname === "/catalog");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.getByRole("heading", { level: 1, name: "Catalog", exact: true })).toBeVisible();
});
