export interface ChunkInfo {
  index: number;
  text: string;
}

export interface AlignedParagraph {
  raw?: string;
  translated?: string;
}

export interface HanziSpan {
  start: number;
  end: number; // exclusive
  text: string;
}
