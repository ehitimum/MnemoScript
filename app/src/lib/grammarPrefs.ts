import type { LTMatch } from '../components/grammar-service';

/**
 * What the writer told the grammar checker to leave alone. Fiction is full of invented names and
 * deliberate style, so a flag must be easy to dismiss and a dismissed word must stay dismissed.
 *
 * - Dictionary: words never flagged as spelling mistakes again (character and place names…).
 *   Kept on this device in localStorage.
 * - Ignored: one rule for one word, for the rest of this session.
 */

const DICT_KEY = 'mnemo_grammar_dictionary';

/** Categories and rules that mostly second-guess style, not mistakes. */
export const DISABLED_CATEGORIES = ['STYLE', 'TYPOGRAPHY', 'REDUNDANCY', 'PLAIN_ENGLISH', 'WIKIPEDIA'];
export const DISABLED_RULES = [
  'WHITESPACE_RULE',
  'EN_QUOTES',
  'DASH_RULE',
  'ENGLISH_WORD_REPEAT_BEGINNING_RULE',
  'PASSIVE_VOICE',
  'TOO_LONG_SENTENCE',
  'SENTENCE_FRAGMENT',
  'EN_UNPAIRED_QUOTES',
];

const ignored = new Set<string>();

const norm = (w: string) => w.trim().toLowerCase();

function readDict(): Set<string> {
  try {
    const raw = localStorage.getItem(DICT_KEY);
    const list = raw ? (JSON.parse(raw) as unknown) : [];
    return new Set(Array.isArray(list) ? list.filter((w): w is string => typeof w === 'string').map(norm) : []);
  } catch {
    return new Set();
  }
}

export function dictionaryWords(): string[] {
  return [...readDict()].sort();
}

export function addToDictionary(word: string): void {
  const w = norm(word);
  if (!w) return;
  const dict = readDict();
  dict.add(w);
  try {
    localStorage.setItem(DICT_KEY, JSON.stringify([...dict]));
  } catch {
    /* storage full or blocked: the word is still dismissed below */
  }
  ignored.add(`*:${w}`);
}

export function removeFromDictionary(word: string): void {
  const dict = readDict();
  dict.delete(norm(word));
  ignored.delete(`*:${norm(word)}`);
  try {
    localStorage.setItem(DICT_KEY, JSON.stringify([...dict]));
  } catch {
    /* ignore */
  }
}

/** Dismiss this rule for this word until the app restarts. */
export function ignoreMatch(match: LTMatch, word: string): void {
  ignored.add(`${match.rule.id}:${norm(word)}`);
}

export const isSpelling = (m: LTMatch) => m.rule.category.id === 'TYPOS' || m.rule.category.id === 'SPELLING';

/** Whether a match the checker returned should be shown. `word` is the flagged text. */
export function shouldShow(match: LTMatch, word: string, dict: Set<string> = readDict()): boolean {
  if (DISABLED_CATEGORIES.includes(match.rule.category.id) || DISABLED_RULES.includes(match.rule.id)) return false;
  const w = norm(word);
  if (ignored.has(`${match.rule.id}:${w}`)) return false;
  if (isSpelling(match) && (dict.has(w) || ignored.has(`*:${w}`))) return false;
  return true;
}

/** One read of the dictionary for a whole check. */
export function grammarFilter(): (match: LTMatch, word: string) => boolean {
  const dict = readDict();
  return (m, w) => shouldShow(m, w, dict);
}

/** Tests only. */
export function resetGrammarPrefsForTests(): void {
  ignored.clear();
  try {
    localStorage.removeItem(DICT_KEY);
  } catch {
    /* ignore */
  }
}
