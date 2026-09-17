---
name: ask-user
description: Ask focused multiple-choice questions through Pi Web's interactive ask-user block when a task is blocked by user intent or a high-impact decision.
disable-model-invocation: true
---

# Ask User

Investigate the workspace and other available evidence first. Ask only when the answer cannot be discovered and would materially change the result, risk, or implementation direction.

Combine related questions, normally one to three and never more than five. End the response with exactly one `ask-user` block and stop until the user answers. Do not put explanations after the block.

Use this exact YAML shape:

```ask-user
version: 1
questions:
  - prompt: Which deployment target should be used?
    options:
      - label: Staging
        description: Validate migrations and configuration before production.
        recommended: true
      - label: Production
        description: Deploy directly to the live environment.
```

Each question must have two to four mutually exclusive options. Include a concise description for every option and mark exactly one option with `recommended: true`; omit `recommended` from the others. Pi Web adds an Other choice and a supplemental text field automatically, so do not add them as YAML options. Do not add fields beyond `version`, `questions`, `prompt`, `options`, `label`, `description`, and `recommended`.
