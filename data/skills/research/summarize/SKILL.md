---
name: summarize
description: Summarize text into structured format
version: 1.0.0
author: helix
tags: [text, analysis, summary]
---

# Summarize

Analyze provided content and produce a clear, structured summary.

## Steps
1. Read the content carefully
2. Identify key points, decisions, and action items
3. Produce summary in requested format

## Output Formats

### Bullet (default)
- Key point 1
- Key point 2
- Action: ...

### Structured
```
## Goal
...
## Key Points
...
## Decisions
...
## Action Items
...
```

## Constraints
- Under 300 words
- Preserve important names, dates, numbers
- Flag contradictions if found
