import React, { useState, useEffect, useRef } from 'react';
import {
  FileText,
  Plus,
  Trash2,
  Save,
  CheckCircle2,
  Heading,
  List,
  ListOrdered,
  CheckSquare,
  Code,
  Search,
  Sparkles,
  Download,
  Copy,
  Check,
  Quote,
  Upload,
  Eye,
  Edit3,
  Columns,
  Maximize2,
  Minimize2,
  BookOpen,
  ChevronRight,
  ChevronDown,
  Smile,
  Minus,
  Table,
  FolderTree,
  CornerDownRight,
  AlertCircle,
  Lightbulb,
} from 'lucide-react';
import { api } from '../api';

const EMOJI_PICKER_OPTIONS = [
  '📄', '📝', '💡', '🚀', '🛠️', '📌', '🎯', '📊',
  '📚', '⚙️', '🧠', '⚡', '💬', '🔒', '🏷️', '🎨',
  '🔬', '📈', '💻', '🌐', '📦', '🧩', '🏆', '🔥'
];

const DOCUMENT_TEMPLATES = [
  {
    title: 'Product Requirement Document (PRD)',
    icon: '🚀',
    description: 'Executive overview, target personas, user stories, and acceptance criteria.',
    content: `# Product Requirement Document (PRD)

> 💡 **Vision:** Build a unified collaborative operating system merging knowledge and instant communication.

## 1. Executive Summary
Briefly describe the product vision, primary problem solved, and expected business impact.

## 2. Target Audience & User Personas
- **Primary Persona:** Software Engineers & Tech Leads
- **Secondary Persona:** Engineering Managers & Product Owners

## 3. Core Features & Functional Requirements
1. **Real-Time Collaboration:** Synchronized workspace state.
2. **AI-Driven Automation:** Automated meeting minutes and task detection.
3. **Enterprise Security:** Row-level security and workspace isolation.

## 4. Key Milestones
- [x] Initial reverse engineering of Notion and Teams
- [ ] Implement nested hierarchical document tree
- [ ] Connect Teams threaded discussion rail
- [ ] Deploy v2.0 release candidate

---

## 5. Technical Architecture
\`\`\`ts
interface WorkspaceState {
  documents: DocumentNode[];
  channels: ChannelThread[];
  collaborators: PresenceState[];
}
\`\`\`
`,
  },
  {
    title: 'System Architecture Spec (RFC)',
    icon: '🛠️',
    description: 'Detailed system architecture, data models, API endpoints, and sequence flows.',
    content: `# System Architecture Specification (RFC)

> 💡 **Scope:** Microservices and real-time state orchestration for hybrid knowledge hubs.

## 1. Context & Motivation
Explain the architectural rationale and key design trade-offs.

## 2. Proposed Architecture
\`\`\`
[ Client App ] ─── (REST / WS) ───> [ FastAPI Gateway ] ───> [ PostgreSQL / SQLite ]
                                           │
                                           └───> [ Groq / Gemini AI Engine ]
\`\`\`

## 3. Data Schema & Entities
- **Workspaces:** Scopes data isolation across teams.
- **Documents:** Hierarchical nested specifications with parent-child references.
- **Channels & Threads:** Slack/Teams messaging with root messages, replies, and reactions.

## 4. Verification Checklist
- [x] Database migration 006 applied cleanly
- [ ] End-to-end WebSocket sync verified
- [ ] Real-time presence heartbeats tested
`,
  },
  {
    title: 'Sprint Kickoff & Meeting Notes',
    icon: '📝',
    description: 'Discussion agenda, key architectural decisions, and assigned action items.',
    content: `# Sprint Kickoff & Meeting Notes

**Date:** ${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}  
**Attendees:** Team Leads, Core Engineers, Product Lead  

> 💡 **Core Theme:** Unify Notion block documents with Microsoft Teams chat rails.

---

## 🎯 Sprint Goals
- Deliver end-to-end document nesting with breadcrumb navigation.
- Provide interactive markdown task checkboxes with instant live sync.
- Wire thread panel and emoji reactions in channels.

## 📋 Action Items
- [ ] Review document tree performance (@frontend)
- [ ] Test reaction toggling under load (@backend)
- [ ] Finalize deployment readiness check (@devops)
`,
  },
];

