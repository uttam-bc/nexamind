import React, { useState } from 'react';
import {
  Bot,
  Calendar,
  Code2,
  DollarSign,
  FileBarChart,
  FileText,
  FolderKanban,
  FolderOpen,
  Home,
  LogOut,
  Menu,
  MessageSquare,
  Settings,
  Sparkles,
  Video,
  X,
} from 'lucide-react';
import { GROUP_NAV, SOLO_NAV } from '../lib/navigation';
import ThemeToggle from './ui/ThemeToggle';

const ICONS = { Bot, Home, Calendar, Code2, DollarSign, FileBarChart, FileText, FolderKanban, FolderOpen, MessageSquare, Settings, Sparkles, Video };

// Phone navigation (below the md breakpoint, where the activity rail and sidebar are hidden):
// a bottom tab bar for the most-used screens and a "More" sheet with everything else.
export default function MobileNav({ activeTab, onTabChange, currentWorkspace, workspaces = [], onSelectWorkspace, onLogout }) {
  const [open, setOpen] = useState(false);
  const isSolo = currentWorkspace?.type === 'personal';
  // Files lives inside Docs.
  const items = (isSolo ? SOLO_NAV : GROUP_NAV).filter((item) => item.id !== 'files');
  const isActiveTab = (id) => activeTab === id || (id === 'documents' && activeTab === 'files');
  const primaryIds = ['dashboard', 'documents', isSolo ? 'solo_chat' : 'channels', 'projects'];
  const primary = primaryIds.map((id) => items.find((item) => item.id === id)).filter(Boolean);

  const go = (id) => {
    onTabChange(id);
    setOpen(false);
  };

  return (
    <>
      <nav
        aria-label="Primary"
        className="md:hidden fixed bottom-0 inset-x-0 z-40 bg-white/90 backdrop-blur-md border-t border-slate-200 flex justify-around px-1 pb-[env(safe-area-inset-bottom)]"
      >
        {primary.map((item) => {
          const Icon = ICONS[item.icon] || FileText;
          const active = isActiveTab(item.id);
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => go(item.id)}
              aria-current={active ? 'page' : undefined}
              className={`flex-1 flex flex-col items-center gap-0.5 py-2 text-xs font-semibold ${active ? 'text-indigo-700' : 'text-slate-600'}`}
            >
              <Icon className="w-5 h-5" aria-hidden="true" />
              <span>{item.label}</span>
            </button>
          );
        })}
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-expanded={open}
          aria-haspopup="dialog"
          className={`flex-1 flex flex-col items-center gap-0.5 py-2 text-xs font-semibold ${
            primary.some((p) => isActiveTab(p.id)) ? 'text-slate-600' : 'text-indigo-700'
          }`}
        >
          <Menu className="w-5 h-5" aria-hidden="true" />
          <span>More</span>
        </button>
      </nav>

      {open && (
        <div className="md:hidden fixed inset-0 z-50 bg-slate-950/50 flex items-end" onClick={() => setOpen(false)}>
          <div
            data-modal
            className="w-full max-h-[85vh] overflow-y-auto bg-white rounded-t-3xl p-4 space-y-4 animate-slide-up"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h2 className="text-base font-bold text-slate-900">All sections</h2>
              <div className="flex items-center gap-1">
                {/* The header has no room for the theme switch on phones, so it lives here. */}
                <ThemeToggle />
                <button type="button" onClick={() => setOpen(false)} aria-label="Close menu" className="p-2 rounded-xl hover:bg-slate-100">
                  <X className="w-5 h-5" aria-hidden="true" />
                </button>
              </div>
            </div>

            <ul className="grid grid-cols-2 gap-2">
              {items.map((item) => {
                const Icon = ICONS[item.icon] || FileText;
                const active = isActiveTab(item.id);
                return (
                  <li key={item.id}>
                    <button
                      type="button"
                      onClick={() => go(item.id)}
                      aria-current={active ? 'page' : undefined}
                      className={`w-full flex items-center gap-2 px-3 py-3 rounded-xl text-sm font-semibold border ${
                        active ? 'bg-indigo-50 border-indigo-200 text-indigo-800' : 'border-slate-200 text-slate-700'
                      }`}
                    >
                      <Icon className="w-4 h-4" aria-hidden="true" />
                      <span>{item.label}</span>
                    </button>
                  </li>
                );
              })}
            </ul>

            {workspaces.length > 1 && (
              <div className="space-y-2">
                <label htmlFor="mobile-workspace" className="text-xs font-bold text-slate-600">
                  Workspace
                </label>
                <select
                  id="mobile-workspace"
                  value={currentWorkspace?.id || ''}
                  onChange={(e) => {
                    onSelectWorkspace(e.target.value);
                    setOpen(false);
                  }}
                  className="w-full border border-slate-300 rounded-xl px-3 py-2.5 text-sm"
                >
                  {workspaces.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.name}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <button
              type="button"
              onClick={() => {
                setOpen(false);
                onLogout();
              }}
              className="w-full flex items-center justify-center gap-2 px-3 py-3 rounded-xl text-sm font-semibold text-rose-700 border border-rose-200 hover:bg-rose-50"
            >
              <LogOut className="w-4 h-4" aria-hidden="true" />
              <span>Sign out</span>
            </button>
          </div>
        </div>
      )}
    </>
  );
}
