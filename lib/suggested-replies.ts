import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { AgentSession } from "@earendil-works/pi-coding-agent";
import type { GenerationUsage } from "./api-types";
import { runShadowAgent, sanitizeShadowMessages } from "./shadow-agent";

const SUGGESTED_REPLIES_TIMEOUT_MS = 90_000;

export const SUGGESTED_REPLIES_PROMPT = `Generate concise reply phrases that capture the useful intents or actions the human user could choose next in response to the latest assistant message in the conversation above.

Requirements:
- Write from the user's perspective, not the assistant's perspective.
- If the assistant asked a concrete question, prioritize direct possible answers. Otherwise, suggest useful next steps, clarifications, or adjustments.
- Match the user's primary language and communication style.
- Each suggestion must be a short phrase, such as an intent or action, not a complete sentence.
- Prefer compact verb phrases, noun phrases, or answer fragments. Rewrite questions as intent phrases (for example, "Explain the failure reason" instead of "Why did it fail?").
- Do not include sentence-ending punctuation or separators inside a suggestion.
- Return as many genuinely useful and meaningfully different phrases as the conversation supports. Let the context determine the count; do not target, pad, or cap it at an arbitrary number.
- Use only information supported by the conversation.
- Do not invent personal details, credentials, decisions, or completed actions.
- Do not use Markdown, numbering, labels, or quotation marks inside a suggestion.
- Do not call any tools.
- Return exactly one JSON object with this shape and no other text: {"suggestions":["..."]}`;

export interface GeneratedSuggestedReplies {
  suggestions: string[];
  usage?: GenerationUsage;
}

function parseJsonPayload(raw: string): unknown {
  const value = raw.trim();
  const candidates = [value];
  for (const match of value.matchAll(/```(?:json)?\s*([\s\S]*?)\s*```/gi)) {
    candidates.push(match[1].trim());
  }

  const objectStart = value.indexOf("{");
  const objectEnd = value.lastIndexOf("}");
  if (objectStart >= 0 && objectEnd > objectStart) {
    candidates.push(value.slice(objectStart, objectEnd + 1));
  }

  const arrayStart = value.indexOf("[");
  const arrayEnd = value.lastIndexOf("]");
  if (arrayStart >= 0 && arrayEnd > arrayStart) {
    candidates.push(value.slice(arrayStart, arrayEnd + 1));
  }

  for (const candidate of new Set(candidates)) {
    try {
      return JSON.parse(candidate);
    } catch {
      // Try the next structured candidate before reporting an invalid response.
    }
  }
  throw new Error("The model did not return valid suggested replies JSON");
}

export function parseSuggestedReplies(raw: string): string[] {
  const parsed = parseJsonPayload(raw);
  const values = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === "object"
      ? (parsed as { suggestions?: unknown }).suggestions
      : undefined;
  if (!Array.isArray(values)) {
    throw new Error("The model did not return a suggestions array");
  }

  const suggestions: string[] = [];
  const seen = new Set<string>();
  for (const candidate of values) {
    if (typeof candidate !== "string") continue;
    const normalized = candidate
      .replace(/\s+/gu, " ")
      .trim()
      .replace(/[。.!！?？,，;；:：]+$/u, "")
      .trim();
    if (!/[\p{L}\p{N}]/u.test(normalized)) continue;
    const dedupeKey = normalized.toLocaleLowerCase();
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    suggestions.push(normalized);
  }

  if (suggestions.length === 0) {
    throw new Error("The model did not return any usable suggested replies");
  }
  return suggestions;
}

export async function generateSuggestedReplies(
  source: AgentSession,
  contextMessages: AgentMessage[],
): Promise<GeneratedSuggestedReplies> {
  const messages = sanitizeShadowMessages(contextMessages);
  if (messages.at(-1)?.role !== "assistant") {
    throw new Error("Suggested replies require a completed assistant message");
  }
  if (!messages.some((message) => message.role === "user" || message.role === "compactionSummary")) {
    throw new Error("The session has no user context for suggested replies");
  }

  const result = await runShadowAgent({
    source: source.agent,
    messages,
    prompt: SUGGESTED_REPLIES_PROMPT,
    timeoutMs: SUGGESTED_REPLIES_TIMEOUT_MS,
    timeoutMessage: "Suggested reply generation timed out",
    failureMessage: "The model did not return suggested replies",
  });

  return {
    suggestions: parseSuggestedReplies(result.text),
    ...(result.usage ? { usage: result.usage } : {}),
  };
}
