/**
 * Batch output language ("en" | "vi") → TTS voice. Client-safe.
 * The seller's `outputLanguage` drives script, voice and subtitles for the whole batch; when the
 * requested voice speaks another language (e.g. the legacy zh-CN default) it is replaced.
 */
import type { OutputLanguage } from "@/lib/script-engine/prompts";

export const OUTPUT_LANGUAGE_VOICES: Record<OutputLanguage, string> = {
  vi: "vi-VN-HoaiMyNeural",
  en: "en-US-AriaNeural",
};

export function voiceForOutputLanguage(lang: OutputLanguage, requested?: string | null): string {
  if (requested && requested.toLowerCase().startsWith(`${lang}-`)) return requested;
  return OUTPUT_LANGUAGE_VOICES[lang];
}
