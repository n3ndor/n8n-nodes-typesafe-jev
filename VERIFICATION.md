# Day-one verification

Everything in this package is unit-tested, but **nothing has touched the live API**. The transport was written from the compiled `@typesafe-ai/sdk` bundle, so the endpoint paths, auth scheme, response envelope and error shape are all inferences. This file is the shortest path from "key arrives" to "known good".

Work through it in order. Steps 1–2 take about five minutes and de-risk everything else.

---

## 1. Check the API against our assumptions

```bash
TYPESAFE_API_KEY=sk-your-key node scripts/verify-api.mjs
```

Costs two `systemOne` calls. Prints a PASS/FAIL line per assumption and, for any failure, the exact file that breaks. Green means the node's wire contract is correct and you can trust the rest.

The assumptions it checks, in rough order of how much damage a mismatch would do:

| # | Assumption | If wrong, fix |
| --- | --- | --- |
| 1 | `Authorization: Bearer <key>` is the accepted scheme | `credentials/TypeSafeApi.credentials.ts` — `authenticate` |
| 2 | `POST /v1/systemone` takes `{ model, state, questions }` | `nodes/TypeSafeJev/transport.ts` — `systemOne` |
| 3 | Response is `{ model, answers, usage }` at the top level, not wrapped | `TypeSafeJev.node.ts` — payload assembly |
| 4 | `answers` is keyed by our question names | README examples |
| 5 | Answer shapes per type (`choice`/`noul`/`score`) | `types.ts`, `simplifyAnswer` |
| 6 | `usage` is snake_case (`input_tokens`) | README |
| 7 | `GET /v1/models` returns a bare array | `transport.ts` — `listModels` |
| 8 | Errors expose `error.message` or `message` | `transport.ts` — `toApiError` |
| 9 | `x-typesafe-request-id` is present on success **and** failure | `transport.ts`, Include Request ID option |
| 10 | A `noul` question is accepted with no `criteria` key | `questions.ts` — noul branch |

Assumptions 3, 5 and 8 are the ones most likely to be wrong, and all three are cheap to fix — they are type declarations and one mapping function, not architecture.

---

## 2. Run it inside n8n

```bash
pnpm install
pnpm run dev
```

This starts a local n8n with the node linked.

1. Create a **TypeSafe API** credential, paste the key, press **Test**. It should go green — that exercises `authenticate` and `test` together.
2. Import `examples/ticket-triage.workflow.json`.
3. Set the credential on both Jev nodes (they import with a `REPLACE_ME` placeholder).
4. Execute.

The workflow runs three sample tickets through **both** input modes at once:

- **Jev (Question Builder)** — per-type fields, full response appended under `typesafeJev`, request ID included.
- **Jev (JSON, Simplified)** — hand-typed JSON schema, answers only, simplified.

The second node is the regression test that matters: a hand-typed JSON schema is exactly what the previous version could never accept. If it returns answers rather than *"Questions must be a non-empty JSON object"*, that bug is confirmed dead against a real instance.

Expected shape from the simplified node:

```json
{ "intent": "refund", "urgent": 0.87, "frustration": 2 }
```

---

## 3. Spot-check the UI

These are the things unit tests cannot see:

- [ ] Question **Type** switches the visible fields — Options for choice, Rubric Levels for score, Describe Yes/No for yes-no. If all fields show at once, `displayOptions` has been stripped from `properties.ts` (see the warning in that file).
- [ ] **Model** dropdown populates from the account rather than erroring.
- [ ] Node icon renders in both light and dark themes.
- [ ] Node shows the model as its subtitle on the canvas.
- [ ] Attach the node to an **AI Agent** as a tool — it should appear, because `usableAsTool` is set.
- [ ] Break a question on purpose (one rubric level) — the error should say *"needs a criteria array with at least two rubric levels"* and **no HTTP call should be made**.
- [ ] Revoke or mistype the key — the error should name the status and carry a request ID.

---

## 4. Then, and only then

- [ ] Pin `n8n-workflow` to the major the lint plugin wants (`@n8n/eslint-plugin-community-nodes` asks for `>=2`; pnpm currently resolves `1.120.31` from the `latest` tag). Lint passes either way, but submission should not rely on that.
- [ ] Set up the npm Trusted Publisher — instructions are at the top of `.github/workflows/publish.yml`.
- [ ] `pnpm run release` to cut `0.2.0`. Publishing happens in CI with provenance; never from this machine.
- [ ] Submit for verification once it has run against a real key for a while.

---

## Known gap

**Dynamic routing outputs** — sending a `choice` answer down its own branch, the way the Switch node does — is not implemented, because it needs a live n8n to verify the `outputs` expression against. Until then, route with a Switch node reading the answer:

```
{{ $json.typesafeJev.answers.intent.choice }}
```

or, with **Answers Only** + **Simplify**:

```
{{ $json.intent }}
```

That is the 0.3.0 candidate and the main reason to install this over an HTTP Request node.
