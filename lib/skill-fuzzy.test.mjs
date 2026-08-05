import assert from "node:assert/strict";
import test from "node:test";

async function loadSubject() {
  return import("./skill-fuzzy.ts");
}

test("extracts plain and quoted $ skill queries at start of text or after whitespace", async () => {
  const { extractSkillQuery } = await loadSubject();

  assert.deepEqual(extractSkillQuery("$codex"), {
    start: 0,
    query: "codex",
    quoted: false,
  });

  assert.deepEqual(extractSkillQuery("Please use $pi-goal"), {
    start: 11,
    query: "pi-goal",
    quoted: false,
  });

  assert.deepEqual(extractSkillQuery('Check $"my custom skill'), {
    start: 6,
    query: "my custom skill",
    quoted: true,
  });

  // Does not trigger in the middle of words or bash vars without leading whitespace/start
  assert.equal(extractSkillQuery("foo$bar"), null);
  assert.equal(extractSkillQuery("foo.bar$"), null);
});

test("filters and ranks skills by name and description", async () => {
  const { filterSkillEntries } = await loadSubject();

  const mockSkills = [
    {
      name: "chrome-devtools",
      description: "Browser automation",
      filePath: "/path/1",
      baseDir: "/path",
      disableModelInvocation: false,
      sourceInfo: {},
    },
    {
      name: "codex-session",
      description: "Read Codex session context",
      filePath: "/path/2",
      baseDir: "/path",
      disableModelInvocation: false,
      sourceInfo: {},
    },
    {
      name: "pi-goal-writer",
      description: "Drafts and reviews goals for Pi",
      filePath: "/path/3",
      baseDir: "/path",
      disableModelInvocation: true,
      sourceInfo: {},
    },
  ];

  const matchedName = filterSkillEntries(mockSkills, "codex");
  assert.equal(matchedName.length, 1);
  assert.equal(matchedName[0].name, "codex-session");

  const matchedDesc = filterSkillEntries(mockSkills, "Browser");
  assert.equal(matchedDesc.length, 1);
  assert.equal(matchedDesc[0].name, "chrome-devtools");

  const emptyQuery = filterSkillEntries(mockSkills, "");
  assert.equal(emptyQuery.length, 3);
  // Active skills should be sorted first
  assert.equal(emptyQuery[0].disableModelInvocation, false);
  assert.equal(emptyQuery[1].disableModelInvocation, false);
  assert.equal(emptyQuery[2].disableModelInvocation, true);
});

test("builds skill insert text and mentions correctly", async () => {
  const { buildSkillInsertText, buildSkillMentionText } = await loadSubject();

  assert.deepEqual(buildSkillInsertText("pi-goal-writer"), {
    text: "$pi-goal-writer ",
    cursorOffset: 16,
  });

  assert.deepEqual(buildSkillInsertText("my skill", true), {
    text: '$"my skill" ',
    cursorOffset: 12,
  });

  assert.equal(buildSkillMentionText("chrome-devtools"), "$chrome-devtools ");
  assert.equal(buildSkillMentionText("my skill"), '$"my skill" ');
});
