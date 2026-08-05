import type { SkillInfo } from "./api-types";

export interface SkillQueryMatch {
  /** Index of the "$" character in the text */
  start: number;
  /** Text typed after the "$" (quotes stripped); may be empty */
  query: string;
  /** True when the token uses the $"..." quoted form */
  quoted: boolean;
}

export interface SkillInsertion {
  /** Text that replaces the $token */
  text: string;
  /** Caret position relative to the start of `text` after insertion */
  cursorOffset: number;
}

/**
 * Detect a $ skill token immediately before the cursor. The $ must be at the
 * start of the text or preceded by whitespace (same rule as @ file tokens).
 * Supports the in-progress quoted form $"my skill name.
 */
export function extractSkillQuery(textBeforeCursor: string): SkillQueryMatch | null {
  const quoted = /(?:^|\s)\$"([^"\n]*)$/.exec(textBeforeCursor);
  if (quoted) {
    return {
      start: textBeforeCursor.length - (quoted[1].length + 2),
      query: quoted[1],
      quoted: true,
    };
  }
  const plain = /(?:^|\s)\$([^\s"]*)$/.exec(textBeforeCursor);
  if (plain) {
    return {
      start: textBeforeCursor.length - (plain[1].length + 1),
      query: plain[1],
      quoted: false,
    };
  }
  return null;
}

function scoreSkill(skill: SkillInfo, lowerQuery: string): number {
  const lowerName = skill.name.toLowerCase();
  const lowerDesc = (skill.description || "").toLowerCase();
  let score = 0;
  if (lowerName === lowerQuery) score = 100;
  else if (lowerName.startsWith(lowerQuery)) score = 80;
  else if (lowerName.includes(lowerQuery)) score = 50;
  else if (lowerDesc.includes(lowerQuery)) score = 30;

  // Active skills (not disabled) gain a slight boost
  if (!skill.disableModelInvocation && score > 0) score += 5;

  return score;
}

export const SKILL_RESULT_LIMIT = 20;

export function filterSkillEntries(
  skills: SkillInfo[],
  query: string,
  limit: number = SKILL_RESULT_LIMIT,
): SkillInfo[] {
  const lowerQuery = query.toLowerCase().trim();
  if (!lowerQuery) {
    return [...skills]
      .sort((a, b) => {
        if (a.disableModelInvocation !== b.disableModelInvocation) {
          return a.disableModelInvocation ? 1 : -1;
        }
        return a.name.localeCompare(b.name);
      })
      .slice(0, limit);
  }

  const scored: Array<{ skill: SkillInfo; score: number }> = [];
  for (const skill of skills) {
    const score = scoreSkill(skill, lowerQuery);
    if (score > 0) scored.push({ skill, score });
  }
  scored.sort((a, b) =>
    b.score - a.score
    || (a.skill.disableModelInvocation === b.skill.disableModelInvocation ? 0 : a.skill.disableModelInvocation ? 1 : -1)
    || a.skill.name.localeCompare(b.skill.name));
  return scored.slice(0, limit).map((s) => s.skill);
}

export function buildSkillInsertText(skillName: string, forceQuotes = false): SkillInsertion {
  const needsQuotes = forceQuotes || skillName.includes(" ");
  const text = needsQuotes ? `$"${skillName}" ` : `$${skillName} `;
  return { text, cursorOffset: text.length };
}

export function buildSkillMentionText(skillName: string): string {
  return skillName.includes(" ") ? `$"${skillName}" ` : `$${skillName} `;
}
