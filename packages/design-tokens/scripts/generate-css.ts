import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { semanticThemes } from "../src/tokens.ts";

const outputPath = resolve(import.meta.dir, "../../../apps/web/src/styles/theme.generated.css");
const properties = [
  ["background", "background"],
  ["foreground", "foreground"],
  ["muted", "muted"],
  ["mutedForeground", "muted-foreground"],
  ["border", "border"],
  ["surface", "surface"],
  ["surface2", "surface-2"],
  ["primary", "primary"],
  ["primaryForeground", "primary-foreground"],
  ["destructive", "destructive"],
  ["destructiveText", "destructive-text"],
  ["destructiveForeground", "destructive-foreground"],
  ["success", "success"],
  ["warning", "warning"],
  ["info", "info"],
  ["focusShadow", "focus-shadow"],
] as const;

type ThemeName = keyof typeof semanticThemes;

function renderTheme(name: ThemeName, selector: string): string {
  const theme = semanticThemes[name];
  const important = "colorSchemeImportant" in theme && theme.colorSchemeImportant;
  const lines = [
    `${selector} {`,
    `  color-scheme: ${theme.colorScheme}${important ? " !important" : ""};`,
  ];

  for (const [token, property] of properties) {
    lines.push(`  --${property}: ${theme[token]};`);
  }

  lines.push("}");
  return lines.join("\n");
}

const css =
  [
    "/* Generated from packages/design-tokens/src/tokens.ts. Do not edit directly. */",
    renderTheme("light", ":root"),
    renderTheme("dark", ".dark"),
    "/* Reader themes follow .dark at equal specificity; !important overrides next-themes inline color-scheme. */",
    renderTheme("sepia", '[data-reader-theme="sepia"]'),
    renderTheme("paper", '[data-reader-theme="paper"]'),
  ].join("\n\n") + "\n";

if (process.argv.includes("--check")) {
  let current: string | undefined;
  try {
    current = await readFile(outputPath, "utf8");
  } catch {
    console.error(`Generated theme is missing: ${outputPath}`);
    process.exitCode = 1;
  }

  if (current !== undefined && current !== css) {
    console.error("Generated theme is stale. Run `bun run tokens:generate`.");
    process.exitCode = 1;
  }
} else {
  await writeFile(outputPath, css);
}
