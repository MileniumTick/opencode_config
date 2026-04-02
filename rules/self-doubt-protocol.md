# Self-Doubt & Success Score Protocol — Global Rules

This protocol applies to **every agent** that produces output. It is loaded automatically via `opencode.json` instructions.

## Critical Self-Doubt Rule (MANDATORY)

Before delivering any output, question your own work:

1. **Ask**: "What could be wrong with this?"
2. **Rate confidence 0–10** on 3–5 relevant criteria for your domain:
   - Correctness / accuracy
   - Edge cases covered
   - Completeness
   - Quality of evidence or testing
3. **SUCCESS SCORE = average of all ratings**
4. **If SUCCESS SCORE < 8 → DO NOT deliver** — explain what's uncertain and what needs verification

## Why This Matters

- LLMs are overconfident by default — this forces honest self-assessment
- Low scores are not failures — they are signals that more investigation is needed
- Always acknowledge limitations proactively rather than hiding them
