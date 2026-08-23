const TAB_LABELS = {
  dashboard: 'Dashboard',
  solo_chat: 'Solo Chat & Notes',
  calendar: 'Calendar & Schedule',
  ai_agent: 'AI Copilot',
  meetings: 'Meetings & Video',
  documents: 'Documents',
  projects: 'Tasks & Kanban',
  code: 'Code Repositories',
  channels: 'Channels',
  settings: 'Settings',
  finance: 'Finance Tracker',
  files: 'File Manager',
  reports: 'Report Synthesizer',
};

export function getTabLabel(tab, workspaceType) {
  if (tab === 'dashboard') {
    return workspaceType === 'personal' ? 'Personal Dashboard' : 'Team Dashboard';
  }
  return TAB_LABELS[tab] || tab.replace(/_/g, ' ');
}

export const SOLO_NAV = [
  { id: 'dashboard', label: 'Dashboard', icon: 'Bot' },
  { id: 'solo_chat', label: 'Solo Chat', icon: 'MessageSquare' },
  { id: 'calendar', label: 'Calendar', icon: 'Calendar' },
  { id: 'ai_agent', label: 'AI Copilot', icon: 'Sparkles' },
  { id: 'meetings', label: 'Meetings', icon: 'Video' },
  { id: 'documents', label: 'Documents', icon: 'FileText' },
  { id: 'projects', label: 'Tasks', icon: 'FolderKanban' },
  { id: 'finance', label: 'Finance', icon: 'DollarSign' },
  { id: 'files', label: 'Files', icon: 'FolderOpen' },
  { id: 'reports', label: 'Reports', icon: 'FileBarChart' },
  { id: 'settings', label: 'Settings', icon: 'Settings' },
];

export const GROUP_NAV = [
  { id: 'dashboard', label: 'Dashboard', icon: 'Bot' },
  { id: 'ai_agent', label: 'AI Copilot', icon: 'Sparkles' },
  { id: 'meetings', label: 'Meetings', icon: 'Video' },
  { id: 'channels', label: 'Channels', icon: 'MessageSquare' },
  { id: 'calendar', label: 'Calendar', icon: 'Calendar' },
  { id: 'documents', label: 'Documents', icon: 'FileText' },
  { id: 'projects', label: 'Sprint Board', icon: 'FolderKanban' },
  { id: 'code', label: 'Code Repos', icon: 'Code2' },
  { id: 'finance', label: 'Finance', icon: 'DollarSign' },
  { id: 'files', label: 'Files', icon: 'FolderOpen' },
  { id: 'reports', label: 'Reports', icon: 'FileBarChart' },
  { id: 'settings', label: 'Settings', icon: 'Settings' },
];
