import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  FileCode2,
  Folder,
  FolderOpen,
  MoreHorizontal,
  Plus,
  Trash2,
  Edit2,
  FoldVertical,
  UnfoldVertical,
  Sparkles,
} from 'lucide-react';

interface FileExplorerProps {
  files: Record<string, string>;
  selectedFile: string;
  recentGeneratedFiles?: string[];
  onSelectFile: (path: string) => void;
  onCreateFile: (path: string) => void;
  onDeleteFile: (path: string) => void;
  onRenameFile: (oldPath: string, newPath: string) => void;
}

interface TreeNode {
  name: string;
  path: string;
  type: 'directory' | 'file';
  children?: TreeNode[];
  fileCount?: number;
}

interface ContextMenuState {
  x: number;
  y: number;
  targetPath: string;
  targetType: 'file' | 'directory' | 'root';
}

function insertPath(nodes: TreeNode[], parts: string[], fullPath: string, currentPath = ''): TreeNode[] {
  const [part, ...rest] = parts;
  const nodePath = currentPath ? `${currentPath}/${part}` : part;

  if (!part) return nodes;

  if (rest.length === 0) {
    return [...nodes, { name: part, path: fullPath, type: 'file', fileCount: 1 }];
  }

  const existing = nodes.find((node) => node.type === 'directory' && node.name === part);
  if (existing) {
    existing.children = insertPath(existing.children || [], rest, fullPath, nodePath);
    return nodes;
  }

  return [
    ...nodes,
    {
      name: part,
      path: nodePath,
      type: 'directory',
      children: insertPath([], rest, fullPath, nodePath),
      fileCount: 0,
    },
  ];
}

function finalizeTree(nodes: TreeNode[]): TreeNode[] {
  return [...nodes]
    .sort((a, b) => {
      if (a.type !== b.type) {
        return a.type === 'directory' ? -1 : 1;
      }
      return a.name.localeCompare(b.name);
    })
    .map((node) => {
      if (node.type === 'file') {
        return { ...node, fileCount: 1 };
      }

      const children = finalizeTree(node.children || []);
      const fileCount = children.reduce((total, child) => total + (child.fileCount || 0), 0);
      return { ...node, children, fileCount };
    });
}

function buildTree(files: Record<string, string>) {
  const root = Object.keys(files).reduce<TreeNode[]>((nodes, path) => insertPath(nodes, path.split('/'), path), []);
  return finalizeTree(root);
}

function collectDirectoryPaths(nodes: TreeNode[]): string[] {
  return nodes.flatMap((node) => {
    if (node.type !== 'directory') return [];
    return [node.path, ...collectDirectoryPaths(node.children || [])];
  });
}

function getDirectoryPathsForFile(path: string) {
  const parts = path.split('/');
  const directories: string[] = [];
  for (let i = 1; i < parts.length; i += 1) {
    directories.push(parts.slice(0, i).join('/'));
  }
  return directories;
}

