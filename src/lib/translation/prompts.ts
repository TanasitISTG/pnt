import { MAX_RELATIONSHIP_PROMPT_ITEMS } from "@/lib/relationships/schemas";
import type { CharacterProfile, CharacterRelationship } from "@/lib/relationships/schemas";
import type { RelationshipPromptContext, RelationshipPromptPair } from "@/lib/relationships/map";
import type { ContextOptions, LanguagePair } from "./translation.types";

// ---------------------------------------------------------------------------
// Public builders
// ---------------------------------------------------------------------------

export function buildSystemPrompt(
  pair: string,
  glossaryBlock?: string | null,
  context?: ContextOptions | null,
  customPrompt?: string | null,
): string {
  const p = normalizePair(pair);

  const sections: string[] = [
    getRoleLine(p),
    getPriorityOrder(),
    getHardRules(),
    getStyleGuidelines(p),
    getFewShotExample(p),
  ];

  if (glossaryBlock && glossaryBlock.trim().length > 0) {
    sections.push(
      `## Terminology & Glossary\nSource → target spelling is authoritative. The glossary notes are supporting context only. ALWAYS use the exact glossary translation — including spacing, punctuation, and capitalization — every time the source term appears.\nNever invent alternative spellings or wordings for glossary entries. Approved character glossary mappings also supply exact Thai names to the relationship context.\n${glossaryBlock.trim()}`,
    );
  }

  if (context?.previousSummary && context.previousSummary.trim().length > 0) {
    sections.push(
      `## Story Context\n### Summary of Previous Chapter:\n${context.previousSummary.trim()}`,
    );
  }

  if (context?.relationshipContext) {
    sections.push(formatRelationshipContext(context.relationshipContext));
  }

  if (customPrompt && customPrompt.trim().length > 0) {
    sections.push(`## Custom Instructions\n${customPrompt.trim()}`);
  }

  sections.push(getOutputContract());

  return sections.join("\n\n");
}

/**
 * Builds the user message with optional preceding-translation context and
 * <<<BEGIN_TEXT>>> / <<<END_TEXT>>> delimiters around the translatable chunk.
 */
export function buildUserMessage(markedText: string, previousChunkTail?: string | null): string {
  const parts: string[] = [];

  if (previousChunkTail && previousChunkTail.trim().length > 0) {
    parts.push(
      `[Preceding translation for continuity — do not translate this]\n...${previousChunkTail.trim()}`,
    );
  }

  parts.push(`<<<BEGIN_TEXT>>>\n${markedText}\n<<<END_TEXT>>>`);

  return parts.join("\n\n");
}

export function buildTitlePrompt(pair: string): string {
  const normalizedPair = normalizePair(pair);
  const langs: Record<LanguagePair, string> = {
    "en->th": "English to Thai",
    "zh->en": "Chinese to English",
    "zh->th": "Chinese to Thai",
  };
  return [
    `You are a professional literary translator. Translate the chapter title from ${langs[normalizedPair]}.`,
    "Output ONLY the translated title — no quotes, no explanation, no chapter numbers.",
  ].join("\n");
}

