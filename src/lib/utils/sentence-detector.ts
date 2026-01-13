/**
 * Sentence Detector for Progressive TTS
 *
 * Detects sentence boundaries in streaming text to enable
 * sentence-by-sentence TTS generation.
 */

export interface DetectedSentence {
  text: string;
  index: number;
}

/**
 * Strip markdown formatting from text for TTS
 * Removes: **bold**, *italic*, bullet points, headers, links, code blocks, etc.
 */
function stripMarkdown(text: string): string {
  return (
    text
      // Remove code blocks
      .replace(/```[\s\S]*?```/g, '')
      .replace(/`[^`]+`/g, '')
      // Remove headers
      .replace(/^#{1,6}\s+/gm, '')
      // Remove bold/italic (order matters: ** before *)
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/\*([^*]+)\*/g, '$1')
      .replace(/__([^_]+)__/g, '$1')
      .replace(/_([^_]+)_/g, '$1')
      // Remove strikethrough
      .replace(/~~([^~]+)~~/g, '$1')
      // Remove links but keep text
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
      // Remove images
      .replace(/!\[([^\]]*)\]\([^)]+\)/g, '')
      // Remove bullet points and list markers
      .replace(/^[\s]*[-*+]\s+/gm, '')
      .replace(/^[\s]*\d+\.\s+/gm, '')
      // Remove blockquotes
      .replace(/^>\s+/gm, '')
      // Remove horizontal rules
      .replace(/^[-*_]{3,}$/gm, '')
      // Clean up multiple spaces and newlines
      .replace(/\n{3,}/g, '\n\n')
      .replace(/  +/g, ' ')
      .trim()
  );
}

export class SentenceDetector {
  private buffer = '';
  private sentenceIndex = 0;

  // Sentence ending patterns - handles ., !, ? followed by space or end
  // Uses a more robust pattern that handles common abbreviations
  private static SENTENCE_END = /([.!?]+)(?:\s+|$)/g;
  private static MIN_SENTENCE_LENGTH = 10;

  // Common abbreviations that should not trigger sentence end
  private static ABBREVIATIONS = new Set([
    'mr.',
    'mrs.',
    'ms.',
    'dr.',
    'prof.',
    'sr.',
    'jr.',
    'vs.',
    'etc.',
    'e.g.',
    'i.e.',
    'inc.',
    'ltd.',
    'co.',
    'corp.',
    'st.',
    'ave.',
    'blvd.',
    'rd.',
    'no.',
    'vol.',
    'rev.',
    'ed.',
    'pp.',
    'est.',
    'approx.',
    'dept.',
    'govt.',
    'fig.',
    'jan.',
    'feb.',
    'mar.',
    'apr.',
    'jun.',
    'jul.',
    'aug.',
    'sep.',
    'sept.',
    'oct.',
    'nov.',
    'dec.',
  ]);

  /**
   * Add a text chunk and extract any complete sentences
   * @param chunk - The text chunk to process
   * @returns Array of complete sentences with their indices
   */
  addChunk(chunk: string): DetectedSentence[] {
    this.buffer += chunk;
    const sentences: DetectedSentence[] = [];

    let lastProcessedIndex = 0;
    let match;

    // Reset regex lastIndex for each call
    SentenceDetector.SENTENCE_END.lastIndex = 0;

    while ((match = SentenceDetector.SENTENCE_END.exec(this.buffer)) !== null) {
      const sentenceEnd = match.index + match[0].length;
      const potentialSentence = this.buffer.slice(lastProcessedIndex, sentenceEnd).trim();

      // Check if this is actually a sentence ending (not an abbreviation)
      if (this.isValidSentenceEnd(potentialSentence)) {
        if (potentialSentence.length >= SentenceDetector.MIN_SENTENCE_LENGTH) {
          // Strip markdown for clean TTS output
          const cleanText = stripMarkdown(potentialSentence);
          if (cleanText.length > 0) {
            sentences.push({
              text: cleanText,
              index: this.sentenceIndex++,
            });
          }
          lastProcessedIndex = sentenceEnd;
        }
      }
    }

    // Keep unprocessed text in buffer
    this.buffer = this.buffer.slice(lastProcessedIndex);

    return sentences;
  }

  /**
   * Check if the sentence ending is valid (not an abbreviation)
   */
  private isValidSentenceEnd(text: string): boolean {
    const lowerText = text.toLowerCase();

    // Check if the text ends with a known abbreviation
    for (const abbrev of SentenceDetector.ABBREVIATIONS) {
      if (lowerText.endsWith(abbrev)) {
        return false;
      }
    }

    // Check for decimal numbers (e.g., "3.14")
    if (/\d+\.\d*$/.test(text)) {
      return false;
    }

    return true;
  }

  /**
   * Flush any remaining text in the buffer as a final sentence
   * Call this when the stream is complete
   */
  flush(): DetectedSentence | null {
    const remaining = this.buffer.trim();
    this.buffer = '';

    if (remaining.length > 0) {
      // Strip markdown for clean TTS output
      const cleanText = stripMarkdown(remaining);
      if (cleanText.length > 0) {
        return {
          text: cleanText,
          index: this.sentenceIndex++,
        };
      }
    }
    return null;
  }

  /**
   * Reset the detector to initial state
   */
  reset(): void {
    this.buffer = '';
    this.sentenceIndex = 0;
  }

  /**
   * Get the current buffer contents (for debugging)
   */
  getBuffer(): string {
    return this.buffer;
  }

  /**
   * Get the current sentence index
   */
  getCurrentIndex(): number {
    return this.sentenceIndex;
  }
}
