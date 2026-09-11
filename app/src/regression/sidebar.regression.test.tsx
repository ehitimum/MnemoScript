import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import Sidebar from '../components/Sidebar';
import type { Document, Project } from '../types';

const project: Project = { id: 'p1', name: 'Book', created_at: '', documents: [], folders: [] };
const docs: Document[] = [
  { id: 'd1', title: 'Ideas', content: '{"nodes":[],"edges":[]}', updated_at: '', docType: 'mindmap', order: 0 },
  { id: 'd2', title: 'Chapter 1', content: '', updated_at: '', docType: 'text', order: 1 },
  { id: 'd3', title: 'Atlas', content: '{}', updated_at: '', docType: 'fantasymap', order: 2 },
];

function renderSidebar(overrides: Partial<React.ComponentProps<typeof Sidebar>> = {}) {
  const props: React.ComponentProps<typeof Sidebar> = {
    selectedProject: project,
    selectedDocument: null,
    documents: docs,
    folders: [],
    onCreateDocument: vi.fn(),
    onSelectDocument: vi.fn(),
    onCreateFolder: vi.fn(),
    onRenameFolder: vi.fn(),
    onDeleteFolder: vi.fn(),
    onMoveDocuments: vi.fn(),
    onMoveFolder: vi.fn(),
    onRenameDocument: vi.fn(),
    onDeleteDocuments: vi.fn(),
    onDuplicateDocuments: vi.fn(),
    ...overrides,
  };
  return { ...render(<Sidebar {...props} />), props };
}

const iconOf = (title: string) => screen.getByTitle(title).parentElement!.querySelector('svg')!;

describe('Sidebar (regression)', () => {
  it('picks the icon from the document type, not the title keyword', () => {
    renderSidebar();
    // A mind map called "Ideas" used to get the generic file icon.
    expect(iconOf('Ideas')).toHaveClass('lucide-layers');
    expect(iconOf('Atlas')).toHaveClass('lucide-map');
    expect(iconOf('Chapter 1')).toHaveClass('lucide-book-open');
  });

  it('opens a document on click and auto-numbers new chapters', () => {
    const { props } = renderSidebar();
    fireEvent.click(screen.getByTitle('Chapter 1'));
    expect(props.onSelectDocument).toHaveBeenCalledWith(expect.objectContaining({ id: 'd2' }));

    fireEvent.click(screen.getByTitle('Add…'));
    fireEvent.click(screen.getByText('New Chapter'));
    expect(props.onCreateDocument).toHaveBeenCalledWith('Chapter 2', 'text', null);
  });

  it('filters the tree by title', () => {
    renderSidebar();
    fireEvent.change(screen.getByPlaceholderText(/filter documents/i), { target: { value: 'atl' } });
    expect(screen.getByTitle('Atlas')).toBeInTheDocument();
    expect(screen.queryByTitle('Ideas')).toBeNull();
  });
});