export default function Documents({ workspaceId, documents = [], onRefreshDocuments }) {
  const [selectedDoc, setSelectedDoc] = useState(null);
  const [docTitle, setDocTitle] = useState('');
  const [docContent, setDocContent] = useState('');
  const [docIcon, setDocIcon] = useState('📄');
  const [docParentId, setDocParentId] = useState(null);

  // Document Tree State (Hierarchical Notion-style)
  const [docTree, setDocTree] = useState([]);
  const [expandedNodes, setExpandedNodes] = useState({});
  const [searchResults, setSearchResults] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearching, setIsSearching] = useState(false);

  // UI Modals & Popovers
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showTemplatesModal, setShowTemplatesModal] = useState(false);
  const [createParentId, setCreateParentId] = useState(null);
  const [newDocTitle, setNewDocTitle] = useState('');
  const [newDocIcon, setNewDocIcon] = useState('📄');

  // Editor states
  const [editorMode, setEditorMode] = useState('split'); // 'edit' | 'preview' | 'split'
  const [isZenMode, setIsZenMode] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [lastSaved, setLastSaved] = useState(null);
  const [showSlashMenu, setShowSlashMenu] = useState(false);
  const [copiedCodeIdx, setCopiedCodeIdx] = useState(null);

  const fileInputRef = useRef(null);
  const textareaRef = useRef(null);

  // Load document tree whenever workspaceId or documents change
  useEffect(() => {
    if (workspaceId) {
      loadDocumentTree();
    }
  }, [workspaceId, documents]);

  // Keep selectedDoc synchronized with documents list
  useEffect(() => {
    if (documents && documents.length > 0) {
      if (!selectedDoc || !documents.some((d) => d.id === selectedDoc.id)) {
        handleSelectDoc(documents[0]);
      } else {
        // Update current doc's metadata in case title or icon changed
        const current = documents.find((d) => d.id === selectedDoc.id);
        if (current && (current.title !== docTitle || (current.icon || '📄') !== docIcon)) {
          setDocTitle(current.title || 'Untitled Document');
          setDocIcon(current.icon || '📄');
          setDocParentId(current.parent_id || null);
        }
      }
    } else {
      setSelectedDoc(null);
      setDocTitle('');
      setDocContent('');
      setDocIcon('📄');
      setDocParentId(null);
    }
  }, [documents]);

  const loadDocumentTree = async () => {
    try {
      const tree = await api.getDocumentTree(workspaceId);
      setDocTree(tree || []);
      // Expand root nodes by default
      if (tree && tree.length > 0) {
        setExpandedNodes((prev) => {
          const next = { ...prev };
          tree.forEach((node) => {
            if (next[node.id] === undefined) next[node.id] = true;
          });
          return next;
        });
      }
    } catch (err) {
      console.warn('Could not load document tree:', err);
    }
  };

  // Live full-text document search with backend
  useEffect(() => {
    if (!searchQuery.trim()) {
      setSearchResults(null);
      setIsSearching(false);
      return;
    }
    const timer = setTimeout(async () => {
      setIsSearching(true);
      try {
        const results = await api.searchDocuments(workspaceId, searchQuery.trim());
        setSearchResults(results || []);
      } catch (err) {
        console.warn('Search documents error:', err);
      } finally {
        setIsSearching(false);
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [searchQuery, workspaceId]);

  const parseDocContent = (content) => {
    if (!content) return '';
    if (typeof content === 'string') {
      try {
        const parsed = JSON.parse(content);
        if (parsed.text) return parsed.text;
        if (parsed.blocks && Array.isArray(parsed.blocks)) {
          return parsed.blocks
            .map((b) => {
              if (b.type === 'heading') return `## ${b.text}`;
              if (b.type === 'todo_item') return `- [${b.checked ? 'x' : ' '}] ${b.text}`;
              if (b.type === 'quote') return `> ${b.text}`;
              if (b.type === 'callout') return `> 💡 **Note:** ${b.text}`;
              if (b.type === 'code_block') return `\`\`\`\n${b.text}\n\`\`\``;
              return b.text || '';
            })
            .join('\n\n');
        }
        return content;
      } catch {
        return content;
      }
    }
    if (typeof content === 'object') {
      if (content.text) return content.text;
      if (content.blocks && Array.isArray(content.blocks)) {
        return content.blocks
          .map((b) => {
            if (b.type === 'heading') return `## ${b.text}`;
            if (b.type === 'todo_item') return `- [${b.checked ? 'x' : ' '}] ${b.text}`;
            if (b.type === 'quote') return `> ${b.text}`;
            if (b.type === 'callout') return `> 💡 **Note:** ${b.text}`;
            if (b.type === 'code_block') return `\`\`\`\n${b.text}\n\`\`\``;
            return b.text || '';
          })
          .join('\n\n');
      }
    }
    return '';
  };

  const handleSelectDoc = (doc) => {
    setSelectedDoc(doc);
    setDocTitle(doc.title || 'Untitled Document');
    setDocContent(parseDocContent(doc.content));
    setDocIcon(doc.icon || '📄');
    setDocParentId(doc.parent_id || null);
    setLastSaved(new Date());
    setShowEmojiPicker(false);
  };

  // Debounced auto-save to backend
  useEffect(() => {
    if (!selectedDoc) return;
    const timer = setTimeout(() => {
      handleSilentSave();
    }, 2500);
    return () => clearTimeout(timer);
  }, [docContent, docTitle, docIcon]);

  const handleSilentSave = async () => {
    if (!selectedDoc || !docTitle.trim()) return;
    try {
      await api.updateDocument(workspaceId, selectedDoc.id, {
        title: docTitle.trim(),
        content: { text: docContent },
        icon: docIcon,
      });
      setLastSaved(new Date());
      if (onRefreshDocuments) onRefreshDocuments();
    } catch (err) {
      // background silent save
    }
  };

  const handleSaveDoc = async () => {
    if (!selectedDoc) return;
    setIsSaving(true);
    try {
      await api.updateDocument(workspaceId, selectedDoc.id, {
        title: docTitle.trim() || 'Untitled Document',
        content: { text: docContent },
        icon: docIcon,
      });
      setLastSaved(new Date());
      if (onRefreshDocuments) await onRefreshDocuments();
      loadDocumentTree();
    } catch (err) {
      alert(`Save error: ${err.message}`);
    } finally {
      setIsSaving(false);
    }
  };

  const handleSelectEmoji = async (emoji) => {
    setDocIcon(emoji);
    setShowEmojiPicker(false);
    if (selectedDoc) {
      try {
        await api.updateDocument(workspaceId, selectedDoc.id, { icon: emoji });
        if (onRefreshDocuments) onRefreshDocuments();
        loadDocumentTree();
      } catch (err) {
        console.warn('Could not update icon:', err);
      }
    }
  };

  const handleCreateNewDoc = async (
    title = 'Untitled Document',
    initialContent = '',
    parentId = null,
    icon = '📄'
  ) => {
    try {
      const created = await api.createDocument(
        workspaceId,
        title.trim() || 'Untitled Document',
        { text: initialContent || `# ${title}\n\nStart writing your document here...` },
        parentId,
        icon
      );
      if (onRefreshDocuments) await onRefreshDocuments();
      await loadDocumentTree();
      handleSelectDoc(created);
      setShowCreateModal(false);
      setShowTemplatesModal(false);
      setNewDocTitle('');
      setCreateParentId(null);
    } catch (err) {
      alert(`Could not create document: ${err.message}`);
    }
  };

  // Interactive to-do checkbox toggle inside live preview
  const handleToggleCheckbox = (lineIndex) => {
    const lines = docContent.split('\n');
    if (lineIndex < 0 || lineIndex >= lines.length) return;
    const line = lines[lineIndex];

    if (line.includes('- [ ]')) {
      lines[lineIndex] = line.replace('- [ ]', '- [x]');
    } else if (line.includes('- [x]')) {
      lines[lineIndex] = line.replace('- [x]', '- [ ]');
    }
    const updated = lines.join('\n');
    setDocContent(updated);

    // Save immediately on checkbox toggle
    if (selectedDoc) {
      api.updateDocument(workspaceId, selectedDoc.id, {
        title: docTitle,
        content: { text: updated },
        icon: docIcon,
      }).catch((e) => console.warn('Toggle save failed', e));
    }
  };

  const insertFormatting = (prefix, suffix = '') => {
    if (!textareaRef.current) return;
    const start = textareaRef.current.selectionStart;
    const end = textareaRef.current.selectionEnd;
    const selected = docContent.substring(start, end);
    const replacement = `${prefix}${selected || 'text'}${suffix}`;
    const updated = docContent.substring(0, start) + replacement + docContent.substring(end);
    setDocContent(updated);

    setTimeout(() => {
      if (textareaRef.current) {
        textareaRef.current.focus();
        textareaRef.current.setSelectionRange(
          start + prefix.length,
          start + prefix.length + (selected.length || 4)
        );
      }
    }, 50);
  };

  const insertSlashBlock = (type) => {
    setShowSlashMenu(false);
    switch (type) {
      case 'h1':
        insertFormatting('# ', '');
        break;
      case 'h2':
        insertFormatting('## ', '');
        break;
      case 'h3':
        insertFormatting('### ', '');
        break;
      case 'todo':
        insertFormatting('- [ ] ', '');
        break;
      case 'bullet':
        insertFormatting('- ', '');
        break;
      case 'numbered':
        insertFormatting('1. ', '');
        break;
      case 'callout':
        insertFormatting('> 💡 **Note:** ', '');
        break;
      case 'quote':
        insertFormatting('> ', '');
        break;
      case 'code':
        insertFormatting('```javascript\n', '\n```');
        break;
      case 'divider':
        insertFormatting('\n---\n', '');
        break;
      case 'table':
        insertFormatting('\n| Feature | Status | Assignee |\n| :--- | :--- | :--- |\n| Core Flow | In Progress | @eng |\n');
        break;
      default:
        break;
    }
  };

  const handleFileUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const reader = new FileReader();
      reader.onload = async (event) => {
        const textContent = event.target.result;
        const baseName = file.name.replace(/\.[^/.]+$/, '');
        const created = await api.createDocument(
          workspaceId,
          baseName,
          { text: typeof textContent === 'string' ? textContent : '' },
          null,
          '📄'
        );
        if (onRefreshDocuments) await onRefreshDocuments();
        await loadDocumentTree();
        handleSelectDoc(created);
      };
      reader.readAsText(file);
    } catch (err) {
      alert(`Upload error: ${err.message}`);
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleExport = (format) => {
    if (!selectedDoc) return;
    let contentToExport = docContent;
    let mimeType = 'text/plain';
    let ext = 'txt';

    if (format === 'md') {
      mimeType = 'text/markdown';
      ext = 'md';
    } else if (format === 'html') {
      mimeType = 'text/html';
      ext = 'html';
      contentToExport = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${docTitle}</title><style>body{font-family:system-ui,-apple-system,sans-serif;max-width:840px;margin:40px auto;padding:0 24px;line-height:1.7;color:#1e293b;}h1,h2,h3{color:#0f172a;}pre{background:#0f172a;color:#f8fafc;padding:16px;border-radius:12px;overflow-x:auto;}blockquote{border-left:4px solid #4f46e5;margin:0;padding-left:16px;color:#475569;}</style></head><body><h1>${docIcon} ${docTitle}</h1><pre style="white-space:pre-wrap;">${docContent}</pre></body></html>`;
    }

    const blob = new Blob([contentToExport], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${docTitle.replace(/\s+/g, '_')}.${ext}`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Find document lineage for breadcrumb trail
  const getBreadcrumbs = () => {
    if (!selectedDoc) return [];
    const crumbs = [];
    let currentId = selectedDoc.parent_id;

    while (currentId) {
      const parent = (documents || []).find((d) => d.id === currentId);
      if (parent) {
        crumbs.unshift(parent);
        currentId = parent.parent_id;
      } else {
        break;
      }
    }
    return crumbs;
  };

  const breadcrumbs = getBreadcrumbs();
  const wordCount = docContent.trim() ? docContent.trim().split(/\s+/).length : 0;
  const charCount = docContent.length;
  const readTime = Math.max(1, Math.ceil(wordCount / 200));

  // Render tree node recursively
  const renderTreeNode = (node, depth = 0) => {
    const isSelected = selectedDoc?.id === node.id;
    const hasChildren = node.children && node.children.length > 0;
    const isExpanded = !!expandedNodes[node.id];

    return (
      <div key={node.id} className="select-none">
        <div
          className={`group flex items-center justify-between px-2 py-1.5 rounded-xl text-xs transition cursor-pointer ${
            isSelected
              ? 'bg-indigo-50 text-[#4F46E5] font-bold shadow-sm'
              : 'text-slate-700 hover:bg-[#F2F4F6]'
          }`}
          style={{ paddingLeft: `${Math.max(8, depth * 14 + 8)}px` }}
          onClick={() => {
            const found = (documents || []).find((d) => d.id === node.id);
            if (found) handleSelectDoc(found);
          }}
        >
          <div className="flex items-center gap-1.5 min-w-0 flex-1">
            {hasChildren ? (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setExpandedNodes((prev) => ({ ...prev, [node.id]: !prev[node.id] }));
                }}
                className="p-0.5 text-slate-400 hover:text-slate-600 rounded transition"
              >
                {isExpanded ? (
                  <ChevronDown className="w-3.5 h-3.5" />
                ) : (
                  <ChevronRight className="w-3.5 h-3.5" />
                )}
              </button>
            ) : (
              <span className="w-3.5" />
            )}

            <span className="text-sm shrink-0">{node.icon || '📄'}</span>
            <span className="truncate">{node.title || 'Untitled'}</span>
          </div>

          {/* Quick Add Subpage button on hover */}
          <div className="opacity-0 group-hover:opacity-100 flex items-center gap-1 transition">
            <button
              type="button"
              title="Add sub-page"
              onClick={(e) => {
                e.stopPropagation();
                setCreateParentId(node.id);
                setNewDocTitle('');
                setNewDocIcon('📄');
                setShowCreateModal(true);
              }}
              className="p-1 text-slate-400 hover:text-[#4F46E5] hover:bg-white rounded transition"
            >
              <Plus className="w-3 h-3" />
            </button>
          </div>
        </div>

        {hasChildren && isExpanded && (
          <div className="mt-0.5 space-y-0.5 border-l border-slate-200 ml-4">
            {node.children.map((child) => renderTreeNode(child, depth + 1))}
          </div>
        )}
      </div>
    );
  };

  // Render markdown blocks with interactive checkboxes, styled headers, and callouts
  const renderFormattedPreview = (markdownText) => {
    if (!markdownText) {
      return (
        <div className="text-slate-400 italic py-16 text-center">
          Document is empty. Write in the editor or insert blocks with the slash command menu.
        </div>
      );
    }

    const lines = markdownText.split('\n');
    let inCodeBlock = false;
    let codeBuffer = [];
    let codeLang = '';
    const renderedElements = [];

    lines.forEach((line, idx) => {
      // Code block start / end
      if (line.trim().startsWith('```')) {
        if (!inCodeBlock) {
          inCodeBlock = true;
          codeLang = line.trim().replace('```', '') || 'code';
          codeBuffer = [];
        } else {
          inCodeBlock = false;
          const codeString = codeBuffer.join('\n');
          const codeBlockIdx = idx;
          renderedElements.push(
            <div
              key={`code-${codeBlockIdx}`}
              className="my-3 rounded-2xl bg-slate-900 border border-slate-800 text-slate-100 overflow-hidden shadow-md font-mono text-xs"
            >
              <div className="flex items-center justify-between px-4 py-2 bg-slate-950/70 border-b border-slate-800 text-[11px] text-slate-400">
                <span className="uppercase tracking-wider font-bold">{codeLang}</span>
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard.writeText(codeString);
                    setCopiedCodeIdx(codeBlockIdx);
                    setTimeout(() => setCopiedCodeIdx(null), 2000);
                  }}
                  className="flex items-center gap-1 hover:text-white transition"
                >
                  {copiedCodeIdx === codeBlockIdx ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-emerald-400" />
                      <span className="text-emerald-400">Copied</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5" />
                      <span>Copy</span>
                    </>
                  )}
                </button>
              </div>
              <pre className="p-4 overflow-x-auto leading-relaxed">{codeString}</pre>
            </div>
          );
        }
        return;
      }

      if (inCodeBlock) {
        codeBuffer.push(line);
        return;
      }

      // Headings
      if (line.startsWith('# ')) {
        renderedElements.push(
          <h1 key={idx} className="text-2xl font-black text-[#191C1E] mt-6 mb-2 tracking-tight">
            {line.replace('# ', '')}
          </h1>
        );
      } else if (line.startsWith('## ')) {
        renderedElements.push(
          <h2 key={idx} className="text-xl font-bold text-[#191C1E] mt-5 mb-2 tracking-tight border-b border-[#E2E8F0] pb-1.5">
            {line.replace('## ', '')}
          </h2>
        );
      } else if (line.startsWith('### ')) {
        renderedElements.push(
          <h3 key={idx} className="text-base font-bold text-[#191C1E] mt-4 mb-1">
            {line.replace('### ', '')}
          </h3>
        );
      }
      // Interactive Task Checkboxes
      else if (line.trim().startsWith('- [ ]') || line.trim().startsWith('- [x]')) {
        const isChecked = line.trim().startsWith('- [x]');
        const text = line.replace(/- \[[ x]\]\s*/, '');
        renderedElements.push(
          <div
            key={idx}
            onClick={() => handleToggleCheckbox(idx)}
            className="flex items-start gap-2.5 py-1 px-1.5 rounded-lg hover:bg-slate-100/60 transition cursor-pointer group"
          >
            <input
              type="checkbox"
              checked={isChecked}
              onChange={() => handleToggleCheckbox(idx)}
              className="mt-1 rounded border-slate-300 text-[#4F46E5] focus:ring-0 cursor-pointer w-4 h-4"
            />
            <span
              className={`text-sm leading-relaxed ${
                isChecked ? 'line-through text-slate-400' : 'text-slate-800'
              }`}
            >
              {text}
            </span>
          </div>
        );
      }
      // Notion Callout block (> 💡 or > ℹ️ or > ⚠️)
      else if (line.trim().startsWith('> 💡') || line.trim().startsWith('> Note:')) {
        renderedElements.push(
          <div
            key={idx}
            className="my-3 p-3.5 rounded-2xl bg-amber-50 border border-amber-200/80 text-amber-900 flex items-start gap-3 shadow-sm text-sm"
          >
            <Lightbulb className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
            <div className="leading-relaxed font-sans">{line.replace(/^>\s*(💡|Note:)?\s*/, '')}</div>
          </div>
        );
      }
      // Blockquote
      else if (line.trim().startsWith('> ')) {
        renderedElements.push(
          <blockquote
            key={idx}
            className="my-2 pl-4 border-l-4 border-[#4F46E5] text-slate-600 italic text-sm py-1"
          >
            {line.replace('> ', '')}
          </blockquote>
        );
      }
      // Bullet list
      else if (line.trim().startsWith('- ') || line.trim().startsWith('* ')) {
        renderedElements.push(
          <li key={idx} className="ml-5 list-disc text-slate-700 text-sm py-0.5 leading-relaxed">
            {line.replace(/^[-*]\s*/, '')}
          </li>
        );
      }
      // Numbered list
      else if (/^\d+\.\s/.test(line.trim())) {
        renderedElements.push(
          <li key={idx} className="ml-5 list-decimal text-slate-700 text-sm py-0.5 leading-relaxed">
            {line.replace(/^\d+\.\s*/, '')}
          </li>
        );
      }
      // Horizontal Rule
      else if (line.trim() === '---' || line.trim() === '***') {
        renderedElements.push(<hr key={idx} className="my-5 border-t border-[#E2E8F0]" />);
      }
      // Empty line / spacer
      else if (!line.trim()) {
        renderedElements.push(<div key={idx} className="h-2" />);
      }
      // Regular paragraph
      else {
        renderedElements.push(
          <p key={idx} className="text-slate-800 text-sm leading-relaxed">
            {line}
          </p>
        );
      }
    });

    return <div className="space-y-1">{renderedElements}</div>;
  };

  return (
    <div
      className={`h-full flex gap-6 select-none ${
        isZenMode ? 'fixed inset-0 z-50 bg-slate-950 p-6' : ''
      }`}
    >
      {/* Hidden File Input for direct document uploads */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".txt,.md,.markdown,.json,.csv,.doc,.docx"
        className="hidden"
        onChange={handleFileUpload}
      />

      {/* 1. Left Sidebar: Notion Document Tree & Quick Action Rail */}
      {!isZenMode && (
        <div className="w-80 p-4 rounded-2xl border border-[#E2E8F0] flex flex-col h-full bg-white shadow-sm flex-shrink-0">
          {/* Header */}
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <BookOpen className="w-4 h-4 text-[#4F46E5]" />
              <h3 className="font-extrabold text-xs uppercase tracking-wider text-slate-700">
                Pages & Knowledge
              </h3>
            </div>
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => fileInputRef.current?.click()}
                title="Upload document file (.txt, .md, .docx)"
                className="p-1.5 bg-[#F2F4F6] hover:bg-[#ECEEF0] text-slate-700 rounded-xl border border-[#E2E8F0] transition"
              >
                <Upload className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => {
                  setCreateParentId(null);
                  setNewDocTitle('');
                  setNewDocIcon('📄');
                  setShowCreateModal(true);
                }}
                className="flex items-center gap-1 bg-[#4F46E5] hover:bg-[#4338CA] text-white px-2.5 py-1.5 rounded-xl text-xs font-bold transition shadow-sm active:scale-95"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>New Page</span>
              </button>
            </div>
          </div>

          {/* Real-time Document Search Input */}
          <div className="relative mb-3">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-2.5" />
            <input
              type="text"
              placeholder="Search pages or text..."
              className="w-full bg-[#F2F4F6] border border-[#E2E8F0] rounded-xl pl-9 pr-3 py-2 text-xs text-[#191C1E] focus:outline-none focus:border-[#4F46E5] placeholder-slate-400 transition"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            {isSearching && (
              <span className="absolute right-3 top-2.5 text-[10px] text-slate-400 font-mono animate-pulse">
                ...
              </span>
            )}
          </div>

          {/* Starter Templates Quick Banner */}
          <button
            onClick={() => setShowTemplatesModal(true)}
            className="w-full mb-3 flex items-center justify-between p-2.5 rounded-2xl bg-indigo-50 border border-indigo-200 hover:border-indigo-300 text-xs text-[#4F46E5] transition group shadow-sm"
          >
            <div className="flex items-center gap-2">
              <Sparkles className="w-3.5 h-3.5 text-[#4F46E5] group-hover:rotate-12 transition" />
              <span className="font-bold">Notion Templates</span>
            </div>
            <span className="text-[10px] bg-indigo-100 text-[#4F46E5] px-2 py-0.5 rounded-full font-mono font-bold">
              3 Specs
            </span>
          </button>

          {/* Page List: Search Results or Nested Tree */}
          <div className="flex-1 overflow-y-auto space-y-1 pr-1">
            {searchResults !== null ? (
              // Search Results View
              <div className="space-y-1">
                <div className="text-[10px] uppercase font-bold text-slate-400 px-2 py-1 flex items-center justify-between">
                  <span>Search Results ({searchResults.length})</span>
                  <button
                    onClick={() => setSearchQuery('')}
                    className="text-[#4F46E5] hover:underline"
                  >
                    Clear
                  </button>
                </div>
                {searchResults.length === 0 ? (
                  <div className="text-center text-slate-400 py-8 text-xs">
                    No matching pages found.
                  </div>
                ) : (
                  searchResults.map((res) => (
                    <button
                      key={res.id}
                      onClick={() => {
                        const target = (documents || []).find((d) => d.id === res.id);
                        if (target) handleSelectDoc(target);
                        setSearchQuery('');
                      }}
                      className="w-full text-left p-2.5 rounded-xl border border-[#E2E8F0] bg-[#F8FAFC] hover:bg-indigo-50 hover:border-[#4F46E5] transition text-xs space-y-1"
                    >
                      <div className="flex items-center gap-1.5 font-bold text-slate-800">
                        <span>{res.icon || '📄'}</span>
                        <span className="truncate">{res.title}</span>
                      </div>
                      {res.match_snippet && (
                        <p className="text-[11px] text-slate-500 font-mono line-clamp-2 bg-white/70 p-1.5 rounded border border-slate-200">
                          {res.match_snippet}
                        </p>
                      )}
                    </button>
                  ))
                )}
              </div>
            ) : (
              // Notion Nested Hierarchy Tree View
              <div className="space-y-0.5">
                {docTree.length === 0 ? (
                  <div className="text-center text-slate-400 py-12 text-xs space-y-2">
                    <FileText className="w-8 h-8 mx-auto text-slate-300 opacity-80" />
                    <p>No pages yet.</p>
                    <button
                      onClick={() => {
                        setCreateParentId(null);
                        setShowCreateModal(true);
                      }}
                      className="text-[#4F46E5] hover:underline font-bold"
                    >
                      Create your first page
                    </button>
                  </div>
                ) : (
                  docTree.map((node) => renderTreeNode(node, 0))
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* 2. Main Document Canvas & Notion Block Editor */}
      <div className="flex-1 p-6 rounded-2xl border border-[#E2E8F0] flex flex-col h-full bg-white shadow-sm overflow-hidden text-[#191C1E]">
        {selectedDoc ? (
          <div className="flex flex-col h-full space-y-4">
            {/* Top Bar: Breadcrumb Trail & Quick Actions */}
            <div className="flex items-center justify-between border-b border-[#E2E8F0] pb-3 gap-4">
              {/* Breadcrumb Hierarchy Path */}
              <div className="flex items-center gap-1.5 text-xs text-slate-500 overflow-x-auto py-1">
                <button
                  type="button"
                  onClick={() => {
                    const rootNode = docTree[0];
                    if (rootNode) {
                      const rootDoc = (documents || []).find((d) => d.id === rootNode.id);
                      if (rootDoc) handleSelectDoc(rootDoc);
                    }
                  }}
                  className="hover:text-[#4F46E5] transition flex items-center gap-1"
                >
                  <FolderTree className="w-3.5 h-3.5" />
                  <span>Workspace</span>
                </button>

                {breadcrumbs.map((crumb) => (
                  <React.Fragment key={crumb.id}>
                    <ChevronRight className="w-3 h-3 text-slate-300 shrink-0" />
                    <button
                      type="button"
                      onClick={() => handleSelectDoc(crumb)}
                      className="hover:text-[#4F46E5] font-medium transition truncate max-w-[120px]"
                    >
                      {crumb.icon || '📄'} {crumb.title}
                    </button>
                  </React.Fragment>
                ))}

                <ChevronRight className="w-3 h-3 text-slate-300 shrink-0" />
                <span className="font-bold text-slate-800 truncate max-w-[180px]">
                  {docIcon} {docTitle || 'Untitled'}
                </span>
              </div>

              {/* Action Buttons */}
              <div className="flex items-center gap-2">
                {/* View Mode Toggle */}
                <div className="bg-[#F2F4F6] p-1 rounded-xl border border-[#E2E8F0] flex items-center gap-1 text-xs">
                  <button
                    onClick={() => setEditorMode('edit')}
                    className={`px-2.5 py-1 rounded-lg font-bold flex items-center gap-1 transition ${
                      editorMode === 'edit'
                        ? 'bg-[#4F46E5] text-white shadow-sm'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                    title="Write Markdown"
                  >
                    <Edit3 className="w-3 h-3" />
                    <span>Write</span>
                  </button>
                  <button
                    onClick={() => setEditorMode('split')}
                    className={`px-2.5 py-1 rounded-lg font-bold flex items-center gap-1 transition ${
                      editorMode === 'split'
                        ? 'bg-[#4F46E5] text-white shadow-sm'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                    title="Split View"
                  >
                    <Columns className="w-3 h-3" />
                    <span>Split</span>
                  </button>
                  <button
                    onClick={() => setEditorMode('preview')}
                    className={`px-2.5 py-1 rounded-lg font-bold flex items-center gap-1 transition ${
                      editorMode === 'preview'
                        ? 'bg-[#4F46E5] text-white shadow-sm'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                    title="Interactive Preview"
                  >
                    <Eye className="w-3 h-3" />
                    <span>Preview</span>
                  </button>
                </div>

                {/* Export Dropdown */}
                <div className="flex items-center gap-1 bg-[#F2F4F6] border border-[#E2E8F0] rounded-xl p-1">
                  <button
                    onClick={() => handleExport('md')}
                    title="Download Markdown (.md)"
                    className="px-2.5 py-1 text-slate-700 hover:text-[#191C1E] text-xs font-semibold hover:bg-white rounded-lg transition flex items-center gap-1"
                  >
                    <Download className="w-3 h-3 text-[#4F46E5]" />
                    <span>MD</span>
                  </button>
                  <button
                    onClick={() => handleExport('html')}
                    title="Download HTML"
                    className="px-2 py-1 text-slate-700 hover:text-[#191C1E] text-xs font-semibold hover:bg-white rounded-lg transition"
                  >
                    HTML
                  </button>
                </div>

                {/* Zen Mode */}
                <button
                  onClick={() => setIsZenMode(!isZenMode)}
                  className="p-2 text-slate-600 hover:text-slate-900 hover:bg-[#F2F4F6] rounded-xl border border-[#E2E8F0] transition"
                  title={isZenMode ? 'Exit Zen Mode' : 'Distraction-free Zen Mode'}
                >
                  {isZenMode ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4 text-[#4F46E5]" />}
                </button>

                {/* Save Button */}
                <button
                  onClick={handleSaveDoc}
                  disabled={isSaving}
                  className="flex items-center gap-1.5 bg-[#4F46E5] hover:bg-[#4338CA] text-white px-4 py-2 rounded-xl text-xs font-bold shadow-sm transition active:scale-95"
                >
                  <Save className="w-3.5 h-3.5" />
                  <span>{isSaving ? 'Saving...' : 'Save'}</span>
                </button>

                {/* Delete Doc */}
                <button
                  onClick={async () => {
                    if (confirm(`Delete page "${docTitle}" and its hierarchy?`)) {
                      await api.deleteDocument(workspaceId, selectedDoc.id);
                      if (onRefreshDocuments) await onRefreshDocuments();
                      await loadDocumentTree();
                      setSelectedDoc(null);
                    }
                  }}
                  className="p-2 text-slate-500 hover:text-rose-600 hover:bg-rose-50 rounded-xl border border-[#E2E8F0] transition"
                  title="Delete Document"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Document Header: Interactive Emoji Icon Picker + Large Title */}
            <div className="flex items-center gap-3 relative">
              {/* Emoji Picker Button */}
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setShowEmojiPicker(!showEmojiPicker)}
                  title="Change page icon"
                  className="w-12 h-12 rounded-2xl bg-slate-100 hover:bg-indigo-50 border border-slate-200 hover:border-[#4F46E5] flex items-center justify-center text-2xl transition shadow-sm"
                >
                  {docIcon}
                </button>

                {/* Emoji Selection Popover */}
                {showEmojiPicker && (
                  <div className="absolute left-0 top-14 bg-white border border-[#E2E8F0] p-3 rounded-2xl shadow-2xl z-30 grid grid-cols-6 gap-2 w-64 animate-in fade-in zoom-in-95">
                    {EMOJI_PICKER_OPTIONS.map((em) => (
                      <button
                        key={em}
                        type="button"
                        onClick={() => handleSelectEmoji(em)}
                        className="text-xl p-2 rounded-xl hover:bg-indigo-50 hover:scale-110 transition"
                      >
                        {em}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Title Input */}
              <input
                type="text"
                className="text-2xl md:text-3xl font-extrabold bg-transparent text-[#191C1E] focus:outline-none flex-1 placeholder-slate-300 tracking-tight"
                value={docTitle}
                onChange={(e) => setDocTitle(e.target.value)}
                placeholder="Untitled Page..."
              />
            </div>

            {/* Notion Slash Command Ribbon & Block Inserters */}
            {editorMode !== 'preview' && (
              <div className="relative flex items-center gap-1.5 bg-[#F8FAFC] p-1.5 rounded-2xl border border-[#E2E8F0] overflow-x-auto text-xs">
                {/* Slash Menu Trigger */}
                <button
                  type="button"
                  onClick={() => setShowSlashMenu(!showSlashMenu)}
                  className="px-2.5 py-1 bg-indigo-50 hover:bg-indigo-100 text-[#4F46E5] font-bold rounded-lg border border-indigo-200 transition flex items-center gap-1"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Insert Block</span>
                </button>

                <div className="w-[1px] h-4 bg-[#E2E8F0] mx-1" />

                <button
                  onClick={() => insertFormatting('# ', '')}
                  className="px-2 py-1 hover:bg-[#ECEEF0] rounded-lg text-slate-700 font-bold transition flex items-center gap-1"
                  title="Heading 1"
                >
                  <Heading className="w-3 h-3" /> H1
                </button>
                <button
                  onClick={() => insertFormatting('## ', '')}
                  className="px-2 py-1 hover:bg-[#ECEEF0] rounded-lg text-slate-700 font-bold transition flex items-center gap-1"
                  title="Heading 2"
                >
                  <Heading className="w-3 h-3" /> H2
                </button>
                <button
                  onClick={() => insertFormatting('**', '**')}
                  className="px-2.5 py-1 hover:bg-[#ECEEF0] rounded-lg text-slate-700 font-black transition"
                  title="Bold"
                >
                  B
                </button>
                <button
                  onClick={() => insertFormatting('*', '*')}
                  className="px-2.5 py-1 hover:bg-[#ECEEF0] rounded-lg text-slate-700 italic font-serif transition"
                  title="Italic"
                >
                  I
                </button>
                <button
                  onClick={() => insertFormatting('- [ ] ', '')}
                  className="px-2 py-1 hover:bg-[#ECEEF0] rounded-lg text-slate-700 transition flex items-center gap-1"
                  title="Task Checkbox"
                >
                  <CheckSquare className="w-3 h-3 text-[#4F46E5]" /> Task
                </button>
                <button
                  onClick={() => insertFormatting('> 💡 **Note:** ', '')}
                  className="px-2 py-1 hover:bg-[#ECEEF0] rounded-lg text-slate-700 transition flex items-center gap-1"
                  title="Notion Callout Box"
                >
                  <Lightbulb className="w-3 h-3 text-amber-500" /> Callout
                </button>
                <button
                  onClick={() => insertFormatting('- ', '')}
                  className="px-2 py-1 hover:bg-[#ECEEF0] rounded-lg text-slate-700 transition flex items-center gap-1"
                  title="Bullet List"
                >
                  <List className="w-3 h-3" /> List
                </button>
                <button
                  onClick={() => insertFormatting('```ts\n', '\n```')}
                  className="px-2 py-1 hover:bg-[#ECEEF0] rounded-lg text-slate-700 font-mono transition flex items-center gap-1"
                  title="Code Block"
                >
                  <Code className="w-3 h-3" /> Code
                </button>
                <button
                  onClick={() => insertFormatting('> ', '')}
                  className="px-2 py-1 hover:bg-[#ECEEF0] rounded-lg text-slate-700 transition flex items-center gap-1"
                  title="Quote"
                >
                  <Quote className="w-3 h-3" /> Quote
                </button>

                {/* Floating Slash Menu Popover */}
                {showSlashMenu && (
                  <div className="absolute left-2 top-11 bg-white border border-[#E2E8F0] p-2 rounded-2xl shadow-2xl z-30 w-56 space-y-1 animate-in fade-in zoom-in-95 text-xs">
                    <div className="px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                      Notion Blocks
                    </div>
                    <button
                      onClick={() => insertSlashBlock('h1')}
                      className="w-full text-left px-2.5 py-1.5 hover:bg-indigo-50 rounded-lg flex items-center gap-2 text-slate-700 font-medium"
                    >
                      <Heading className="w-3.5 h-3.5 text-[#4F46E5]" /> Heading 1
                    </button>
                    <button
                      onClick={() => insertSlashBlock('h2')}
                      className="w-full text-left px-2.5 py-1.5 hover:bg-indigo-50 rounded-lg flex items-center gap-2 text-slate-700 font-medium"
                    >
                      <Heading className="w-3.5 h-3.5 text-[#4F46E5]" /> Heading 2
                    </button>
                    <button
                      onClick={() => insertSlashBlock('todo')}
                      className="w-full text-left px-2.5 py-1.5 hover:bg-indigo-50 rounded-lg flex items-center gap-2 text-slate-700 font-medium"
                    >
                      <CheckSquare className="w-3.5 h-3.5 text-emerald-600" /> To-do List
                    </button>
                    <button
                      onClick={() => insertSlashBlock('callout')}
                      className="w-full text-left px-2.5 py-1.5 hover:bg-indigo-50 rounded-lg flex items-center gap-2 text-slate-700 font-medium"
                    >
                      <Lightbulb className="w-3.5 h-3.5 text-amber-500" /> Callout Card
                    </button>
                    <button
                      onClick={() => insertSlashBlock('code')}
                      className="w-full text-left px-2.5 py-1.5 hover:bg-indigo-50 rounded-lg flex items-center gap-2 text-slate-700 font-medium"
                    >
                      <Code className="w-3.5 h-3.5 text-slate-600" /> Code Snippet
                    </button>
                    <button
                      onClick={() => insertSlashBlock('quote')}
                      className="w-full text-left px-2.5 py-1.5 hover:bg-indigo-50 rounded-lg flex items-center gap-2 text-slate-700 font-medium"
                    >
                      <Quote className="w-3.5 h-3.5 text-indigo-400" /> Quote Block
                    </button>
                    <button
                      onClick={() => insertSlashBlock('table')}
                      className="w-full text-left px-2.5 py-1.5 hover:bg-indigo-50 rounded-lg flex items-center gap-2 text-slate-700 font-medium"
                    >
                      <Table className="w-3.5 h-3.5 text-slate-600" /> Markdown Table
                    </button>
                    <button
                      onClick={() => insertSlashBlock('divider')}
                      className="w-full text-left px-2.5 py-1.5 hover:bg-indigo-50 rounded-lg flex items-center gap-2 text-slate-700 font-medium"
                    >
                      <Minus className="w-3.5 h-3.5 text-slate-400" /> Divider Line
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Document Statistics Footer */}
            <div className="flex items-center justify-between text-[11px] text-slate-500 px-2 font-mono">
              <div className="flex items-center gap-3">
                <span>{wordCount} words</span>
                <span>•</span>
                <span>{charCount} characters</span>
                <span>•</span>
                <span>~{readTime} min read</span>
              </div>

              <div className="flex items-center gap-2">
                <span className="flex items-center gap-1 text-[#10B981] font-bold">
                  <CheckCircle2 className="w-3 h-3" />
                  <span>Auto-saved to NexaMind</span>
                </span>
                {lastSaved && <span>at {lastSaved.toLocaleTimeString()}</span>}
              </div>
            </div>

            {/* Editor Workspace Canvas */}
            <div className="flex-1 flex gap-4 overflow-hidden min-h-0">
              {/* Write Textarea */}
              {(editorMode === 'edit' || editorMode === 'split') && (
                <div className="flex-1 h-full flex flex-col">
                  <textarea
                    ref={textareaRef}
                    value={docContent}
                    onChange={(e) => setDocContent(e.target.value)}
                    placeholder="Type '/' for commands or start writing your document..."
                    className="w-full flex-1 bg-[#F8FAFC] border border-[#E2E8F0] rounded-2xl p-6 text-sm text-[#191C1E] focus:outline-none focus:border-[#4F46E5] font-sans leading-relaxed resize-none shadow-inner"
                  />
                </div>
              )}

              {/* Formatted Interactive Preview */}
              {(editorMode === 'preview' || editorMode === 'split') && (
                <div className="flex-1 h-full bg-[#F8FAFC] border border-[#E2E8F0] rounded-2xl p-6 overflow-y-auto font-sans leading-relaxed text-sm text-[#191C1E] shadow-inner">
                  {renderFormattedPreview(docContent)}
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-center space-y-4 max-w-md mx-auto">
            <div className="w-16 h-16 rounded-2xl bg-indigo-50 border border-indigo-100 flex items-center justify-center text-[#4F46E5] shadow-sm">
              <BookOpen className="w-8 h-8" />
            </div>
            <div>
              <h3 className="font-bold text-lg text-[#191C1E]">No Page Selected</h3>
              <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                Create a new nested page, select a template spec, or upload markdown documents.
              </p>
            </div>
            <div className="flex items-center gap-3 pt-2">
              <button
                onClick={() => {
                  setCreateParentId(null);
                  setNewDocTitle('');
                  setShowCreateModal(true);
                }}
                className="flex items-center gap-1.5 bg-[#4F46E5] hover:bg-[#4338CA] text-white px-4 py-2.5 rounded-2xl text-xs font-bold shadow-md shadow-indigo-600/30 transition active:scale-95"
              >
                <Plus className="w-4 h-4" />
                <span>Create New Page</span>
              </button>
              <button
                onClick={() => fileInputRef.current?.click()}
                className="flex items-center gap-1.5 bg-slate-900 hover:bg-slate-800 text-slate-200 px-4 py-2.5 rounded-2xl text-xs font-bold border border-slate-800 transition active:scale-95"
              >
                <Upload className="w-4 h-4 text-indigo-400" />
                <span>Upload File</span>
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Create Page Modal (Supports Root or Subpage Parent ID) */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-50">
          <div className="bg-white p-6 rounded-3xl border border-[#E2E8F0] max-w-md w-full space-y-4 shadow-2xl text-[#191C1E]">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <FileText className="w-5 h-5 text-[#4F46E5]" />
                <h3 className="text-base font-extrabold text-[#191C1E]">
                  {createParentId ? 'Create Nested Subpage' : 'Create New Page'}
                </h3>
              </div>
              <button
                onClick={() => setShowCreateModal(false)}
                className="text-slate-400 hover:text-slate-700"
              >
                ✕
              </button>
            </div>

            {createParentId && (
              <div className="text-xs text-slate-500 bg-indigo-50 border border-indigo-100 p-2.5 rounded-xl flex items-center gap-1.5">
                <CornerDownRight className="w-3.5 h-3.5 text-[#4F46E5]" />
                <span>
                  Adding under parent:{' '}
                  <strong>
                    {(documents || []).find((d) => d.id === createParentId)?.title || 'Parent Page'}
                  </strong>
                </span>
              </div>
            )}

            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleCreateNewDoc(newDocTitle, '', createParentId, newDocIcon);
              }}
              className="space-y-4"
            >
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    const random =
                      EMOJI_PICKER_OPTIONS[
                        Math.floor(Math.random() * EMOJI_PICKER_OPTIONS.length)
                      ];
                    setNewDocIcon(random);
                  }}
                  title="Click to randomize icon"
                  className="w-10 h-10 rounded-xl bg-slate-100 hover:bg-slate-200 border border-slate-300 flex items-center justify-center text-xl shrink-0"
                >
                  {newDocIcon}
                </button>
                <input
                  type="text"
                  required
                  autoFocus
                  placeholder="e.g. Sprint Backlog & RFC"
                  className="w-full bg-[#F2F4F6] border border-[#E2E8F0] rounded-xl px-4 py-2.5 text-xs text-[#191C1E] focus:outline-none focus:border-[#4F46E5]"
                  value={newDocTitle}
                  onChange={(e) => setNewDocTitle(e.target.value)}
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-semibold transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-[#4F46E5] hover:bg-[#4338CA] text-white rounded-xl text-xs font-bold shadow-md shadow-indigo-600/30 transition active:scale-95"
                >
                  Create Page
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Starter Templates Modal */}
      {showTemplatesModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-50">
          <div className="bg-white p-6 rounded-3xl border border-[#E2E8F0] max-w-2xl w-full space-y-4 shadow-2xl text-[#191C1E]">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-[#4F46E5]" />
                <h3 className="text-base font-extrabold text-[#191C1E]">Notion Document Templates</h3>
              </div>
              <button
                onClick={() => setShowTemplatesModal(false)}
                className="text-slate-400 hover:text-slate-700 text-xs font-bold"
              >
                Close
              </button>
            </div>

            <p className="text-xs text-slate-500">
              Initialize a production-ready engineering specification or sprint note with 1-click:
            </p>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {DOCUMENT_TEMPLATES.map((tmpl, idx) => (
                <div
                  key={idx}
                  onClick={() => handleCreateNewDoc(tmpl.title, tmpl.content, null, tmpl.icon)}
                  className="p-4 rounded-2xl bg-[#F8FAFC] hover:bg-indigo-50 border border-[#E2E8F0] hover:border-[#4F46E5] cursor-pointer transition flex flex-col justify-between space-y-2 group shadow-sm"
                >
                  <div className="space-y-1.5">
                    <div className="text-2xl">{tmpl.icon}</div>
                    <h4 className="font-bold text-xs text-slate-800 group-hover:text-[#4F46E5] transition">
                      {tmpl.title}
                    </h4>
                    <p className="text-[11px] text-slate-500 line-clamp-3 leading-relaxed">
                      {tmpl.description}
                    </p>
                  </div>
                  <div className="pt-2 text-[10px] font-bold text-[#4F46E5] flex items-center justify-between">
                    <span>Use Template</span>
                    <span>→</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
