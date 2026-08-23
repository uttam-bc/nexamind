import React, { useState, useEffect } from 'react';
import {
  Search,
  FileText,
  FolderKanban,
  Video,
  MessageSquare,
  FileBarChart,
  Code2,
  FolderOpen,
  DollarSign,
  Play,
  ArrowRight,
  X,
} from 'lucide-react';

export default function CommandPalette({
  isOpen,
  onClose,
  documents,
  tasks,
  sessions,
  channels,
  repos,
  reports,
  onNavigate,
}) {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);

  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setSelectedIndex(0);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const items = [];

  items.push(
    { id: 'action-video', category: 'Actions', title: 'Start Live Video Call', icon: Play, action: () => { onNavigate('meetings'); onClose(); } },
    { id: 'action-doc', category: 'Actions', title: 'Create New Document', icon: FileText, action: () => { onNavigate('documents'); onClose(); } },
    { id: 'action-task', category: 'Actions', title: 'Add Kanban Task', icon: FolderKanban, action: () => { onNavigate('projects'); onClose(); } },
    { id: 'action-ai', category: 'Actions', title: 'Open AI Copilot', icon: MessageSquare, action: () => { onNavigate('ai_agent'); onClose(); } },
    { id: 'action-finance', category: 'Actions', title: 'Finance Tracker', icon: DollarSign, action: () => { onNavigate('finance'); onClose(); } },
    { id: 'action-files', category: 'Actions', title: 'File Manager', icon: FolderOpen, action: () => { onNavigate('files'); onClose(); } },
  );

  (documents || []).forEach((d) => {
    items.push({ id: `doc-${d.id}`, category: 'Documents', title: d.title, subtitle: 'Document', icon: FileText, action: () => { onNavigate('documents'); onClose(); } });
  });
  (tasks || []).forEach((t) => {
    items.push({ id: `task-${t.id}`, category: 'Tasks', title: t.title, subtitle: `${t.status?.replace('_', ' ')} • ${t.priority || 'medium'}`, icon: FolderKanban, action: () => { onNavigate('projects'); onClose(); } });
  });
  (sessions || []).forEach((s) => {
    items.push({ id: `session-${s.id}`, category: 'Meetings', title: s.title, subtitle: `${s.action_items?.length || 0} action items`, icon: Video, action: () => { onNavigate('meetings'); onClose(); } });
  });
  (channels || []).forEach((c) => {
    items.push({ id: `channel-${c.id}`, category: 'Channels', title: `#${c.name}`, subtitle: 'Channel', icon: MessageSquare, action: () => { onNavigate('channels'); onClose(); } });
  });
  (repos || []).forEach((r) => {
    items.push({ id: `repo-${r.id}`, category: 'Code', title: r.name, subtitle: 'Repository', icon: Code2, action: () => { onNavigate('code'); onClose(); } });
  });
  (reports || []).forEach((r) => {
    items.push({ id: `report-${r.id}`, category: 'Reports', title: r.title, subtitle: r.report_type, icon: FileBarChart, action: () => { onNavigate('reports'); onClose(); } });
  });

  const filteredItems = items.filter((item) => {
    const q = query.toLowerCase();
    return item.title.toLowerCase().includes(q) || (item.subtitle && item.subtitle.toLowerCase().includes(q)) || item.category.toLowerCase().includes(q);
  });

  const handleKeyDown = (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((prev) => (prev + 1 < filteredItems.length ? prev + 1 : prev));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((prev) => (prev > 0 ? prev - 1 : 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (filteredItems[selectedIndex]) filteredItems[selectedIndex].action();
    } else if (e.key === 'Escape') {
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 bg-black/75 backdrop-blur-sm z-50 flex items-start justify-center pt-[15vh] p-4 animate-fade-in" onClick={onClose}>
      <div className="glass-panel w-full max-w-xl rounded-2xl border border-slate-700/80 shadow-2xl overflow-hidden flex flex-col max-h-[min(520px,70vh)] animate-slide-up" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center px-4 py-3.5 border-b border-slate-800/80 gap-3">
          <Search className="w-5 h-5 text-indigo-400 flex-shrink-0" />
          <input
            type="text"
            autoFocus
            placeholder="Search tasks, documents, meetings, channels..."
            className="flex-1 bg-transparent text-sm text-slate-100 placeholder-slate-500 focus:outline-none"
            value={query}
            onChange={(e) => { setQuery(e.target.value); setSelectedIndex(0); }}
            onKeyDown={handleKeyDown}
          />
          <kbd className="hidden sm:inline text-[10px] font-mono px-2 py-0.5 text-slate-500 bg-slate-800 rounded border border-slate-700">ESC</kbd>
          <button onClick={onClose} className="btn-ghost p-1"><X className="w-4 h-4" /></button>
        </div>
        <div className="flex-1 overflow-y-auto p-2 space-y-0.5">
          {filteredItems.map((item, idx) => {
            const Icon = item.icon;
            const isSelected = idx === selectedIndex;
            return (
              <button
                key={item.id}
                onClick={item.action}
                onMouseEnter={() => setSelectedIndex(idx)}
                className={`w-full flex items-center justify-between p-3 rounded-xl text-left transition ${
                  isSelected ? 'bg-indigo-600/15 border border-indigo-500/30 text-slate-100' : 'text-slate-300 hover:bg-slate-800/50 border border-transparent'
                }`}
              >
                <div className="flex items-center gap-3 truncate">
                  <div className={`p-2 rounded-lg ${isSelected ? 'bg-indigo-600 text-white' : 'bg-slate-800 text-slate-400'}`}>
                    <Icon className="w-4 h-4" />
                  </div>
                  <div className="truncate">
                    <div className="text-sm font-semibold truncate">{item.title}</div>
                    {item.subtitle && <div className="text-xs text-slate-500 truncate">{item.subtitle}</div>}
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <span className="text-[9px] uppercase tracking-wider font-bold px-2 py-0.5 rounded bg-slate-800 text-slate-500">{item.category}</span>
                  <ArrowRight className="w-3.5 h-3.5 text-slate-600" />
                </div>
              </button>
            );
          })}
          {filteredItems.length === 0 && (
            <div className="text-center text-slate-500 py-12 text-sm">No results for &ldquo;{query}&rdquo;</div>
          )}
        </div>
      </div>
    </div>
  );
}
