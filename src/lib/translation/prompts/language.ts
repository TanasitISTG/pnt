export type LanguagePair = "en->th" | "zh->en" | "zh->th";

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
