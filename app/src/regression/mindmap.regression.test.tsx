import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import MindMap from '../components/MindMap';
import type { Document } from '../types';

const doc: Document = {
  id: 'mm1',
  title: 'Plot web',
  content: '{"nodes":[],"edges":[]}',
  updated_at: '',
  docType: 'mindmap',
  order: 0,
};

describe('MindMap (regression)', () => {
  it('flushes a pending (debounced) edit on unmount, tagged with its document id', () => {
    const onUpdate = vi.fn();
    const { unmount } = render(<MindMap document={doc} onUpdateContent={onUpdate} onRequestSave={vi.fn()} theme="dark" />);
    fireEvent.click(screen.getByTitle('Add rectangle node'));
    expect(onUpdate).not.toHaveBeenCalled(); // still inside the 400 ms debounce
    unmount();
    expect(onUpdate).toHaveBeenCalledTimes(1);
    const [json, id] = onUpdate.mock.calls[0];
    expect(id).toBe('mm1');
    expect(JSON.parse(json).nodes).toHaveLength(1);
  });

  it('Save flushes pending edits before asking the parent to persist', () => {
    const onUpdate = vi.fn();
    const onSave = vi.fn();
    render(<MindMap document={doc} onUpdateContent={onUpdate} onRequestSave={onSave} theme="dark" />);
    fireEvent.click(screen.getByTitle('Add circle node'));
    fireEvent.click(screen.getByTitle('Save mind map'));
    expect(onUpdate).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onUpdate.mock.invocationCallOrder[0]).toBeLessThan(onSave.mock.invocationCallOrder[0]);
  });

  it('does not emit an update just for mounting', () => {
    vi.useFakeTimers();
    try {
      const onUpdate = vi.fn();
      render(<MindMap document={doc} onUpdateContent={onUpdate} onRequestSave={vi.fn()} theme="dark" />);
      vi.advanceTimersByTime(1000);
      expect(onUpdate).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});
