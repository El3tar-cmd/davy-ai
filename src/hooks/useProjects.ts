import { useState, useEffect, useCallback } from 'react';
import { SYSTEM_PROMPT } from '../constants/system-prompt';
import type { Project, OllamaMessage } from '../types';

function createSystemMessage(): OllamaMessage {
  return { role: 'system', content: SYSTEM_PROMPT };
}

function createDefaultProject(id: string, name: string): Project {
  const initMsgs: OllamaMessage[] = [createSystemMessage()];
  return {
    id,
    name,
    messages: initMsgs,
    files: {},
    history: [{ messages: initMsgs, files: {} }],
    historyIndex: 0,
    updatedAt: Date.now(),
  };
}

function sanitizeStoredProjects(raw: unknown): Project[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    return [createDefaultProject('default', 'Project 1')];
  }

  const projects = raw
    .filter((candidate): candidate is Partial<Project> => Boolean(candidate && typeof candidate === 'object'))
    .map((project, index) => {
      const messages = Array.isArray(project.messages) && project.messages.length > 0
        ? project.messages
        : [createSystemMessage()];
      const files = project.files && typeof project.files === 'object'
        ? project.files as Record<string, string>
        : {};
      const history = Array.isArray(project.history) && project.history.length > 0
        ? project.history
        : [{ messages, files }];
      const historyIndex = typeof project.historyIndex === 'number'
        ? Math.min(Math.max(project.historyIndex, 0), history.length - 1)
        : history.length - 1;

      return {
        id: typeof project.id === 'string' && project.id ? project.id : `project-${index + 1}`,
        name: typeof project.name === 'string' && project.name ? project.name : `Project ${index + 1}`,
        messages,
        files,
        history,
        historyIndex,
        updatedAt: typeof project.updatedAt === 'number' ? project.updatedAt : Date.now(),
      };
    });

  return projects.length > 0 ? projects : [createDefaultProject('default', 'Project 1')];
}

/**
 * Manages the full project lifecycle: CRUD, history, undo/redo.
 * Persists projects and current selection to localStorage.
 */
export function useProjects() {
  const [projects, setProjects] = useState<Project[]>(() => {
    const saved = localStorage.getItem('stitch_projects');
    if (saved) {
      try {
        return sanitizeStoredProjects(JSON.parse(saved));
      } catch (_e) {
        // Fall through to defaults
      }
    }

    const legacyMessages = localStorage.getItem('stitch_messages');
    const legacyFiles = localStorage.getItem('stitch_files');
    if (legacyMessages || legacyFiles) {
      let msgs: OllamaMessage[] = [createSystemMessage()];
      let fls: Record<string, string> = {};

      try {
        if (legacyMessages) {
          msgs = JSON.parse(legacyMessages);
        }
      } catch (_e) {
        msgs = [createSystemMessage()];
      }

      try {
        if (legacyFiles) {
          fls = JSON.parse(legacyFiles);
        }
      } catch (_e) {
        fls = {};
      }

      return [{
        id: 'default',
        name: 'Project 1',
        messages: msgs,
        files: fls,
        history: [{ messages: msgs, files: fls }],
        historyIndex: 0,
        updatedAt: Date.now(),
      }];
    }

    return [createDefaultProject('default', 'Project 1')];
  });

  const [currentProjectId, setCurrentProjectId] = useState<string>(
    () => localStorage.getItem('stitch_current_project') || 'default'
  );

  const currentProject = projects.find((p) => p.id === currentProjectId) || projects[0] || createDefaultProject('default', 'Project 1');
  const messages = currentProject.messages;
  const files = currentProject.files;

  useEffect(() => {
    localStorage.setItem('stitch_projects', JSON.stringify(projects));
  }, [projects]);

  useEffect(() => {
    localStorage.setItem('stitch_current_project', currentProjectId);
  }, [currentProjectId]);

  const updateCurrentProject = useCallback(
    (updates: Partial<Project>) => {
      setProjects((prev) =>
        prev.map((p) =>
          p.id === currentProjectId ? { ...p, ...updates, updatedAt: Date.now() } : p
        )
      );
    },
    [currentProjectId]
  );

  const pushToHistory = useCallback(
    (newMessages: OllamaMessage[], newFiles: Record<string, string>) => {
      setProjects((prev) =>
        prev.map((p) => {
          if (p.id === currentProjectId) {
            const newHistory = p.history.slice(0, p.historyIndex + 1);
            newHistory.push({ messages: newMessages, files: newFiles });
            return {
              ...p,
              messages: newMessages,
              files: newFiles,
              history: newHistory,
              historyIndex: newHistory.length - 1,
              updatedAt: Date.now(),
            };
          }
          return p;
        })
      );
    },
    [currentProjectId]
  );

  const handleUndo = useCallback(() => {
    if (currentProject.historyIndex > 0) {
      const newIndex = currentProject.historyIndex - 1;
      const state = currentProject.history[newIndex];
      updateCurrentProject({
        messages: state.messages,
        files: state.files,
        historyIndex: newIndex,
      });
    }
  }, [currentProject, updateCurrentProject]);

  const handleRedo = useCallback(() => {
    if (currentProject.historyIndex < currentProject.history.length - 1) {
      const newIndex = currentProject.historyIndex + 1;
      const state = currentProject.history[newIndex];
      updateCurrentProject({
        messages: state.messages,
        files: state.files,
        historyIndex: newIndex,
      });
    }
  }, [currentProject, updateCurrentProject]);

  const createProject = useCallback(() => {
    const newId = Date.now().toString();
    const newProject = createDefaultProject(newId, `Project ${projects.length + 1}`);
    setProjects((prev) => [newProject, ...prev]);
    setCurrentProjectId(newId);
    return newId;
  }, [projects.length]);

  const switchProject = useCallback((id: string) => {
    setCurrentProjectId(id);
  }, []);

  const deleteProject = useCallback(
    (id: string): boolean => {
      if (projects.length === 1) {
        alert('You must have at least one project.');
        return false;
      }
      if (!window.confirm('Are you sure you want to delete this project?')) {
        return false;
      }
      setProjects((prev) => {
        const filtered = prev.filter((p) => p.id !== id);
        if (id === currentProjectId && filtered[0]) {
          setCurrentProjectId(filtered[0].id);
        }
        return filtered;
      });
      return true;
    },
    [projects.length, currentProjectId]
  );

  const clearChat = useCallback(() => {
    if (window.confirm('Are you sure you want to clear the chat and all generated files for this project?')) {
      pushToHistory([{ role: 'system', content: SYSTEM_PROMPT }], {});
    }
  }, [pushToHistory]);

  return {
    projects,
    currentProject,
    currentProjectId,
    messages,
    files,
    updateCurrentProject,
    pushToHistory,
    handleUndo,
    handleRedo,
    createProject,
    switchProject,
    deleteProject,
    clearChat,
  };
}
