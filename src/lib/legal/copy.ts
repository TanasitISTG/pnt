import type { LegalCopy, LegalDocument, LegalDocumentId } from "./types";
import type { Locale } from "@/lib/i18n/locales";

/**
 * The three legal documents in both languages.
 *
 * The English side is the text that was already published, moved here verbatim — nothing a reader
 * of the English policy sees changes. The Thai side is a translation of it, written to be read as
 * the app's own Thai reads (§5 of `i18n.md`): the same nouns the catalog uses (`ผู้ให้บริการ`,
 * `คีย์ API`, `นิยาย`), no particles, and no apology.
 *
 * `satisfies` is the check this file exists for: every document has to be present in every locale,
 * and every document has to have the shape above. A translation that stops halfway is a compile
 * error, not a page that renders English under a Thai heading.
 */
const termsEn: LegalDocument = {
  title: "Terms of Service",
  summary: "Terms governing access to Personal Novel Translator (Pnt).",
  sections: [
    {
      heading: "1. Service scope",
      paragraphs: [
        "Pnt is a novel translation workspace. Every account owns its own novels, chapters and glossary, and nothing in one account is readable or editable from another. Guests can read chapters their translators have published, which is the whole of what guest access provides.",
      ],
    },
    {
      heading: "2. Machine translation",
      paragraphs: [
        'Translations displayed on Pnt are generated using automated machine-translation models (LLMs). Translations are provided "as is" without warranty of any kind, express or implied, regarding accuracy, completeness, or suitability.',
      ],
    },
    {
      heading: "3. Intellectual property",
      paragraphs: [
        "Original web novel texts and content remain the intellectual property of their respective authors and copyright holders. Pnt is intended solely for personal study, translation assistance, and private reading.",
      ],
    },
  ],
};

const termsTh: LegalDocument = {
  title: "ข้อกำหนดการใช้งาน",
  summary: "ข้อกำหนดในการเข้าใช้งาน Personal Novel Translator (Pnt)",
  sections: [
    {
      heading: "1. ขอบเขตของบริการ",
      paragraphs: [
        "Pnt เป็นพื้นที่ทำงานสำหรับแปลนิยาย แต่ละบัญชีมีนิยาย บท และอภิธานศัพท์ของตัวเอง โดยที่บัญชีอื่นอ่านหรือแก้ไขไม่ได้ ผู้อ่านทั่วไปอ่านได้เฉพาะบทที่นักแปลเผยแพร่แล้ว ซึ่งเป็นสิทธิ์ทั้งหมดของการเข้าใช้แบบไม่ลงชื่อ",
      ],
    },
    {
      heading: "2. การแปลด้วยเครื่อง",
      paragraphs: [
        "คำแปลที่แสดงบน Pnt ผลิตด้วยโมเดลแปลอัตโนมัติ (LLM) คำแปลให้ตามสภาพ โดยไม่มีการรับประกันใด ๆ ทั้งโดยชัดแจ้งและโดยนัย เรื่องความถูกต้อง ความครบถ้วน หรือความเหมาะสม",
      ],
    },
    {
      heading: "3. ทรัพย์สินทางปัญญา",
      paragraphs: [
        "ข้อความและเนื้อหานิยายเว็บต้นฉบับยังเป็นทรัพย์สินทางปัญญาของผู้เขียนและผู้ถือลิขสิทธิ์แต่ละราย Pnt จัดทำขึ้นเพื่อการศึกษาส่วนตัว การช่วยแปล และการอ่านส่วนตัวเท่านั้น",
      ],
    },
  ],
};

const privacyEn: LegalDocument = {
  title: "Privacy Policy",
  summary: "Information on how data is handled on Personal Novel Translator (Pnt).",
  sections: [
    {
      heading: "1. Data storage & usage",
      paragraphs: [
        "Every account on Pnt keeps its own workspace: its own novels, chapters and glossary, which no other account can read or edit. Guest access is read-only.",
      ],
      bullets: [
        {
          lead: "Local storage",
          text: "Reader preferences, font sizes, line height, text width, page theme, and reading progress for guests are stored locally on your device.",
        },
        {
          lead: "Account reader state",
          text: "For a signed-in account, reading position, read chapters, and bookmarks are stored with the account instead of the browser.",
        },
        {
          lead: "Session data",
          text: "Sessions are authenticated with HttpOnly cookies.",
        },
        {
          lead: "AI configuration",
          text: "Translation provider API keys are encrypted at rest using AES-GCM and are never exposed to another account.",
        },
      ],
    },
    {
      heading: "2. Third-party services",
      paragraphs: ["We do not sell data or run advertising trackers."],
      bullets: [
        {
          lead: "PostHog",
          text: "Optional page-view analytics and crash reports, active only with explicit user consent. Session replay and automatic page-content capture are disabled.",
        },
        {
          lead: "Translation providers",
          text: "Novel raw text is sent to user-configured LLM providers (e.g. OpenAI / OpenRouter) solely for translation processing.",
        },
      ],
    },
    {
      heading: "3. Data retention",
      paragraphs: [
        "Novels, chapters, glossaries, and reader progress remain stored until you delete them or delete your account. Progress a guest keeps in the browser is cleared by clearing browser storage.",
      ],
    },
  ],
};

