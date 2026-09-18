# n8n-nodes-typesafe-jev

An n8n community node for [TypeSafe Jev](https://typesafe.ai), the TypeSafe System One model for fast, structured decisions.

Jev returns typed decisions rather than generated prose. In a single node execution you can ask several independent questions about the same state and get back calibrated probabilities — for classification, routing, verification and scoring.

> Unofficial and community-maintained. Not affiliated with, endorsed by, or supported by TypeSafe.

## Installation

In n8n, go to **Settings → Community Nodes**, select **Install**, and enter:

```text
n8n-nodes-typesafe-jev
```

## Credentials

Create an API key in the TypeSafe console, then add a **TypeSafe API** credential in n8n and paste the key. Press **Test** to confirm it works — the credential is checked against the model list endpoint.

| Field | Required | Notes |
| --- | --- | --- |
| API Key | yes | Stored encrypted by n8n and never written to output data |
| Base URL | no | Defaults to `https://api.typesafe.ai`. Change only for a proxy or dedicated deployment. |

## Node configuration

1. Pick a **Model**, or leave the default. The dropdown is loaded from your account.
2. Supply **State** — plain text, a JSON object or a JSON array. Defaults to the whole incoming item (`{{ $json }}`).
3. Choose **Question Builder** to define questions field by field, or **JSON** to supply a schema generated upstream.
4. Give every question a **Name**. That name is the key its answer appears under.

### Question types

| Type | You provide | Jev returns |
| --- | --- | --- |
| **Choice** | Two or more labelled options, each with an optional description | `choice`, `confidence`, and a probability per label |
| **Yes/No** | Optional descriptions of what counts as yes and no | `noul` — the probability of yes |
| **Score** | An ordered rubric of two or more levels, lowest first | expected `score`, `confidence`, `legend`, and probabilities per level |

### Output

| Option | Result |
| --- | --- |
| **Append to Item** (default) | Incoming fields, plus the full response under `typesafeJev` |
| **Response Only** | The full response — `model`, `answers`, `usage` |
| **Answers Only** | Just `answers` |

Enable **Simplify** to reduce each answer to the single value you would branch on: the chosen label, the yes probability, or the expected score. With **Answers Only** and **Simplify** together, an item comes out as `{ "intent": "refund", "urgent": 0.82, "frustration": 1.4 }` — ready for a Switch or Filter node.

Under **Options** you can set the request timeout, rename the output field, and include the TypeSafe request ID for support tickets.

### Using it as an AI Agent tool

The node sets `usableAsTool`, so it can be attached directly to an AI Agent. The agent supplies the state, and Jev answers with a typed decision rather than free text.

### JSON mode example

```json
{
  "intent": {
    "type": "choice",
    "instructions": "What is the customer's primary request?",
    "criteria": {
      "refund": "The customer requests money returned.",
      "technical_help": "The customer needs a product or integration fixed.",
      "information": "The customer asks a question or seeks information."
    }
  },
  "urgent": {
    "type": "noul",
    "instructions": "Does the customer explicitly convey time pressure?",
    "criteria": {
      "true": "They ask for immediate, urgent, or time-bound action.",
      "false": "They do not convey time pressure."
    }
  },
  "frustration": {
    "type": "score",
    "instructions": "How frustrated is the customer?",
    "criteria": [
      "Calm or neutral",
      "Concerned but civil",
      "Very angry or strongly negative"
    ]
  }
}
```

## Error handling

The question schema is validated before any request is made — names must be unique, choices need at least two labels, scores need at least two rubric levels. Schema problems are reported as configuration errors; API failures are reported separately with the HTTP status, the server's message and the TypeSafe request ID.

Turn on **Continue On Fail** if the workflow should carry on and receive an item with an `error` field instead. n8n's built-in **Retry On Fail** handles transient failures.

## Compatibility

Requires Node.js 20.15 or newer. The package has **no runtime dependencies** and declares `n8n-workflow` as a peer dependency, as n8n's verification guidelines require.

## Development

```bash
pnpm install
pnpm run lint
pnpm run test
pnpm run build
```

`pnpm run dev` starts a local n8n with the node linked. `pnpm run release` bumps the version, tags and pushes, which triggers the publish workflow — releases go out from GitHub Actions with npm provenance, never from a local machine.

To check the live API against every assumption this node makes:

```bash
TYPESAFE_API_KEY=sk-your-key node scripts/verify-api.mjs
```

See [VERIFICATION.md](VERIFICATION.md) for the full first-run checklist and [examples/ticket-triage.workflow.json](examples/ticket-triage.workflow.json) for an importable workflow that exercises both input modes.

While running `pnpm run dev`, n8n loads the node from disk and registers it as `CUSTOM.typeSafeJev` rather than `n8n-nodes-typesafe-jev.typeSafeJev`. Import [examples/ticket-triage.dev.workflow.json](examples/ticket-triage.dev.workflow.json) in that mode, regenerated with `node scripts/dev-workflow.mjs`, otherwise n8n reports `Unrecognized node type`. Settings, Community Nodes, Install does not apply to a local dev node either; it installs from npm.

> Do not run `pnpm run lint --fix` over `nodes/TypeSafeJev/properties.ts`. Its fixer reorders fixed-collection entries by rebuilding them, and silently drops `displayOptions` and `typeOptions` in the process, which flattens the per-type question form.

## License

[MIT](LICENSE)