export function FileExplorer({
  files,
  selectedFile,
  recentGeneratedFiles = [],
  onSelectFile,
  onCreateFile,
  onDeleteFile,
  onRenameFile,
}: FileExplorerProps) {
  const fileCount = Object.keys(files).length;
  const tree = useMemo(() => buildTree(files), [files]);
  const allDirectoryPaths = useMemo(() => collectDirectoryPaths(tree), [tree]);
  const recentFileSet = useMemo(() => new Set(recentGeneratedFiles), [recentGeneratedFiles]);

  const [expandedDirs, setExpandedDirs] = useState<Record<string, boolean>>({});
  const [isCreating, setIsCreating] = useState(false);
  const [newFileName, setNewFileName] = useState('');
  const [renamingFile, setRenamingFile] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);

  const createInputRef = useRef<HTMLInputElement>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isCreating && createInputRef.current) {
      createInputRef.current.focus();
    }
  }, [isCreating]);

  useEffect(() => {
    if (renamingFile && renameInputRef.current) {
      renameInputRef.current.focus();
    }
  }, [renamingFile]);

  useEffect(() => {
    if (!selectedFile) return;
    const parentDirs = getDirectoryPathsForFile(selectedFile);
    if (parentDirs.length === 0) return;

    setExpandedDirs((prev) => {
      const next = { ...prev };
      let changed = false;
      parentDirs.forEach((dir) => {
        if (!next[dir]) {
          next[dir] = true;
          changed = true;
        }
      });
      return changed ? next : prev;
    });
  }, [selectedFile]);

  useEffect(() => {
    const handleClickAway = () => setContextMenu(null);
    window.addEventListener('click', handleClickAway);
    return () => window.removeEventListener('click', handleClickAway);
  }, []);

  const handleCreateSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newFileName.trim()) return;
    onCreateFile(newFileName.trim());
    setIsCreating(false);
    setNewFileName('');
  };

  const handleRenameSubmit = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (renamingFile && renameValue.trim() && renameValue.trim() !== renamingFile) {
      onRenameFile(renamingFile, renameValue.trim());
    }
    setRenamingFile(null);
    setRenameValue('');
  };

  const openCreateInput = (prefix = '') => {
    setIsCreating(true);
    setNewFileName(prefix);
    setContextMenu(null);
  };

  const toggleDirectory = (path: string) => {
    setExpandedDirs((prev) => ({ ...prev, [path]: !prev[path] }));
  };

  const expandAll = () => {
    setExpandedDirs(Object.fromEntries(allDirectoryPaths.map((path) => [path, true])));
  };

  const collapseAll = () => {
    setExpandedDirs({});
  };

  const openContextMenu = (
    event: React.MouseEvent,
    targetPath: string,
    targetType: 'file' | 'directory' | 'root'
  ) => {
    event.preventDefault();
    event.stopPropagation();
    setContextMenu({ x: event.clientX, y: event.clientY, targetPath, targetType });
  };

  const renderContextMenu = () => {
    if (!contextMenu) return null;

    const items: Array<{ label: string; action: () => void; danger?: boolean }> = [];

    if (contextMenu.targetType === 'root') {
      items.push({ label: 'New file', action: () => openCreateInput('') });
      items.push({ label: 'Expand all', action: expandAll });
      items.push({ label: 'Collapse all', action: collapseAll });
    }

    if (contextMenu.targetType === 'directory') {
      items.push({ label: 'New file here', action: () => openCreateInput(`${contextMenu.targetPath}/`) });
      items.push({
        label: expandedDirs[contextMenu.targetPath] ? 'Collapse folder' : 'Expand folder',
        action: () => toggleDirectory(contextMenu.targetPath),
      });
    }

    if (contextMenu.targetType === 'file') {
      items.push({
        label: 'Rename file',
        action: () => {
          setRenamingFile(contextMenu.targetPath);
          setRenameValue(contextMenu.targetPath);
          setContextMenu(null);
        },
      });
      items.push({
        label: 'Delete file',
        danger: true,
        action: () => {
          onDeleteFile(contextMenu.targetPath);
          setContextMenu(null);
        },
      });
    }

    return (
      <div
        className="fixed z-50 min-w-[180px] rounded-lg border border-zinc-700 bg-zinc-900/95 p-1 shadow-2xl backdrop-blur"
        style={{ top: contextMenu.y + 4, left: contextMenu.x + 4 }}
      >
        {items.map((item) => (
          <button
            key={item.label}
            type="button"
            onClick={item.action}
            className={`flex w-full items-center rounded-md px-3 py-2 text-left text-sm transition-colors ${
              item.danger
                ? 'text-red-400 hover:bg-red-500/10'
                : 'text-zinc-200 hover:bg-zinc-800'
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>
    );
  };

  const renderNode = (node: TreeNode, depth = 0): React.ReactNode => {
    const paddingLeft = 10 + depth * 14;

    if (node.type === 'directory') {
      const isExpanded = expandedDirs[node.path] ?? depth < 1;
      return (
        <div key={node.path}>
          <div
            className="group flex w-full items-center gap-2 rounded-md px-2 py-2 text-sm text-zinc-300 transition-colors hover:bg-zinc-800"
            style={{ paddingLeft }}
            onContextMenu={(event) => openContextMenu(event, node.path, 'directory')}
          >
            <button type="button" onClick={() => toggleDirectory(node.path)} className="flex flex-1 items-center gap-2 text-left">
              {isExpanded ? (
                <ChevronDown className="h-3.5 w-3.5 shrink-0 text-zinc-500" />
              ) : (
                <ChevronRight className="h-3.5 w-3.5 shrink-0 text-zinc-500" />
              )}
              {isExpanded ? (
                <FolderOpen className="h-4 w-4 shrink-0 text-amber-400" />
              ) : (
                <Folder className="h-4 w-4 shrink-0 text-amber-400" />
              )}
              <span className="truncate font-medium">{node.name}</span>
            </button>
            <span className="rounded-full border border-zinc-700 bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-400">
              {node.fileCount || 0}
            </span>
            <button
              type="button"
              onClick={(event) => openContextMenu(event, node.path, 'directory')}
              className="rounded p-1 opacity-0 transition-opacity hover:bg-zinc-700 group-hover:opacity-100"
            >
              <MoreHorizontal className="h-3.5 w-3.5 text-zinc-500" />
            </button>
          </div>
          {isExpanded && node.children?.map((child) => renderNode(child, depth + 1))}
        </div>
      );
    }

    const isSelected = selectedFile === node.path;
    const isRecent = recentFileSet.has(node.path);

    return (
      <div
        key={node.path}
        className={`group flex w-full items-center justify-between rounded-md px-2 py-2 text-sm transition-colors ${
          isSelected
            ? 'bg-indigo-500/10 text-indigo-400'
            : 'text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200'
        } ${isRecent ? 'ring-1 ring-emerald-500/30 bg-emerald-500/5' : ''}`}
        style={{ paddingLeft }}
        onContextMenu={(event) => openContextMenu(event, node.path, 'file')}
      >
        {renamingFile === node.path ? (
          <form onSubmit={handleRenameSubmit} className="flex min-w-0 flex-1 items-center gap-2">
            <FileCode2 className="h-4 w-4 shrink-0" />
            <input
              ref={renameInputRef}
              type="text"
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              className="min-w-0 flex-1 rounded border border-indigo-500/50 bg-zinc-900 px-1 text-sm text-zinc-200 outline-none"
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  setRenamingFile(null);
                  setRenameValue('');
                }
              }}
              onBlur={() => handleRenameSubmit()}
            />
          </form>
        ) : (
          <>
            <button type="button" onClick={() => onSelectFile(node.path)} className="flex min-w-0 flex-1 items-center gap-2 text-left">
              <FileCode2 className="h-4 w-4 shrink-0 text-indigo-400" />
              <span className="truncate">{node.name}</span>
              {isRecent && <Sparkles className="h-3.5 w-3.5 shrink-0 text-emerald-400" />}
            </button>
            <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setRenamingFile(node.path);
                  setRenameValue(node.path);
                }}
                className="rounded p-1 text-zinc-400 transition-colors hover:bg-zinc-700 hover:text-zinc-200"
                title="Rename"
              >
                <Edit2 className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  if (confirm(`Are you sure you want to delete ${node.path}?`)) {
                    onDeleteFile(node.path);
                  }
                }}
                className="rounded p-1 text-zinc-400 transition-colors hover:bg-red-500/20 hover:text-red-400"
                title="Delete"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={(event) => openContextMenu(event, node.path, 'file')}
                className="rounded p-1 text-zinc-400 transition-colors hover:bg-zinc-700 hover:text-zinc-200"
                title="More"
              >
                <MoreHorizontal className="h-3.5 w-3.5" />
              </button>
            </div>
          </>
        )}
      </div>
    );
  };

  return (
    <div className="flex h-full w-full flex-col border-r border-zinc-800 bg-zinc-900/50" onContextMenu={(event) => openContextMenu(event, '', 'root')}>
      <div className="flex items-center justify-between gap-3 border-b border-zinc-800 p-3">
        <div className="flex min-w-0 items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-wider text-zinc-400">Files</span>
          <span className="rounded-full border border-zinc-700 bg-zinc-800 px-2 py-0.5 text-[10px] font-medium text-zinc-300">
            {fileCount}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button type="button" onClick={expandAll} className="rounded p-1 text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200" title="Expand all">
            <UnfoldVertical className="h-4 w-4" />
          </button>
          <button type="button" onClick={collapseAll} className="rounded p-1 text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200" title="Collapse all">
            <FoldVertical className="h-4 w-4" />
          </button>
          <button type="button" onClick={() => openCreateInput('')} className="rounded p-1 text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200" title="New File">
            <Plus className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        {isCreating && (
          <form onSubmit={handleCreateSubmit} className="flex items-center gap-2 rounded-md bg-zinc-800/50 px-2 py-1.5">
            <FileCode2 className="h-4 w-4 shrink-0 text-zinc-500" />
            <input
              ref={createInputRef}
              type="text"
              value={newFileName}
              onChange={(e) => setNewFileName(e.target.value)}
              placeholder="folder/file.ext"
              className="min-w-0 flex-1 bg-transparent text-sm text-zinc-200 outline-none"
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  setIsCreating(false);
                  setNewFileName('');
                }
              }}
              onBlur={() => {
                setIsCreating(false);
                setNewFileName('');
              }}
            />
          </form>
        )}

        {tree.length === 0 ? (
          <div className="px-3 py-6 text-center text-xs text-zinc-500">No files yet.</div>
        ) : (
          tree.map((node) => renderNode(node))
        )}
      </div>

      {renderContextMenu()}
    </div>
  );
}
