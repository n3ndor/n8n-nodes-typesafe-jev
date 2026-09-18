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

`n8n-node dev` pulls `n8n@latest`, and n8n 2.x requires **Node 24 or newer**. On an older Node the install fails rather than warning clearly. Check first:

```bash
node -v
```

If it is below 24, switch before running dev (the node itself still builds and ships fine on Node 20.15+, this is only n8n's own requirement):

```bash
nvm install 24
nvm use 24
```

Then:

```bash
pnpm install
pnpm run dev
```

This starts a local n8n with the node symlinked in, using `~/.n8n-node-cli` as an isolated user folder so it does not touch existing n8n data. The first run downloads n8n in full, which takes several minutes. Let it finish. Killing it partway leaves a half-written package in the npm cache, and the next run then fails with `Cannot find module '../package.json'`; recover by deleting the matching folder under `~/AppData/Local/npm-cache/_npx/`.

1. Create a **TypeSafe API** credential, paste the key, press **Test**. It should go green — that exercises `authenticate` and `test` together.
2. Import **`examples/ticket-triage.dev.workflow.json`**, not the plain one. See the note below.
3. Set the credential on both Jev nodes.
4. Execute.

### Do not use the npm-named workflow in dev

n8n registers a node under a different type name depending on how it was loaded:

| Loaded via | Registered type |
| --- | --- |
| npm install, which is what real users do | `n8n-nodes-typesafe-jev.typeSafeJev` |
| `pnpm run dev`, from the `custom/` folder | `CUSTOM.typeSafeJev` |

`CustomDirectoryLoader` hardcodes its package name to `CUSTOM`, so a workflow exported from one mode will not resolve in the other. It fails with `Unrecognized node type`, which looks exactly like the node failing to load even though it loaded fine.

`examples/ticket-triage.workflow.json` is canonical and uses the npm name. Regenerate the dev copy after editing it:

```bash
node scripts/dev-workflow.mjs
```

Also note that **Settings → Community Nodes → Install** cannot be used during development. It installs from npm and will fail with `Package version does not exist` until the package is published. Dev nodes load from disk instead, with no install step. Find it by pressing Tab on the canvas and searching `TypeSafe`.

The workflow runs three sample tickets through **both** input modes at once:

- **Jev (Question Builder)** — per-type fields, full response appended under `typesafeJev`, request ID included.
- **Jev (JSON, Simplified)** — hand-typed JSON schema, answers only, simplified.

The second node is the regression test that matters: a hand-typed JSON schema is exactly what the previous version could never accept. If it returns answers rather than *"Questions must be a non-empty JSON object"*, that bug is confirmed dead against a real instance.

Expected shape from the simplified node:

```json
{ "intent": "refund", "urgent": 0.87, "frustration": 2 }
```

---

### Confirming the package loads, without logging in

n8n's REST and `/types/nodes.json` endpoints need an authenticated session, so checking registration normally means creating an owner account first. You can skip that by running the loader n8n itself uses at startup, from any directory that has n8n installed:

```js
const { PackageDirectoryLoader } = require('n8n-core');
const loader = new PackageDirectoryLoader('D:/Programmierung/PROJECTS/n8n-nodes-typesafe-jev');
await loader.loadAll();
console.log(loader.loadedNodes, loader.types.credentials.map((c) => c.name));
```

Last run against n8n 2.39.8 reported `typeSafeJev v1`, credential `typeSafeApi`, the codex categories, `usableAsTool: true`, and the per-type `displayOptions` intact. If the package were malformed, this throws where n8n would otherwise fail silently at startup.

One Windows-only artifact: the loader builds `iconUrl` with `path.join`, so locally it comes out as `dist\nodes\...\typesafeJev.svg` with backslashes and the icon may not render in a local dev instance. That is n8n's path handling on Windows, not a fault in the package, and it does not occur on a Linux or Docker host.

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

## 4. Releasing

- [ ] `pnpm run release` to cut `0.2.0`. Publishing happens in CI with provenance, never from this machine.
- [ ] Submit for verification once it has run against a real key for a while.

Verification is becoming load-bearing rather than cosmetic. n8n 2.39.8 emits this on startup:

```
N8N_UNVERIFIED_PACKAGES_ENABLED -> The default for this variable will change to
`false` in a future version. Set it to `true` explicitly to keep installing
unverified community packages.
```

Once that default flips, installing an unverified node stops being a click in the UI and becomes an environment-variable change on the n8n host. On someone else's instance that means involving whoever administers it. The three hard blockers for verification are already cleared: zero runtime dependencies, no environment reads, and provenance publishing from CI.

### The npm trusted publishing bootstrap

npm can only configure a Trusted Publisher on a package that **already exists** in the registry. There is no pending state, so a brand new package cannot use OIDC for its first publish. The order has to be:

| # | When | Action |
| --- | --- | --- |
| 1 | Now | Create a granular access token on npmjs.com, scoped to your account with read and write, short expiry. Add it as the `NPM_TOKEN` repository secret on GitHub. |
| 2 | Once publishing is unblocked | `pnpm run release`. CI publishes with the token, and still attaches provenance, which comes from `id-token: write` rather than from the auth method. |
| 3 | Immediately after | npmjs.com → Packages → n8n-nodes-typesafe-jev → Settings → Trusted publishing → Add a publisher (GitHub Actions, owner `n3ndor`, repo `n8n-nodes-typesafe-jev`, workflow `publish.yml`, environment blank). |
| 4 | Same sitting | Delete the `NPM_TOKEN` secret and revoke the token. The workflow skips the token path when the secret is unset and npm falls back to OIDC. |

Step 1 can be done before the publishing block lifts. Token creation is not the same operation as publishing.

Full details are in the header of `.github/workflows/publish.yml`.

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
