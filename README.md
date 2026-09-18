# n8n-nodes-typesafe-jev

An n8n community node for [TypeSafe Jev](https://typesafe.ai), the TypeSafe System One model for fast, structured decisions. It uses the official [`@typesafe-ai/sdk`](https://github.com/typesafe-ai/typesafe-sdk-js).

Jev returns typed decisions rather than generated prose. In one node execution you can ask multiple independent questions about the same state and receive calibrated probability data for workflow routing, classification, verification, and scoring.

## Installation

In n8n, go to **Settings → Community Nodes**, select **Install**, and enter:

```text
n8n-nodes-typesafe-jev
```

For local development, build the package, then install the generated `.tgz` file through the same screen or place it in an n8n custom extensions directory.

```bash
npm install
npm run build
npm pack
```

## Credentials

Create a TypeSafe API key in the TypeSafe console, then create a **TypeSafe API** credential in n8n and paste the key. The key is stored by n8n as a credential and is never added to output data.

## Node configuration

1. Supply **State** as text, a JSON object, or a JSON array. Fields accept normal n8n expressions; the default state is `{{ $json }}`.
2. Select **Question Builder** for an n8n form, or **JSON** to generate the entire schema dynamically.
3. Add one or more questions. Each needs a stable name that will become the answer key.

### Question types

| Type | Criteria | Result |
| --- | --- | --- |
| Choice | JSON object mapping labels to descriptions | `choice`, `confidence`, and a probability for every label |
| Yes / No (Noul) | Optional JSON object with `true` and `false` descriptions | `noul`, the probability of yes |
| Score | JSON array of two or more ordered rubric descriptions | expected `score`, `confidence`, `legend`, and probabilities by level |

Example JSON questions:

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

The default **Append Result** output preserves the incoming item and adds the full response at `typesafeJev`. Choose **Result Only** to emit the TypeSafe response by itself. The response includes the resolved model, all typed answers, calibrated confidence/probabilities where supplied by Jev, and usage metadata.

## Error handling

The node validates the dynamic question schema before a request is made: question names must be unique, choices need at least two labels, and scores need at least two rubric levels. TypeSafe SDK/API failures are surfaced as n8n node errors. Enable n8n's **Continue On Fail** option if workflow execution should instead return an item with an `error` field.

## Development and publishing

```bash
npm install
npm run build
npm test
npm pack --dry-run
```

Before publishing, replace the placeholder repository URLs in `package.json`, validate against a local n8n instance with a real API key, set the release version, and publish with npm's protected-release process. Do not include API keys in fixtures, workflow exports, or package files.

## Compatibility

Node.js 20.15 or newer is required. The package declares `n8n-workflow` as a peer dependency and follows n8n's community-node package discovery metadata.

## License

[MIT](LICENSE)
