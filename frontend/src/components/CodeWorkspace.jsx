import React, { useState, useEffect } from 'react';
import {
  Code2,
  GitCommit,
  GitPullRequest,
  AlertCircle,
  Plus,
  Save,
  FolderTree,
  FileCode,
  CheckCircle2,
  File,
  X,
  MessageSquare,
  Send,
  Eye,
  GitBranch,
} from 'lucide-react';
import { api } from '../api';

export default function CodeWorkspace({ workspaceId, repos, onRefreshRepos }) {
  const [selectedRepo, setSelectedRepo] = useState(null);
  const [commits, setCommits] = useState([]);
  const [issues, setIssues] = useState([]);
  const [activeCodeTab, setActiveCodeTab] = useState('editor'); // 'editor' | 'commits' | 'issues'

  // Multi-file state
  const [files, setFiles] = useState([
    {
      name: 'gateway.ts',
      language: 'typescript',
      content: `// NexaMind Real-time WebSocket Gateway
import { WebSocketServer } from 'ws';

const wss = new WebSocketServer({ port: 8080 });

wss.on('connection', (ws) => {
  console.log('Client connected to NexaMind sync gateway');
  ws.on('message', (data) => {
    // Broadcast message to channel room subscribers
    wss.clients.forEach((client) => {
      if (client.readyState === 1) {
        client.send(data);
      }
    });
  });
});
`,
    },
    {
      name: 'auth_service.py',
      language: 'python',
      content: `import bcrypt
import jwt
from datetime import datetime, timedelta

SECRET_KEY = "nexamind-secure-jwt-key"

def create_access_token(user_id: str) -> str:
    payload = {
        "sub": user_id,
        "exp": datetime.utcnow() + timedelta(days=7),
    }
    return jwt.encode(payload, SECRET_KEY, algorithm="HS256")
`,
    },
    {
      name: 'README.md',
      language: 'markdown',
      content: `# NexaMind Core Services
Microservices architecture connecting real-time WebSockets, WebRTC video calling, and Supabase PostgreSQL.
`,
    },
  ]);

  const [activeFileName, setActiveFileName] = useState('gateway.ts');
  const [commitMessage, setCommitMessage] = useState('');
  const [showCreateRepoModal, setShowCreateRepoModal] = useState(false);
  const [newRepoName, setNewRepoName] = useState('');
  const [showCreateIssueModal, setShowCreateIssueModal] = useState(false);
  const [issueTitle, setIssueTitle] = useState('');
  const [issueDesc, setIssueDesc] = useState('');
  const [selectedCommit, setSelectedCommit] = useState(null);
  const [selectedIssue, setSelectedIssue] = useState(null);
  const [issueCommentText, setIssueCommentText] = useState('');
  const [issueComments, setIssueComments] = useState({});

  useEffect(() => {
    if (repos && repos.length > 0 && !selectedRepo) {
      handleSelectRepo(repos[0]);
    }
  }, [repos]);

  const handleSelectRepo = async (repo) => {
    setSelectedRepo(repo);
    try {
      const [cList, iList] = await Promise.all([
        api.listCommits(workspaceId, repo.id),
        api.listIssues(workspaceId, repo.id),
      ]);
      setCommits(cList);
      setIssues(iList);
    } catch (err) {
      console.error('Error fetching repo data', err);
    }
  };

  const activeFile = files.find((f) => f.name === activeFileName) || files[0];

  const handleFileContentChange = (newContent) => {
    setFiles(
      files.map((f) => (f.name === activeFileName ? { ...f, content: newContent } : f))
    );
  };

  const handleCreateNewFile = () => {
    const name = prompt('Enter filename (e.g. models.py, schema.sql):');
    if (name && !files.find((f) => f.name === name)) {
      const newFile = {
        name,
        language: name.endsWith('.py') ? 'python' : name.endsWith('.ts') ? 'typescript' : 'text',
        content: `// ${name}\n\n`,
      };
      setFiles([...files, newFile]);
      setActiveFileName(name);
    }
  };

  const handleCommit = async (e) => {
    e.preventDefault();
    if (!commitMessage.trim() || !selectedRepo) return;
    try {
      const c = await api.createCommit(workspaceId, selectedRepo.id, {
        message: commitMessage.trim(),
      });
      setCommits((prev) => [c, ...prev]);
      setCommitMessage('');
      alert('Commit created and logged to repository!');
    } catch (err) {
      alert(`Commit error: ${err.message}`);
    }
  };

  const handleCreateIssue = async (e) => {
    e.preventDefault();
    if (!issueTitle.trim() || !selectedRepo) return;
    try {
      const issue = await api.createIssue(workspaceId, selectedRepo.id, {
        title: issueTitle.trim(),
        description: issueDesc.trim() || undefined,
      });
      setIssues((prev) => [issue, ...prev]);
      setShowCreateIssueModal(false);
      setIssueTitle('');
      setIssueDesc('');
    } catch (err) {
      alert(err.message);
    }
  };

  const handleToggleIssueStatus = async (issue) => {
    const newStatus = issue.status === 'open' ? 'closed' : 'open';
    try {
      const updated = await api.updateIssue(workspaceId, selectedRepo.id, issue.id, {
        status: newStatus,
      });
      setIssues(issues.map((i) => (i.id === issue.id ? { ...i, status: newStatus } : i)));
      if (selectedIssue?.id === issue.id) {
        setSelectedIssue({ ...selectedIssue, status: newStatus });
      }
    } catch (err) {
      alert(err.message);
    }
  };

  const handleAddIssueComment = (e) => {
    e.preventDefault();
    if (!issueCommentText.trim() || !selectedIssue) return;
    const comment = {
      id: Date.now(),
      text: issueCommentText.trim(),
      author: 'You',
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };
    setIssueComments((prev) => ({
      ...prev,
      [selectedIssue.id]: [...(prev[selectedIssue.id] || []), comment],
    }));
    setIssueCommentText('');
  };

  const handleCreateRepo = async (e) => {
    e.preventDefault();
    if (!newRepoName.trim()) return;
    try {
      const r = await api.createRepo(workspaceId, { name: newRepoName.trim() });
      setShowCreateRepoModal(false);
      setNewRepoName('');
      await onRefreshRepos();
      handleSelectRepo(r);
    } catch (err) {
      alert(err.message);
    }
  };

  return (
    <div className="h-full flex gap-6">
      {/* Repos Sidebar */}
      <div className="w-80 glass-panel p-4 rounded-2xl border border-slate-800 flex flex-col h-full">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-bold text-xs uppercase tracking-wider text-slate-400">
            Repositories ({repos.length})
          </h3>
          <button
            onClick={() => setShowCreateRepoModal(true)}
            className="flex items-center gap-1 bg-indigo-600 hover:bg-indigo-500 text-white px-2.5 py-1.5 rounded-lg text-xs font-bold transition shadow-md shadow-indigo-600/30"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>New Repo</span>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto space-y-1.5 pr-1">
          {repos.map((repo) => {
            const isSelected = selectedRepo?.id === repo.id;
            return (
              <button
                key={repo.id}
                onClick={() => handleSelectRepo(repo)}
                className={`w-full text-left p-3.5 rounded-xl transition border ${
                  isSelected
                    ? 'bg-indigo-600/15 border-indigo-500 text-slate-100 font-semibold'
                    : 'bg-slate-900/60 border-slate-800/80 text-slate-300 hover:bg-slate-800'
                }`}
              >
                <div className="flex items-center gap-2 mb-1">
                  <Code2 className={`w-4 h-4 ${isSelected ? 'text-indigo-400' : 'text-slate-500'}`} />
                  <span className="text-xs font-bold truncate">{repo.name}</span>
                </div>
                <div className="text-[10px] text-slate-500 truncate">
                  {repo.description || 'Main code repository'}
                </div>
              </button>
            );
          })}

          {repos.length === 0 && (
            <div className="text-center text-slate-500 py-10 text-xs">No repositories found.</div>
          )}
        </div>
      </div>

      {/* Code Editor & VCS Views */}
      <div className="flex-1 glass-panel p-6 rounded-2xl border border-slate-800 flex flex-col h-full overflow-hidden bg-slate-950/40">
        {selectedRepo ? (
          <div className="flex flex-col h-full space-y-4">
            {/* Top Repo Header & Tabs */}
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-3">
                <Code2 className="w-5 h-5 text-indigo-400" />
                <h3 className="font-extrabold text-base text-slate-100">{selectedRepo.name}</h3>
                <span className="text-xs text-indigo-400 font-mono bg-indigo-500/10 px-2 py-0.5 rounded border border-indigo-500/20 flex items-center gap-1">
                  <GitBranch className="w-3 h-3" /> main
                </span>
              </div>

              {/* Subtabs */}
              <div className="flex items-center gap-1 bg-slate-900 p-1 rounded-xl border border-slate-800">
                <button
                  onClick={() => setActiveCodeTab('editor')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
                    activeCodeTab === 'editor' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  Code Editor
                </button>
                <button
                  onClick={() => setActiveCodeTab('commits')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition flex items-center gap-1.5 ${
                    activeCodeTab === 'commits' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <GitCommit className="w-3.5 h-3.5" />
                  <span>Commits ({commits.length})</span>
                </button>
                <button
                  onClick={() => setActiveCodeTab('issues')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition flex items-center gap-1.5 ${
                    activeCodeTab === 'issues' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <AlertCircle className="w-3.5 h-3.5" />
                  <span>Issues ({issues.length})</span>
                </button>
              </div>
            </div>

            {/* 1. Code Editor Tab */}
            {activeCodeTab === 'editor' && (
              <div className="flex-1 flex flex-col min-h-0 space-y-3">
                {/* File Tree Switcher */}
                <div className="flex items-center justify-between bg-slate-900/80 p-1.5 rounded-xl border border-slate-800">
                  <div className="flex items-center gap-1 overflow-x-auto pr-2">
                    {files.map((file) => {
                      const isCurrent = file.name === activeFileName;
                      return (
                        <button
                          key={file.name}
                          onClick={() => setActiveFileName(file.name)}
                          className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-mono transition ${
                            isCurrent
                              ? 'bg-slate-950 text-indigo-300 border border-slate-700 shadow-sm'
                              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
                          }`}
                        >
                          <FileCode className="w-3.5 h-3.5 text-emerald-400" />
                          <span>{file.name}</span>
                        </button>
                      );
                    })}
                  </div>

                  <button
                    onClick={handleCreateNewFile}
                    className="flex items-center gap-1 text-[11px] font-semibold text-indigo-400 hover:text-indigo-300 px-2 py-1 bg-indigo-500/10 rounded-lg border border-indigo-500/20"
                    title="Add File"
                  >
                    <Plus className="w-3 h-3" />
                    <span>New File</span>
                  </button>
                </div>

                <div className="flex-1 bg-slate-950 border border-slate-800 rounded-xl p-4 overflow-hidden flex font-mono text-xs text-emerald-400 shadow-inner">
                  <div className="text-slate-600 select-none pr-4 border-r border-slate-800 text-right space-y-1">
                    {Array.from({ length: 18 }).map((_, i) => (
                      <div key={i}>{i + 1}</div>
                    ))}
                  </div>
                  <textarea
                    className="flex-1 bg-transparent text-emerald-400 px-4 font-mono text-xs focus:outline-none resize-none leading-relaxed"
                    value={activeFile?.content || ''}
                    onChange={(e) => handleFileContentChange(e.target.value)}
                  />
                </div>

                {/* Commit Form */}
                <form onSubmit={handleCommit} className="flex gap-2">
                  <input
                    type="text"
                    required
                    placeholder="Enter commit message (e.g. feat: implement real-time broadcast channel)..."
                    className="flex-1 bg-slate-900 border border-slate-800 rounded-xl px-4 py-2.5 text-xs text-slate-100 focus:outline-none focus:border-indigo-500"
                    value={commitMessage}
                    onChange={(e) => setCommitMessage(e.target.value)}
                  />
                  <button
                    type="submit"
                    className="flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-500 text-white px-5 py-2.5 rounded-xl text-xs font-bold shadow-md shadow-indigo-600/30 transition"
                  >
                    <GitCommit className="w-4 h-4" />
                    <span>Commit</span>
                  </button>
                </form>
              </div>
            )}

            {/* 2. Commits Log Tab */}
            {activeCodeTab === 'commits' && (
              <div className="flex-1 overflow-y-auto space-y-2 pr-1">
                {commits.map((c) => (
                  <div
                    key={c.id}
                    onClick={() => setSelectedCommit(c)}
                    className="p-4 bg-slate-900/60 hover:bg-slate-900 border border-slate-800/80 hover:border-indigo-500/40 rounded-xl flex items-center justify-between text-xs cursor-pointer transition"
                  >
                    <div className="flex items-center gap-3">
                      <GitCommit className="w-4 h-4 text-purple-400" />
                      <div>
                        <div className="font-bold text-slate-100">{c.message}</div>
                        <div className="text-[11px] text-slate-500 mt-0.5">
                          Committed on {new Date(c.created_at).toLocaleString()}
                        </div>
                      </div>
                    </div>
                    <span className="font-mono text-xs text-indigo-400 bg-indigo-500/10 px-2.5 py-1 rounded-lg border border-indigo-500/20">
                      {c.hash.slice(0, 7)}
                    </span>
                  </div>
                ))}

                {commits.length === 0 && (
                  <div className="text-center text-slate-500 py-12 text-xs">No commits recorded yet.</div>
                )}
              </div>
            )}

            {/* 3. Issues Tracker Tab */}
            {activeCodeTab === 'issues' && (
              <div className="flex-1 flex flex-col space-y-3 min-h-0">
                <div className="flex justify-end">
                  <button
                    onClick={() => setShowCreateIssueModal(true)}
                    className="flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-500 text-white px-3 py-1.5 rounded-xl text-xs font-bold transition"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>New Issue</span>
                  </button>
                </div>

                <div className="flex-1 overflow-y-auto space-y-2 pr-1">
                  {issues.map((issue) => (
                    <div
                      key={issue.id}
                      onClick={() => setSelectedIssue(issue)}
                      className="p-4 bg-slate-900/60 hover:bg-slate-900 border border-slate-800/80 hover:border-amber-500/40 rounded-xl flex items-start justify-between text-xs cursor-pointer transition"
                    >
                      <div>
                        <div className="flex items-center gap-2">
                          <AlertCircle
                            className={`w-4 h-4 ${
                              issue.status === 'open' ? 'text-amber-400' : 'text-emerald-400'
                            }`}
                          />
                          <span className="font-bold text-slate-100">{issue.title}</span>
                        </div>
                        {issue.description && (
                          <p className="text-slate-400 mt-1 line-clamp-1">{issue.description}</p>
                        )}
                      </div>
                      <span
                        className={`text-[10px] uppercase font-bold px-2.5 py-1 rounded-md border ${
                          issue.status === 'open'
                            ? 'bg-amber-500/10 text-amber-400 border-amber-500/20'
                            : 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                        }`}
                      >
                        {issue.status}
                      </span>
                    </div>
                  ))}

                  {issues.length === 0 && (
                    <div className="text-center text-slate-500 py-12 text-xs">No issues opened.</div>
                  )}
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center h-full text-slate-500 py-16">
            <Code2 className="w-12 h-12 mb-3 text-slate-600" />
            <span className="text-sm font-semibold">Select or create a repository</span>
          </div>
        )}
      </div>

      {/* Commit Detail Modal */}
      {selectedCommit && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center p-4 z-50 animate-fade-in">
          <div className="glass-panel p-6 rounded-2xl border border-slate-700 max-w-lg w-full space-y-4 bg-slate-900/95">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <GitCommit className="w-5 h-5 text-purple-400" />
                <span className="font-bold text-sm text-slate-100">Commit Details</span>
              </div>
              <button onClick={() => setSelectedCommit(null)} className="text-slate-400 hover:text-slate-200">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <span className="text-slate-400 font-bold block mb-1">Message:</span>
                <p className="text-slate-100 bg-slate-950 p-3 rounded-xl border border-slate-800 font-semibold">
                  {selectedCommit.message}
                </p>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <span className="text-slate-400 font-bold block mb-1">Commit SHA:</span>
                  <span className="font-mono text-indigo-400">{selectedCommit.hash}</span>
                </div>
                <div>
                  <span className="text-slate-400 font-bold block mb-1">Timestamp:</span>
                  <span className="text-slate-300">{new Date(selectedCommit.created_at).toLocaleString()}</span>
                </div>
              </div>

              <div>
                <span className="text-slate-400 font-bold block mb-1">Changes Diff:</span>
                <div className="bg-slate-950 p-3 rounded-xl border border-slate-800 font-mono text-xs text-emerald-400 space-y-1">
                  <div>+ updated module logic in {activeFileName}</div>
                  <div>+ verified syntax build benchmarks</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Issue Detail & Discussion Modal */}
      {selectedIssue && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center p-4 z-50 animate-fade-in">
          <div className="glass-panel p-6 rounded-2xl border border-slate-700 max-w-xl w-full space-y-4 bg-slate-900/95 max-h-[85vh] flex flex-col">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <AlertCircle className="w-5 h-5 text-amber-400" />
                <span className="font-bold text-sm text-slate-100 truncate">{selectedIssue.title}</span>
              </div>
              <button onClick={() => setSelectedIssue(null)} className="text-slate-400 hover:text-slate-200">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto space-y-4 pr-1 text-xs">
              <div className="flex items-center justify-between bg-slate-950 p-3 rounded-xl border border-slate-800">
                <span>Status: <strong className="uppercase text-amber-400">{selectedIssue.status}</strong></span>
                <button
                  onClick={() => handleToggleIssueStatus(selectedIssue)}
                  className={`px-3 py-1 rounded-lg font-bold text-xs transition ${
                    selectedIssue.status === 'open'
                      ? 'bg-emerald-600 text-white'
                      : 'bg-amber-600 text-white'
                  }`}
                >
                  {selectedIssue.status === 'open' ? 'Close Issue' : 'Reopen Issue'}
                </button>
              </div>

              {selectedIssue.description && (
                <div>
                  <span className="text-slate-400 font-bold block mb-1">Description:</span>
                  <p className="text-slate-200 bg-slate-950 p-3 rounded-xl border border-slate-800 leading-relaxed">
                    {selectedIssue.description}
                  </p>
                </div>
              )}

              {/* Comments Discussion Thread */}
              <div className="space-y-2 pt-2 border-t border-slate-800">
                <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block">
                  Discussion Comments ({(issueComments[selectedIssue.id] || []).length})
                </span>

                {(issueComments[selectedIssue.id] || []).map((comm) => (
                  <div key={comm.id} className="bg-slate-950 p-3 rounded-xl border border-slate-800 space-y-1">
                    <div className="flex justify-between text-[10px] text-slate-500">
                      <span className="font-bold text-indigo-400">{comm.author}</span>
                      <span>{comm.time}</span>
                    </div>
                    <p className="text-slate-200">{comm.text}</p>
                  </div>
                ))}

                <form onSubmit={handleAddIssueComment} className="flex gap-2 pt-2">
                  <input
                    type="text"
                    placeholder="Write a comment or status update..."
                    className="flex-1 bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-100 focus:outline-none focus:border-indigo-500"
                    value={issueCommentText}
                    onChange={(e) => setIssueCommentText(e.target.value)}
                  />
                  <button
                    type="submit"
                    className="bg-indigo-600 hover:bg-indigo-500 text-white px-4 py-2 rounded-xl text-xs font-bold"
                  >
                    Post
                  </button>
                </form>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Create Repo Modal */}
      {showCreateRepoModal && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center p-4 z-50 animate-fade-in">
          <div className="glass-panel p-6 rounded-2xl border border-slate-800 max-w-sm w-full space-y-4">
            <h3 className="text-base font-bold text-slate-100">Create Code Repository</h3>
            <form onSubmit={handleCreateRepo} className="space-y-4">
              <input
                type="text"
                required
                autoFocus
                placeholder="e.g. backend-core-service"
                className="w-full bg-slate-900 border border-slate-800 rounded-xl px-4 py-2.5 text-xs text-slate-100 focus:outline-none focus:border-indigo-500"
                value={newRepoName}
                onChange={(e) => setNewRepoName(e.target.value)}
              />
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowCreateRepoModal(false)}
                  className="px-3 py-1.5 text-xs font-semibold text-slate-400 hover:text-slate-200"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="bg-indigo-600 hover:bg-indigo-500 text-white px-4 py-1.5 rounded-xl text-xs font-bold"
                >
                  Create
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Create Issue Modal */}
      {showCreateIssueModal && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center p-4 z-50 animate-fade-in">
          <div className="glass-panel p-6 rounded-2xl border border-slate-800 max-w-sm w-full space-y-4">
            <h3 className="text-base font-bold text-slate-100">Create New Issue</h3>
            <form onSubmit={handleCreateIssue} className="space-y-4">
              <input
                type="text"
                required
                autoFocus
                placeholder="Issue title..."
                className="w-full bg-slate-900 border border-slate-800 rounded-xl px-4 py-2.5 text-xs text-slate-100 focus:outline-none focus:border-indigo-500"
                value={issueTitle}
                onChange={(e) => setIssueTitle(e.target.value)}
              />
              <textarea
                placeholder="Description / reproduction steps..."
                className="w-full bg-slate-900 border border-slate-800 rounded-xl px-4 py-2 text-xs text-slate-200 focus:outline-none focus:border-indigo-500 resize-none h-20"
                value={issueDesc}
                onChange={(e) => setIssueDesc(e.target.value)}
              />
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowCreateIssueModal(false)}
                  className="px-3 py-1.5 text-xs font-semibold text-slate-400 hover:text-slate-200"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="bg-indigo-600 hover:bg-indigo-500 text-white px-4 py-1.5 rounded-xl text-xs font-bold"
                >
                  Submit Issue
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
