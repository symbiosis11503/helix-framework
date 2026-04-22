---
name: youtube-ingest
description: Extract full transcript and structured summary from any YouTube video (caption-probe then Whisper ASR fallback)
version: 1.0.0
author: helix
tags: [video, transcript, asr, research, youtube]
parameters:
  - name: url
    type: string
    required: true
    description: YouTube video URL (full or short form — youtu.be/... accepted)
  - name: summary_style
    type: string
    required: false
    description: "bullet | structured | strategy (default: structured)"
  - name: language
    type: string
    required: false
    description: "Whisper language hint (default: auto; common: zh, en, ja)"
capabilities: [transcript, summary, ingest]
---

# YouTube Ingest

Turn a YouTube URL into a full transcript + structured summary, then optionally store it in agent memory for recall.

## Why this skill exists

YouTube videos are a common research source but frequently ship with no captions and no transcript. Naïve flows stop when captions are disabled. This skill runs a **3-stage fallback** so the agent never says "sorry, no transcript":

1. **Caption probe** — try `yt-dlp` for official/auto captions (cheapest, most accurate)
2. **Audio ASR** — if no captions, extract audio and transcribe via OpenAI Whisper API
3. **Structured summary** — pass the transcript through an LLM for agent-usable output

Tested end-to-end on a 57-minute Chinese briefing video: 41,808-char transcript in ~3 seconds, Gemini-summarized in ~30 seconds. Total cost ~$0.35 / hour of video.

## Steps

### 1. Detect captions
```bash
yt-dlp --skip-download --write-auto-sub --write-sub \
  --sub-lang "$LANGS" --sub-format vtt \
  --output "%(id)s.%(ext)s" "$URL"
```
- If VTT file appears → Stage 2 (skip ASR)
- If no VTT → Stage 3 (ASR fallback)

### 2. Audio ASR (no-caption fallback)
```bash
# Extract audio — mp3 VBR q5 gives ~23 MB per 60 min (under Whisper's 25 MB limit)
yt-dlp -x --audio-format mp3 --audio-quality 5 -o audio.mp3 "$URL"

# Transcribe
curl -sS https://api.openai.com/v1/audio/transcriptions \
  -H "Authorization: Bearer $OPENAI_API_KEY" \
  -F file=@audio.mp3 \
  -F model=whisper-1 \
  -F language="$LANG_HINT" \
  -F response_format=text > transcript.txt
```

If audio > 25 MB, split with `ffmpeg -f segment -segment_time 600` and merge after.

### 3. Summarize
Feed `transcript.txt` to the agent's configured LLM with a prompt matching `summary_style`:
- **bullet** — 10–15 flat bullet points, no headers
- **structured** — Metadata / Key Facts / Structured Summary / Action Items
- **strategy** — add a final section tailored to the caller's context (e.g. "how does this apply to our business?")

### 4. Store (optional)
If `memory_store: true` in the call context, write:
- `research_assets/transcripts/<video_id>.txt` — raw transcript
- `research_assets/summaries/<video_id>.md` — structured summary
- Agent memory: `{ type: 'semantic', topic: 'yt:<id>', content: <summary>, source_url: <url> }`

## Output contract

```json
{
  "video_id": "5Q_4S9C9ZPM",
  "title": "...",
  "duration_sec": 3417,
  "caption_source": "official" | "auto" | "asr" | "none",
  "transcript": "... full text ...",
  "transcript_chars": 41808,
  "summary": "... structured markdown ...",
  "provenance": {
    "audio_source": "yt-dlp mp3",
    "asr_engine": "openai/whisper-1",
    "language": "zh",
    "llm_summarizer": "gemini-2.5-pro"
  },
  "confidence": "high" | "medium" | "low"
}
```

`confidence`:
- `high` — official captions
- `medium` — auto captions or clean ASR
- `low` — ASR on noisy audio, missing chunks, size-split merge

## Constraints

- **Never** claim summary content that isn't backed by transcript — cite line ranges if asked
- **Never** invent timestamps when ASR didn't produce them
- Skip copyrighted reproduction (don't paste >15 words verbatim from transcript in the final summary)
- If video is private / region-locked / members-only → return `{ "error": "video_inaccessible", "caption_source": "none" }`, don't fabricate

## Dependencies

- `yt-dlp` ≥ 2026.03 (caption probe + audio extract)
- `ffmpeg` (audio chunk split for >25 MB files)
- `OPENAI_API_KEY` env var (Whisper API)
- Agent's default LLM provider (summarization)

## Example invocations

```
agent: 幫我讀這個影片 https://youtu.be/5Q_4S9C9ZPM
→ skill runs, returns structured summary, stores transcript
agent can now answer follow-ups using that transcript from memory.

agent: 這影片的重點 3 個是什麼？
→ memory recall on yt:5Q_4S9C9ZPM, no re-ingest needed.
```
