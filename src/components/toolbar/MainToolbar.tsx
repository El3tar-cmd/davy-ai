import React from 'react';
import {
  Play, Code, Terminal, Monitor, Tablet, Smartphone,
  Menu, RefreshCw, Save, Download, Package, Github, Database
} from 'lucide-react';
import type { ActiveTab, DeviceSize } from '../../types';

interface MainToolbarProps {
  activeTab: ActiveTab;
  onTabChange: (tab: ActiveTab) => void;
  deviceSize: DeviceSize;
  onDeviceSizeChange: (size: DeviceSize) => void;
  isAutoSync: boolean;
  onToggleAutoSync: () => void;
  onManualSync: () => void;
  isGenerating: boolean;
  onResetViewer: () => void;
  onExportZip: () => void;
  hasFiles: boolean;
  onOpenMobileMenu: () => void;
  onOpenPackageManager?: () => void;
  onOpenGitHub?: () => void;
  onOpenDatabase?: () => void;
  onSave?: () => void;
  isTerminalVisible?: boolean;
  onToggleTerminal?: () => void;
}

export function MainToolbar({
  activeTab,
  onTabChange,
  deviceSize,
  onDeviceSizeChange,
  isAutoSync,
  onToggleAutoSync,
  onManualSync,
  isGenerating,
  onResetViewer,
  onExportZip,
  hasFiles,
  onOpenMobileMenu,
  onOpenPackageManager,
  onOpenGitHub,
  onOpenDatabase,
  onSave,
  isTerminalVisible,
  onToggleTerminal,
}: MainToolbarProps) {
  const tabs = [
    { tab: 'preview' as const, icon: Play, label: 'Preview' },
    { tab: 'code' as const, icon: Code, label: 'Code' },
    { tab: 'console' as const, icon: Terminal, label: 'Logs' },
  ];

  const mobileActions = [
    { icon: Package, label: 'Packages', onClick: onOpenPackageManager, disabled: false },
    { icon: Github, label: 'GitHub', onClick: onOpenGitHub, disabled: !hasFiles },
    { icon: Database, label: 'Database', onClick: onOpenDatabase, disabled: false },
    { icon: Save, label: 'Save', onClick: onSave, disabled: false },
    { icon: Download, label: 'Export', onClick: onExportZip, disabled: !hasFiles },
  ];

  return (
    <div className="border-b border-zinc-800 bg-zinc-900/30">
      <div className="h-14 flex items-center justify-between px-2 sm:px-4 overflow-x-auto gap-2">
        <div className="flex items-center gap-2 shrink-0">
          <button
            className="md:hidden p-2 text-zinc-400 hover:text-white shrink-0"
            onClick={onOpenMobileMenu}
            title="Open chat"
          >
            <Menu className="w-5 h-5" />
          </button>
          <div className="flex items-center gap-1 bg-zinc-900 p-0.5 sm:p-1 rounded-lg border border-zinc-800 shrink-0">
            {tabs.map(({ tab, icon: Icon, label }) => (
              <button
                key={tab}
                onClick={() => onTabChange(tab)}
                className={`flex items-center gap-1.5 px-2 sm:px-3 py-1 sm:py-1.5 rounded-md text-[11px] sm:text-sm font-medium transition-colors ${
                  activeTab === tab
                    ? 'bg-zinc-800 text-white'
                    : 'text-zinc-400 hover:text-zinc-200'
                }`}
                title={label}
              >
                <Icon className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                <span>{label}</span>
              </button>
            ))}
          </div>
        </div>

        {activeTab === 'preview' && (
          <div className="hidden lg:flex items-center gap-1 bg-zinc-900 p-1 rounded-lg border border-zinc-800 shrink-0">
            {([
              { size: 'desktop' as const, icon: Monitor },
              { size: 'tablet' as const, icon: Tablet },
              { size: 'mobile' as const, icon: Smartphone },
            ]).map(({ size, icon: Icon }) => (
              <button
                key={size}
                onClick={() => onDeviceSizeChange(size)}
                className={`p-1.5 rounded-md transition-colors ${
                  deviceSize === size
                    ? 'bg-zinc-800 text-white'
                    : 'text-zinc-400 hover:text-zinc-200'
                }`}
                title={size}
              >
                <Icon className="w-4 h-4" />
              </button>
            ))}
          </div>
        )}

        <div className="flex items-center gap-1 sm:gap-2 shrink-0 ml-auto">
          <div className="flex items-center gap-1 bg-zinc-900 p-0.5 sm:p-1 rounded-lg border border-zinc-800">
            <button
              onClick={onToggleAutoSync}
              className={`flex items-center gap-1 px-1.5 sm:px-2 py-0.5 sm:py-1 rounded text-[9px] sm:text-[10px] font-bold uppercase tracking-tighter transition-colors ${
                isAutoSync
                  ? 'bg-green-500/20 text-green-400'
                  : 'bg-zinc-800 text-zinc-500'
              }`}
              title={isAutoSync ? 'Auto-sync is ON' : 'Auto-sync is OFF'}
            >
              <RefreshCw
                className={`w-2.5 h-3 sm:w-3 sm:h-3 ${isAutoSync && isGenerating ? 'animate-spin' : ''}`}
              />
              {isAutoSync ? 'Live' : 'Manual'}
            </button>
            {!isAutoSync && (
              <button
                onClick={onManualSync}
                className="px-1.5 sm:px-2 py-0.5 sm:py-1 rounded text-[9px] sm:text-[10px] font-bold uppercase tracking-tighter bg-indigo-600 text-white hover:bg-indigo-500 transition-colors"
              >
                Sync
              </button>
            )}
          </div>

          <button
            onClick={onResetViewer}
            className="p-1 sm:p-1.5 text-zinc-400 hover:text-indigo-400 hover:bg-zinc-800 rounded-md transition-colors"
            title="Hard Reset Viewer"
          >
            <RefreshCw className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
          </button>

          <div className="w-px h-4 bg-zinc-800 mx-0.5 sm:mx-1 hidden sm:block"></div>

          <button
            onClick={onToggleTerminal}
            className={`hidden md:flex items-center gap-1.5 sm:gap-2 px-1.5 sm:px-3 py-1 sm:py-1.5 text-xs sm:text-sm font-medium transition-colors rounded-md ${
              isTerminalVisible
                ? 'bg-indigo-600/20 text-indigo-400 border border-indigo-500/30'
                : 'text-zinc-300 hover:text-white'
            }`}
            title="Toggle Terminal In Code View"
          >
            <Terminal className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
            <span className="hidden sm:inline">Terminal</span>
          </button>

          <button
            onClick={onOpenPackageManager}
            className="hidden md:flex items-center gap-1.5 sm:gap-2 px-1.5 sm:px-3 py-1 sm:py-1.5 text-xs sm:text-sm font-medium text-zinc-300 hover:text-white transition-colors"
            title="Manage NPM Packages"
          >
            <Package className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
            <span className="hidden sm:inline">Packages</span>
          </button>

          <button
            onClick={onOpenGitHub}
            disabled={!hasFiles}
            className="hidden md:flex items-center gap-1.5 sm:gap-2 px-1.5 sm:px-3 py-1 sm:py-1.5 text-xs sm:text-sm font-medium text-zinc-300 hover:text-white transition-colors disabled:opacity-50"
            title="Push to GitHub"
          >
            <Github className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
            <span className="hidden sm:inline">GitHub</span>
          </button>

          <button
            onClick={onOpenDatabase}
            className="hidden md:flex items-center gap-1.5 sm:gap-2 px-1.5 sm:px-3 py-1 sm:py-1.5 text-xs sm:text-sm font-medium text-zinc-300 hover:text-white transition-colors"
            title="Setup Database Provider"
          >
            <Database className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
            <span className="hidden sm:inline">Database</span>
          </button>

          <button
            onClick={onSave}
            className="hidden md:flex items-center gap-1.5 sm:gap-2 px-1.5 sm:px-3 py-1 sm:py-1.5 text-xs sm:text-sm font-medium text-zinc-300 hover:text-white transition-colors"
            title="Save current history state"
          >
            <Save className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
            <span className="hidden sm:inline">Save</span>
          </button>

          <button
            onClick={onExportZip}
            disabled={!hasFiles}
            className="hidden md:flex items-center gap-1.5 sm:gap-2 px-2 sm:px-3 py-1 sm:py-1.5 text-xs sm:text-sm bg-indigo-600 text-white hover:bg-indigo-500 rounded-md transition-colors disabled:opacity-50"
            title="Export project"
          >
            <Download className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
            <span className="hidden sm:inline">Export</span>
          </button>
        </div>
      </div>

      <div className="md:hidden px-2 pb-2 overflow-x-auto">
        <div className="flex items-center gap-2 min-w-max">
          {mobileActions.map(({ icon: Icon, label, onClick, disabled }) => (
            <button
              key={label}
              onClick={onClick}
              disabled={disabled}
              className="flex items-center gap-2 rounded-md border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-xs font-medium text-zinc-300 disabled:opacity-40"
              title={label}
            >
              <Icon className="w-3.5 h-3.5" />
              <span>{label}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
