/**
 * YouTube Ingest Tool — full transcript + structured summary for any YT video.
 *
 * Skill spec: data/skills/research/youtube-ingest/SKILL.md
 *
 * Pipeline:
 *   1. Caption probe (yt-dlp subtitles / auto captions)
 *   2. Audio ASR fallback (yt-dlp mp3 → OpenAI Whisper API)
 *   3. LLM summarize (caller's default provider)
 *
 * Env:
 *   OPENAI_API_KEY — required for ASR fallback when no captions
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const execFileP = promisify(execFile);

const VIDEO_ID_RE = /(?:v=|youtu\.be\/|\/embed\/|\/shorts\/)([a-zA-Z0-9_-]{11})/;
const DEFAULT_LANGS = 'zh-TW,zh-Hant,zh,zh-Hans,en,ja';
const WHISPER_SIZE_LIMIT = 25 * 1024 * 1024;

export function extractVideoId(url) {
  if (!url || typeof url !== 'string') return null;
  const m = url.match(VIDEO_ID_RE);
  return m ? m[1] : null;
}

async function runYtDlp(args, { cwd } = {}) {
  const { stdout, stderr } = await execFileP('yt-dlp', args, { cwd, maxBuffer: 32 * 1024 * 1024 });
  return { stdout, stderr };
}

async function fetchMetadata(url) {
  const { stdout } = await execFileP('yt-dlp', ['--skip-download', '--dump-json', url], { maxBuffer: 64 * 1024 * 1024 });
  const meta = JSON.parse(stdout);
  return {
    video_id: meta.id,
    title: meta.title,
    channel: meta.channel || meta.uploader,
    duration_sec: meta.duration,
    upload_date: meta.upload_date,
    view_count: meta.view_count,
    description: meta.description,
  };
}

async function probeCaptions(url, workdir, langs) {
  try {
    await runYtDlp(
      [
        '--skip-download',
        '--write-auto-sub',
        '--write-sub',
        '--sub-lang', langs,
        '--sub-format', 'vtt',
        '--output', '%(id)s.%(ext)s',
        url,
      ],
      { cwd: workdir },
    );
    const files = await fs.readdir(workdir);
    const vtt = files.find((f) => f.endsWith('.vtt'));
    if (!vtt) return { source: 'none', text: '' };
    const raw = await fs.readFile(path.join(workdir, vtt), 'utf8');
    const text = raw
      .split('\n')
      .filter((l) => l && !l.startsWith('WEBVTT') && !l.startsWith('NOTE') && !/^\d+$/.test(l) && !/-->/.test(l) && !/^(Kind|Language):/i.test(l))
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (!text) return { source: 'none', text: '' };
    return { source: vtt.includes('.auto.') ? 'auto' : 'official', text };
  } catch {
    return { source: 'none', text: '' };
  }
}

async function extractAudio(url, workdir) {
  await runYtDlp(
    ['-x', '--audio-format', 'mp3', '--audio-quality', '5', '-o', 'audio.%(ext)s', url],
    { cwd: workdir },
  );
  const audioPath = path.join(workdir, 'audio.mp3');
  const stat = await fs.stat(audioPath);
  return { path: audioPath, size: stat.size };
}

const CHUNK_SECONDS = 600;

async function splitAudioByDuration(audioPath, workdir, segmentSec = CHUNK_SECONDS) {
  const pattern = path.join(workdir, 'chunk-%03d.mp3');
  await execFileP(
    'ffmpeg',
    ['-hide_banner', '-loglevel', 'error', '-y', '-i', audioPath, '-f', 'segment', '-segment_time', String(segmentSec), '-c', 'copy', pattern],
    { maxBuffer: 32 * 1024 * 1024 },
  );
  const files = (await fs.readdir(workdir)).filter((f) => /^chunk-\d{3}\.mp3$/.test(f)).sort();
  return files.map((f) => path.join(workdir, f));
}

async function transcribeWithWhisper(audioPath, { language, apiKey, maxBytes = WHISPER_SIZE_LIMIT } = {}) {
  const token = apiKey || process.env.OPENAI_API_KEY;
  if (!token) throw new Error('OPENAI_API_KEY not set; required for ASR fallback when captions are unavailable');

  const stat = await fs.stat(audioPath);
  if (stat.size <= maxBytes) {
    return await whisperOneShot(audioPath, { language, token });
  }

  const workdir = path.dirname(audioPath);
  const chunks = await splitAudioByDuration(audioPath, workdir, CHUNK_SECONDS);
  if (!chunks.length) throw new Error(`ffmpeg produced no chunks for audio ${audioPath}`);
  const parts = [];
  for (const chunkPath of chunks) {
    const chunkStat = await fs.stat(chunkPath);
    if (chunkStat.size > maxBytes) {
      throw new Error(`chunk ${path.basename(chunkPath)} is ${chunkStat.size} bytes, still over ${maxBytes}; try shorter segment time`);
    }
    const text = await whisperOneShot(chunkPath, { language, token });
    parts.push(text.trim());
  }
  return parts.join('\n\n');
}

async function whisperOneShot(audioPath, { language, token }) {
  const args = [
    '-sS', '--max-time', '900',
    '-X', 'POST', 'https://api.openai.com/v1/audio/transcriptions',
    '-H', `Authorization: Bearer ${token}`,
    '-F', `file=@${audioPath}`,
    '-F', 'model=whisper-1',
    '-F', 'response_format=text',
  ];
  if (language) args.push('-F', `language=${language}`);
  args.push('-w', '\n__HTTP__%{http_code}\n');

  const { stdout } = await execFileP('curl', args, { maxBuffer: 64 * 1024 * 1024 });
  const marker = stdout.lastIndexOf('\n__HTTP__');
  const body = marker >= 0 ? stdout.slice(0, marker) : stdout;
  const code = marker >= 0 ? stdout.slice(marker + '\n__HTTP__'.length).trim() : '200';
  if (code !== '200') {
    throw new Error(`whisper_api_${code}: ${body.slice(0, 200)}`);
  }
  return body;
}

/**
 * Main entry — fetch transcript (probe → ASR fallback) for a YT URL.
 * Returns raw transcript + provenance. Summarization is caller's job (pass to agent LLM).
 */