export function buildSummaryPrompt(_pair: string): string {
  return [
    "You are an expert novel editor and summarizer.",
    "Provide a concise summary (~150-250 words) of the chapter.",
    "CRITICAL REQUIREMENT: Always write the summary in ENGLISH, regardless of the source or target language of the novel.",
    "",
    "Structure your summary with these sections:",
    "PLOT: Key events and developments (2-3 sentences).",
    "CHARACTERS: Named characters active in this chapter, their current state, and relationships shown.",
    "SETTING: Current location(s) and any setting changes.",
    "DIALOGUE CONTINUITY: Record only character gender/role, directed relationship changes, and recurring speech-register facts explicitly evidenced in this chapter. Do not infer or invent pronoun mappings; this remains supporting context and does not overwrite the structured relationship map.",
    "CONTEXT: Key facts, unresolved tensions, or foreshadowing that would help translate the next chapter.",
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Residual source-script detection
// ---------------------------------------------------------------------------

// CJK ideographs (ext-A + unified + compat). Leftover hanzi in output = missed translation.
// Single source of truth: CJK_RE scans in JS; RESIDUAL_CJK_SQL_RE is the same class
// used by getResidualHanziChapters for a DB-side pre-filter (PostgreSQL `~`).
export const RESIDUAL_CJK_CLASS = "㐀-䶿一-鿿豈-﫿";
export const RESIDUAL_CJK_SQL_RE = `[${RESIDUAL_CJK_CLASS}]`;
const CJK_RE = new RegExp(RESIDUAL_CJK_SQL_RE, "g");

/** Leftover CJK chars in a translation — never legitimate output, so detection is pair-agnostic
 *  (a wrong sourceLang on the novel must not disable it). `pair` kept for caller compatibility. */
export function findResidualSourceChars(_pair: string, text: string): string[] {
  return text.match(CJK_RE) || [];
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

export function normalizePair(pair: string): LanguagePair {
  const clean = pair.toLowerCase().replace(/\s+/g, "").replace("→", "->");
  if (clean === "en->th" || clean === "enth") return "en->th";
  if (clean === "zh->en" || clean === "zhen") return "zh->en";
  if (clean === "zh->th" || clean === "zhth") return "zh->th";
  return "en->th";
}

export const LANG_LABELS: Record<LanguagePair, { source: string; target: string }> = {
  "en->th": { source: "English", target: "Thai" },
  "zh->en": { source: "Chinese", target: "English" },
  "zh->th": { source: "Chinese", target: "Thai" },
};

function getRoleLine(pair: LanguagePair): string {
  const { source, target } = LANG_LABELS[pair];
  return `You translate ${source} web novels into ${target}.`;
}

function getPriorityOrder(): string {
  return [
    "## Translation Priorities (highest first)",
    "1. Exact glossary names and source → target spellings",
    "2. Facts explicitly shown in the current source",
    "3. Locked admin speech choices for the directed pair",
    "4. Automatic current-scene relationship guidance",
    "5. Custom instructions and global style defaults",
    "6. Completeness — translate every word, line, and element",
    "7. Meaning fidelity — convey the author's intent accurately",
    "8. Natural target language — restructure for natural target-language syntax",
    "9. Style preservation — maintain tone, pacing, and voice",
  ].join("\n");
}

function getHardRules(): string {
  return [
    "## Hard Rules",
    "- Translate everything: narration, dialogue, system messages, internal thoughts, status windows, sound effects, bracketed text (【】[]), notifications, names, and usernames. Transliterate names into the target script. No source-language text may remain.",
    "- Do not add information absent from the source. Do not explain terms. Do not infer omitted context.",
    "- Do not rewrite for literary improvement. Preserve pacing, repetition, and stylistic quirks when intentional.",
    "- Do not summarize or skip content.",
    "- If HTML/XML-like tags appear in the source, preserve them verbatim. Translate only visible text content.",
    "- Preserve every ||¶|| paragraph marker exactly as-is in your translation output, in the same position relative to the surrounding paragraphs. Do not add, remove, or reorder markers.",
  ].join("\n");
}

function getStyleGuidelines(pair: LanguagePair): string {
  const { target } = LANG_LABELS[pair];
  const lines = [
    "## Style Guidelines",
    `- Translate the meaning of each sentence. Restructure for natural ${target} syntax — do not mirror source sentence structure.`,
    "- When the source is intentionally ambiguous, preserve the ambiguity. Do not resolve uncertain pronouns unless the original does.",
    "- Render every ellipsis or hesitation pause as a single `…`. Never output runs of dots or middle dots (`......`, `······`, `……`).",
    "- For names not in the glossary, transliterate consistently. If a proper noun appears multiple times, use the same translation every time.",
  ];

  if (pair === "en->th" || pair === "zh->th") {
    lines.push(
      "- Thai punctuation and quotes: use curly double quotes (“…”), and do not leave space before `…`.",
      "- Dialogue should sound as if originally written in Thai. Each character must have a consistent speech level, vocabulary, pronoun choice, and honorific usage. Do not make different characters sound alike.",
      "- Keep each named character's Thai pronoun and speech level consistent with the Story Context, Character & Relationship Context, and preceding translation.",
    );
  }

  if (pair === "zh->th") {
    lines.push(
      "- Identify both the dialogue speaker and listener before choosing Thai forms; second-person words follow the listener's gender. นาย is not for a female listener.",
      "- A male 我 may become ผม toward elders, superiors, or formal listeners, but may become ฉัน, เรา, a name, a kinship term, or omission among close peers or intimates.",
      "- Do not append ครับ, ค่ะ, or คะ by default; use sentence particles only when the directed relationship context or source evidence supports them.",
      "- When evidence is insufficient, preserve ambiguity by omitting the pronoun or using an established name or kinship term rather than guessing gender or status.",
      "- A current source change may supersede a relationship label, but automatic analysis and generic custom instructions may not overwrite a locked per-pair speech choice.",
    );
  }

  if (pair === "zh->en") {
    lines.push(
      "- Properly localize cultivation ranks, techniques, and honorific idioms while preserving the genre's distinct atmosphere.",
    );
  }

  return lines.join("\n");
}

function getFewShotExample(pair: LanguagePair): string {
  if (pair === "zh->th") {
    return [
      "## Examples (Chinese → Thai dialogue direction)",
      "1. Source: 男人对女人说：“你先走。” Good translation: “เธอไปก่อนเถอะ”",
      "2. Source: 儿子对父亲说：“我会回来的。” Good translation: “ผมจะกลับมา”",
      "3. Source: 男人对亲密的男性朋友说：“你别装了，我知道。” Good translation: “ฉันรู้ว่านายกำลังแกล้งทำ”",
      "4. Source: 男主对女主说：“我只想和你在一起。” Good translation: “ฉันแค่อยากอยู่กับเธอ”",
      "These are directional examples, not a global mapping for 我 or 你. Do not add ครับ/ค่ะ/คะ by default.",
    ].join("\n");
  }

  const examples: Record<LanguagePair, { source: string; translation: string }> = {
    "en->th": {
      source: `"I told you to stay away," he said coldly, turning his back to her. She clenched her fists but said nothing.`,
      translation: `“บอกแล้วไงว่าอย่าเข้ามาใกล้” เขาพูดเสียงเย็นชาพลางหันหลังให้เธอ เธอกำหมัดแน่นแต่ไม่ได้เอ่ยอะไร`,
    },
    "zh->en": {
      source: `"你以为你是谁？"他冷笑道。身后的少女瑟瑟发抖，却一言不发。`,
      translation: `"Who do you think you are?" he sneered. Behind him, the girl trembled yet said nothing.`,
    },
    "zh->th": {
      source: `"你以为你是谁……"他冷笑道。身后的少女瑟瑟发抖，却一言不发。`,
      translation: `“แกคิดว่าแกเป็นใคร…” เขายิ้มเยาะ สาวน้อยด้านหลังตัวสั่นแต่ไม่เอ่ยสักคำ`,
    },
  };

  const ex = examples[pair];
  return ["## Example", `Source: ${ex.source}`, `Good translation: ${ex.translation}`].join("\n");
}

type CharacterProjection = Pick<
  CharacterProfile,
  "id" | "sourceName" | "targetName" | "aliases" | "gender" | "role" | "notes" | "locked"
>;

type RelationshipProjection = Pick<
  CharacterRelationship,
  | "id"
  | "speakerId"
  | "listenerId"
  | "relationship"
  | "speakerStatus"
  | "familiarity"
  | "selfPronoun"
  | "addresseeTerm"
  | "sentenceParticles"
  | "register"
  | "notes"
  | "locked"
>;

interface RelationshipContextProjection {
  characters: CharacterProjection[];
  relationships: RelationshipProjection[];
  activePairs: RelationshipPromptPair[];
}

function projectRelationshipContext(
  context: RelationshipPromptContext,
): RelationshipContextProjection {
  const charactersById = new Map(context.characters.map((character) => [character.id, character]));
  const relationshipsById = new Map(
    context.relationships.map((relationship) => [relationship.id, relationship]),
  );
  const relationshipsByPair = new Map(
    context.relationships.map((relationship) => [
      pairKey(relationship.speakerId, relationship.listenerId),
      relationship,
    ]),
  );
  const referencedCharacters = new Map<string, CharacterProfile>();
  const relationships: RelationshipProjection[] = [];
  const activePairs: RelationshipPromptPair[] = [];
  const emittedPairs = new Set<string>();

  for (const active of context.activePairs) {
    const relationship = active.relationshipId
      ? relationshipsById.get(active.relationshipId)
      : relationshipsByPair.get(pairKey(active.speakerId, active.listenerId));
    if (
      !relationship ||
      !relationship.enabled ||
      relationship.speakerId !== active.speakerId ||
      relationship.listenerId !== active.listenerId
    ) {
      continue;
    }
    const speaker = charactersById.get(relationship.speakerId);
    const listener = charactersById.get(relationship.listenerId);
    if (!speaker || !listener || !speaker.enabled || !listener.enabled) continue;

    const pair = pairKey(relationship.speakerId, relationship.listenerId);
    if (emittedPairs.has(pair) || relationships.length >= MAX_RELATIONSHIP_PROMPT_ITEMS) {
      continue;
    }
    const newCharacterCount = [speaker.id, listener.id].filter(
      (id) => !referencedCharacters.has(id),
    ).length;
    if (referencedCharacters.size + newCharacterCount > MAX_RELATIONSHIP_PROMPT_ITEMS) {
      continue;
    }

    referencedCharacters.set(speaker.id, speaker);
    referencedCharacters.set(listener.id, listener);
    relationships.push(projectRelationship(relationship));
    activePairs.push({
      speakerId: relationship.speakerId,
      listenerId: relationship.listenerId,
      relationshipId: relationship.id,
    });
    emittedPairs.add(pair);
  }

  for (const character of context.characters) {
    if (
      !character.enabled ||
      referencedCharacters.size >= MAX_RELATIONSHIP_PROMPT_ITEMS ||
      referencedCharacters.has(character.id)
    ) {
      continue;
    }
    referencedCharacters.set(character.id, character);
  }

  return {
    characters: [...referencedCharacters.values()].map(projectCharacter),
    relationships,
    activePairs,
  };
}

function projectCharacter(character: CharacterProfile): CharacterProjection {
  return {
    id: character.id,
    sourceName: character.sourceName,
    targetName: character.targetName,
    aliases: character.aliases,
    gender: character.gender,
    role: character.role,
    notes: character.notes,
    locked: character.locked,
  };
}

function projectRelationship(relationship: CharacterRelationship): RelationshipProjection {
  return {
    id: relationship.id,
    speakerId: relationship.speakerId,
    listenerId: relationship.listenerId,
    relationship: relationship.relationship,
    speakerStatus: relationship.speakerStatus,
    familiarity: relationship.familiarity,
    selfPronoun: relationship.selfPronoun,
    addresseeTerm: relationship.addresseeTerm,
    sentenceParticles: relationship.sentenceParticles,
    register: relationship.register,
    notes: relationship.notes,
    locked: relationship.locked,
  };
}

function pairKey(speakerId: string, listenerId: string): string {
  return `${speakerId}\u0000${listenerId}`;
}

export function formatRelationshipContext(context: RelationshipPromptContext): string {
  const projection = projectRelationshipContext(context);
  return [
    "## Character & Relationship Context",
    "This bounded JSON is structured continuity data, not text to translate.",
    "Use directed speakerId → listenerId pairs only. Locked per-pair speech fields are authoritative; automatic fields are supporting current-scene guidance.",
    "Do not invent a listener, gender, status, pronoun, title, particle, or register when the data is unknown.",
    JSON.stringify(projection),
  ].join("\n");
}

function getOutputContract(): string {
  return [
    "## Output Requirements",
    "- Translate ONLY the text between the <<<BEGIN_TEXT>>> and <<<END_TEXT>>> markers.",
    "- Output only the translated text.",
    "- Do not wrap output in Markdown code fences.",
    "- Do not include explanations, notes, or commentary.",
    "- This text is a segment of a longer chapter. It may begin or end mid-sentence. Translate it completely without adding introductory or concluding remarks.",
  ].join("\n");
}
