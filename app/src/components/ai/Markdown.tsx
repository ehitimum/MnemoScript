import type { ReactNode } from 'react';

/**
 * Minimal Markdown for AI replies: paragraphs, headings, bullet/numbered lists, block quotes,
 * fenced code, **bold**, *italic*, `code`. Builds React elements (never innerHTML), so model
 * output can't inject markup.
 */

function inline(text: string, keyBase: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`|\*[^*\s][^*]*\*|_[^_\s][^_]*_)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const tok = m[0];
    const key = `${keyBase}-${i++}`;
    if (tok.startsWith('**')) out.push(<strong key={key} className="font-semibold text-foreground">{tok.slice(2, -2)}</strong>);
    else if (tok.startsWith('`')) out.push(<code key={key} className="px-1 py-0.5 rounded bg-secondary/70 font-mono text-[0.85em]">{tok.slice(1, -1)}</code>);
    else out.push(<em key={key}>{tok.slice(1, -1)}</em>);
    last = m.index + tok.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

type Block =
  | { kind: 'p'; text: string }
  | { kind: 'h'; level: number; text: string }
  | { kind: 'ul' | 'ol'; items: string[] }
  | { kind: 'quote'; text: string }
  | { kind: 'code'; text: string }
  | { kind: 'hr' };

function parseBlocks(src: string): Block[] {
  const lines = src.replace(/\r\n/g, '\n').split('\n');
  const blocks: Block[] = [];
  let para: string[] = [];
  const flush = () => {
    if (para.length) blocks.push({ kind: 'p', text: para.join(' ') });
    para = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const t = line.trim();
    if (t.startsWith('```')) {
      flush();
      const code: string[] = [];
      while (++i < lines.length && !lines[i].trim().startsWith('```')) code.push(lines[i]);
      blocks.push({ kind: 'code', text: code.join('\n') });
      continue;
    }
    if (!t) { flush(); continue; }
    const h = /^(#{1,4})\s+(.*)$/.exec(t);
    if (h) { flush(); blocks.push({ kind: 'h', level: h[1].length, text: h[2] }); continue; }
    if (/^(-{3,}|\*{3,})$/.test(t)) { flush(); blocks.push({ kind: 'hr' }); continue; }
    const ul = /^[-*•]\s+(.*)$/.exec(t);
    const ol = /^\d+[.)]\s+(.*)$/.exec(t);
    if (ul || ol) {
      flush();
      const kind = ul ? 'ul' : 'ol';
      const prev = blocks[blocks.length - 1];
      const item = (ul ?? ol)![1];
      if (prev && prev.kind === kind) prev.items.push(item);
      else blocks.push({ kind, items: [item] });
      continue;
    }
    if (t.startsWith('>')) {
      flush();
      const text = t.replace(/^>\s?/, '');
      const prev = blocks[blocks.length - 1];
      if (prev && prev.kind === 'quote') prev.text += ` ${text}`;
      else blocks.push({ kind: 'quote', text });
      continue;
    }
    para.push(t);
  }
  flush();
  return blocks;
}

export default function Markdown({ text, className = '' }: { text: string; className?: string }) {
  const blocks = parseBlocks(text);
  return (
    <div className={`flex flex-col gap-2.5 ${className}`}>
      {blocks.map((b, i) => {
        const k = `b${i}`;
        switch (b.kind) {
          case 'h':
            return <p key={k} className={`font-semibold text-foreground ${b.level <= 2 ? 'text-[1.05em]' : ''}`}>{inline(b.text, k)}</p>;
          case 'ul':
            return <ul key={k} className="list-disc pl-5 flex flex-col gap-1 marker:text-primary/70">{b.items.map((it, j) => <li key={j}>{inline(it, `${k}-${j}`)}</li>)}</ul>;
          case 'ol':
            return <ol key={k} className="list-decimal pl-5 flex flex-col gap-1 marker:text-primary/70 marker:font-medium">{b.items.map((it, j) => <li key={j}>{inline(it, `${k}-${j}`)}</li>)}</ol>;
          case 'quote':
            return <blockquote key={k} className="border-l-2 border-primary/40 pl-3 italic text-foreground/85">{inline(b.text, k)}</blockquote>;
          case 'code':
            return <pre key={k} className="rounded-lg bg-secondary/60 border border-border/30 px-3 py-2 text-[0.8em] font-mono overflow-x-auto whitespace-pre-wrap">{b.text}</pre>;
          case 'hr':
            return <hr key={k} className="border-border/40" />;
          default:
            return <p key={k}>{inline(b.text, k)}</p>;
        }
      })}
    </div>
  );
}
