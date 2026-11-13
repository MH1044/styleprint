import type Database from "better-sqlite3";
import type {
  Decision,
  DecisionAction,
  ParagraphRecord,
  Profile,
  ProfileLearning,
  StyleProfile,
  StyleTargets,
} from "@styleprint/shared";
import { DECISIONS_PER_CARD_UPDATE } from "@styleprint/shared";
import {
  createSpend,
  getParagraph,
  getProfile,
  listDecisionsByProfile,
  updateProfileLearning,
  updateProfileStyleCard,
} from "../db/repo.js";
import { chatCompletion } from "../ai/client.js";
import { renderPrompt } from "../pipeline/prompts.js";

/**
 * Learning from decisions (Stage 4). Every wizard decision is logged; from
 * them the voice learns three things:
 * - reverting a rewrite that removed an avoid-list word puts that word back
 *   in the allowed set, so later rewrites stop removing it;
 * - a phrase the user adds in three separate edits becomes a favourite;
 * - after every DECISIONS_PER_CARD_UPDATE decisions, the style card is
 *   regenerated with a "What the user corrected:" appendix.
 */

const APPENDIX_HEADING = "What the user corrected:";
const FAVOURITE_THRESHOLD = 3;
const MAX_FAVOURITES = 20;
const MAX_TRACKED_PHRASES = 400;
const MAX_LESSONS = 15;

/** The style targets with what the user taught applied: words they restored are no longer avoided. */
export function effectiveTargets(targets: StyleTargets, learning: ProfileLearning): StyleTargets {
  const allowed = new Set(learning.allowedWords.map((w) => w.toLowerCase()));
  return { ...targets, avoidList: targets.avoidList.filter((w) => !allowed.has(w.toLowerCase())) };
}

export function effectiveStyleProfile(styleJson: StyleProfile, learning: ProfileLearning): StyleProfile {
  return { ...styleJson, targets: effectiveTargets(styleJson.targets, learning) };
}

function containsWord(text: string, word: string): boolean {
  return new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(text);
}

// Grammatical glue only. The fingerprint's FUNCTION_WORDS list is the 150
// most common words, content words like "thing" and "work" included; a
// phrase such as "the thing is" is exactly the kind of habit worth learning.
const GLUE_WORDS = new Set(
  (
    "a an the and or but nor so yet for of to in on at by with from into onto over under about as than then that this " +
    "these those it its i me my we us our you your he him his she her they them their is am are was were be been being " +
    "do does did have has had will would can could shall should may might must not no if there here which who whom what " +
    "when where how all any each some such just very too also up out off"
  ).split(" ")
);

