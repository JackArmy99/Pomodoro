import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { Cue } from "@/lib/research/video/youtube";

// ---------------------------------------------------------------------------
// Local speech-to-text for videos that come with no captions — the Tagetik
// Community webinars, first of all. Everything runs on this machine: ffmpeg
// pulls the audio out, Whisper (an open speech-recognition model, run through
// transformers.js / ONNX) turns it into timed text. Nothing is uploaded and
// nothing is billed. Claude cannot take audio, so this step has to be local or
// a third-party service; local keeps portal content on Jack's laptop.
//
// Both tools are OPTIONAL add-ons (installed by `npm run portal:setup`, like the
// portal browser), so they are loaded lazily with a plain-English error.
//
// Measured on Jack's laptop, a 24.7-minute webinar: whisper-base 5.4 min
// (4.6x real time) but mangled product names; whisper-small ~2.2x real time
// (~11 min) and clearly better — "CAPEX", "Capital Expenditure", no repeats.
// Small is the default; WHISPER_MODEL overrides it.
// ---------------------------------------------------------------------------

export const DEFAULT_WHISPER_MODEL = "onnx-community/whisper-small";
const SAMPLE_RATE = 16_000;

export class AsrUnavailable extends Error {}

function setupHint(what: string): string {
  return `${what} isn't installed. It's an optional add-on for transcribing videos that have no captions. Run:  npm run portal:setup`;
}

// Audio as 16 kHz mono 32-bit floats — exactly what Whisper reads.
export async function extractAudio(file: string): Promise<Float32Array> {
  let ffmpeg: string | null = null;
  try {
    // Dynamic: ffmpeg-static is an optional add-on, not a dependency.
    const mod: any = await import("ffmpeg-static" as string);
    ffmpeg = (mod.default ?? mod) as string;
  } catch {
    ffmpeg = null;
  }
  if (!ffmpeg) throw new AsrUnavailable(setupHint("The audio converter (ffmpeg)"));

  return new Promise((resolve, reject) => {
    const p = spawn(ffmpeg!, [
      "-v", "error", "-i", file,
      "-ac", "1", "-ar", String(SAMPLE_RATE), "-f", "f32le", "pipe:1",
    ]);
    const chunks: Buffer[] = [];
    let stderr = "";
    p.stdout.on("data", (c: Buffer) => chunks.push(c));
    p.stderr.on("data", (d: Buffer) => (stderr += d.toString()));
    p.on("error", reject);
    p.on("close", (code) => {
      if (code !== 0) return reject(new Error(`ffmpeg failed: ${stderr.slice(0, 300)}`));
      const buf = Buffer.concat(chunks);
      // Copy into an aligned buffer: Float32Array needs a 4-byte offset.
      const out = new Float32Array(buf.byteLength / 4);
      new Uint8Array(out.buffer).set(buf.subarray(0, out.byteLength));
      resolve(out);
    });
  });
}

// One loaded model per process: loading takes ~15 s, transcribing far longer,
// and the worker may handle several videos in a row.
let loaded: { model: string; asr: any } | null = null;

async function loadModel(model: string): Promise<any> {
  if (loaded?.model === model) return loaded.asr;
  let transformers: any;
  try {
    transformers = await import("@huggingface/transformers" as string);
  } catch {
    throw new AsrUnavailable(setupHint("The speech-to-text model runtime"));
  }
  // Keep the downloaded model OUT of node_modules: `npm install` would wipe it
  // and force a fresh multi-hundred-MB download after every update.
  const cacheDir = join(process.cwd(), "storage", "whisper-models");
  mkdirSync(cacheDir, { recursive: true });
  transformers.env.cacheDir = cacheDir;

  const asr = await transformers.pipeline("automatic-speech-recognition", model, {
    dtype: "q8",
  });
  loaded = { model, asr };
  return asr;
}

