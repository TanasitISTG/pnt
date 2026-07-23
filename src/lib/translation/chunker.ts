export interface ChunkInfo {
  index: number;
  text: string;
}

export function chunkText(text: string, targetSize = 2000): ChunkInfo[] {
  if (!text || text.trim().length === 0) {
    return [];
  }

  const chunks: ChunkInfo[] = [];

  // Primary split on double newlines (paragraphs)
  const paragraphBlocks = splitIntoBlocks(text);

  let currentChunkText = "";

  function flushChunk() {
    if (currentChunkText.length > 0) {
      chunks.push({
        index: chunks.length,
        text: currentChunkText,
      });
      currentChunkText = "";
    }
  }

  for (const block of paragraphBlocks) {
    if (block.length === 0) continue;

    // If block fits into current chunk
    if (currentChunkText.length + block.length <= targetSize) {
      currentChunkText += block;
    } else {
      // Current chunk has content and adding block exceeds targetSize
      if (currentChunkText.length > 0) {
        flushChunk();
      }

      // If single block exceeds targetSize, split by sentence boundaries
      if (block.length > targetSize) {
        const sentenceBlocks = splitBySentences(block);
        for (const sentence of sentenceBlocks) {
          if (currentChunkText.length + sentence.length <= targetSize) {
            currentChunkText += sentence;
          } else {
            if (currentChunkText.length > 0) {
              flushChunk();
            }

            // If single sentence exceeds targetSize, hard split
            if (sentence.length > targetSize) {
              let offset = 0;
              while (offset < sentence.length) {
                const subStr = sentence.slice(offset, offset + targetSize);
                chunks.push({
                  index: chunks.length,
                  text: subStr,
                });
                offset += targetSize;
              }
              currentChunkText = "";
            } else {
              currentChunkText = sentence;
            }
          }
        }
      } else {
        currentChunkText = block;
      }
    }
  }

  flushChunk();

  return chunks;
}

function splitIntoBlocks(text: string): string[] {
  const blocks: string[] = [];
  let lastIndex = 0;

  const regex = /(\r?\n\s*\r?\n)/g;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    const end = match.index + match[0].length;
    const blockText = text.slice(lastIndex, end);
    if (blockText.length > 0) {
      blocks.push(blockText);
    }
    lastIndex = end;
  }

  if (lastIndex < text.length) {
    blocks.push(text.slice(lastIndex));
  }

  return blocks;
}

function splitBySentences(text: string): string[] {
  const blocks: string[] = [];
  let lastIndex = 0;

  const regex = /([^.!?。！？\n]+[.!?。！？\n]+(?:\s+|$))/g;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    const end = match.index + match[0].length;
    const blockText = text.slice(lastIndex, end);
    if (blockText.length > 0) {
      blocks.push(blockText);
    }
    lastIndex = end;
  }

  if (lastIndex < text.length) {
    blocks.push(text.slice(lastIndex));
  }

  return blocks;
}
