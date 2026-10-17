const API_BASE_URL =
  process.env.EXPO_PUBLIC_API_URL ||
  (typeof window !== 'undefined' && window.location ? window.location.origin : 'http://127.0.0.1:8000');

let authToken = '';

export const setAuthToken = (token) => {
  authToken = token;
};

export const getAuthToken = () => authToken;

async function request(path, options = {}) {
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {}),
  };

  if (authToken) {
    headers['Authorization'] = `Bearer ${authToken}`;
  }

  const res = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers,
  });

  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.detail || 'Request failed');
  }
  return data;
}

export const mobileApi = {
  login: (email, password) =>
    request('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),
  register: (name, email, password) =>
    request('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ name, email, password }),
    }),
  getMe: () => request('/auth/me'),
  listWorkspaces: () => request('/workspaces'),
  getWorkspace: (id) => request(`/workspaces/${id}`),
  listTasks: (wsId) => request(`/workspaces/${wsId}/tasks`),
  createTask: (wsId, title) =>
    request(`/workspaces/${wsId}/tasks`, {
      method: 'POST',
      body: JSON.stringify({ title, status: 'todo' }),
    }),
  listSessions: (wsId) => request(`/workspaces/${wsId}/sessions`),
  getFinanceSummary: (wsId) => request(`/workspaces/${wsId}/finance/summary`),
  listDocuments: (wsId) => request(`/workspaces/${wsId}/documents`),
  listChannels: (wsId) => request(`/workspaces/${wsId}/channels`),
  listMessages: (wsId, channelId) => request(`/workspaces/${wsId}/channels/${channelId}/messages`),
  chatWithAgent: (wsId, prompt) =>
    request(`/workspaces/${wsId}/ai/chat`, {
      method: 'POST',
      body: JSON.stringify({ prompt }),
    }),
};
