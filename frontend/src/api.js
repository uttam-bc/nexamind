// Empty in development (Vite proxies API paths); set VITE_API_URL when the API is on another origin.
const API_BASE = (import.meta.env.VITE_API_URL || '').replace(/\/+$/, '');

// Opens an authenticated WebSocket. The token goes in the first frame, never in the URL.
export function openSocket(path) {
  const url = new URL(path, API_BASE || window.location.origin);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  const ws = new WebSocket(url.toString());
  ws.addEventListener('open', () => {
    ws.send(JSON.stringify({ type: 'auth', token: getAuthToken() }));
  });
  return ws;
}

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

// Multipart upload with progress and cancel (fetch can't report upload progress). Same auth and
// errors as request(). Returns { promise, abort }; an aborted upload rejects with err.aborted = true.
export function startUpload(path, formData, onProgress) {
  const xhr = new XMLHttpRequest();
  const promise = new Promise((resolve, reject) => {
    xhr.onabort = () => reject(Object.assign(new Error('Upload cancelled'), { aborted: true }));
    xhr.open('POST', `${API_BASE}${path}`);
    const token = getAuthToken();
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress?.(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onerror = () => reject(new Error('Upload interrupted. Check your connection and try again.'));
    xhr.onload = () => {
      let data = {};
      try {
        data = JSON.parse(xhr.responseText || '{}');
      } catch {
        data = {};
      }
      if (xhr.status === 401 && token) window.dispatchEvent(new CustomEvent('nexamind:unauthorized'));
      if (xhr.status >= 200 && xhr.status < 300) resolve(data);
      else reject(Object.assign(new Error(typeof data.detail === 'string' ? data.detail : `Upload failed (HTTP ${xhr.status})`), { status: xhr.status, data }));
    };
    xhr.send(formData);
  });
  return { promise, abort: () => xhr.abort() };
}

function uploadWithProgress(path, formData, onProgress) {
  return startUpload(path, formData, onProgress).promise;
}

// Query string without empty values.
function qs(params) {
  return new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '')).toString();
}

const encodePath = (value) => value.split('/').map(encodeURIComponent).join('/');

// Fetch a protected file as a Blob with a type we choose (never rendered as HTML). Errors carry the
// server's explanation, e.g. "You don't have access to this file…".
async function fetchProtectedBlob(path, type) {
  const res = await fetch(`${API_BASE}${path}`, { headers: { Authorization: `Bearer ${getAuthToken()}` } });
  if (!res.ok) {
    let detail = '';
    try {
      detail = (await res.json()).detail;
    } catch {
      detail = '';
    }
    throw Object.assign(new Error(typeof detail === 'string' && detail ? detail : `Could not open the file (HTTP ${res.status})`), { status: res.status });
  }
  return new Blob([await res.arrayBuffer()], type ? { type } : undefined);
}

function saveBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename || 'download';
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Identical GETs issued at the same moment (React StrictMode double effects, two components
// loading the same list) share one network request.
const inFlightGets = new Map();

function request(path, options = {}) {
  const method = (options.method || 'GET').toUpperCase();
  if (method !== 'GET') return sendRequest(path, options);
  const key = `${getAuthToken() || ''} ${path}`;
  if (inFlightGets.has(key)) return inFlightGets.get(key);
  const promise = sendRequest(path, options).finally(() => inFlightGets.delete(key));
  inFlightGets.set(key, promise);
  return promise;
}

async function sendRequest(path, options = {}) {
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

  if (res.status === 401 && token) {
    // Token expired or revoked: let the app return to the login screen.
    window.dispatchEvent(new CustomEvent('nexamind:unauthorized'));
  }

  if (!res.ok) {
    let errorMsg = 'Request failed';
    if (typeof data.detail === 'string') {
      errorMsg = data.detail;
    } else if (Array.isArray(data.detail)) {
      errorMsg = data.detail
        .map((d) => (d.msg || JSON.stringify(d)).replace(/^Value error, /, ''))
        .join(', ');
    } else if (data.message) {
      errorMsg = data.message;
    } else if (res.status === 401) {
      errorMsg = 'Session expired or not logged in. Please log in again.';
    } else if (res.status === 429) {
      errorMsg = 'Too many requests. Please wait a moment and try again.';
    } else if (res.status === 404) {
      errorMsg = 'Workspace or endpoint not found.';
    } else {
      errorMsg = `Request failed (HTTP ${res.status})`;
    }
    throw Object.assign(new Error(errorMsg), { status: res.status, data });
  }
  return data;
}

export const api = {
  // Auth
  register: (name, email, password, username, otp) =>
    request('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ name, email, password, username: username || undefined, otp: otp || undefined }),
    }),
  sendOtp: (email, purpose = 'register') =>
    request('/auth/send-otp', {
      method: 'POST',
      body: JSON.stringify({ email, purpose }),
    }),
  verifyOtp: (email, otp, purpose = 'register') =>
    request('/auth/verify-otp', {
      method: 'POST',
      body: JSON.stringify({ email, otp, purpose }),
    }),
  loginWithGoogle: (credential) =>
    request('/auth/google', {
      method: 'POST',
      body: JSON.stringify({ credential }),
    }),
  getGoogleConfig: () => request('/auth/google/config'),
  login: (email, password) =>
    request('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),
  getMe: () => request('/auth/me'),
  updateMe: (data) => request('/auth/me', { method: 'PATCH', body: JSON.stringify(data) }),
  deleteAccount: (password) => request('/auth/me', { method: 'DELETE', body: JSON.stringify({ password }) }),
  // Revokes every token for this account on the server, not just the local copy.
  logout: () => request('/auth/logout', { method: 'POST' }),
  // Fire-and-forget revocation for a token that is no longer stored locally. `keepalive` lets
  // the request finish even if the page navigates or closes right after signing out.
  revokeToken: (token) =>
    fetch(`${API_BASE}/auth/logout`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      keepalive: true,
    }).catch(() => {}),
  changePassword: (currentPassword, newPassword) =>
    request('/auth/change-password', {
      method: 'POST',
      body: JSON.stringify({ current_password: currentPassword, new_password: newPassword }),
    }),
  resetPassword: (email, otp, newPassword) =>
    request('/auth/reset-password', {
      method: 'POST',
      body: JSON.stringify({ email, otp, new_password: newPassword }),
    }),
  searchUsers: (query = '') => request(`/auth/users/search?q=${encodeURIComponent(query)}`),

  // Public contact form (stored server-side, forwarded by e-mail when configured)
  sendContactMessage: ({ name, email, subject, message, website }) =>
    request('/contact', {
      method: 'POST',
      body: JSON.stringify({ name, email, subject: subject || undefined, message, website: website || undefined }),
    }),

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
  leaveWorkspace: (wsId) => request(`/workspaces/${wsId}/leave`, { method: 'POST' }),
  removeWorkspaceMember: (wsId, userId) => request(`/workspaces/${wsId}/members/${userId}`, { method: 'DELETE' }),
  updateMemberRole: (wsId, userId, role) =>
    request(`/workspaces/${wsId}/members/${userId}`, { method: 'PATCH', body: JSON.stringify({ role }) }),
  deleteWorkspace: (wsId, confirmName) =>
    request(`/workspaces/${wsId}`, { method: 'DELETE', body: JSON.stringify({ confirm_name: confirmName }) }),
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
  searchDocuments: (wsId, query) =>
    request(`/workspaces/${wsId}/documents/search?q=${encodeURIComponent(query || '')}`),
  getDocumentTree: (wsId) => request(`/workspaces/${wsId}/documents/tree`),
  createDocument: (wsId, title, content, parentId = null, icon = '📄') =>
    request(`/workspaces/${wsId}/documents`, {
      method: 'POST',
      body: JSON.stringify({ title, content, parent_id: parentId, icon }),
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

  // Git repositories (real Git storage: every change is a commit)
  listRepos: (wsId) => request(`/workspaces/${wsId}/repos`),
  repoTemplates: (wsId) => request(`/workspaces/${wsId}/repo-templates`),
  repoActivity: (wsId, limit = 20) => request(`/workspaces/${wsId}/repo-activity?limit=${limit}`),
  createRepo: (wsId, data) => request(`/workspaces/${wsId}/repos`, { method: 'POST', body: JSON.stringify(data) }),
  importRepo: (wsId, data) => request(`/workspaces/${wsId}/repos/import`, { method: 'POST', body: JSON.stringify(data) }),
  startRepoUpload: (wsId) => request(`/workspaces/${wsId}/repo-uploads`, { method: 'POST' }),
  uploadRepoFiles: (wsId, uploadId, entries, onProgress) => {
    const form = new FormData();
    entries.forEach(({ file, path }) => {
      form.append('files', file, file.name);
      form.append('paths', path);
    });
    return startUpload(`/workspaces/${wsId}/repo-uploads/${uploadId}/files`, form, onProgress);
  },
  discardRepoUpload: (wsId, uploadId) => request(`/workspaces/${wsId}/repo-uploads/${uploadId}`, { method: 'DELETE' }),
  getRepo: (wsId, repoId) => request(`/workspaces/${wsId}/repos/${repoId}`),
  updateRepo: (wsId, repoId, data) => request(`/workspaces/${wsId}/repos/${repoId}`, { method: 'PATCH', body: JSON.stringify(data) }),
  deleteRepo: (wsId, repoId, confirmName) =>
    request(`/workspaces/${wsId}/repos/${repoId}`, { method: 'DELETE', body: JSON.stringify({ confirm_name: confirmName }) }),
  repoEvents: (wsId, repoId) => request(`/workspaces/${wsId}/repos/${repoId}/activity`),
  repoTree: (wsId, repoId, ref, path = '') => request(`/workspaces/${wsId}/repos/${repoId}/tree?${qs({ ref, path })}`),
  repoBlob: (wsId, repoId, ref, path) => request(`/workspaces/${wsId}/repos/${repoId}/blob?${qs({ ref, path })}`),
  downloadRepoFile: async (wsId, repoId, ref, path) =>
    saveBlob(await fetchProtectedBlob(`/workspaces/${wsId}/repos/${repoId}/raw?${qs({ ref, path })}`, 'application/octet-stream'), path.split('/').pop()),
  downloadRepoArchive: async (wsId, repoId, ref, filename) =>
    saveBlob(await fetchProtectedBlob(`/workspaces/${wsId}/repos/${repoId}/archive?${qs({ ref })}`, 'application/zip'), filename),
  fetchRepoRaw: (wsId, repoId, ref, path, type) => fetchProtectedBlob(`/workspaces/${wsId}/repos/${repoId}/raw?${qs({ ref, path })}`, type),
  searchRepo: (wsId, repoId, q, ref) => request(`/workspaces/${wsId}/repos/${repoId}/search?${qs({ q, ref })}`),
  repoCommits: (wsId, repoId, { ref = '', path = '', page = 1 } = {}) =>
    request(`/workspaces/${wsId}/repos/${repoId}/commits?${qs({ ref, path, page })}`),
  repoCommit: (wsId, repoId, sha) => request(`/workspaces/${wsId}/repos/${repoId}/commits/${sha}`),
  commitChanges: (wsId, repoId, data) =>
    request(`/workspaces/${wsId}/repos/${repoId}/commits`, { method: 'POST', body: JSON.stringify(data) }),
  compareRefs: (wsId, repoId, base, head) => request(`/workspaces/${wsId}/repos/${repoId}/compare?${qs({ base, head })}`),
  repoBranches: (wsId, repoId) => request(`/workspaces/${wsId}/repos/${repoId}/branches`),
  createBranch: (wsId, repoId, data) =>
    request(`/workspaces/${wsId}/repos/${repoId}/branches`, { method: 'POST', body: JSON.stringify(data) }),
  deleteBranch: (wsId, repoId, name) =>
    request(`/workspaces/${wsId}/repos/${repoId}/branches/${encodePath(name)}`, { method: 'DELETE' }),
  repoTags: (wsId, repoId) => request(`/workspaces/${wsId}/repos/${repoId}/tags`),
  createTag: (wsId, repoId, data) => request(`/workspaces/${wsId}/repos/${repoId}/tags`, { method: 'POST', body: JSON.stringify(data) }),
  repoCollaborators: (wsId, repoId) => request(`/workspaces/${wsId}/repos/${repoId}/collaborators`),
  setCollaborator: (wsId, repoId, userId, role) =>
    request(`/workspaces/${wsId}/repos/${repoId}/collaborators`, { method: 'PUT', body: JSON.stringify({ user_id: userId, role }) }),
  removeCollaborator: (wsId, repoId, userId) =>
    request(`/workspaces/${wsId}/repos/${repoId}/collaborators/${userId}`, { method: 'DELETE' }),
  branchRules: (wsId, repoId) => request(`/workspaces/${wsId}/repos/${repoId}/branch-rules`),
  setBranchRule: (wsId, repoId, branch, requiredApprovals) =>
    request(`/workspaces/${wsId}/repos/${repoId}/branch-rules`, {
      method: 'PUT', body: JSON.stringify({ branch, required_approvals: requiredApprovals }),
    }),
  deleteBranchRule: (wsId, repoId, branch) =>
    request(`/workspaces/${wsId}/repos/${repoId}/branch-rules/${encodePath(branch)}`, { method: 'DELETE' }),
  listIssues: (wsId, repoId, params = {}) => request(`/workspaces/${wsId}/repos/${repoId}/issues?${qs(params)}`),
  getIssue: (wsId, repoId, number) => request(`/workspaces/${wsId}/repos/${repoId}/issues/${number}`),
  createIssue: (wsId, repoId, data) =>
    request(`/workspaces/${wsId}/repos/${repoId}/issues`, { method: 'POST', body: JSON.stringify(data) }),
  updateIssue: (wsId, repoId, number, data) =>
    request(`/workspaces/${wsId}/repos/${repoId}/issues/${number}`, { method: 'PATCH', body: JSON.stringify(data) }),
  commentIssue: (wsId, repoId, number, body) =>
    request(`/workspaces/${wsId}/repos/${repoId}/issues/${number}/comments`, { method: 'POST', body: JSON.stringify({ body }) }),
  linkIssueTask: (wsId, repoId, number, taskId = null) =>
    request(`/workspaces/${wsId}/repos/${repoId}/issues/${number}/task`, { method: 'PUT', body: JSON.stringify({ task_id: taskId }) }),
  unlinkIssueTask: (wsId, repoId, number) =>
    request(`/workspaces/${wsId}/repos/${repoId}/issues/${number}/task`, { method: 'DELETE' }),
  issueFromActionItem: (wsId, repoId, actionItemId) =>
    request(`/workspaces/${wsId}/repos/${repoId}/issues/from-action-item`, {
      method: 'POST', body: JSON.stringify({ action_item_id: actionItemId }),
    }),
  listPulls: (wsId, repoId, state = 'open', page = 1) => request(`/workspaces/${wsId}/repos/${repoId}/pulls?${qs({ state, page })}`),
  getPull: (wsId, repoId, number) => request(`/workspaces/${wsId}/repos/${repoId}/pulls/${number}`),
  createPull: (wsId, repoId, data) =>
    request(`/workspaces/${wsId}/repos/${repoId}/pulls`, { method: 'POST', body: JSON.stringify(data) }),
  updatePull: (wsId, repoId, number, data) =>
    request(`/workspaces/${wsId}/repos/${repoId}/pulls/${number}`, { method: 'PATCH', body: JSON.stringify(data) }),
  pullFiles: (wsId, repoId, number) => request(`/workspaces/${wsId}/repos/${repoId}/pulls/${number}/files`),
  pullCommits: (wsId, repoId, number) => request(`/workspaces/${wsId}/repos/${repoId}/pulls/${number}/commits`),
  commentPull: (wsId, repoId, number, data) =>
    request(`/workspaces/${wsId}/repos/${repoId}/pulls/${number}/comments`, { method: 'POST', body: JSON.stringify(data) }),
  reviewPull: (wsId, repoId, number, data) =>
    request(`/workspaces/${wsId}/repos/${repoId}/pulls/${number}/reviews`, { method: 'POST', body: JSON.stringify(data) }),
  mergePull: (wsId, repoId, number, data) =>
    request(`/workspaces/${wsId}/repos/${repoId}/pulls/${number}/merge`, { method: 'POST', body: JSON.stringify(data) }),
  listGitTokens: () => request('/auth/git-tokens'),
  createGitToken: (data) => request('/auth/git-tokens', { method: 'POST', body: JSON.stringify(data) }),
  revokeGitToken: (id) => request(`/auth/git-tokens/${id}`, { method: 'DELETE' }),

  // Channels (Teams-Style)
  listChannels: (wsId) => request(`/workspaces/${wsId}/channels`),
  getChannelUnreads: (wsId) => request(`/workspaces/${wsId}/channels/unread`),
  createChannel: (wsId, data) =>
    request(`/workspaces/${wsId}/channels`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  createOrOpenDm: (wsId, targetUsername) =>
    request(`/workspaces/${wsId}/channels/dm`, {
      method: 'POST',
      body: JSON.stringify({ target_username: targetUsername }),
    }),
  listMessages: (wsId, channelId, parentId = null, rootOnly = false, { before, limit } = {}) => {
    let url = `/workspaces/${wsId}/channels/${channelId}/messages?`;
    if (parentId) url += `parent_id=${parentId}&`;
    if (rootOnly) url += `root_only=true&`;
    if (before) url += `before=${encodeURIComponent(before)}&`;
    if (limit) url += `limit=${limit}&`;
    return request(url);
  },
  postMessage: (wsId, channelId, data) => {
    const payload = typeof data === 'string' ? { content: data } : data;
    return request(`/workspaces/${wsId}/channels/${channelId}/messages`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },
  editMessage: (wsId, channelId, messageId, content) =>
    request(`/workspaces/${wsId}/channels/${channelId}/messages/${messageId}`, {
      method: 'PATCH',
      body: JSON.stringify({ content }),
    }),
  deleteMessage: (wsId, channelId, messageId) =>
    request(`/workspaces/${wsId}/channels/${channelId}/messages/${messageId}`, { method: 'DELETE' }),
  deleteChannel: (wsId, channelId) => request(`/workspaces/${wsId}/channels/${channelId}`, { method: 'DELETE' }),
  toggleReaction: (wsId, channelId, messageId, emoji) =>
    request(`/workspaces/${wsId}/channels/${channelId}/messages/${messageId}/reactions`, {
      method: 'POST',
      body: JSON.stringify({ emoji }),
    }),
  markChannelRead: (wsId, channelId) =>
    request(`/workspaces/${wsId}/channels/${channelId}/read`, {
      method: 'POST',
    }),

  // Presence (Teams-Style)
  getWorkspacePresence: (wsId) => request(`/ws/workspaces/${wsId}/presence`),


  // Files
  listFiles: (wsId) => request(`/workspaces/${wsId}/files`),
  // Word/PDF/Markdown/text files are converted to document text on the server.
  importDocument: (wsId, file, parentId = null, onProgress = null) => {
    const formData = new FormData();
    formData.append('file', file);
    if (parentId) formData.append('parent_id', parentId);
    return onProgress
      ? uploadWithProgress(`/workspaces/${wsId}/documents/import`, formData, onProgress)
      : request(`/workspaces/${wsId}/documents/import`, { method: 'POST', body: formData });
  },
  uploadFile: (wsId, formData, onProgress = null) =>
    onProgress
      ? uploadWithProgress(`/workspaces/${wsId}/files`, formData, onProgress)
      : request(`/workspaces/${wsId}/files`, { method: 'POST', body: formData }),
  downloadFile: async (wsId, fileId, filename) => {
    const res = await fetch(`${API_BASE}/workspaces/${wsId}/files/${fileId}/download`, {
      headers: { Authorization: `Bearer ${getAuthToken()}` },
    });
    if (!res.ok) throw new Error(`Download failed (HTTP ${res.status})`);
    const url = URL.createObjectURL(await res.blob());
    const link = document.createElement('a');
    link.href = url;
    link.download = filename || 'download';
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  },
  getFilePreview: (wsId, fileId) => request(`/workspaces/${wsId}/files/${fileId}/preview`),
  // Chat attachments. `base` is a conversation: /workspaces/{w}/channels/{c} or /workspaces/{w}/meetings/{m}.
  uploadChatAttachment: (base, file, clientUploadId, onProgress) => {
    const form = new FormData();
    form.append('file', file);
    if (clientUploadId) form.append('client_upload_id', clientUploadId);
    return startUpload(`${base}/attachments`, form, onProgress);
  },
  fetchAttachmentBlob: (base, attachmentId, type) => fetchProtectedBlob(`${base}/attachments/${attachmentId}/download`, type),
  downloadAttachment: async (base, attachmentId, filename) =>
    saveBlob(await fetchProtectedBlob(`${base}/attachments/${attachmentId}/download`), filename),
  // The raw bytes as a Blob with a type we choose, so the browser never treats an upload as HTML.
  fetchFileBlob: async (wsId, fileId, type) => {
    const res = await fetch(`${API_BASE}/workspaces/${wsId}/files/${fileId}/download`, {
      headers: { Authorization: `Bearer ${getAuthToken()}` },
    });
    if (!res.ok) throw new Error(`Could not load the file (HTTP ${res.status})`);
    return new Blob([await res.arrayBuffer()], { type });
  },
  fileToDocument: (wsId, fileId) => request(`/workspaces/${wsId}/files/${fileId}/to-document`, { method: 'POST' }),
  // The page as it is now, as Word (.docx) or Markdown.
  exportDocument: async (wsId, docId, format = 'docx', title = 'document') => {
    const res = await fetch(`${API_BASE}/workspaces/${wsId}/documents/${docId}/export?format=${format}`, {
      headers: { Authorization: `Bearer ${getAuthToken()}` },
    });
    if (!res.ok) throw new Error(`Download failed (HTTP ${res.status})`);
    const url = URL.createObjectURL(await res.blob());
    const link = document.createElement('a');
    link.href = url;
    link.download = `${(title || 'document').replace(/[\\/:*?"<>|]+/g, '_')}.${format}`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  },
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
  deleteTransaction: (wsId, txId) =>
    request(`/workspaces/${wsId}/finance/transactions/${txId}`, {
      method: 'DELETE',
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
  uploadSessionFile: (wsId, file, title) => {
    const formData = new FormData();
    formData.append('file', file);
    if (title) formData.append('title', title);
    return request(`/workspaces/${wsId}/sessions/upload`, { method: 'POST', body: formData });
  },
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

  // Meetings (scheduled and instant video meetings)
  listMeetings: (wsId, scope = 'upcoming') => request(`/workspaces/${wsId}/meetings?scope=${scope}`),
  getMeeting: (wsId, meetingId) => request(`/workspaces/${wsId}/meetings/${meetingId}`),
  // Calls from a direct message: a live meeting of the conversation that rings the other person.
  getLiveCall: (wsId, channelId) => request(`/workspaces/${wsId}/channels/${channelId}/call`),
  startCall: (wsId, channelId, clientRequestId) =>
    request(`/workspaces/${wsId}/channels/${channelId}/call`, { method: 'POST', body: JSON.stringify({ client_request_id: clientRequestId }) }),
  declineCall: (wsId, meetingId) => request(`/workspaces/${wsId}/meetings/${meetingId}/decline`, { method: 'POST' }),
  scheduleMeeting: (wsId, data) =>
    request(`/workspaces/${wsId}/meetings`, { method: 'POST', body: JSON.stringify(data) }),
  startInstantMeeting: (wsId, data) =>
    request(`/workspaces/${wsId}/meetings/instant`, { method: 'POST', body: JSON.stringify(data) }),
  updateMeeting: (wsId, meetingId, data) =>
    request(`/workspaces/${wsId}/meetings/${meetingId}`, { method: 'PATCH', body: JSON.stringify(data) }),
  cancelMeeting: (wsId, meetingId) =>
    request(`/workspaces/${wsId}/meetings/${meetingId}/cancel`, { method: 'POST' }),
  endMeeting: (wsId, meetingId, scope) =>
    request(`/workspaces/${wsId}/meetings/${meetingId}/end`, { method: 'POST', body: JSON.stringify({ scope }) }),
  getMeetingMessages: (wsId, meetingId) => request(`/workspaces/${wsId}/meetings/${meetingId}/messages`),
  getIceServers: (wsId) => request(`/workspaces/${wsId}/video/ice-servers`),
  getMeetingTranscript: (wsId, meetingId) => request(`/workspaces/${wsId}/meetings/${meetingId}/transcript`),
  uploadTranscriptChunk: (wsId, meetingId, formData) =>
    request(`/workspaces/${wsId}/meetings/${meetingId}/transcript/chunks`, { method: 'POST', body: formData }),
  addTranscriptSegment: (wsId, meetingId, data) =>
    request(`/workspaces/${wsId}/meetings/${meetingId}/transcript/segments`, { method: 'POST', body: JSON.stringify(data) }),
  reportTranscriptGap: (wsId, meetingId, data) =>
    request(`/workspaces/${wsId}/meetings/${meetingId}/transcript/gaps`, { method: 'POST', body: JSON.stringify(data) }),

  // Minutes of meeting (review, edit, approve)
  getMom: (wsId, sessionId) => request(`/workspaces/${wsId}/sessions/${sessionId}/mom`),
  regenerateMom: (wsId, sessionId) =>
    request(`/workspaces/${wsId}/sessions/${sessionId}/mom/generate`, { method: 'POST' }),
  editMom: (wsId, sessionId, markdown) =>
    request(`/workspaces/${wsId}/sessions/${sessionId}/mom`, { method: 'PATCH', body: JSON.stringify({ markdown }) }),
  addMomActionItem: (wsId, sessionId, data) =>
    request(`/workspaces/${wsId}/sessions/${sessionId}/mom/action-items`, { method: 'POST', body: JSON.stringify(data) }),
  updateMomActionItem: (wsId, sessionId, itemId, data) =>
    request(`/workspaces/${wsId}/sessions/${sessionId}/mom/action-items/${itemId}`, { method: 'PATCH', body: JSON.stringify(data) }),
  approveMom: (wsId, sessionId, itemIds) =>
    request(`/workspaces/${wsId}/sessions/${sessionId}/mom/approve`, { method: 'POST', body: JSON.stringify({ item_ids: itemIds }) }),

  // Notifications
  listNotifications: (params = {}) => {
    const q = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== ''));
    return request(`/notifications${q.toString() ? `?${q}` : ''}`);
  },
  markNotificationsRead: (ids) => request('/notifications/read', { method: 'POST', body: JSON.stringify({ ids }) }),
  markAllNotificationsRead: () => request('/notifications/read-all', { method: 'POST' }),
  dismissNotification: (id) => request(`/notifications/${id}`, { method: 'DELETE' }),
  getNotificationPrefs: () => request('/notifications/preferences'),
  setNotificationPrefs: (prefs) => request('/notifications/preferences', { method: 'PUT', body: JSON.stringify(prefs) }),

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

  // AI Agent & Long-Term Memory
  chatWithAgent: (wsId, prompt, sessionId = null) =>
    request(`/workspaces/${wsId}/ai/chat`, {
      method: 'POST',
      body: JSON.stringify({ prompt, session_id: sessionId || undefined }),
    }),
  listAiSessions: (wsId) => request(`/workspaces/${wsId}/ai/sessions`),
  createAiSession: (wsId) =>
    request(`/workspaces/${wsId}/ai/sessions`, {
      method: 'POST',
    }),
  getAiSessionMessages: (wsId, sessionId) =>
    request(`/workspaces/${wsId}/ai/sessions/${sessionId}`),
  deleteAiSession: (wsId, sessionId) =>
    request(`/workspaces/${wsId}/ai/sessions/${sessionId}`, {
      method: 'DELETE',
    }),
  getMemoryStats: (wsId) => request(`/workspaces/${wsId}/ai/memory/stats`),
  reindexMemory: (wsId) =>
    request(`/workspaces/${wsId}/ai/memory/reindex`, {
      method: 'POST',
    }),
  getAiConfig: () => request('/ai/config'),
  saveGeminiKey: (apiKey) =>
    request('/ai/config/gemini-key', {
      method: 'PUT',
      body: JSON.stringify({ api_key: apiKey }),
    }),
  deleteGeminiKey: () => request('/ai/config/gemini-key', { method: 'DELETE' }),
  // Tests the given key, or the key the server would use for this user when omitted.
  testGeminiKey: (apiKey) =>
    request('/ai/config/test-gemini', {
      method: 'POST',
      body: JSON.stringify({ api_key: apiKey || null }),
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
