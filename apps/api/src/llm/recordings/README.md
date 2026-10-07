# Recorded LLM responses

Replay fixtures for `contract.test.ts`. Created by running an eval with a real key:

```bash
LLM_API_KEY=sk-ant-... LLM_RECORD_DIR=apps/api/src/llm/recordings npm run eval:intent -w @fpc/api
LLM_API_KEY=sk-ant-... LLM_RECORD_DIR=apps/api/src/llm/recordings npm run eval:explain -w @fpc/api
```

Each file is one real request/response pair (no headers, so no API key). The
contract test replays every response through the real SDK, our schema
validation and the fact guard, so a change in the provider's response shape —
or in our parsing — fails CI without spending tokens.
