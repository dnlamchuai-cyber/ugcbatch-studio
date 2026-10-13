import "server-only";
/** Server-only half of the AI_PROVIDER_MOCK fixtures (reads files from disk). */
import { readFileSync } from "fs";
import { join } from "path";

export const MOCK_FIXTURE_DIR = join(process.cwd(), "public", "mock");

let audioCache: Buffer | null = null;
/** Bundled 3 s mono mp3 used for every mocked voiceover. */
export function mockSpeechAudio(): Buffer {
  if (!audioCache) audioCache = readFileSync(join(MOCK_FIXTURE_DIR, "sample.mp3"));
  return audioCache;
}