function words(text: string): string[] {
  return text.toLowerCase().match(/[a-z]+(?:'[a-z]+)?/g) ?? [];
}

/**
 * Two- to four-word sequences the user wrote that weren't in the text they
 * replaced. Sequences never cross punctuation (so "the thing is, the plan"
 * yields "the thing is", not "thing is the") and need at least one word
 * that isn't grammatical glue ("of the", "it is" never count).
 */
export function addedPhrases(before: string, after: string): string[] {
  const previous = ` ${words(before).join(" ")} `;
  const found = new Set<string>();
  for (const clause of after.split(/[,.;:!?()"“”—–\n]+/)) {
    const tokens = words(clause);
    for (let n = 2; n <= 4; n++) {
      for (let i = 0; i + n <= tokens.length; i++) {
        const gram = tokens.slice(i, i + n);
        if (!gram.some((t) => t.length >= 3 && !GLUE_WORDS.has(t))) continue;
        const phrase = gram.join(" ");
        if (!previous.includes(` ${phrase} `)) found.add(phrase);
      }
    }
  }
  return [...found];
}

/** Phrases added in enough separate edits, longest first, without repeating one already inside a longer favourite. */
function favouritesFrom(counts: Record<string, number>): string[] {
  const candidates = Object.entries(counts)
    .filter(([, count]) => count >= FAVOURITE_THRESHOLD)
    .sort((a, b) => b[0].split(" ").length - a[0].split(" ").length || b[1] - a[1] || a[0].localeCompare(b[0]));
  const chosen: string[] = [];
  for (const [phrase] of candidates) {
    if (chosen.some((c) => ` ${c} `.includes(` ${phrase} `))) continue;
    chosen.push(phrase);
    if (chosen.length === MAX_FAVOURITES) break;
  }
  return chosen;
}

export interface DecisionLesson {
  action: DecisionAction;
  /** The paragraph as the draft had it. */
  original: string;
  /** The paragraph as it stood when the user decided. */
  before: string;
  /** The paragraph after the decision. */
  after: string;
}

/** Updates what the profile has learned from one wizard decision. */
export function learnFromDecision(db: Database.Database, profileId: string, lesson: DecisionLesson): void {
  const profile = getProfile(db, profileId);
  if (!profile) return;
  const learning = profile.learning;
  let changed = false;

  if (lesson.action === "revert" && profile.styleJson) {
    for (const word of profile.styleJson.targets.avoidList) {
      const w = word.toLowerCase();
      if (containsWord(lesson.original, w) && !containsWord(lesson.before, w) && !learning.allowedWords.includes(w)) {
        learning.allowedWords.push(w);
        changed = true;
      }
    }
  }

  if (lesson.action === "edit") {
    for (const phrase of addedPhrases(lesson.before, lesson.after)) {
      learning.phraseCounts[phrase] = (learning.phraseCounts[phrase] ?? 0) + 1;
      changed = true;
    }
    const tracked = Object.entries(learning.phraseCounts);
    if (tracked.length > MAX_TRACKED_PHRASES) {
      tracked.sort((a, b) => b[1] - a[1]);
      learning.phraseCounts = Object.fromEntries(tracked.slice(0, MAX_TRACKED_PHRASES / 2));
    }
    learning.favouritePhrases = favouritesFrom(learning.phraseCounts);
  }

  if (changed) updateProfileLearning(db, profileId, learning);
}

export interface LearningStatus {
  decisionsLogged: number;
  untilNextCardUpdate: number;
  allowedWords: string[];
  favouritePhrases: string[];
  cardUpdatedAt: string | null;
}

export function learningStatus(db: Database.Database, profile: Profile): LearningStatus {
  const decisionsLogged = listDecisionsByProfile(db, profile.id).length;
  const sinceUpdate = decisionsLogged - profile.learning.decisionsAtLastCardUpdate;
  return {
    decisionsLogged,
    untilNextCardUpdate: Math.max(0, DECISIONS_PER_CARD_UPDATE - sinceUpdate),
    allowedWords: profile.learning.allowedWords,
    favouritePhrases: profile.learning.favouritePhrases,
    cardUpdatedAt: profile.learning.cardUpdatedAt,
  };
}

function clip(text: string, max = 140): string {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

/** Plain-English lessons from a run of decisions, most recent last. */
export function describeCorrections(decisions: Decision[], paragraphs: Map<string, ParagraphRecord>): string[] {
  const lessons: string[] = [];
  let kept = 0;
  for (const d of decisions) {
    const p = paragraphs.get(d.paragraphId);
    const rewrite = p?.pass2 ?? p?.original ?? "";
    switch (d.action) {
      case "keep":
        kept++;
        break;
      case "revert":
        if (p) lessons.push(`Rejected a rewrite and kept their own wording: "${clip(p.original)}" over "${clip(rewrite)}"`);
        break;
      case "edit":
        if (p?.final) lessons.push(`Rewrote "${clip(rewrite)}" as "${clip(p.final)}"`);
        break;
      case "retry":
        if (d.steer) lessons.push(`Asked for another try with the note "${clip(d.steer, 80)}"`);
        break;
      case "blend":
        lessons.push(`Blended a rewrite back toward their original, keeping about ${Math.round(Number(d.steer ?? 0.5) * 100)}% of the rewrite`);
        break;
    }
  }
  if (kept > 0) lessons.push(`Accepted ${kept} rewrite${kept === 1 ? "" : "s"} as they were`);
  return lessons;
}

function splitCard(card: string): { body: string; lessons: string[] } {
  const at = card.indexOf(APPENDIX_HEADING);
  if (at < 0) return { body: card.trim(), lessons: [] };
  const lessons = card
    .slice(at + APPENDIX_HEADING.length)
    .split("\n")
    .map((l) => l.replace(/^\s*-\s*/, "").trim())
    .filter(Boolean);
  return { body: card.slice(0, at).trim(), lessons };
}

/**
 * The card with its corrections appendix rebuilt locally: earlier lessons
 * plus new ones (most recent kept), and the learned words and phrases. This
 * is what mock mode returns, and what a freshly rebuilt card is given so the
 * learned exceptions survive a rebuild.
 */
export function cardWithLessons(card: string, newLessons: string[], learning: ProfileLearning): string {
  const { body, lessons } = splitCard(card);
  const learnedPrefixes = ["Keeps these words", "Reaches for these phrases"];
  const merged = [...lessons.filter((l) => !learnedPrefixes.some((p) => l.startsWith(p))), ...newLessons];
  const unique = merged.filter((l, i) => merged.indexOf(l) === i).slice(-MAX_LESSONS);
  if (learning.allowedWords.length) unique.push(`Keeps these words even though AI drafts overuse them: ${learning.allowedWords.join(", ")}`);
  if (learning.favouritePhrases.length) unique.push(`Reaches for these phrases: ${learning.favouritePhrases.map((p) => `"${p}"`).join(", ")}`);
  if (unique.length === 0) return body;
  return `${body}\n\n${APPENDIX_HEADING}\n${unique.map((l) => `- ${l}`).join("\n")}`;
}

export interface CardRefresh {
  refreshed: boolean;
  decisionsUsed: number;
  error?: string;
}

/**
 * Regenerates the style card from the user's corrections once enough
 * decisions have been logged since the last update. A failed call (no
 * credit, network) leaves the card as it was and is reported, not thrown:
 * finishing the wizard should never depend on it.
 */
export async function refreshStyleCardIfDue(db: Database.Database, profileId: string): Promise<CardRefresh> {
  const profile = getProfile(db, profileId);
  if (!profile?.styleCard) return { refreshed: false, decisionsUsed: 0 };
  const decisions = listDecisionsByProfile(db, profileId);
  const pending = decisions.slice(profile.learning.decisionsAtLastCardUpdate);
  if (pending.length < DECISIONS_PER_CARD_UPDATE) return { refreshed: false, decisionsUsed: 0 };

  const paragraphs = new Map<string, ParagraphRecord>();
  for (const d of pending) {
    if (paragraphs.has(d.paragraphId)) continue;
    const p = getParagraph(db, d.paragraphId);
    if (p) paragraphs.set(p.id, p);
  }
  const lessons = describeCorrections(pending, paragraphs);
  const prompt = renderPrompt("style-card-refresh", {
    style_card: profile.styleCard,
    corrections: lessons.map((l) => `- ${l}`).join("\n") || "(none)",
    allowed_words: profile.learning.allowedWords.join(", ") || "(none)",
    favourite_phrases: profile.learning.favouritePhrases.join(", ") || "(none)",
  });

  try {
    const result = await chatCompletion({
      tier: "publik-balanced",
      temperature: 0,
      prompt,
      mock: { kind: "style-card-refresh", reply: cardWithLessons(profile.styleCard, lessons, profile.learning) },
    });
    const card = result.text.trim();
    if (!card) throw new Error("the style card update came back empty");
    updateProfileStyleCard(db, profileId, card);
    updateProfileLearning(db, profileId, {
      ...profile.learning,
      decisionsAtLastCardUpdate: decisions.length,
      cardUpdatedAt: new Date().toISOString(),
    });
    createSpend(db, {
      documentId: null,
      call: "style-card-refresh",
      tier: "publik-balanced",
      chargeMicros: result.usage.chargeMicros ?? 0,
      balanceAfterMicros: result.usage.balanceAfterMicros ?? null,
    });
    return { refreshed: true, decisionsUsed: pending.length };
  } catch (err) {
    return { refreshed: false, decisionsUsed: 0, error: err instanceof Error ? err.message : "style card update failed" };
  }
}

/** After the card is rebuilt from scratch, it starts a fresh count but keeps the learned exceptions. */
export function rebuiltCard(db: Database.Database, profile: Profile, card: string): string {
  updateProfileLearning(db, profile.id, {
    ...profile.learning,
    decisionsAtLastCardUpdate: listDecisionsByProfile(db, profile.id).length,
  });
  return cardWithLessons(card, [], profile.learning);
}
