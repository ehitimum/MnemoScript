import { useState, lazy, Suspense } from 'react';
import type { Project, Document, DocType, Folder } from '../../types';
import type { ThemeType } from '../../App';
import type { Editor as TiptapEditor } from '@tiptap/react';
import { ArrowLeft, Save, Sparkles } from 'lucide-react';
import Editor from '../Editor';
import MindMap from '../MindMap';
import MobileTopBar from './MobileTopBar';
import MobileTabBar, { type MobileTab } from './MobileTabBar';
import MobileLibrary from './MobileLibrary';
import MobileSettings from './MobileSettings';
import ToolsSheet from './ToolsSheet';

const FantasyMap = lazy(() => import('../FantasyMap'));

interface Props {
  // Data
  selectedProject: Project | null;
  selectedDocument: Document | null;
  documents: Document[];
  folders: Folder[];
  projects: Project[];
  activeEditor: TiptapEditor | null;
  // Project / document actions
  onOpenProject: (p: Project) => void;
  onCloseProject: () => void;
  onNewProject: () => void;
  onSelectDocument: (doc: Document) => void;
  onCreateDocument: (title: string, docType?: DocType, folderId?: string | null) => void;
  onCreateFolder: (name: string, parentId?: string | null) => void;
  onRenameDocument: (id: string, title: string) => void;
  onDeleteDocuments: (ids: string[]) => void;
  onDuplicateDocuments: (ids: string[], folderId?: string | null) => void;
  onMoveDocuments: (ids: string[], folderId: string | null) => void;
  onUpdateDocumentContent: (content: string) => void;
  onEditorReady: (editor: TiptapEditor) => void;
  persistCurrent: () => void;
  // Editor / settings state
  editorFont: string;
  setEditorFont: (f: string) => void;
  editorSize: number;
  setEditorSize: (n: number) => void;
  lineHeight: number;
  setLineHeight: (n: number) => void;
  editorPadding: number;
  setEditorPadding: (n: number) => void;
  spellcheckActive: boolean;
  setSpellcheckActive: (b: boolean) => void;
  autoSaveInterval: number;
  setAutoSaveInterval: (n: number) => void;
  defaultSavePath: string;
  setDefaultSavePath: (s: string) => void;
  theme: ThemeType;
  setTheme: (t: ThemeType) => void;
}

/**
 * Phone-native shell: a slim top bar (Write only), a full-screen active screen,
 * and a bottom tab bar (Library / Write / Tools / Settings). Tools opens a bottom
 * sheet over the editor. Completely separate from the desktop layout.
 */
