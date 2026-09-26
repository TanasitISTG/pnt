export const semanticThemes = {
  light: {
    colorScheme: "light",
    background: "#f7f4ed",
    foreground: "#1c1c1c",
    muted: "rgba(28, 28, 28, 0.04)",
    mutedForeground: "#5f5f5d",
    border: "#eceae4",
    surface: "#f7f4ed",
    surface2: "#fcfbf8",
    primary: "#1c1c1c",
    primaryForeground: "#fcfbf8",
    destructive: "#a8442f",
    destructiveText: "var(--destructive)",
    destructiveForeground: "#fcfbf8",
    success: "#53604b",
    warning: "#735735",
    info: "#505f65",
    focusShadow: "rgba(0, 0, 0, 0.1) 0px 4px 12px",
  },
  dark: {
    colorScheme: "dark",
    background: "#1c1c1c",
    foreground: "#f7f4ed",
    muted: "rgba(247, 244, 237, 0.06)",
    mutedForeground: "#a3a3a0",
    border: "rgba(247, 244, 237, 0.1)",
    surface: "#232320",
    surface2: "#2a2a27",
    primary: "#f7f4ed",
    primaryForeground: "#1c1c1c",
    destructive: "#a8442f",
    destructiveText: "#e6a18f",
    destructiveForeground: "#fcfbf8",
    success: "#bcc7b5",
    warning: "#d5b991",
    info: "#b8c5ca",
    focusShadow: "rgba(247, 244, 237, 0.15) 0px 4px 12px",
  },
  sepia: {
    colorScheme: "light",
    colorSchemeImportant: true,
    background: "#f4ecd8",
    foreground: "#5b4636",
    muted: "rgba(91, 70, 54, 0.06)",
    mutedForeground: "#856f57",
    border: "#e2d5b8",
    surface: "#f4ecd8",
    surface2: "#f9f2e2",
    primary: "#5b4636",
    primaryForeground: "#f9f2e2",
    destructive: "#8f4630",
    destructiveText: "var(--destructive)",
    destructiveForeground: "#f9f2e2",
    success: "#566047",
    warning: "#705333",
    info: "#525d61",
    focusShadow: "rgba(91, 70, 54, 0.12) 0px 4px 12px",
  },
  paper: {
    colorScheme: "light",
    colorSchemeImportant: true,
    background: "#f6f6f2",
    foreground: "#1f1f1c",
    muted: "rgba(31, 31, 28, 0.05)",
    mutedForeground: "#63635c",
    border: "#e6e6df",
    surface: "#f6f6f2",
    surface2: "#fcfcfa",
    primary: "#1f1f1c",
    primaryForeground: "#fcfcfa",
    destructive: "#9c4530",
    destructiveText: "var(--destructive)",
    destructiveForeground: "#fcfcfa",
    success: "#53604b",
    warning: "#735735",
    info: "#505f65",
    focusShadow: "rgba(0, 0, 0, 0.1) 0px 4px 12px",
  },
} as const;

type SemanticTheme = (typeof semanticThemes)[keyof typeof semanticThemes];

function toNativeTheme<T extends SemanticTheme>(theme: T) {
  // CSS box-shadow syntax is not a React Native shadow color or style.
  const { focusShadow: _focusShadow, ...colors } = theme;
  return {
    ...colors,
    destructiveText:
      theme.destructiveText === "var(--destructive)" ? theme.destructive : theme.destructiveText,
  };
}

export const nativeThemes = {
  light: toNativeTheme(semanticThemes.light),
  dark: toNativeTheme(semanticThemes.dark),
  sepia: toNativeTheme(semanticThemes.sepia),
  paper: toNativeTheme(semanticThemes.paper),
} as const;

export const nativeRadii = {
  micro: 4,
  standard: 6,
  comfortable: 8,
  card: 12,
  container: 16,
  fullPill: 9999,
} as const;

export const nativeSpacing = [8, 10, 12, 16, 24, 32, 40, 56, 80, 96, 128, 176, 192, 208] as const;
