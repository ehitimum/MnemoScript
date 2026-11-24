/**
 * Document order in the sidebar, the phone library and the book compiler.
 *
 * Each document has an `order` index. Older versions gave a new document `order = documents.length`,
 * so after a delete two documents could share an index; ties were then broken by *last edited* time
 * and editing "Chapter 3" moved it below "Chapter 4" — and kept it there however often it was fixed.
 * Now a new document goes after the highest index, and ties are broken by title, naturally
 * ("Chapter 2" < "Chapter 10"), then id: stable, and never changed by editing.
 * The backend sorts the same way (`project.rs`, `compare_documents`).
 */

interface Orderable {
  id: string;
  title: string;
  order: number;
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

export function compareDocs(a: Orderable, b: Orderable): number {
  return (a.order ?? 0) - (b.order ?? 0) || collator.compare(a.title, b.title) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

/** The `order` for a document added after `docs` (one past the highest, not the count). */
export function nextDocOrder(docs: readonly { order: number }[], offset = 0): number {
  let max = -1;
  for (const d of docs) if (Number.isFinite(d.order) && d.order > max) max = d.order;
  return max + 1 + offset;
}
