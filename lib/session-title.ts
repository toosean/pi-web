import {
  type Agent,
  type AgentMessage,
  type AgentOptions,
} from "@earendil-works/pi-agent-core";
import type { AgentSession } from "@earendil-works/pi-coding-agent";
import {
  buildShadowAgentOptions,
  runShadowAgent,
  sanitizeShadowMessages,
} from "./shadow-agent";
import type { GenerationUsage } from "./api-types";

const TITLE_TIMEOUT_MS = 90_000;
const MAX_TITLE_LENGTH = 80;

const FALSE_VALUES = new Set(["0", "false", "off", "no", "disabled"]);

/**
 * Returns whether auto title generation after turn 1 is enabled in pi-web configuration.
 * Defaults to true unless explicitly disabled via PI_WEB_AUTO_GENERATE_TITLE / PI_WEB_AUTO_TITLE.
 */
export function isAutoGenerateTitleEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const value = env.PI_WEB_AUTO_GENERATE_TITLE ?? env.PI_WEB_AUTO_TITLE;
  if (value === undefined) return true;
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return true;
  return !FALSE_VALUES.has(trimmed);
}

const TITLE_PROMPT = `Create a concise title for this session based on the conversation above.

Requirements:
- Match the primary language used by the user.
- Describe the user's concrete goal or the outcome, not the act of chatting.
- Use 4-12 words for space-separated languages, or 8-24 characters for CJK text when practical.
- Do not call any tools.
- Return only the title as plain text, with no quotes, label, markdown, or explanation.`;

export interface GeneratedSessionTitle {
  title: string;
  usage?: GenerationUsage;
}

/**
 * Build a temporary Agent configuration whose provider-facing prefix matches
 * the source Agent. Tool implementations are replaced without changing their
 * names, descriptions, or schemas, so a naming run cannot mutate the project.
 */
export function buildSessionTitleAgentOptions(source: Agent): AgentOptions {
  return buildShadowAgentOptions(source);
}

/**
 * A running source session usually ends in the user message currently being
 * answered. Fold the title request into a copy of that message so the title
 * request does not send two consecutive user messages to the provider.
 */
export function appendTitleRequestToTrailingUser(messages: AgentMessage[]): AgentMessage[] {
  const lastMessage = messages.at(-1);
  if (!lastMessage || lastMessage.role !== "user") return messages;

  const content = typeof lastMessage.content === "string"
    ? `${lastMessage.content}\n\n${TITLE_PROMPT}`
    : [...lastMessage.content, { type: "text" as const, text: TITLE_PROMPT }];

  return [
    ...messages.slice(0, -1),
    { ...lastMessage, content },
  ];
}

function stripWrappingQuotes(value: string): string {
  const pairs: Array<[string, string]> = [
    ['"', '"'],
    ["'", "'"],
    ["`", "`"],
    ["\u201c", "\u201d"],
    ["\u300c", "\u300d"],
    ["\u300e", "\u300f"],
  ];
  for (const [start, end] of pairs) {
    if (value.startsWith(start) && value.endsWith(end) && value.length > start.length + end.length) {
      return value.slice(start.length, -end.length).trim();
    }
  }
  return value;
}

export function parseGeneratedSessionTitle(raw: string): string {
  let value = raw.trim();
  const fenced = value.match(/^```(?:json|text)?\s*([\s\S]*?)\s*```$/i);
  if (fenced) value = fenced[1].trim();

  if (value.startsWith("{")) {
    try {
      const parsed = JSON.parse(value) as { title?: unknown };
      if (typeof parsed.title === "string") value = parsed.title.trim();
    } catch {
      // Fall back to plain-text cleanup below.
    }
  }

  value = value.split(/\r?\n/, 1)[0] ?? "";
  value = value.replace(/^(?:session\s+title|title|标题)\s*[:：-]\s*/i, "");
  value = stripWrappingQuotes(value).replace(/\s+/g, " ").trim();
  value = value.replace(/[。.!]+$/u, "").trim();

  if (!/[\p{L}\p{N}]/u.test(value)) {
    throw new Error("The model did not return a usable session title");
  }

  const characters = Array.from(value);
  if (characters.length > MAX_TITLE_LENGTH) {
    value = characters.slice(0, MAX_TITLE_LENGTH).join("").trim();
  }
  return value;
}

export function sanitizeTitleMessages(messages: AgentMessage[]): AgentMessage[] {
  return sanitizeShadowMessages(messages);
}

export async function generateSessionTitle(source: AgentSession): Promise<GeneratedSessionTitle> {
  const sourceAgent = source.agent;
  await sourceAgent.waitForIdle();

  const sanitizedMessages = sanitizeTitleMessages(sourceAgent.state.messages);
  if (!sanitizedMessages.some(
    (message) => message.role === "user" || message.role === "compactionSummary",
  )) {
    throw new Error("The session has no user messages to name");
  }

  const continuesFromTrailingUser = sanitizedMessages.at(-1)?.role === "user";
  const result = await runShadowAgent({
    source: sourceAgent,
    messages: continuesFromTrailingUser
      ? appendTitleRequestToTrailingUser(sanitizedMessages)
      : sanitizedMessages,
    prompt: TITLE_PROMPT,
    continueFromMessages: continuesFromTrailingUser,
    timeoutMs: TITLE_TIMEOUT_MS,
    timeoutMessage: "Session title generation timed out",
    failureMessage: "The model did not return a session title",
  });

  return {
    title: parseGeneratedSessionTitle(result.text),
    ...(result.usage ? { usage: result.usage } : {}),
  };
}