const privacyTh: LegalDocument = {
  title: "นโยบายความเป็นส่วนตัว",
  summary: "ข้อมูลว่าข้อมูลถูกจัดการอย่างไรบน Personal Novel Translator (Pnt)",
  sections: [
    {
      heading: "1. การจัดเก็บและการใช้ข้อมูล",
      paragraphs: [
        "ทุกบัญชีบน Pnt มีพื้นที่ทำงานของตัวเอง ทั้งนิยาย บท และอภิธานศัพท์ ซึ่งบัญชีอื่นอ่านหรือแก้ไขไม่ได้ การเข้าใช้แบบไม่ลงชื่อเป็นแบบอ่านเท่านั้น",
      ],
      bullets: [
        {
          lead: "ที่เก็บข้อมูลในเครื่อง",
          text: "ค่าการอ่าน ขนาดตัวอักษร ระยะบรรทัด ความกว้างข้อความ ธีมของหน้า และความคืบหน้าการอ่านของผู้อ่านทั่วไป ถูกเก็บไว้ในอุปกรณ์ของคุณ",
        },
        {
          lead: "สถานะการอ่านของบัญชี",
          text: "เมื่อลงชื่อเข้าใช้ ตำแหน่งการอ่าน บทที่อ่านแล้ว และบุ๊กมาร์กจะถูกเก็บไว้กับบัญชีแทนเบราว์เซอร์",
        },
        {
          lead: "ข้อมูลเซสชัน",
          text: "เซสชันยืนยันตัวตนด้วยคุกกี้แบบ HttpOnly",
        },
        {
          lead: "การตั้งค่า AI",
          text: "คีย์ API ของผู้ให้บริการแปลถูกเข้ารหัสไว้บนเซิร์ฟเวอร์ด้วย AES-GCM และไม่ถูกเปิดเผยต่อบัญชีอื่น",
        },
      ],
    },
    {
      heading: "2. บริการของบุคคลที่สาม",
      paragraphs: ["เราไม่ขายข้อมูลและไม่ใช้ตัวติดตามโฆษณา"],
      bullets: [
        {
          lead: "PostHog",
          text: "สถิติการเข้าชมและรายงานข้อขัดข้องแบบเลือกได้ ทำงานเมื่อได้รับความยินยอมชัดเจนเท่านั้น และปิดการบันทึกซ้ำรวมถึงการเก็บเนื้อหาหน้าอัตโนมัติไว้",
        },
        {
          lead: "ผู้ให้บริการแปล",
          text: "ข้อความต้นฉบับของนิยายถูกส่งไปยังผู้ให้บริการ LLM ที่คุณตั้งค่าไว้ (เช่น OpenAI / OpenRouter) เพื่อการแปลเท่านั้น",
        },
      ],
    },
    {
      heading: "3. ระยะเวลาการเก็บข้อมูล",
      paragraphs: [
        "นิยาย บท อภิธานศัพท์ และความคืบหน้าการอ่านจะถูกเก็บไว้จนกว่าคุณจะลบหรือลบบัญชี ความคืบหน้าที่ผู้อ่านทั่วไปเก็บไว้ในเบราว์เซอร์จะหายไปเมื่อล้างข้อมูลเบราว์เซอร์",
      ],
    },
  ],
};

const cookiePolicyEn: LegalDocument = {
  title: "Cookie Policy",
  summary: "This policy explains how Pnt uses cookies and local storage to operate the platform.",
  sections: [
    {
      heading: "1. Essential cookies",
      paragraphs: [
        "We use the essential cookies that signing in requires. They cannot be switched off, and they do not require consent.",
      ],
      cards: [
        {
          name: "better-auth.session_token",
          detail: "Purpose: Authenticates signed-in sessions. Duration: Session / 30 days.",
        },
      ],
    },
    {
      heading: "2. Functional cookies",
      paragraphs: [
        "These remember a choice you made so the next visit is quicker. They are created only after you sign in, and they store no identifier beyond the option you chose.",
      ],
      cards: [
        {
          name: "better-auth.last_used_login_method",
          detail:
            "Purpose: Remembers which sign-in method worked last in this browser, so the sign-in page can point you at it. Duration: 30 days.",
        },
      ],
    },
    {
      heading: "3. Optional analytics cookies",
      paragraphs: [
        "When you grant consent, we use PostHog for product analytics and error tracking to help improve service performance and stability.",
      ],
      cards: [
        {
          name: "ph_* (PostHog)",
          detail:
            'Purpose: Anonymous usage statistics and exception monitoring. Status: Only active if you click "Accept all" on the consent banner.',
        },
      ],
    },
    {
      heading: "4. Browser local storage",
      paragraphs: [
        "We store functional preferences directly in your browser. This data never leaves your device:",
      ],
      bullets: [
        {
          lead: "pnt-reader-settings",
          text: "Font size, typeface, line height, text width, view mode, and reader page theme.",
        },
        {
          lead: "pnt-reader-progress",
          text: "Reading position across chapters for guests.",
        },
        {
          lead: "pnt-reader-bookmarks",
          text: "Reader bookmarks and notes for guests.",
        },
        {
          lead: "pnt-consent-v1",
          text: "Your cookie consent selection.",
        },
        {
          lead: "theme",
          text: "Dark mode / light mode appearance setting.",
        },
      ],
      closing:
        "When you sign in, your reading position, read chapters, and bookmarks are stored with your account instead of the browser, so they follow you across devices.",
    },
  ],
};

