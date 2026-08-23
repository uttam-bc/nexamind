const API_BASE = '';

export function getAuthToken() {
  return localStorage.getItem('nexamind_token') || '';
}

export function setAuthToken(token) {
  if (token) {
    localStorage.setItem('nexamind_token', token);
  } else {
    localStorage.removeItem('nexamind_token');
  }
}

export function getSavedWorkspaceId() {
  return localStorage.getItem('nexamind_workspace_id') || '';
}

export function setSavedWorkspaceId(id) {
  if (id) {
    localStorage.setItem('nexamind_workspace_id', id);
  } else {
    localStorage.removeItem('nexamind_workspace_id');
  }
}

async function request(path, options = {}) {
  const token = getAuthToken();
  const headers = {
    ...(options.headers || {}),
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  if (!(options.body instanceof FormData) && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }

  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
  });

  if (res.status === 204) {
    return null;
  }

  let data = {};
  try {
    data = await res.json();
  } catch {
    data = {};
  }

  if (!res.ok) {
    let errorMsg = 'Request failed';
    if (typeof data.detail === 'string') {
      errorMsg = data.detail;
    } else if (Array.isArray(data.detail)) {
      errorMsg = data.detail.map((d) => d.msg || JSON.stringify(d)).join(', ');
    } else if (data.message) {
      errorMsg = data.message;
    } else if (res.status === 401) {
      errorMsg = 'Session expired or not logged in. Please log in again.';
    } else if (res.status === 404) {
      errorMsg = 'Workspace or endpoint not found.';
    } else {
      errorMsg = `Request failed (HTTP ${res.status})`;
    }
    throw new Error(errorMsg);
  }
  return data;
}

