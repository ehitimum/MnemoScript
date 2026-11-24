import { describe, it, expect } from 'vitest';
import { getSchema } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { DOMParser } from '@tiptap/pm/model';
import { buildFlatText } from './proseFlatText';

const schema = getSchema([StarterKit]);

function docFromHtml(html: string) {
  const el = document.createElement('div');
  el.innerHTML = html;
  return DOMParser.fromSchema(schema).parse(el);
}

describe('buildFlatText', () => {
  it('joins blocks with a single space so words at block edges never fuse', () => {
    const { text } = buildFlatText(docFromHtml('<h2>Title</h2><p>Body text.</p>'));
    expect(text).toBe('Title Body text.');
  });

  it('produces a map one longer than the text (exclusive end offsets are mappable)', () => {
    const doc = docFromHtml('<p>Hello</p><p>World</p>');
    const { text, map } = buildFlatText(doc);
    expect(map).toHaveLength(text.length + 1);
  });

  it('maps flat offsets back to the exact document positions', () => {
    const doc = docFromHtml('<h2>Title</h2><p>Body text.</p>');
    const { text, map } = buildFlatText(doc);
    const start = text.indexOf('Body');
    expect(doc.textBetween(map[start], map[start + 4])).toBe('Body');
    const dot = text.indexOf('.');
    expect(doc.textBetween(map[dot], map[dot + 1])).toBe('.');
  });

  it('keeps inline marks transparent (bold text is part of the same run)', () => {
    const doc = docFromHtml('<p>The <strong>quick</strong> fox</p>');
    const { text, map } = buildFlatText(doc);
    expect(text).toBe('The quick fox');
    const q = text.indexOf('quick');
    expect(doc.textBetween(map[q], map[q + 5])).toBe('quick');
  });

  it('handles an empty document', () => {
    const { text, map } = buildFlatText(docFromHtml('<p></p>'));
    expect(text).toBe('');
    expect(map).toHaveLength(1);
  });

  it('is stable across list items and nested blocks', () => {
    const doc = docFromHtml('<ul><li><p>one</p></li><li><p>two</p></li></ul><p>three</p>');
    const { text, map } = buildFlatText(doc);
    expect(text).toBe('one two three');
    const t = text.indexOf('three');
    expect(doc.textBetween(map[t], map[t + 5])).toBe('three');
  });
});