const cookiePolicyTh: LegalDocument = {
  title: "นโยบายคุกกี้",
  summary: "นโยบายนี้อธิบายว่า Pnt ใช้คุกกี้และที่เก็บข้อมูลในเบราว์เซอร์อย่างไรเพื่อให้บริการทำงาน",
  sections: [
    {
      heading: "1. คุกกี้ที่จำเป็น",
      paragraphs: ["เราใช้คุกกี้ที่จำเป็นสำหรับการเข้าสู่ระบบ ปิดไม่ได้ และไม่ต้องขอความยินยอม"],
      cards: [
        {
          name: "better-auth.session_token",
          detail: "วัตถุประสงค์: ยืนยันเซสชันที่ลงชื่อเข้าใช้ อายุ: เซสชัน / 30 วัน",
        },
      ],
    },
    {
      heading: "2. คุกกี้เพื่อการทำงาน",
      paragraphs: [
        "คุกกี้กลุ่มนี้จดจำตัวเลือกที่คุณเคยทำไว้ เพื่อให้การเข้าชมครั้งถัดไปเร็วขึ้น ถูกสร้างขึ้นหลังคุณลงชื่อเข้าใช้เท่านั้น และเก็บเฉพาะตัวเลือกที่คุณใช้ ไม่เก็บข้อมูลระบุตัวตนอื่น",
      ],
      cards: [
        {
          name: "better-auth.last_used_login_method",
          detail:
            "วัตถุประสงค์: จดจำว่าวิธีลงชื่อเข้าใช้ใดได้ผลล่าสุดในเบราว์เซอร์นี้ เพื่อให้หน้าเข้าสู่ระบบชี้ไปที่วิธีนั้น อายุ: 30 วัน",
        },
      ],
    },
    {
      heading: "3. คุกกี้วิเคราะห์แบบเลือกได้",
      paragraphs: [
        "เมื่อคุณให้ความยินยอม เราใช้ PostHog วิเคราะห์การใช้งานและติดตามข้อผิดพลาด เพื่อพัฒนาประสิทธิภาพและความเสถียรของบริการ",
      ],
      cards: [
        {
          name: "ph_* (PostHog)",
          detail:
            "วัตถุประสงค์: สถิติการใช้งานแบบไม่ระบุตัวตนและเฝ้าดูข้อผิดพลาด สถานะ: ทำงานเมื่อคุณกด “ยอมรับทั้งหมด” บนแบนเนอร์ความยินยอมเท่านั้น",
        },
      ],
    },
    {
      heading: "4. ที่เก็บข้อมูลในเบราว์เซอร์",
      paragraphs: ["เราเก็บค่าการใช้งานไว้ในเบราว์เซอร์ของคุณโดยตรง ข้อมูลนี้ไม่ออกจากอุปกรณ์ของคุณ:"],
      bullets: [
        {
          lead: "pnt-reader-settings",
          text: "ขนาดตัวอักษร แบบตัวอักษร ระยะบรรทัด ความกว้างข้อความ โหมดมุมมอง และธีมหน้าอ่าน",
        },
        {
          lead: "pnt-reader-progress",
          text: "ตำแหน่งการอ่านข้ามบทสำหรับผู้อ่านทั่วไป",
        },
        {
          lead: "pnt-reader-bookmarks",
          text: "บุ๊กมาร์กและบันทึกของผู้อ่านทั่วไป",
        },
        {
          lead: "pnt-consent-v1",
          text: "ตัวเลือกความยินยอมคุกกี้ของคุณ",
        },
        {
          lead: "theme",
          text: "การตั้งค่ารูปลักษณ์ โหมดมืด / โหมดสว่าง",
        },
      ],
      closing:
        "เมื่อคุณลงชื่อเข้าใช้ ตำแหน่งการอ่าน บทที่อ่านแล้ว และบุ๊กมาร์กจะถูกเก็บไว้กับบัญชีแทนเบราว์เซอร์ จึงติดตามคุณไปได้ทุกอุปกรณ์",
    },
  ],
};

/**
 * The documents, and the reason this module is one map rather than three pages.
 *
 * A page reads `legalDocument("privacy", locale)`, so the two languages cannot be reached
 * differently and a new locale is a type error here until every document is written in it.
 */
export const legalCopy = {
  terms: { en: termsEn, th: termsTh },
  privacy: { en: privacyEn, th: privacyTh },
  cookiePolicy: { en: cookiePolicyEn, th: cookiePolicyTh },
} satisfies LegalCopy;

export function legalDocument(id: LegalDocumentId, locale: Locale): LegalDocument {
  return legalCopy[id][locale];
}