export const api = {
  // Auth
  register: (name, email, password) =>
    request('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ name, email, password }),
    }),
  login: (email, password) =>
    request('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),
  getMe: () => request('/auth/me'),

  // Workspaces
  listWorkspaces: () => request('/workspaces'),
  createWorkspace: (name) =>
    request('/workspaces', {
      method: 'POST',
      body: JSON.stringify({ name }),
    }),
  updateWorkspace: (wsId, name) =>
    request(`/workspaces/${wsId}`, {
      method: 'PATCH',
      body: JSON.stringify({ name }),
    }),
  getWorkspaceMembers: (wsId) => request(`/workspaces/${wsId}/members`),
  regenerateJoinCode: (wsId) =>
    request(`/workspaces/${wsId}/regenerate-code`, {
      method: 'POST',
    }),
  joinWorkspace: (join_code) =>
    request('/workspaces/join', {
      method: 'POST',
      body: JSON.stringify({ join_code }),
    }),
  getWorkspace: (id) => request(`/workspaces/${id}`),

  // Documents
  listDocuments: (wsId) => request(`/workspaces/${wsId}/documents`),
  createDocument: (wsId, title, content) =>
    request(`/workspaces/${wsId}/documents`, {
      method: 'POST',
      body: JSON.stringify({ title, content }),
    }),
  getDocument: (wsId, docId) => request(`/workspaces/${wsId}/documents/${docId}`),
  updateDocument: (wsId, docId, data) =>
    request(`/workspaces/${wsId}/documents/${docId}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),
  deleteDocument: (wsId, docId) =>
    request(`/workspaces/${wsId}/documents/${docId}`, {
      method: 'DELETE',
    }),

  // Tasks (Kanban)
  listTasks: (wsId, status) =>
    request(`/workspaces/${wsId}/tasks${status ? `?status=${status}` : ''}`),
  createTask: (wsId, data) =>
    request(`/workspaces/${wsId}/tasks`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  updateTask: (wsId, taskId, data) =>
    request(`/workspaces/${wsId}/tasks/${taskId}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),
  deleteTask: (wsId, taskId) =>
    request(`/workspaces/${wsId}/tasks/${taskId}`, {
      method: 'DELETE',
    }),

  // Code Repos
  listRepos: (wsId) => request(`/workspaces/${wsId}/repos`),
  createRepo: (wsId, data) =>
    request(`/workspaces/${wsId}/repos`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  listCommits: (wsId, repoId) => request(`/workspaces/${wsId}/repos/${repoId}/commits`),
  createCommit: (wsId, repoId, data) =>
    request(`/workspaces/${wsId}/repos/${repoId}/commits`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  listIssues: (wsId, repoId) => request(`/workspaces/${wsId}/repos/${repoId}/issues`),
  createIssue: (wsId, repoId, data) =>
    request(`/workspaces/${wsId}/repos/${repoId}/issues`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  updateIssue: (wsId, repoId, issueId, data) =>
    request(`/workspaces/${wsId}/repos/${repoId}/issues/${issueId}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),

  // Channels
  listChannels: (wsId) => request(`/workspaces/${wsId}/channels`),
  createChannel: (wsId, data) =>
    request(`/workspaces/${wsId}/channels`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  listMessages: (wsId, channelId) =>
    request(`/workspaces/${wsId}/channels/${channelId}/messages`),
  postMessage: (wsId, channelId, content) =>
    request(`/workspaces/${wsId}/channels/${channelId}/messages`, {
      method: 'POST',
      body: JSON.stringify({ content }),
    }),

  // Files
  listFiles: (wsId) => request(`/workspaces/${wsId}/files`),
  uploadFile: (wsId, formData) =>
    request(`/workspaces/${wsId}/files`, {
      method: 'POST',
      body: formData,
    }),
  deleteFile: (wsId, fileId) =>
    request(`/workspaces/${wsId}/files/${fileId}`, {
      method: 'DELETE',
    }),

  // Finance
  listTransactions: (wsId) => request(`/workspaces/${wsId}/finance/transactions`),
  createTransaction: (wsId, data) =>
    request(`/workspaces/${wsId}/finance/transactions`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  getFinanceSummary: (wsId) => request(`/workspaces/${wsId}/finance/summary`),

  // Sessions / Meetings
  listSessions: (wsId) => request(`/workspaces/${wsId}/sessions`),
  createSession: (wsId, data) =>
    request(`/workspaces/${wsId}/sessions`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  updateSession: (wsId, sessionId, data) =>
    request(`/workspaces/${wsId}/sessions/${sessionId}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),
  uploadSession: (wsId, formData) =>
    request(`/workspaces/${wsId}/sessions/upload`, {
      method: 'POST',
      body: formData,
    }),
  generateSessionMom: (wsId, sessionId) =>
    request(`/workspaces/${wsId}/sessions/${sessionId}/mom`, {
      method: 'POST',
    }),
  deleteSession: (wsId, sessionId) =>
    request(`/workspaces/${wsId}/sessions/${sessionId}`, {
      method: 'DELETE',
    }),

  // Video Meetings
  startVideoRoom: (wsId, name) =>
    request(`/workspaces/${wsId}/video/rooms`, {
      method: 'POST',
      body: JSON.stringify({ name }),
    }),
  listVideoRooms: (wsId) => request(`/workspaces/${wsId}/video/rooms`),
  joinVideoRoom: (wsId, roomId) =>
    request(`/workspaces/${wsId}/video/rooms/${roomId}/join`, {
      method: 'POST',
    }),
  endVideoRoom: (wsId, roomId, notes) =>
    request(`/workspaces/${wsId}/video/rooms/${roomId}/end`, {
      method: 'POST',
      body: JSON.stringify({ notes }),
    }),

  // Reports
  listReports: (wsId) => request(`/workspaces/${wsId}/reports`),
  generateReport: (wsId, data) =>
    request(`/workspaces/${wsId}/reports/generate`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  getReport: (wsId, reportId) => request(`/workspaces/${wsId}/reports/${reportId}`),
  deleteReport: (wsId, reportId) =>
    request(`/workspaces/${wsId}/reports/${reportId}`, {
      method: 'DELETE',
    }),

  // AI Agent
  chatWithAgent: (wsId, prompt) =>
    request(`/workspaces/${wsId}/ai/chat`, {
      method: 'POST',
      body: JSON.stringify({ prompt }),
    }),

  // Calendar & Reminders
  listCalendarEvents: (wsId, eventType) =>
    request(`/workspaces/${wsId}/calendar/events${eventType ? `?event_type=${eventType}` : ''}`),
  createCalendarEvent: (wsId, data) =>
    request(`/workspaces/${wsId}/calendar/events`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  updateCalendarEvent: (wsId, eventId, data) =>
    request(`/workspaces/${wsId}/calendar/events/${eventId}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),
  deleteCalendarEvent: (wsId, eventId) =>
    request(`/workspaces/${wsId}/calendar/events/${eventId}`, {
      method: 'DELETE',
    }),
  detectReminders: (wsId) =>
    request(`/workspaces/${wsId}/calendar/detect-reminders`, {
      method: 'POST',
    }),
};
