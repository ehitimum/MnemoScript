import { useState } from 'react';
import { api } from '../lib/api';
import { useMediaQuery } from '../lib/useMediaQuery';
import type { Project } from '../types';
import { FolderPlus } from 'lucide-react';

interface ProjectCreationModalProps {
  isOpen: boolean;
  onClose: () => void;
  onProjectCreated: (project: Project) => void;
  defaultSavePath?: string;
}

function ProjectCreationModal({ isOpen, onClose, onProjectCreated, defaultSavePath }: ProjectCreationModalProps) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [location, setLocation] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isMobile = useMediaQuery('(max-width: 768px)');

  if (!isOpen) return null;

  const handleBrowseLocation = async () => {
    try {
      const dir = await api.selectDirectory();
      if (dir) setLocation(dir);
    } catch (err) {
      console.error('Error selecting directory:', err);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setIsSubmitting(true);
    setError(null);

    try {
      const project = await api.createProject(
        name.trim(),
        description.trim() || undefined,
        location.trim() || undefined,
      );
      onProjectCreated(project);
      setName('');
      setDescription('');
      setLocation('');
    } catch (err) {
      console.error('Failed to create project:', err);
      setError((err as Error).message || 'Failed to create project.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-background/60 backdrop-blur-md z-2000 flex items-center justify-center p-4 animate-in fade-in duration-200">
      <div className="bg-popover border border-border/40 shadow-2xl rounded-2xl w-full max-w-md overflow-hidden flex flex-col p-6 animate-in zoom-in-95 duration-200">
        
        {/* Modal Header */}
        <div className="flex items-center gap-3 text-lg font-semibold text-foreground border-b border-border/20 pb-3 mb-5">
          <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center text-primary">
            <FolderPlus className="w-4 h-4" />
          </div>
          <h3 className="text-base font-semibold text-foreground">Initialize Workspace Project</h3>
        </div>
        
        {/* Form Body */}
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label className="text-2xs font-semibold text-muted-foreground uppercase tracking-wider">
              Project Name <span className="text-destructive font-bold">*</span>
            </label>
            <input
              type="text"
              className="w-full bg-secondary/35 border border-border/30 text-foreground text-sm rounded-lg px-3 py-2.5 focus:border-primary/50 focus:ring-1 focus:ring-primary/20 outline-none transition-all placeholder:text-muted-foreground/50"
              placeholder="e.g., my-novel-outline"
              value={name}
              autoFocus
              required
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-2xs font-semibold text-muted-foreground uppercase tracking-wider">
              Description / Notes
            </label>
            <textarea
              className="w-full bg-secondary/35 border border-border/30 text-foreground text-sm rounded-lg px-3 py-2.5 focus:border-primary/50 focus:ring-1 focus:ring-primary/20 outline-none transition-all placeholder:text-muted-foreground/50 resize-none"
              placeholder="Provide a structural overview or scope details..."
              value={description}
              rows={3}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>

          {/* On mobile, storage is app-private and not user-selectable, so the
              disk-path picker is hidden — projects save to app storage. */}
          {!isMobile && (
            <div className="flex flex-col gap-1.5">
              <label className="text-2xs font-semibold text-muted-foreground uppercase tracking-wider">
                Target Disk Path Location
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  className="flex-1 bg-secondary/15 border border-border/20 text-muted-foreground/75 text-xs rounded-lg px-3 py-2.5 outline-none truncate"
                  placeholder={defaultSavePath ? `Default: ${defaultSavePath}` : 'Default: ~/.mnemoscript/projects'}
                  value={location}
                  readOnly
                />
                <button
                  type="button"
                  className="bg-secondary text-foreground hover:bg-secondary/80 px-4 py-2.5 text-xs font-semibold rounded-lg cursor-pointer transition-all border border-border/30 flex-shrink-0"
                  onClick={handleBrowseLocation}
                >
                  Browse...
                </button>
              </div>
            </div>
          )}

          {error && (
            <p className="text-xs text-destructive bg-destructive/10 border border-destructive/20 rounded-lg px-3 py-2">
              {error}
            </p>
          )}

          {/* Modal Actions */}
          <div className="flex justify-end gap-3 mt-6 pt-4 border-t border-border/20">
            <button 
              type="button" 
              className="bg-secondary hover:bg-secondary/80 text-foreground px-4 py-2.5 text-xs font-semibold rounded-lg cursor-pointer transition-all border border-border/30" 
              onClick={onClose} 
              disabled={isSubmitting}
            >
              Cancel
            </button>
            <button 
              type="submit" 
              className="bg-primary text-primary-foreground hover:opacity-95 disabled:opacity-40 disabled:scale-100 disabled:cursor-not-allowed px-5 py-2.5 text-xs font-semibold rounded-lg cursor-pointer shadow-xs active:scale-98 transition-all" 
              disabled={isSubmitting || !name.trim()}
            >
              {isSubmitting ? 'Provisioning...' : 'Initialize'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default ProjectCreationModal;