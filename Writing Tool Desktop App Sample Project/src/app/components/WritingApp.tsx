import { useState, useEffect } from "react";
import {
  File,
  Edit,
  Eye,
  Settings,
  FolderOpen,
  FileText,
  Save,
  ChevronRight,
  ChevronDown,
  Plus,
  BookOpen,
  ListTree,
  StickyNote,
} from "lucide-react";
import { Button } from "./ui/Button";
import { Menubar } from "./ui/Menubar";
import { ScrollArea } from "./ui/ScrollArea";
import { Editor } from "./Editor";

interface ChildWork {
  id: string;
  name: string;
  type: "chapter" | "tracker" | "log" | "note";
  content: string;
}

interface Project {
  id: string;
  name: string;
  type: "book" | "notebook";
  childWorks: ChildWork[];
}

export function WritingApp() {
  const [projects] = useState<Project[]>([
    {
      id: "1",
      name: "My Novel",
      type: "book",
      childWorks: [
        {
          id: "1-1",
          name: "Chapter 1: The Beginning",
          type: "chapter",
          content: "",
        },
        {
          id: "1-2",
          name: "Chapter 2: Discovery",
          type: "chapter",
          content: "",
        },
        {
          id: "1-3",
          name: "Character Tracker",
          type: "tracker",
          content: "",
        },
        {
          id: "1-4",
          name: "Plot Notes",
          type: "note",
          content: "",
        },
      ],
    },
  ]);

  const [currentProject, setCurrentProject] = useState<Project>(projects[0]);
  const [selectedWork, setSelectedWork] = useState<ChildWork>(
    projects[0].childWorks[0]
  );
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(
    new Set(["1"])
  );
  const [content, setContent] = useState(selectedWork.content);
  const [isSaving, setIsSaving] = useState(false);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);

  // Auto-save functionality
  useEffect(() => {
    const autoSaveInterval = setInterval(() => {
      handleAutoSave();
    }, 30000); // Auto-save every 30 seconds

    return () => clearInterval(autoSaveInterval);
  }, [content]);

  const handleAutoSave = () => {
    if (content !== selectedWork.content) {
      setIsSaving(true);
      setTimeout(() => {
        selectedWork.content = content;
        setLastSaved(new Date());
        setIsSaving(false);
      }, 500);
    }
  };

  const handleManualSave = () => {
    setIsSaving(true);
    setTimeout(() => {
      selectedWork.content = content;
      setLastSaved(new Date());
      setIsSaving(false);
    }, 500);
  };

  const toggleProject = (projectId: string) => {
    const newExpanded = new Set(expandedProjects);
    if (newExpanded.has(projectId)) {
      newExpanded.delete(projectId);
    } else {
      newExpanded.add(projectId);
    }
    setExpandedProjects(newExpanded);
  };

  const getIconForType = (type: string) => {
    switch (type) {
      case "chapter":
        return <FileText className="w-4 h-4" />;
      case "tracker":
        return <ListTree className="w-4 h-4" />;
      case "log":
        return <BookOpen className="w-4 h-4" />;
      case "note":
        return <StickyNote className="w-4 h-4" />;
      default:
        return <FileText className="w-4 h-4" />;
    }
  };

  return (
    <div className="h-screen flex flex-col bg-[#1e1e1e] text-[#cccccc]">
      {/* Top Menu Bar */}
      <div className="h-9 bg-[#323233] flex items-center px-2 border-b border-[#2d2d30]">
        <Menubar />
      </div>

      {/* Main Content Area */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left Sidebar - File Explorer */}
        <div className="w-64 bg-[#252526] border-r border-[#2d2d30] flex flex-col">
          <div className="h-9 flex items-center justify-between px-3 border-b border-[#2d2d30]">
            <span className="text-xs uppercase tracking-wide text-[#cccccc]">
              Explorer
            </span>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 hover:bg-[#2a2d2e]"
            >
              <Plus className="w-4 h-4" />
            </Button>
          </div>

          <ScrollArea className="flex-1">
            <div className="p-2">
              {projects.map((project) => (
                <div key={project.id} className="mb-1">
                  <div
                    className="flex items-center gap-1 px-2 py-1 hover:bg-[#2a2d2e] cursor-pointer rounded"
                    onClick={() => toggleProject(project.id)}
                  >
                    {expandedProjects.has(project.id) ? (
                      <ChevronDown className="w-4 h-4" />
                    ) : (
                      <ChevronRight className="w-4 h-4" />
                    )}
                    <FolderOpen className="w-4 h-4 text-[#dcb67a]" />
                    <span className="text-sm">{project.name}</span>
                  </div>

                  {expandedProjects.has(project.id) && (
                    <div className="ml-4 mt-1">
                      {project.childWorks.map((work) => (
                        <div
                          key={work.id}
                          className={`flex items-center gap-2 px-2 py-1 hover:bg-[#2a2d2e] cursor-pointer rounded text-sm ${
                            selectedWork.id === work.id
                              ? "bg-[#37373d]"
                              : ""
                          }`}
                          onClick={() => {
                            setSelectedWork(work);
                            setContent(work.content);
                            setCurrentProject(project);
                          }}
                        >
                          {getIconForType(work.type)}
                          <span className="truncate">{work.name}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </ScrollArea>
        </div>

        {/* Editor Area */}
        <div className="flex-1 flex flex-col">
          {/* Editor Tab Bar */}
          <div className="h-9 bg-[#252526] border-b border-[#2d2d30] flex items-center px-3">
            <div className="flex items-center gap-2 px-3 py-1 bg-[#1e1e1e] border-t-2 border-t-[#007acc] text-sm">
              {getIconForType(selectedWork.type)}
              <span>{selectedWork.name}</span>
            </div>
          </div>

          {/* Editor Content */}
          <Editor
            content={content}
            onChange={setContent}
            selectedWork={selectedWork}
          />
        </div>
      </div>

      {/* Bottom Status Bar */}
      <div className="h-6 bg-[#007acc] flex items-center justify-between px-3 text-xs">
        <div className="flex items-center gap-4">
          <span className="flex items-center gap-2">
            <FileText className="w-3 h-3" />
            {currentProject.name} / {selectedWork.name}
          </span>
        </div>

        <div className="flex items-center gap-4">
          {isSaving && <span>Saving...</span>}
          {lastSaved && !isSaving && (
            <span>
              Last saved: {lastSaved.toLocaleTimeString()}
            </span>
          )}
          <button
            onClick={handleManualSave}
            className="flex items-center gap-1 hover:bg-[#005a9e] px-2 py-0.5 rounded"
          >
            <Save className="w-3 h-3" />
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
