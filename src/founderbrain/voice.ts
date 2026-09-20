/**
 * src/founderbrain/voice.ts
 *
 * WHAT THIS IS. Server-side speech-to-text for the mic button, used whenever a
 * browser cannot run Web Speech (Aside's Chromium has no speech backend and
 * fails `error:network`). Audio is recorded in the browser, sent here once,
 * forwarded to Groq whisper-large-v3, metered into the usage ledger, and
 * returned as text. The audio is never stored or used to train anything.
 */
import { DomainError } from "./domain.ts";
import type { Config } from "./config.ts";
import type { PgBrainStore } from "./store.ts";
import { ceilMicro, recordUsageEvent, voiceCostRateUsdPerMinute } from "./usage.ts";

const GROQ_TRANSCRIPTIONS_URL = "https://api.groq.com/openai/v1/audio/transcriptions";
/** Groq caps uploads at 25MB free / 100MB dev; keep generous headroom under both. */
const MAX_AUDIO_BYTES = 24 * 1024 * 1024;
const MAX_SECONDS = 300;

export type VoiceInput = { audio: Buffer; mime: string; seconds: number };

export async function transcribeVoice(
  config: Config,
  store: PgBrainStore,
  workspace: string,
  input: VoiceInput,
): Promise<{ text: string }> {
  if (!config.GROQ_API_KEY)
    throw new DomainError(503, "voice_not_configured", "Voice transcription is not configured yet.");
  if (!input.mime.startsWith("audio/"))
    throw new DomainError(422, "invalid_request", "Send an audio recording.");
  if (input.audio.length === 0 || input.audio.length > MAX_AUDIO_BYTES)
    throw new DomainError(413, "voice_too_long", "That recording is too large. Keep clips under 5 minutes.");
  // Client-reported duration, clamped: it only feeds metering, not the provider.
  const seconds = Math.min(Math.max(Math.ceil(input.seconds || 1), 1), MAX_SECONDS);

  const form = new FormData();
  form.append(
    "file",
    new Blob([new Uint8Array(input.audio)], { type: input.mime }),
    `voice.${input.mime === "audio/webm" ? "webm" : "ogg"}`,
  );
  form.append("model", "whisper-large-v3-turbo");
  form.append("temperature", "0");
  form.append("response_format", "json");

  const body = await (async () => {
    try {
      // eslint-disable-next-line no-restricted-globals -- ASR egress, not model inference: the OpenRouter rule guards inference, not speech-to-text.
      const response = await fetch(GROQ_TRANSCRIPTIONS_URL, {
        method: "POST",
        headers: { Authorization: `Bearer ${config.GROQ_API_KEY}` },
        body: form,
      });
      if (!response.ok)
        throw new DomainError(502, "voice_failed", "Transcription failed. Type instead or try again.");
      return (await response.json()) as { text?: string };
    } catch (error) {
      if (error instanceof DomainError) throw error;
      throw new DomainError(502, "voice_failed", "Transcription failed. Type instead or try again.");
    }
  })();
  const text = (body.text ?? "").trim();

  // Meter before returning: the provider charge exists regardless of what the
  // founder does with the text.
  await recordUsageEvent(store, workspace, config, {
    kind: "voice_transcribe",
    costMicroUsd: ceilMicro((seconds / 60) * voiceCostRateUsdPerMinute(config) * 1_000_000),
    meta: { seconds, provider: "groq", model: "whisper-large-v3-turbo" },
  });
  return { text };
}