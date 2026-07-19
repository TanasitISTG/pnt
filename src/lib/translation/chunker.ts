export interface ChunkInfo {
  index: number;
  text: string;
  startOffset: number;
  endOffset: number;
}

export function chunkText(text: string, targetSize = 2000): ChunkInfo[] {
  if (!text || text.trim().length === 0) {
    return [];
  }

  const chunks: ChunkInfo[] = [];

  // Primary split on double newlines (paragraphs)
  const paragraphBlocks = splitIntoBlocks(text);

  let currentChunkText = "";
  let currentChunkStart = 0;

  function flushChunk() {
    if (currentChunkText.length > 0) {
      chunks.push({
        index: chunks.length,
        text: currentChunkText,
        startOffset: currentChunkStart,
        endOffset: currentChunkStart + currentChunkText.length,
      });
      currentChunkText = "";
    }
  }

  for (const block of paragraphBlocks) {
    if (block.text.length === 0) continue;

    // If block fits into current chunk
    if (currentChunkText.length + block.text.length <= targetSize) {
      if (currentChunkText.length === 0) {
        currentChunkStart = block.startOffset;
      }
      currentChunkText += block.text;
    } else {
      // Current chunk has content and adding block exceeds targetSize
      if (currentChunkText.length > 0) {
        flushChunk();
      }

      // If single block exceeds targetSize, split by sentence boundaries
      if (block.text.length > targetSize) {
        const sentenceBlocks = splitBySentences(block.text, block.startOffset);
        for (const sentence of sentenceBlocks) {
          if (currentChunkText.length + sentence.text.length <= targetSize) {
            if (currentChunkText.length === 0) {
              currentChunkStart = sentence.startOffset;
            }
            currentChunkText += sentence.text;
          } else {
            if (currentChunkText.length > 0) {
              flushChunk();
            }

            // If single sentence exceeds targetSize, hard split
            if (sentence.text.length > targetSize) {
              let offset = 0;
              while (offset < sentence.text.length) {
                const subStr = sentence.text.slice(offset, offset + targetSize);
                chunks.push({
                  index: chunks.length,
                  text: subStr,
                  startOffset: sentence.startOffset + offset,
                  endOffset: sentence.startOffset + offset + subStr.length,
                });
                offset += targetSize;
              }
              currentChunkText = "";
            } else {
              currentChunkStart = sentence.startOffset;
              currentChunkText = sentence.text;
            }
          }
        }
      } else {
        currentChunkStart = block.startOffset;
        currentChunkText = block.text;
      }
    }
  }

  flushChunk();

  return chunks;
}

interface TextBlock {
  text: string;
  startOffset: number;
}

function splitIntoBlocks(text: string): TextBlock[] {
  const blocks: TextBlock[] = [];
  let lastIndex = 0;

  const regex = /(\r?\n\s*\r?\n)/g;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    const end = match.index + match[0].length;
    const blockText = text.slice(lastIndex, end);
    if (blockText.length > 0) {
      blocks.push({
        text: blockText,
        startOffset: lastIndex,
      });
    }
    lastIndex = end;
  }

  if (lastIndex < text.length) {
    blocks.push({
      text: text.slice(lastIndex),
      startOffset: lastIndex,
    });
  }

  return blocks;
}

function splitBySentences(text: string, baseOffset: number): TextBlock[] {
  const blocks: TextBlock[] = [];
  let lastIndex = 0;

  const regex = /([^.!?。！？\n]+[.!?。！？\n]+(?:\s+|$))/g;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    const end = match.index + match[0].length;
    const blockText = text.slice(lastIndex, end);
    if (blockText.length > 0) {
      blocks.push({
        text: blockText,
        startOffset: baseOffset + lastIndex,
      });
    }
    lastIndex = end;
  }

  if (lastIndex < text.length) {
    blocks.push({
      text: text.slice(lastIndex),
      startOffset: baseOffset + lastIndex,
    });
  }

  return blocks;
}