// Tagetik vocabulary Whisper reliably mishears. The transcript is the evidence
// shown on screen and searched later, so names that matter are corrected —
// conservatively, whole words only, and listed here so it's auditable.
//
// Variants are real, from the first webinar: "CCH2GETIC", "CCH Tegetic",
// "CCH Digetic", "CCH Degetic", "CCH-Tageta", "Antigetic" (= "and Tagetik").
const GLOSSARY: [RegExp, string][] = [
  // "CCH" + any rendering of Tagetik: optional 2/to, a T/D, a vowel, g/j-e-t,
  // then ic/ik/ics/iks/a.
  [/\bCCH[\s-]*(?:2|to\s?)?[TDtd]?[aeio]?[gj]et(?:ic|ik|ics|iks|ick|a)\b/gi, "CCH Tagetik"],
  [/\b(?:Tagetic|Tegetic|Tegetik|Tagetick|Tajetik|Tagetics|Digetic|Degetic)\b/gi, "Tagetik"],
  [/\bAntigetic\b/g, "and Tagetik"],
  [/\bWalter'?s\s+Clu(?:re|wer)\b/gi, "Wolters Kluwer"],
  [/\bWolters\s+Clu(?:re|wer)\b/gi, "Wolters Kluwer"],
  [/\bcat\s?fix\b/gi, "CapEx"],
  [/\bcap\s?ex\b/gi, "CapEx"],
];

export function applyGlossary(text: string): string {
  return GLOSSARY.reduce((t, [re, fix]) => t.replace(re, fix), text);
}

const normalise = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N} ]+/gu, "").trim();

// Whisper reads the audio in overlapping 30-second windows; at a seam it can
// emit the same sentence twice. Drop a segment that repeats the previous one,
// or that is wholly contained in it.
export function dropSeamRepeats(cues: Cue[]): Cue[] {
  const out: Cue[] = [];
  for (const c of cues) {
    const prev = out[out.length - 1];
    if (prev) {
      const a = normalise(prev.text);
      const b = normalise(c.text);
      if (b && (a === b || (b.length > 12 && a.endsWith(b)))) continue;
    }
    out.push(c);
  }
  return out.map((c, i) => ({ ...c, ordinal: i }));
}

// Whisper chunks → the same timed cues YouTube captions produce, so everything
// downstream (storage, citations, the summariser) works unchanged.
export function chunksToCues(chunks: { timestamp: [number, number | null]; text: string }[]): Cue[] {
  const cues: Cue[] = [];
  for (const ch of chunks) {
    const text = applyGlossary((ch.text ?? "").trim());
    if (!text) continue;
    const startMs = Math.round((ch.timestamp?.[0] ?? 0) * 1000);
    const endRaw = ch.timestamp?.[1];
    const endMs = Math.round((endRaw ?? (ch.timestamp?.[0] ?? 0) + 5) * 1000);
    cues.push({ ordinal: cues.length, startMs, endMs: Math.max(endMs, startMs), text });
  }
  return dropSeamRepeats(cues);
}

export type TranscribeResult = { cues: Cue[]; model: string; seconds: number; audioMinutes: number };

export async function transcribeFile(
  file: string,
  opts: { model?: string; language?: string } = {},
): Promise<TranscribeResult> {
  const model = opts.model || process.env.WHISPER_MODEL || DEFAULT_WHISPER_MODEL;
  const started = Date.now();
  const audio = await extractAudio(file);
  const asr = await loadModel(model);
  const out: any = await asr(audio, {
    chunk_length_s: 30,
    stride_length_s: 5,
    return_timestamps: true,
    // Whisper otherwise silently assumes English; say so explicitly, and let
    // a non-English library item pass its language through.
    language: opts.language || process.env.WHISPER_LANGUAGE || "english",
    task: "transcribe",
  });
  return {
    cues: chunksToCues(out?.chunks ?? []),
    model,
    seconds: (Date.now() - started) / 1000,
    audioMinutes: audio.length / SAMPLE_RATE / 60,
  };
}
