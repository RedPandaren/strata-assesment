# AI Enquiry Processing Prototype

This repository now contains a working Part 1 prototype for the AI Developer assessment.

The app is designed as an internal staff assistant for reviewing inbound client enquiries. A staff user pastes an enquiry into the web UI, and the system:

- classifies the enquiry into a fixed business category
- surfaces a secondary signal for mixed-intent cases
- assigns a simple risk level for staff prioritization
- returns a confidence score
- produces a one-sentence summary
- recommends the next action for staff
- drafts a suggested professional response
- flags uncertain cases for manual review
- supports batch analysis for multiple enquiries in one request

## Stack

- Node.js
- Express
- Vanilla HTML, CSS, and JavaScript
- Gemini API by default, with optional OpenAI support via environment variables
- Zod for validation
- Node test runner for backend coverage

## Why this approach

- A lightweight browser UI is easier to review than a CLI tool.
- The AI call happens server-side so API keys are not exposed in browser code.
- Categories are fixed to keep classification stable and business-friendly.
- Low-confidence and unclear messages are flagged for human review instead of forcing unsafe automation.

## Project structure

```text
src/
  server.js
  ai.js
  validator.js
  prompts.js
public/
  index.html
  styles.css
  app.js
.env.example
package.json
README.md
```

## Setup

1. Install dependencies:

```bash
npm install
```

2. Copy the example environment file:

```bash
copy .env.example .env
```

3. Add your API key to `.env`.

Gemini example:

```env
LLM_PROVIDER=gemini
MODEL_NAME=gemini-2.5-flash
GEMINI_API_KEY=your_gemini_api_key_here
LLM_TIMEOUT_MS=20000
REVIEW_CONFIDENCE_THRESHOLD=0.8
BATCH_LIMIT=10
```

OpenAI example:

```env
LLM_PROVIDER=openai
MODEL_NAME=gpt-4.1-mini
OPENAI_API_KEY=your_openai_api_key_here
REVIEW_CONFIDENCE_THRESHOLD=0.8
BATCH_LIMIT=10
```

4. Start the app:

```bash
npm start
```

5. Open `http://localhost:3000`

6. Run backend tests:

```bash
npm test
```

## How it works

1. Staff pastes a client enquiry into the form.
2. The browser sends the message to `POST /api/analyze`.
3. The server validates the input.
4. The selected LLM provider returns structured JSON.
5. The server validates the model output and normalizes the result.
6. The API attaches request metadata such as request ID, provider, model, threshold, and response time.
7. The UI renders the category, secondary signal, risk level, confidence, summary, action, and draft response.

## API contract

Request:

```json
{
  "message": "The tenant says the ceiling is leaking again and the damage is getting worse. Please treat this urgently."
}
```

Response shape:

```json
{
  "ok": true,
  "data": {
    "category": "urgent issue",
    "secondary_signal": "none",
    "risk_level": "high",
    "confidence": 0.94,
    "summary": "Client reports urgent water damage requiring immediate attention.",
    "recommended_action": "Escalate to the maintenance or property response team immediately.",
    "suggested_response": "Thank you for reporting this. We have flagged it as urgent and will arrange immediate review.",
    "needs_review": false
  },
  "meta": {
    "requestId": "a7e4f4d9-7bb4-4b8e-a0d7-b8f6171ec2be",
    "provider": "gemini",
    "model": "gemini-2.0-flash",
    "resultSource": "live",
    "responseTimeMs": 812,
    "reviewConfidenceThreshold": 0.8,
    "batchLimit": 10
  }
}
```

Batch request:

```json
{
  "messages": [
    "Why was our invoice higher this month?",
    "I emailed last week and still have not received a response."
  ]
}
```

Batch endpoint:

- `POST /api/analyze/batch`
- validates each enquiry before processing
- returns one result object per input message
- preserves safe fallback behavior per item if a provider call fails

If Gemini returns a model-not-found error, the server will automatically try a small fallback list of Flash models before returning a safe fallback result.

## Prompt design notes

The prompt enforces:

- one category from a fixed set
- one short example per category to reduce boundary ambiguity
- strict JSON output
- no invented facts
- one-sentence summary
- concise action and response text
- a secondary signal for mixed-intent cases
- a risk level for prioritization
- dominant-category handling for mixed-intent messages
- `needs_review: true` for unclear or low-confidence cases
- configurable review threshold via `REVIEW_CONFIDENCE_THRESHOLD`

## Error handling

- Empty or too-short input is rejected before calling the model.
- Very weak inputs such as repeated placeholders or low-context messages are rejected early.
- If the provider returns invalid JSON or the API call fails, the app falls back to:
  - category: `unclear/needs review`
  - confidence: `0`
  - manual review recommendation
- This keeps the workflow usable even when the AI output is unreliable.
- Gemini requests also use a timeout and model fallback chain.
- Every API response includes a request ID to make backend debugging easier.
- Server logs are emitted as structured JSON for backend traceability.

## Review heuristics

The app does not rely only on the model's confidence score. It also flags review when:

- the category is `unclear/needs review`
- confidence is below `0.8`
- the message is very short and likely lacks context
- the message mixes billing and complaint signals
- the message contains urgent operational language but the model does not classify it as urgent

This makes the prototype feel safer and more realistic than a pure one-shot model output.

## Design decisions

- `Server-side provider calls`: keeps API keys out of the browser and makes fallback handling easier.
- `Fixed categories`: makes the result easier to trust and easier to route into future workflows.
- `Human review path`: avoids pretending the system is fully autonomous.
- `Heuristic confidence handling`: confidence is treated as a triage signal, not as a calibrated probability.
- `Configurable review threshold`: makes review behavior adjustable without code changes.
- `Batch endpoint`: shows how the same backend can process higher-volume workflows.
- `Structured result card`: separates category, confidence, action, and draft response so staff can scan the result quickly.
- `Risk level + secondary signal`: gives staff a better triage view than category alone.
- `Timeout and model fallback`: reduces fragility when one Gemini Flash model is unavailable.

## Backend extras

- `Request IDs`: each API response includes `meta.requestId`, and the same ID is returned in the `x-request-id` response header.
- `Structured logs`: the server logs request completion and server startup as JSON events.
- `Batch analysis`: `POST /api/analyze/batch` handles multiple enquiries in one call.
- `Automated tests`: validation, fallback behavior, and both analysis endpoints are covered by `node --test`.

## Sample inputs

- `Hi, we are looking for help managing a strata property in Brisbane. Can someone contact us with pricing?`
- `The tenant says the ceiling is leaking again and water damage is spreading. Please treat this urgently.`
- `Why was our invoice higher this month?`
- `I emailed last week and still have not received a response. This is very disappointing.`
- `Can you help with the thing from before? It is still not sorted and we need an answer soon.`

## Known limitations

- The confidence score is model-generated and heuristic, not statistically calibrated.
- The app does not persist submissions or audit manual overrides.
- Risk level is rule-assisted and designed for triage, not formal SLA enforcement.

