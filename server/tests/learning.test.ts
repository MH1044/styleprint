import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { DECISIONS_PER_CARD_UPDATE } from "@styleprint/shared";
import { openTestDb } from "../src/db/client.js";
import { migrate } from "../src/db/schema.js";
import {
  createDecision,
  createDocument,
  createParagraph,
  createProfile,
  getProfile,
  updateParagraph,
  updateProfileStyle,
} from "../src/db/repo.js";
import { computeStyleProfile } from "../src/fingerprint/index.js";
import { LLM_VOCAB } from "../src/fingerprint/llmVocab.js";
import {
  addedPhrases,
  effectiveTargets,
  learnFromDecision,
  learningStatus,
  rebuiltCard,
  refreshStyleCardIfDue,
} from "../src/learning/index.js";

const ORIGINAL_ENV = { ...process.env };
let db: Database.Database;

beforeEach(() => {
  process.env.STYLEPRINT_MOCK = "1";
});
afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  db?.close();
});

const CORPUS = "I keep things short. Honestly, the thing is, most plans fail on a Tuesday. We fixed it anyway, and it held.";
const CARD = "Short declaratives. Starts arguments with a concession.";
const AVOID_WORD = LLM_VOCAB.find((w) => /^[a-z]+$/.test(w))!;

function seedProfile() {
  db = openTestDb();
  const profile = createProfile(db, "Voice");
  updateProfileStyle(db, profile.id, computeStyleProfile(CORPUS), CARD);
  const document = createDocument(db, { profileId: profile.id, title: "Doc", draftText: "One.\n\nTwo." });
  return { profile, document };
}

function logDecisions(documentId: string, count: number) {
  for (let i = 0; i < count; i++) {
    const p = createParagraph(db, { documentId, idx: i, original: `Original paragraph ${i}.` });
    updateParagraph(db, p.id, { pass2: `Rewritten paragraph ${i}.`, final: `Rewritten paragraph ${i}.` });
    createDecision(db, { documentId, paragraphId: p.id, action: i % 2 ? "revert" : "keep", steer: null });
  }
}

describe("migration", () => {
  it("adds the learning column to a database created before it existed", () => {
    db = new Database(":memory:");
    db.exec(`CREATE TABLE profiles (id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at TEXT NOT NULL,
             style_json TEXT, style_card TEXT, lora_path TEXT)`);
    db.prepare(`INSERT INTO profiles (id, name, created_at) VALUES ('old', 'Old voice', '2026-11-01')`).run();
    migrate(db);
    migrate(db);
    expect(getProfile(db, "old")?.learning).toEqual({
      allowedWords: [],
      favouritePhrases: [],
      phraseCounts: {},
      decisionsAtLastCardUpdate: 0,
      cardUpdatedAt: null,
    });
  });
});

describe("learning from decisions", () => {
  it("finds the phrases an edit added, ignoring function-word-only ones", () => {
    const added = addedPhrases("We should leave now.", "Honestly, the thing is, we should leave now.");
    expect(added).toContain("the thing is");
    expect(added).not.toContain("honestly the"); // crosses a comma
    expect(added).not.toContain("we should");
    expect(addedPhrases("a b", "of the it is")).toEqual([]);
  });

  it("allows an avoid-list word again after the user reverts a rewrite that removed it", () => {
    const { profile } = seedProfile();
    expect(getProfile(db, profile.id)!.styleJson!.targets.avoidList).toContain(AVOID_WORD);

    learnFromDecision(db, profile.id, {
      action: "revert",
      original: `We ${AVOID_WORD} this every quarter.`,
      before: "We do this every quarter.",
      after: `We ${AVOID_WORD} this every quarter.`,
    });
    const learned = getProfile(db, profile.id)!;
    expect(learned.learning.allowedWords).toEqual([AVOID_WORD]);
    expect(effectiveTargets(learned.styleJson!.targets, learned.learning).avoidList).not.toContain(AVOID_WORD);
  });

  it("makes a phrase a favourite once three separate edits add it", () => {
    const { profile } = seedProfile();
    const edit = (n: number) =>
      learnFromDecision(db, profile.id, {
        action: "edit",
        original: `Draft ${n}.`,
        before: `The plan worked in round ${n}.`,
        after: `The thing is, the plan worked in round ${n}.`,
      });
    edit(1);
    edit(2);
    expect(getProfile(db, profile.id)!.learning.favouritePhrases).toEqual([]);
    edit(3);
    expect(getProfile(db, profile.id)!.learning.favouritePhrases).toContain("the thing is");
  });
});

describe("style card refresh", () => {
  it(`waits for ${DECISIONS_PER_CARD_UPDATE} decisions, then rewrites the card with what the user corrected`, async () => {
    const { profile, document } = seedProfile();
    logDecisions(document.id, DECISIONS_PER_CARD_UPDATE - 1);
    expect(await refreshStyleCardIfDue(db, profile.id)).toEqual({ refreshed: false, decisionsUsed: 0 });
    expect(learningStatus(db, getProfile(db, profile.id)!).untilNextCardUpdate).toBe(1);

    logDecisions(document.id, 1);
    const refresh = await refreshStyleCardIfDue(db, profile.id);
    expect(refresh).toEqual({ refreshed: true, decisionsUsed: DECISIONS_PER_CARD_UPDATE });

    const updated = getProfile(db, profile.id)!;
    expect(updated.styleCard).toContain(CARD);
    expect(updated.styleCard).toContain("What the user corrected:");
    expect(updated.styleCard).toContain('- Rejected a rewrite and kept their own wording: "Original paragraph 1." over "Rewritten paragraph 1."');
    expect(updated.styleCard).toMatch(/- Accepted \d+ rewrites as they were/);
    expect(updated.learning.decisionsAtLastCardUpdate).toBe(DECISIONS_PER_CARD_UPDATE);
    expect(updated.learning.cardUpdatedAt).not.toBeNull();
    expect(learningStatus(db, updated).untilNextCardUpdate).toBe(DECISIONS_PER_CARD_UPDATE);

    // Nothing new since: no second refresh.
    expect((await refreshStyleCardIfDue(db, profile.id)).refreshed).toBe(false);
  });

  it("keeps learned words and phrases when the card is rebuilt from scratch", () => {
    const { profile } = seedProfile();
    learnFromDecision(db, profile.id, {
      action: "revert",
      original: `We ${AVOID_WORD} it.`,
      before: "We do it.",
      after: `We ${AVOID_WORD} it.`,
    });
    const card = rebuiltCard(db, getProfile(db, profile.id)!, "A brand new card.");
    expect(card).toBe(`A brand new card.\n\nWhat the user corrected:\n- Keeps these words even though AI drafts overuse them: ${AVOID_WORD}`);
  });
});
