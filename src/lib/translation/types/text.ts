export interface ChunkInfo {
  index: number;
  text: string;
}

export interface AlignedParagraph {
  raw?: string;
  translated?: string;
}

export interface ResidualScriptSpan {
  start: number;
  end: number; // exclusive
  text: string;
  letterCount: number;
}
