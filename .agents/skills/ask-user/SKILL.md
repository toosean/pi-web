---
name: ask-user
description: Ask focused multiple-choice questions through Pi Web's interactive ask-user block when a task is blocked by user intent or a high-impact decision.
---

# Ask User

Investigate the workspace and other available evidence first. Ask only when the answer cannot be discovered and would materially change the result, risk, or implementation direction.

Combine related questions, normally one to three and never more than five. End the response with exactly one `ask-user` block and stop until the user answers. Do not put explanations after the block.

## Output contract (hard requirements)

The renderer only recognizes a **CommonMark fenced code block whose info string is exactly `ask-user`**. Anything else is displayed as inert code or raw text and the user cannot answer it.

- Emit the block as a fenced code block: an opening line made of three backticks immediately followed by `ask-user`, then the YAML body, then a closing line made of three backticks alone.
- Never wrap the block in an XML/HTML tag. Any angle-bracket tag form of the block (an opening tag named `ask-user` closed by a matching end tag) is **invalid** and is the most common failure: do not imitate the `<skill name="ask-user">` metadata wrapper that Pi injects, and do not invent `question` or `options` tags either.
- The info string must be exactly `ask-user`. Variants such as `yaml`, `yml`, `ask_user`, or `Ask-User` after the opening backticks are rejected.
- Never nest the block inside another code fence, and never leave it unterminated.
- The closing three-backtick line must be present, on its own line, with nothing after it in the response.

## Template

The example below is literal, fences included: it opens with three backticks plus `ask-user` and closes with three backticks on their own line.

```ask-user
version: 1
questions:
  - prompt: "Which deployment target should be used?"
    options:
      - label: "Staging"
        description: "Validate migrations and configuration before production."
        recommended: true
      - label: "Production"
        description: "Deploy directly to the live environment."
```

Each question must have two to four mutually exclusive options. Include a concise description for every option and mark exactly one option with `recommended: true`; omit `recommended` from the others. Pi Web adds an Other choice and a supplemental text field automatically, so do not add them as YAML options. Do not add fields beyond `version`, `questions`, `prompt`, `options`, `label`, `description`, and `recommended`.

## Quote every value (hard requirement)

Always wrap `prompt`, `label`, and `description` values in quotes (double quotes by default). **Never emit an unquoted plain scalar.** Unquoted values fail in two ways, and both are easy to hit in this workflow because option text routinely contains code, colors, and ratios such as `color: "#fff"`, `background: #1677ff`, or `#e8eef7`:

- A `: ` (colon followed by a space) inside an unquoted value is read as the start of a new mapping key, so the whole body fails with `bad indentation of a mapping entry`. Pi Web then falls back to an inert code block, the user cannot answer it, and must retype the questions by hand.
- A ` #` (space followed by `#`) inside an unquoted value starts a YAML comment, so everything from `#` to the end of the line is **silently dropped** (e.g. `label: Keep #1677FF white icon` renders as `Keep`).

Rules for quoted values:

- Double quotes by default; escape inner double quotes as `\"` (e.g. `description: "只补 color: \"#fff\"。"`). Use YAML single quotes only for quote-heavy text, escaping inner `'` as `''`.
- Inside quotes, `:`, `#`, `{`, `}`, `[`, `]`, `,`, `&`, `*`, `%`, `@`, backticks, and leading `-`/`?`/`:` are all safe.
- Keep each value on one line; never embed line breaks in `prompt`, `label`, or `description` (use `，`, `；`, or ` / ` instead).
- Respect the parser limits while quoting: `prompt` ≤ 500 chars, `label` ≤ 120 chars, `description` ≤ 500 chars, 2–4 options per question, exactly one `recommended: true` per question, and no duplicate labels within a question.
- Parsing is whole-block and all-or-nothing: any YAML error, unknown field, wrong `recommended` count, too many/few options, duplicate label, or over-long value drops the entire block with no partial rendering and no visible error.

## Pre-send check

Before finishing the response, verify all of these:

1. The last non-empty content is a fenced block opened by a line reading exactly `ask-user` after three backticks.
2. A closing three-backtick line terminates that block, and no text follows it.
3. No XML/HTML tag form of the block appears anywhere.
4. Every `prompt`, `label`, and `description` value is wrapped in quotes, and no unquoted `: ` or ` #` remains anywhere in the body.
5. The body parses as YAML with only the allowed fields (correct names and indentation, 2–4 options per question, exactly one `recommended: true` per question, no duplicate labels, no multi-line values, lengths within limits).

If any check fails, rewrite the block before sending; do not send a tag-based fallback.
