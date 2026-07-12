/**
 * Upload hardening — never trust a file's name or type. Before importing any
 * audio we verify it is REALLY audio by sniffing its magic bytes, cap its size,
 * and sanitize any text/URLs derived from it. A file renamed to `.mp3` that is
 * actually HTML/JS/an executable is rejected, so it can never reach the app as
 * anything but inert audio bytes (and React already escapes all text, so tags
 * can't inject markup either).
 */
const MAX_BYTES = 120 * 1024 * 1024; // 120 MB
const AUDIO_EXT = /\.(mp3|m4a|aac|flac|wav|ogg|oga|opus|weba)$/i;
const AUDIO_MIME = /^(audio\/|application\/ogg$)/i;

const ascii = (bytes: Uint8Array, start: number, str: string): boolean =>
  [...str].every((ch, i) => bytes[start + i] === ch.charCodeAt(0));

/** True when the leading bytes match a known audio container/codec. */
export function sniffAudio(b: Uint8Array): boolean {
  if (b.length < 4) return false;
  if (ascii(b, 0, 'ID3')) return true; // MP3 with ID3v2 tag
  if (b[0] === 0xff && (b[1]! & 0xe0) === 0xe0) return true; // MP3 frame sync / ADTS AAC
  if (ascii(b, 0, 'fLaC')) return true; // FLAC
  if (ascii(b, 0, 'OggS')) return true; // OGG / Opus / Vorbis
  if (ascii(b, 0, 'RIFF') && ascii(b, 8, 'WAVE')) return true; // WAV
  if (ascii(b, 4, 'ftyp')) return true; // MP4 / M4A / AAC container
  if (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return true; // Matroska/WebM
  return false;
}

export interface ValidationResult {
  ok: boolean;
  reason?: string;
}

/** Validate a picked/dropped file is genuine audio and within limits. */
export async function validateAudioFile(file: File): Promise<ValidationResult> {
  if (file.size === 0) return { ok: false, reason: 'Arquivo vazio.' };
  if (file.size > MAX_BYTES) return { ok: false, reason: 'Arquivo muito grande (máx. 120 MB).' };
  const extOk = AUDIO_EXT.test(file.name);
  const mimeOk = !file.type || AUDIO_MIME.test(file.type);
  if (!extOk && !mimeOk) return { ok: false, reason: 'Tipo de arquivo não suportado.' };
  try {
    const head = new Uint8Array(await file.slice(0, 16).arrayBuffer());
    if (!sniffAudio(head)) return { ok: false, reason: 'O arquivo não é um áudio válido.' };
  } catch {
    return { ok: false, reason: 'Não foi possível ler o arquivo.' };
  }
  return { ok: true };
}

/** Strip control chars / angle brackets and cap length (defense-in-depth). */
export function sanitizeText(input: string, max = 200): string {
  let out = '';
  for (const ch of input) {
    const code = ch.codePointAt(0) ?? 0;
    out += code < 0x20 || code === 0x7f || ch === '<' || ch === '>' ? ' ' : ch;
  }
  return out
    .replace(/\s{2,}/g, ' ')
    .trim()
    .slice(0, max);
}

/** Only allow http(s) or inline image data URLs as a cover — nothing else. */
export function safeCoverUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  return /^(https?:\/\/|data:image\/(png|jpe?g|webp|gif);)/i.test(url) ? url : null;
}
