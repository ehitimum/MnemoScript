import { describe, it, expect } from 'vitest';
import { api } from './api';

/**
 * The browser fallback backend (used by the web build and by these tests). It
 * mirrors the Rust command surface, so the same API contract is exercised.
 */
describe('api (browser fallback backend)', () => {
  it('creates, lists and opens projects', async () => {
    const p = await api.createProject('Novel', 'a story');
    expect(p.id).toBeTruthy();
    expect(p.name).toBe('Novel');
    expect(p.path).toMatch(/^browser:\/\//);
    const list = await api.listProjects();
    expect(list.map((x) => x.id)).toContain(p.id);
    const byPath = await api.openProjectByPath(p.path!);
    expect(byPath.id).toBe(p.id);
  });

  it('documents round-trip through create / save / load / delete', async () => {
    const p = await api.createProject('Docs');
    const d = await api.createDocument(p.id, 'Chapter 1', '<p>one</p>', 'text', 0);
    expect(d.docType).toBe('text');
    await api.saveDocument(p.id, { ...d, content: '<p>two</p>', folderId: 'f1' });
    const loaded = await api.loadDocument(p.id, d.id);
    expect(loaded.content).toBe('<p>two</p>');
    expect(loaded.folderId).toBe('f1');
    const full = await api.loadProject(p.id);
    expect(full.documents).toHaveLength(1);
    await api.deleteDocument(p.id, d.id);
    expect((await api.loadProject(p.id)).documents).toHaveLength(0);
  });

  it('saves folders on the project', async () => {
    const p = await api.createProject('Folders');
    await api.saveProject({ ...p, folders: [{ id: 'f1', name: 'Part One', order: 0, parentId: null }] });
    expect((await api.loadProject(p.id)).folders[0].name).toBe('Part One');
  });

  it('renames and forgets projects', async () => {
    const p = await api.createProject('Old name');
    const renamed = await api.renameProject(p.id, 'New name');
    expect(renamed.name).toBe('New name');
    await api.deleteProject(p.id);
    expect((await api.listProjects()).some((x) => x.id === p.id)).toBe(false);
  });

  it('native-only features degrade gracefully in a browser', async () => {
    expect(await api.importImage('any')).toBeNull();
    expect(await api.importAssets('any')).toEqual([]);
    expect(await api.selectDirectory()).toBeNull();
    await expect(api.exportFile('any', 'x.png', new Uint8Array([1]))).rejects.toThrow(/unsupported/);
  });

  it('reports missing projects as errors instead of returning garbage', async () => {
    await expect(api.loadProject('nope')).rejects.toThrow(/not found/);
    await expect(api.loadDocument('nope', 'x')).rejects.toThrow();
  });
});
