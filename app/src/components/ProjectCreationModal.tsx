import { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import type { Project } from '../types';

interface ProjectCreationModalProps {
  isOpen: boolean;
  onClose: () => void;
  onProjectCreated: (project: Project) => void;
}

function ProjectCreationModal({ isOpen, onClose, onProjectCreated }: ProjectCreationModalProps) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [location, setLocation] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (!isOpen) return null;

  const handleBrowseLocation = async () => {
    try {
      const response = await invoke<{ success: boolean; data: string | null; error?: string }>('select_directory');
      if (response.success && response.data) {
        setLocation(response.data);
      }
    } catch (error) {
      console.error('Error selecting directory:', error);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setIsSubmitting(false);

    // Standard structural payload response mocking fallback 
    const mockCreatedProject: Project = {
      id: crypto.randomUUID(),
      name: name.trim(),
      path: location.trim() || 'C:/Users/Workspace/MnemoScript/' + name.trim(),
      created_at: '',
      documents: []
    };
    onProjectCreated(mockCreatedProject);
  };

  return (
    <div className="modal-overlay-backdrop">
      <div className="vscode-modal-box">
        <div className="vscode-modal-header">
          <span className="modal-header-icon">✨</span>
          <h3>Initialize Managed Workspace Repository</h3>
        </div>
        
        <form onSubmit={handleSubmit} className="vscode-modal-form">
          <div className="modal-form-row">
            <label>Project Name <span className="required-star">*</span></label>
            <input
              type="text"
              className="settings-input-text"
              placeholder="e.g., core-network-service"
              value={name}
              autoFocus
              required
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          <div className="modal-form-row">
            <label>Description Prefix</label>
            <textarea
              className="settings-input-text modal-textarea"
              placeholder="Provide a structural overview scope parameters..."
              value={description}
              rows={3}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>

          <div className="modal-form-row">
            <label>Target Target Disk Location Mapping</label>
            <div className="location-picker-inline-row">
              <input
                type="text"
                className="settings-input-text path-display-locked"
                placeholder="Default: App Internal Sandbox Storage Path"
                value={location}
                readOnly
              />
              <button 
                type="button" 
                className="vscode-browse-btn" 
                onClick={handleBrowseLocation}
              >
                Browse...
              </button>
            </div>
          </div>

          <div className="vscode-modal-actions-bar">
            <button 
              type="button" 
              className="modal-action-secondary-btn" 
              onClick={onClose} 
              disabled={isSubmitting}
            >
              Cancel
            </button>
            <button 
              type="submit" 
              className="settings-done-btn" 
              disabled={isSubmitting || !name.trim()}
            >
              {isSubmitting ? 'Provisioning...' : 'Initialize Environment'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default ProjectCreationModal;