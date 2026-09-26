export interface ChunkInfo {
  index: number;
  text: string;
}

export interface ResidualScriptSpan {
  start: number;
  end: number; // exclusive
  text: string;
  letterCount: number;
}
