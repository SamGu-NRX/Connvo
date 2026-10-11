/**
 * Pure canary privacy-scan shared by the replay pipeline (run.ts --replay)
 * and the negative-control test (negative-control.test.ts).
 *
 * The scan is deliberately extracted so the negative control can exercise
 * EXACTLY the leak-detection code the committed artifacts depend on: the test
 * plants a private sentinel into a test-only explanation and a test-only file
 * text and asserts the scan flags them (scan is not vacuous), while the real
 * committed results stay clean and are never written to by the test.
 */

export interface CanarySentenceSource {
  pairId: string;
  sentence: string;
}

export interface CanaryFileSource {
  name: string;
  content: string;
}

export interface CanaryScanInput {
  sentences: CanarySentenceSource[];
  fileTexts: CanaryFileSource[];
  sentinels: string[];
}

/**
 * Return one entry per (location, sentinel) leak; empty when clean.
 * Location is "<pairId>" for sentences and "<name>" for file texts — the
 * same shape the committed stability.json has always recorded.
 */
export function scanCanaryLeaks(input: CanaryScanInput): string[] {
  const leaks: string[] = [];
  for (const { pairId, sentence } of input.sentences) {
    for (const sentinel of input.sentinels) {
      if (sentence.includes(sentinel)) {
        leaks.push(`${pairId}: ${sentinel}`);
      }
    }
  }
  for (const { name, content } of input.fileTexts) {
    for (const sentinel of input.sentinels) {
      if (content.includes(sentinel)) leaks.push(`${name}: ${sentinel}`);
    }
  }
  return leaks;
}
