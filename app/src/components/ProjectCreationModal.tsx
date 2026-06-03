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
      } else if (response.error) {
        console.error('Failed to select directory:', response.error);
      }
    } catch (error) {
      console.error('Error selecting directory:', error);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setIsSubmitting(true);
    try {
      const response = await invoke<{ success: boolean; data: Project; error?: string }>('create_project', {
        name: name.trim(),
        description: description.trim() || undefined,
        path: location.trim() || undefined,
      });
      if (response.success) {
        onProjectCreated(response.data);
        setName('');
        setDescription('');
        setLocation('');
        onClose();
      } else {
        console.error('Failed to create project:', response.error);
        alert(`Failed to create project: ${response.error}`);
      }
    } catch (error) {
      console.error('Error creating project:', error);
      alert(`Error: ${error}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="modal-overlay">
      <div className="modal">
        <div className="modal-header">
          <h2>Create New Project</h2>
          <button className="close-x" onClick={onClose}>&times;</button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label htmlFor="project-name">Project Name *</label>
            <input
              id="project-name"
              type="text"
              placeholder="e.g., My Masterpiece"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              autoFocus
            />
          </div>
          <div className="form-group">
            <label htmlFor="project-description">Description (optional)</label>
            <textarea
              id="project-description"
              placeholder="Provide a brief overview of your writing project..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
            />
          </div>
          <div className="form-group">
            <label htmlFor="project-location">Project Location (optional)</label>
            <div className="location-picker">
              <input
                id="project-location"
                type="text"
                placeholder="Default: App Data Folder (Leave empty)"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
              />
              <button 
                type="button" 
                className="browse-button" 
                onClick={handleBrowseLocation}
              >
                📁 Browse
              </button>
            </div>
            <p className="field-hint">
              Choose a custom folder on your PC. A folder named after your project will be created inside.
            </p>
          </div>
          <div className="modal-actions">
            <button type="button" className="cancel-btn" onClick={onClose} disabled={isSubmitting}>
              Cancel
            </button>
            <button type="submit" className="submit-btn" disabled={isSubmitting}>
              {isSubmitting ? 'Creating...' : '🚀 Create Project'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default ProjectCreationModal;