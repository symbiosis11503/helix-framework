---
name: web-search
description: Search the web and return structured results
version: 1.0.0
author: helix
tags: [web, search, research]
---

# Web Search

Search the web for information relevant to a query. Return structured results with title, URL, and summary.

## Steps
1. Accept search query from user
2. Use available web tools (MCP, curl, etc.) to search
3. Parse and rank results by relevance
4. Return top results in structured format

## Output Format
```json
[
  { "title": "...", "url": "https://...", "summary": "..." }
]
```

## Constraints
- Max 10 results
- Prefer recent sources
- Skip duplicates
