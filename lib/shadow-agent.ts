import {
  Agent,
  type AgentMessage,
  type AgentOptions,
  type AgentTool,
} from "@earendil-works/pi-agent-core";
import type { GenerationUsage } from "./api-types";

export interface ShadowAgentResult {
  text: string;
  usage?: GenerationUsage;
}

function createShadowTools(tools: AgentTool[]): AgentTool[] {
  return tools.map((tool) => ({
    ...tool,
    execute: async () => {
      throw new Error("Tools cannot be executed during background generation");
    },
  }));
}

/**
 * Preserve the source Agent's provider-facing configuration while replacing
 * every tool implementation with a non-mutating stub.
 */
export function buildShadowAgentOptions(source: Agent): AgentOptions {
  const state = source.state;
  return {
    initialState: {
      systemPrompt: state.systemPrompt,
      model: state.model,
      thinkingLevel: state.thinkingLevel,
      tools: createShadowTools(state.tools),
      messages: state.messages,
    },
    convertToLlm: source.convertToLlm,
    transformContext: source.transformContext,
    streamFn: source.streamFunction,
    getApiKey: source.getApiKey,
    onPayload: source.onPayload,
    onResponse: source.onResponse,
    steeringMode: source.steeringMode,
    followUpMode: source.followUpMode,
    sessionId: source.sessionId,
    thinkingBudgets: source.thinkingBudgets,
    transport: source.transport,
    maxRetryDelayMs: source.maxRetryDelayMs,
    toolExecution: source.toolExecution,
  };
}

/** Remove tool calls or results that do not form an adjacent complete pair. */
export function sanitizeShadowMessages(messages: AgentMessage[]): AgentMessage[] {
  const sanitized: AgentMessage[] = [];
  let expectedToolResultIds: Set<string> | undefined;

  for (let index = 0; index < messages.length; index++) {
    const message = messages[index];

    if (message.role === "assistant") {
      const followingToolResultIds = new Set<string>();
      for (let resultIndex = index + 1; resultIndex < messages.length; resultIndex++) {
        const resultMessage = messages[resultIndex];
        if (resultMessage.role !== "toolResult") break;
        followingToolResultIds.add(resultMessage.toolCallId);
      }

      expectedToolResultIds = new Set<string>();
      const content = message.content.filter((block) => {
        if (block.type !== "toolCall") return true;
        if (!followingToolResultIds.has(block.id)) return false;
        expectedToolResultIds!.add(block.id);
        return true;
      });

      if (content.length > 0) sanitized.push({ ...message, content });
      continue;
    }

    if (message.role === "toolResult") {
      if (expectedToolResultIds?.delete(message.toolCallId)) sanitized.push(message);
      continue;
    }

    expectedToolResultIds = undefined;
    sanitized.push(message);
  }

  return sanitized;
}

function getGeneratedAssistantResult(
  agent: Agent,
  historyLength: number,
  failureMessage: string,
): ShadowAgentResult {
  const generatedMessages = agent.state.messages.slice(historyLength);
  for (let index = generatedMessages.length - 1; index >= 0; index--) {
    const message = generatedMessages[index];
    if (message.role !== "assistant") continue;
    if (message.stopReason === "error") {
      throw new Error(message.errorMessage || failureMessage);
    }
    const text = message.content
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("\n")
      .trim();
    if (!text) continue;
    return {
      text,
      ...(message.usage ? {
        usage: {
          input: message.usage.input,
          output: message.usage.output,
          cacheRead: message.usage.cacheRead,
          cacheWrite: message.usage.cacheWrite,
          total: message.usage.totalTokens,
        },
      } : {}),
    };
  }
  throw new Error(failureMessage);
}

export async function runShadowAgent(options: {
  source: Agent;
  messages: AgentMessage[];
  prompt?: string;
  continueFromMessages?: boolean;
  timeoutMs: number;
  timeoutMessage: string;
  failureMessage: string;
}): Promise<ShadowAgentResult> {
  const agentOptions = buildShadowAgentOptions(options.source);
  agentOptions.initialState!.messages = options.messages;
  const temporaryAgent = new Agent(agentOptions);
  const historyLength = options.messages.length;
  const runPromise = options.continueFromMessages
    ? temporaryAgent.continue()
    : temporaryAgent.prompt(options.prompt ?? "");
  let timeout: ReturnType<typeof setTimeout> | undefined;

  try {
    await Promise.race([
      runPromise,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => {
          temporaryAgent.abort();
          reject(new Error(options.timeoutMessage));
        }, options.timeoutMs);
      }),
    ]);
  } catch (error) {
    temporaryAgent.abort();
    await runPromise.catch(() => {});
    throw error;
  } finally {
    if (timeout) clearTimeout(timeout);
  }

  return getGeneratedAssistantResult(temporaryAgent, historyLength, options.failureMessage);
}