function MobileShell(props: Props) {
  const {
    selectedProject,
    selectedDocument,
    documents,
    folders,
    projects,
    activeEditor,
    onOpenProject,
    onCloseProject,
    onNewProject,
    onSelectDocument,
    onCreateDocument,
    onCreateFolder,
    onRenameDocument,
    onDeleteDocuments,
    onDuplicateDocuments,
    onMoveDocuments,
    onUpdateDocumentContent,
    onEditorReady,
    persistCurrent,
    theme,
    setTheme,
  } = props;

  const [tab, setTab] = useState<MobileTab>('library');
  const [toolsOpen, setToolsOpen] = useState(false);

  const isText = selectedDocument?.docType === 'text';
  const isMindMap = selectedDocument?.docType === 'mindmap';
  const isFantasyMap = selectedDocument?.docType === 'fantasymap';

  // Switch screens; leaving the writing surface also closes the tools sheet.
  // (When a document is deleted while on Write, renderWrite shows an empty state.)
  const goTab = (t: MobileTab) => {
    setTab(t);
    if (t !== 'write') setToolsOpen(false);
  };

  // Opening a document jumps to the writing surface.
  const selectDoc = (doc: Document) => {
    onSelectDocument(doc);
    goTab('write');
  };

  const renderWrite = () => {
    if (!selectedDocument) {
      return (
        <div className="flex-1 flex flex-col items-center justify-center gap-4 px-8 text-center">
          <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center text-primary">
            <Sparkles className="w-7 h-7" />
          </div>
          <p className="text-sm text-muted-foreground">
            Pick a document from your Library, or create a new one to start writing.
          </p>
          <button className="mn-btn mn-btn-primary" onClick={() => goTab('library')}>
            Go to Library
          </button>
        </div>
      );
    }
    if (isMindMap) {
      return (
        <MindMap
          key={selectedDocument.id}
          document={selectedDocument}
          onUpdateContent={onUpdateDocumentContent}
          onRequestSave={persistCurrent}
          theme={theme}
        />
      );
    }
    if (isFantasyMap && selectedProject) {
      return (
        <Suspense fallback={<div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">Loading map studio…</div>}>
          <FantasyMap
            key={selectedDocument.id}
            document={selectedDocument}
            projectId={selectedProject.id}
            onUpdateContent={onUpdateDocumentContent}
            onRequestSave={persistCurrent}
            theme={theme}
          />
        </Suspense>
      );
    }
    return (
      <Editor
        projectId={selectedProject?.id ?? ''}
        document={selectedDocument}
        onUpdateDocumentContent={onUpdateDocumentContent}
        onEditorReady={onEditorReady}
        isEditingSettings={false}
        onCloseSettings={() => {}}
        editorFont={props.editorFont}
        setEditorFont={props.setEditorFont}
        editorSize={props.editorSize}
        setEditorSize={props.setEditorSize}
        lineHeight={props.lineHeight}
        setLineHeight={props.setLineHeight}
        editorPadding={props.editorPadding}
        setEditorPadding={props.setEditorPadding}
        spellcheckActive={props.spellcheckActive}
        setSpellcheckActive={props.setSpellcheckActive}
        autoSaveInterval={props.autoSaveInterval}
        setAutoSaveInterval={props.setAutoSaveInterval}
        defaultSavePath={props.defaultSavePath}
        setDefaultSavePath={props.setDefaultSavePath}
        theme={theme}
        setTheme={setTheme}
        chrome="mobile"
      />
    );
  };

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {tab === 'write' && selectedDocument && (
        <MobileTopBar
          title={selectedDocument.title}
          subtitle={selectedProject?.name}
          left={
            <button className="w-9 h-9 flex items-center justify-center rounded-xl text-foreground/80 active:scale-90" onClick={() => goTab('library')} title="Library">
              <ArrowLeft className="w-5 h-5" />
            </button>
          }
          right={
            <button className="w-9 h-9 flex items-center justify-center rounded-xl text-foreground/80 active:scale-90" onClick={persistCurrent} title="Save">
              <Save className="w-5 h-5" />
            </button>
          }
        />
      )}

      <main className="flex-1 flex flex-col min-h-0 overflow-hidden">
        {tab === 'library' && (
          <MobileLibrary
            selectedProject={selectedProject}
            projects={projects}
            documents={documents}
            folders={folders}
            onOpenProject={onOpenProject}
            onCloseProject={onCloseProject}
            onNewProject={onNewProject}
            onSelectDocument={selectDoc}
            onCreateDocument={(title, type, folderId) => {
              onCreateDocument(title, type, folderId);
              goTab('write');
            }}
            onCreateFolder={onCreateFolder}
            onRenameDocument={onRenameDocument}
            onDeleteDocuments={onDeleteDocuments}
            onDuplicateDocuments={onDuplicateDocuments}
            onMoveDocuments={onMoveDocuments}
          />
        )}

        {tab === 'write' && renderWrite()}

        {tab === 'settings' && (
          <MobileSettings
            theme={theme}
            setTheme={setTheme}
            editorFont={props.editorFont}
            setEditorFont={props.setEditorFont}
            editorSize={props.editorSize}
            setEditorSize={props.setEditorSize}
            lineHeight={props.lineHeight}
            setLineHeight={props.setLineHeight}
            spellcheckActive={props.spellcheckActive}
            setSpellcheckActive={props.setSpellcheckActive}
            autoSaveInterval={props.autoSaveInterval}
            setAutoSaveInterval={props.setAutoSaveInterval}
          />
        )}
      </main>

      <MobileTabBar
        tab={tab}
        onTab={goTab}
        onTools={() => setToolsOpen((o) => !o)}
        toolsActive={toolsOpen}
        canWrite={!!selectedDocument}
        canTools={isText && tab === 'write'}
      />

      <ToolsSheet open={toolsOpen} onClose={() => setToolsOpen(false)} editor={activeEditor} />
    </div>
  );
}

export default MobileShell;
