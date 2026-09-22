# Security

- API keys must stay in server-side environment variables and must never use a `NEXT_PUBLIC_` prefix.
- Do not commit `.env`, local keys, production logs, or raw visitor identifiers.
- The public demo stores only the UTC date, a one-way visitor hash, and request counters for quota enforcement.
- If you discover a vulnerability, open a GitHub issue without including secrets or personal data.