export async function ingestYouTube(url, opts = {}) {
  const langs = opts.captionLangs || DEFAULT_LANGS;
  const languageHint = opts.language || 'auto';
  const videoId = extractVideoId(url);
  if (!videoId) throw new Error(`could not parse YouTube video id from url: ${url}`);

  const workdir = await fs.mkdtemp(path.join(os.tmpdir(), `helix-yt-${videoId}-`));
  const started = Date.now();
  try {
    const meta = await fetchMetadata(url);

    const caption = await probeCaptions(url, workdir, langs);
    if (caption.source !== 'none' && caption.text.length > 100) {
      return {
        ok: true,
        video_id: videoId,
        title: meta.title,
        channel: meta.channel,
        duration_sec: meta.duration_sec,
        caption_source: caption.source,
        transcript: caption.text,
        transcript_chars: caption.text.length,
        provenance: {
          caption_source: caption.source,
          asr_engine: null,
          language: null,
        },
        confidence: caption.source === 'official' ? 'high' : 'medium',
        duration_ms: Date.now() - started,
      };
    }

    const audio = await extractAudio(url, workdir);
    const chunked = audio.size > WHISPER_SIZE_LIMIT;
    const asrLang = languageHint === 'auto' ? undefined : languageHint;
    const transcript = await transcribeWithWhisper(audio.path, {
      language: asrLang,
      apiKey: opts.openaiApiKey,
    });
    return {
      ok: true,
      video_id: videoId,
      title: meta.title,
      channel: meta.channel,
      duration_sec: meta.duration_sec,
      caption_source: 'asr',
      transcript,
      transcript_chars: transcript.length,
      provenance: {
        caption_source: 'asr',
        audio_source: 'yt-dlp mp3',
        asr_engine: 'openai/whisper-1',
        language: asrLang || 'auto',
        audio_bytes: audio.size,
        chunked,
        chunk_seconds: chunked ? CHUNK_SECONDS : null,
      },
      confidence: chunked ? 'low' : 'medium',
      duration_ms: Date.now() - started,
    };
  } finally {
    try { await fs.rm(workdir, { recursive: true, force: true }); } catch {}
  }
}

export async function registerYouTubeIngestTool(registry) {
  if (!registry || typeof registry.register !== 'function') {
    throw new Error('registry with register() required');
  }
  registry.register({
    name: 'youtube.ingest',
    description: 'Extract full transcript from a YouTube video. Uses yt-dlp captions when available, falls back to OpenAI Whisper ASR when not. Returns {transcript, caption_source, provenance, confidence}. Caller summarizes with their own LLM.',
    level: 'L2',
    category: 'read',
    inputSchema: {
      required: ['url'],
      optional: ['language', 'captionLangs'],
    },
    handler: async (args) => await ingestYouTube(args.url, args),
    metadata: { skill: 'data/skills/research/youtube-ingest/SKILL.md' },
  });
  return { registered: ['youtube.ingest'] };
}

export default { ingestYouTube, extractVideoId, registerYouTubeIngestTool };
