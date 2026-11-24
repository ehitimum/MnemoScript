/**
 * Inline AI commands for the writing area (/polish, /proofread, …). Each command is one tool-less
 * request to the project's connected AI: the passage goes in, the revised passage comes back, and
 * the editor shows it as a preview the writer accepts or discards (nothing changes before that).
 */

export type InlineCommandId = 'polish' | 'proofread' | 'grammar' | 'shorten' | 'expand' | 'tone' | 'continue';

export interface InlineCommand {
  id: InlineCommandId;
  label: string;
  /** Present participle for the progress line ("Polishing…"). */
  progress: string;
  description: string;
  keywords: string[];
  /** Mechanical fixes: show a word diff by default and ask for less effort. */
  corrective: boolean;
}

export const INLINE_COMMANDS: InlineCommand[] = [
  { id: 'polish', label: 'Polish', progress: 'Polishing', description: 'Smoother rhythm, sharper words', keywords: ['improve', 'refine', 'rewrite', 'ai'], corrective: false },
  { id: 'proofread', label: 'Proofread', progress: 'Proofreading', description: 'Spelling, typos, punctuation', keywords: ['spelling', 'typo', 'spell', 'ai'], corrective: true },
  { id: 'grammar', label: 'Fix grammar', progress: 'Checking grammar', description: 'Grammar only, wording kept', keywords: ['grammar', 'correct', 'ai'], corrective: true },
  { id: 'shorten', label: 'Shorten', progress: 'Tightening', description: 'About a third shorter', keywords: ['tighten', 'trim', 'cut', 'concise', 'ai'], corrective: false },
  { id: 'expand', label: 'Expand', progress: 'Expanding', description: 'More detail, same events', keywords: ['longer', 'detail', 'elaborate', 'ai'], corrective: false },
  { id: 'tone', label: 'Change tone', progress: 'Changing the tone', description: 'Darker, lighter, tenser…', keywords: ['tone', 'mood', 'voice', 'style', 'ai'], corrective: false },
  { id: 'continue', label: 'Continue writing', progress: 'Writing', description: 'A paragraph or two more', keywords: ['continue', 'next', 'write', 'more', 'ai'], corrective: false },
];

export const TONES = [
  { id: 'darker', label: 'Darker', prompt: 'darker, more ominous' },
  { id: 'lighter', label: 'Lighter', prompt: 'lighter, warmer' },
  { id: 'tense', label: 'Tenser', prompt: 'tenser, more urgent' },
  { id: 'lyrical', label: 'Lyrical', prompt: 'more lyrical and evocative' },
  { id: 'formal', label: 'Formal', prompt: 'more formal' },
  { id: 'casual', label: 'Casual', prompt: 'more casual and conversational' },
] as const;

export type ToneId = (typeof TONES)[number]['id'];

export function inlineCommand(id: InlineCommandId): InlineCommand {
  return INLINE_COMMANDS.find((c) => c.id === id) ?? INLINE_COMMANDS[0];
}

const INSTRUCTIONS: Record<Exclude<InlineCommandId, 'tone'>, string> = {
  polish:
    'Polish this passage: smoother rhythm, sharper word choice, fewer filler and repeated words. Keep the meaning, ' +
    "the events, the point of view, the tense and the author's voice. Change only what makes it better.",
  proofread:
    'Proofread this passage: fix spelling, typos, punctuation, capitalisation and doubled words. Do not rephrase ' +
    'or change the style; keep everything else exactly as written.',
  grammar:
    'Fix the grammar only (agreement, tense slips, articles, run-on sentences). Keep the wording and style otherwise ' +
    'unchanged; deliberate fragments in prose or dialogue stay as they are.',
  shorten:
    "Tighten this passage to about two thirds of its length. Keep every plot point, what the dialogue says and the author's voice; cut redundancy, not substance.",
  expand:
    'Expand this passage to about one and a half times its length with concrete sensory detail, interiority and pacing. ' +
    'Do not add plot events or characters, and do not change what happens.',
  continue:
    'Continue the story from where the text ends with one or two paragraphs (about 80–180 words) in the same voice, ' +
    'tense and point of view. Do not resolve major threads or introduce major new characters. Do not repeat the existing text.',
};

const SYSTEM_REWRITE =
  'You are the line editor inside MnemoScript, a writing studio for novelists. You receive one passage between ' +
  '<passage> tags and an instruction. Reply with the revised passage only: no preamble, no explanation, no tags or ' +
  'quotation marks around it. Keep the paragraph breaks (a blank line between paragraphs). Keep names, British or ' +
  'American spelling and dialogue punctuation the way the author uses them. If nothing needs changing, return the passage unchanged.';

const SYSTEM_CONTINUE =
  'You are a co-writer inside MnemoScript, a writing studio for novelists. You receive the story so far between ' +
  '<story_so_far> tags. Reply with the new text only: no preamble, no explanation, no tags or quotation marks around it. ' +
  'Separate paragraphs with a blank line.';

export interface InlinePrompt {
  system: string;
  user: string;
  effort?: string;
}

/** `before` is the text just before the passage (voice and continuity only). */
export function buildInlinePrompt(id: InlineCommandId, passage: string, before: string, tone?: ToneId): InlinePrompt {
  const cmd = inlineCommand(id);
  if (id === 'continue') {
    return { system: SYSTEM_CONTINUE, user: `${INSTRUCTIONS.continue}\n\n<story_so_far>\n${before}${passage}\n</story_so_far>` };
  }
  const toneText = TONES.find((t) => t.id === tone)?.prompt ?? TONES[0].prompt;
  const instruction =
    id === 'tone'
      ? `Rewrite this passage in a ${toneText} tone. Keep the events, the characters, the point of view and the tense.`
      : INSTRUCTIONS[id];
  const context = before.trim()
    ? `<context>\n${before.trim()}\n</context>\n(The context only shows the voice and what came before. Do not rewrite or repeat it.)\n\n`
    : '';
  return { system: SYSTEM_REWRITE, user: `${instruction}\n\n${context}<passage>\n${passage}\n</passage>`, effort: cmd.corrective ? 'low' : undefined };
}

const QUOTE_PAIRS: [string, string][] = [
  ['"', '"'],
  ['“', '”'],
  ["'", "'"],
];

/** Strip the wrappers models sometimes add despite the instructions. */
export function cleanInlineOutput(raw: string, original: string): string {
  let t = raw.replace(/\r\n?/g, '\n').trim();
  t = t.replace(/^```[a-z]*\n([\s\S]*?)\n```$/i, '$1').trim();
  t = t.replace(/^<(passage|story_so_far|text)>\s*/i, '').replace(/\s*<\/(passage|story_so_far|text)>$/i, '').trim();
  // "Here's the polished passage:" on its own line.
  t = t.replace(/^(here(?:'|’)?s|here is|sure|certainly)[^\n]{0,80}:\s*\n+/i, '').trim();
  const o = original.trim();
  for (const [a, b] of QUOTE_PAIRS) {
    if (t.length > 1 && t.startsWith(a) && t.endsWith(b) && !(o.startsWith(a) && o.endsWith(b))) {
      t = t.slice(a.length, -b.length).trim();
    }
  }
  return t.replace(/\n{3,}/g, '\n\n');
}
