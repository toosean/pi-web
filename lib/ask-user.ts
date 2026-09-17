import { JSON_SCHEMA, load } from "js-yaml";

export const ASK_USER_LANGUAGE = "ask-user";
export const ASK_USER_OTHER_SELECTION = "other" as const;

const MAX_SOURCE_LENGTH = 20_000;
const MAX_QUESTIONS = 5;
const MAX_OPTIONS = 4;
const MAX_PROMPT_LENGTH = 500;
const MAX_LABEL_LENGTH = 120;
const MAX_DESCRIPTION_LENGTH = 500;

export interface AskUserOption {
  label: string;
  description: string;
  recommended: boolean;
}

export interface AskUserQuestion {
  prompt: string;
  options: AskUserOption[];
}

export interface AskUserForm {
  version: 1;
  questions: AskUserQuestion[];
}

export type AskUserSelection = number | typeof ASK_USER_OTHER_SELECTION | null;

export interface AskUserAnswer {
  selection: AskUserSelection;
  supplement: string;
}

export interface AskUserAnswerLabels {
  intro: string;
  choice: string;
  supplement: string;
  other: string;
  answer: string;
  separator: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(record: Record<string, unknown>, allowed: readonly string[]): boolean {
  const allowedKeys = new Set(allowed);
  return Object.keys(record).every((key) => allowedKeys.has(key));
}

function readSingleLine(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength || /[\r\n]/.test(normalized)) return null;
  return normalized;
}

export function parseAskUserBlock(source: string): AskUserForm | null {
  if (!source.trim() || source.length > MAX_SOURCE_LENGTH) return null;

  let parsed: unknown;
  try {
    parsed = load(source, { schema: JSON_SCHEMA });
  } catch {
    return null;
  }

  if (!isRecord(parsed) || !hasOnlyKeys(parsed, ["version", "questions"])) return null;
  if (parsed.version !== 1 || !Array.isArray(parsed.questions)) return null;
  if (parsed.questions.length < 1 || parsed.questions.length > MAX_QUESTIONS) return null;

  const questions: AskUserQuestion[] = [];
  for (const rawQuestion of parsed.questions) {
    if (!isRecord(rawQuestion) || !hasOnlyKeys(rawQuestion, ["prompt", "options"])) return null;
    const prompt = readSingleLine(rawQuestion.prompt, MAX_PROMPT_LENGTH);
    if (!prompt || !Array.isArray(rawQuestion.options)) return null;
    if (rawQuestion.options.length < 2 || rawQuestion.options.length > MAX_OPTIONS) return null;

    const options: AskUserOption[] = [];
    const labels = new Set<string>();
    let recommendedCount = 0;
    for (const rawOption of rawQuestion.options) {
      if (!isRecord(rawOption) || !hasOnlyKeys(rawOption, ["label", "description", "recommended"])) return null;
      const label = readSingleLine(rawOption.label, MAX_LABEL_LENGTH);
      const description = readSingleLine(rawOption.description, MAX_DESCRIPTION_LENGTH);
      if (!label || !description || labels.has(label)) return null;
      if (rawOption.recommended !== undefined && typeof rawOption.recommended !== "boolean") return null;
      const recommended = rawOption.recommended === true;
      if (recommended) recommendedCount++;
      labels.add(label);
      options.push({ label, description, recommended });
    }
    if (recommendedCount !== 1) return null;
    questions.push({ prompt, options });
  }

  return { version: 1, questions };
}

export function createEmptyAskUserAnswers(form: AskUserForm): AskUserAnswer[] {
  return form.questions.map(() => ({ selection: null, supplement: "" }));
}

export function isAskUserAnswerComplete(answer: AskUserAnswer | undefined): boolean {
  if (!answer || answer.selection === null) return false;
  return answer.selection !== ASK_USER_OTHER_SELECTION || answer.supplement.trim().length > 0;
}

export function areAskUserAnswersComplete(form: AskUserForm, answers: readonly AskUserAnswer[]): boolean {
  return answers.length === form.questions.length && answers.every(isAskUserAnswerComplete);
}

export function getActiveAskUserMessageIndex(messages: readonly { role?: string }[]): number {
  let lastUserIndex = -1;
  let lastAssistantIndex = -1;
  for (let index = messages.length - 1; index >= 0; index--) {
    const role = messages[index]?.role;
    if (lastUserIndex === -1 && role === "user") lastUserIndex = index;
    if (lastAssistantIndex === -1 && role === "assistant") lastAssistantIndex = index;
    if (lastUserIndex !== -1 && lastAssistantIndex !== -1) break;
  }
  return lastAssistantIndex > lastUserIndex ? lastAssistantIndex : -1;
}

function escapeMarkdownText(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/([`*_[\]<>])/g, "\\$1");
}

function formatAnswerField(label: string, value: string, separator: string): string {
  const lines = value.replace(/\r\n?/g, "\n").split("\n").map(escapeMarkdownText);
  return `   - ${label}${separator}${lines[0]}${lines.slice(1).map((line) => `\n     ${line}`).join("")}`;
}

export function formatAskUserAnswers(
  form: AskUserForm,
  answers: readonly AskUserAnswer[],
  labels: AskUserAnswerLabels,
): string | null {
  if (!areAskUserAnswersComplete(form, answers)) return null;

  const sections = form.questions.map((question, index) => {
    const response = answers[index];
    const isOther = response.selection === ASK_USER_OTHER_SELECTION;
    const selected = isOther
      ? labels.other
      : question.options[response.selection as number]?.label;
    if (!selected) return null;

    const lines = [
      `${index + 1}. **${escapeMarkdownText(question.prompt)}**`,
      formatAnswerField(labels.choice, selected, labels.separator),
    ];
    const supplement = response.supplement.trim();
    if (supplement) {
      lines.push(formatAnswerField(isOther ? labels.answer : labels.supplement, supplement, labels.separator));
    }
    return lines.join("\n");
  });

  if (sections.some((section) => section === null)) return null;
  return `${labels.intro}\n\n${sections.join("\n\n")}`;
}
