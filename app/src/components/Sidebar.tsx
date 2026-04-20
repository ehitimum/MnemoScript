import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import type { Project } from '../types';

function Sidebar({ onSelectProject }: { onSelectProject: (project: Project) => void }) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [newProjectName, setNewProjectName] = useState('');

  useEffect(() => {
    loadProjects();
  }, []);

  const loadProjects = async () => {
    try {
      const response = await invoke<{ success: boolean; data: Project[]; error?: string }>('list_projects');
      if (response.success) {
        setProjects(response.data || []);
      } else {
        console.error('Failed to load projects:', response.error);
      }
    } catch (error) {
      console.error('Error loading projects:', error);
    }
  };

  const handleCreateProject = async () => {
    if (!newProjectName.trim()) return;
    try {
      const response = await invoke<{ success: boolean; data: Project; error?: string }>('create_project', {
        name: newProjectName.trim(),
      });
      if (response.success) {
        setProjects([...projects, response.data]);
        setNewProjectName('');
      } else {
        console.error('Failed to create project:', response.error);
      }
    } catch (error) {
      console.error('Error creating project:', error);
    }
  };

  return (
    <div className="sidebar">
      <h2>Projects</h2>
      <div className="project-create">
        <input
          type="text"
          placeholder="New project name"
          value={newProjectName}
          onChange={(e) => setNewProjectName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleCreateProject()}
        />
        <button onClick={handleCreateProject}>Create</button>
      </div>
      <ul className="project-list">
        {projects.map((project) => (
          <li key={project.id} onClick={() => onSelectProject(project)}>
            {project.name}
            <span className="project-date">
              {new Date(project.created_at).toLocaleDateString()}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default Sidebar;