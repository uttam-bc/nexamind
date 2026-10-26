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
  Loader2,
  Image as ImageIcon,
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
  Lightbulb,
  ArrowLeft,
  Wand2,
} from 'lucide-react';
import { api } from '../api';
import FeatureHeader from './FeatureHeader';
import { notify, confirmDialog } from '../context/ToastContext';
import MarkdownDocument from './MarkdownDocument';
import FilePreview from './FilePreview';

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
- [x] Agree on the project scope
- [ ] Implement direct-write live canvas
- [ ] Connect agentic AI memory sync
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
                                           └───> [ Gemini 2.0 Agentic Memory ]
\`\`\`

## 3. Data Schema & Entities
- **Workspaces:** Scopes data isolation across teams.
- **Documents:** Hierarchical nested specifications with parent-child references.
- **Channels & Threads:** Slack/Teams messaging with root messages, replies, and reactions.

## 4. Verification Checklist
- [x] Database migration applied cleanly
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

> 💡 **Sprint Objective:** Complete direct-write documents and agentic memory consolidation.

## 🎯 Discussion Agenda
1. Review sprint goals and milestones
2. Architecture walkthrough: 4-stage AI memory pipeline
3. Frontend user experience polish

## 📋 Action Items
- [ ] Review direct-write document canvas (@frontend)
- [ ] Test reaction toggling under load (@backend)
- [ ] Finalize deployment readiness check (@devops)
`,
  },
];

export default function Documents({ workspaceId, documents = [], onRefreshDocuments, onBack, openDocId, onOpenedDoc }) {
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

  // Direct Notion Editor Mode
  // Default is 'direct' (write directly in preview session)
  const [importProgress, setImportProgress] = useState(0);
  const [viewMode, setViewMode] = useState('direct'); // 'original' | 'preview' | 'direct' | 'split' | 'code'
  // Uploaded files behind pages (page id -> file). A page made from a PDF shows the PDF itself by
  // default: the editable text is an extraction and can't keep columns, fonts or pictures.
  const [originals, setOriginals] = useState(new Map());
  const originalsRef = useRef(originals);
  originalsRef.current = originals;
  const refreshOriginals = async () => {
    try {
      const files = await api.listFiles(workspaceId);
      const map = new Map((files || []).filter((f) => f.document_id).map((f) => [f.document_id, f]));
      originalsRef.current = map;
      setOriginals(map);
      return map;
    } catch {
      return originalsRef.current;
    }
  };
  useEffect(() => {
    refreshOriginals();
  }, [workspaceId]); // eslint-disable-line react-hooks/exhaustive-deps
  const isPdf = (file) => !!file && /\.pdf$/i.test(file.filename || '');
  const pdfOriginal = selectedDoc && isPdf(originals.get(selectedDoc.id)) ? originals.get(selectedDoc.id) : null;
  const [isImporting, setIsImporting] = useState(false);
  const [isUploadingImage, setIsUploadingImage] = useState(false);
  const imageInputRef = useRef(null);
  const [isZenMode, setIsZenMode] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [lastSaved, setLastSaved] = useState(null);
  const [showSlashMenu, setShowSlashMenu] = useState(false);

  const fileInputRef = useRef(null);
  // What was last loaded from (or saved to) the server for the open document. Autosave only
  // writes when the editor differs from it, so opening a page never overwrites it.
  const loadedDocRef = useRef({ id: null, text: '', title: '', icon: '📄', updatedAt: null });
  const selectRequestRef = useRef(0);
  const pendingSelectRef = useRef(false); // a page is being fetched for display
  const [isLoadingDoc, setIsLoadingDoc] = useState(false);
  const directTextareaRef = useRef(null);
  const rawTextareaRef = useRef(null);

  // Load document tree whenever workspaceId or documents change
  useEffect(() => {
    if (workspaceId) {
      loadDocumentTree();
    }
  }, [workspaceId, documents]);

  // Opened from the Files tab: show that page.
  useEffect(() => {
    if (!openDocId || !documents?.length) return;
    const target = documents.find((d) => d.id === openDocId);
    if (target) handleSelectDoc(target);
    onOpenedDoc?.();
  }, [openDocId, documents]);

  // Keep selectedDoc synchronized with documents list
  useEffect(() => {
    if (documents && documents.length > 0) {
      if (openDocId && documents.some((d) => d.id === openDocId)) return; // handled above
      if (!selectedDoc || !documents.some((d) => d.id === selectedDoc.id)) {
        handleSelectDoc(documents[0]);
      } else {
        const current = documents.find((d) => d.id === selectedDoc.id);
        const loaded = loadedDocRef.current;
        const dirty = docContent !== loaded.text || docTitle !== loaded.title || docIcon !== loaded.icon;
        // Changed elsewhere (another member, or the AI copilot) and nothing unsaved here: reload it.
        // Never while another page is being opened, or the reload would override the user's click.
        if (
          current &&
          !pendingSelectRef.current &&
          current.updated_at !== loaded.updatedAt &&
          !dirty &&
          loaded.id === current.id
        ) {
          handleSelectDoc(current, { keepView: true });
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

  const handleSelectDoc = async (doc, { keepView = false } = {}) => {
    if (!doc) return;
    const requestId = ++selectRequestRef.current;
    pendingSelectRef.current = true;
    let full = doc;
    // List and tree items don't carry content; fetch the whole document before showing it.
    if (!('content' in doc)) {
      setIsLoadingDoc(true);
      try {
        full = await api.getDocument(workspaceId, doc.id);
      } catch (err) {
        if (requestId === selectRequestRef.current) {
          pendingSelectRef.current = false;
          setIsLoadingDoc(false);
          notify(`Could not open "${doc.title}": ${err.message}`, 'error');
        }
        return;
      }
    }
    if (requestId !== selectRequestRef.current) return; // a newer selection won

    const raw = parseDocContent(full.content);
    const title = full.title || 'Untitled Document';
    const icon = full.icon || '📄';
    loadedDocRef.current = { id: full.id, text: raw, title, icon, updatedAt: full.updated_at };
    setSelectedDoc(full);
    setDocTitle(title);
    setDocIcon(icon);
    setDocParentId(full.parent_id || null);
    setDocContent(raw);
    // Existing pages open as a readable preview; empty pages open ready to type.
    if (!keepView) setViewMode(isPdf(originalsRef.current.get(full.id)) ? 'original' : raw.trim() ? 'preview' : 'direct');
    setLastSaved(full.updated_at ? new Date(full.updated_at) : null);
    setIsLoadingDoc(false);
    pendingSelectRef.current = false;
  };

  const loadDocumentTree = async () => {
    try {
      const tree = await api.getDocumentTree(workspaceId);
      setDocTree(tree || []);
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
              if (b.type === 'todo') return `- [${b.checked ? 'x' : ' '}] ${b.text}`;
              if (b.type === 'bullet') return `- ${b.text}`;
              if (b.type === 'callout') return `> 💡 ${b.text}`;
              return b.text || '';
            })
            .join('\n');
        }
      } catch {
        return content;
      }
    }
    if (typeof content === 'object') {
      if (content.text) return content.text;
      if (content.blocks && Array.isArray(content.blocks)) {
        return content.blocks.map((b) => b.text || '').join('\n');
      }
    }
    return '';
  };

  const hasUnsavedChanges = () => {
    const loaded = loadedDocRef.current;
    return (
      !!selectedDoc &&
      loaded.id === selectedDoc.id &&
      (docContent !== loaded.text || docTitle !== loaded.title || docIcon !== loaded.icon)
    );
  };

  const rememberSaved = (saved) => {
    loadedDocRef.current = {
      id: saved?.id || selectedDoc.id,
      text: docContent,
      title: docTitle.trim() || 'Untitled Document',
      icon: docIcon,
      updatedAt: saved?.updated_at || loadedDocRef.current.updatedAt,
    };
  };

  // Auto-save debounce effect: only real edits to a fully loaded document are written.
  useEffect(() => {
    if (!selectedDoc || isLoadingDoc || !hasUnsavedChanges()) return;
    const timer = setTimeout(() => {
      handleSilentSave();
    }, 1200);
    return () => clearTimeout(timer);
  }, [docContent, docTitle, docIcon, isLoadingDoc]);

  const handleSilentSave = async () => {
    if (!selectedDoc || !docTitle.trim() || !hasUnsavedChanges()) return;
    try {
      const saved = await api.updateDocument(workspaceId, selectedDoc.id, {
        title: docTitle.trim(),
        content: { text: docContent },
        icon: docIcon,
      });
      rememberSaved(saved);
      setLastSaved(new Date());
      if (onRefreshDocuments) onRefreshDocuments();
    } catch (err) {
      notify(`Autosave failed: ${err.message}`, 'error');
    }
  };

  const handleSaveDoc = async () => {
    if (!selectedDoc) return;
    setIsSaving(true);
    try {
      const saved = await api.updateDocument(workspaceId, selectedDoc.id, {
        title: docTitle.trim() || 'Untitled Document',
        content: { text: docContent },
        icon: docIcon,
      });
      rememberSaved(saved);
      setLastSaved(new Date());
      if (onRefreshDocuments) await onRefreshDocuments();
      loadDocumentTree();
    } catch (err) {
      notify(`Save error: ${err.message}`, 'error');
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
        { text: initialContent || '' },
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
      notify(`Could not create document: ${err.message}`, 'error');
    }
  };

  // Interactive to-do checkbox toggle inside direct preview
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

    if (selectedDoc) {
      api.updateDocument(workspaceId, selectedDoc.id, {
        title: docTitle,
        content: { text: updated },
        icon: docIcon,
      }).catch((e) => console.warn('Toggle save failed', e));
    }
  };

  // Put text at the cursor (or at the end when no editor is open) and switch to editing.
  const insertAtCursor = (snippet) => {
    const targetRef = viewMode === 'code' ? rawTextareaRef : directTextareaRef;
    const el = targetRef.current;
    if (!el) {
      setDocContent((prev) => `${prev.replace(/\s*$/, '')}\n\n${snippet}\n`);
      setViewMode('direct');
      return;
    }
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const before = docContent.substring(0, start);
    const lead = before && !before.endsWith('\n\n') ? (before.endsWith('\n') ? '\n' : '\n\n') : '';
    const updated = `${before}${lead}${snippet}\n${docContent.substring(end)}`;
    setDocContent(updated);
    const caret = before.length + lead.length + snippet.length + 1;
    setTimeout(() => {
      el.focus();
      el.setSelectionRange(caret, caret);
    }, 50);
  };

  const handleInsertImage = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !selectedDoc) return;
    if (!/^image\/(png|jpeg|gif|webp|bmp)$/.test(file.type)) {
      notify('Choose a PNG, JPEG, GIF, WebP or BMP image.', 'error');
      return;
    }
    setIsUploadingImage(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const stored = await api.uploadFile(workspaceId, formData);
      const alt = file.name.replace(/\.[^.]+$/, '').replace(/[\[\]]/g, '');
      insertAtCursor(`![${alt}](file:${stored.id})`);
      notify('Image added. It is saved with the page.', 'success');
    } catch (err) {
      notify(`Could not add the image: ${err.message}`, 'error');
    } finally {
      setIsUploadingImage(false);
    }
  };

  const insertFormatting = (prefix, suffix = '') => {
    const targetRef = viewMode === 'code' ? rawTextareaRef : directTextareaRef;
    if (!targetRef.current) {
      setDocContent((prev) => `${prev}\n${prefix}New block${suffix}`);
      return;
    }
    const start = targetRef.current.selectionStart;
    const end = targetRef.current.selectionEnd;
    const selected = docContent.substring(start, end);
    const replacement = `${prefix}${selected || 'text'}${suffix}`;
    const updated = docContent.substring(0, start) + replacement + docContent.substring(end);
    setDocContent(updated);

    setTimeout(() => {
      if (targetRef.current) {
        targetRef.current.focus();
        targetRef.current.setSelectionRange(
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
        insertFormatting('\n# ', '\n');
        break;
      case 'h2':
        insertFormatting('\n## ', '\n');
        break;
      case 'h3':
        insertFormatting('\n### ', '\n');
        break;
      case 'todo':
        insertFormatting('\n- [ ] ', '\n');
        break;
      case 'bullet':
        insertFormatting('\n- ', '\n');
        break;
      case 'numbered':
        insertFormatting('\n1. ', '\n');
        break;
      case 'callout':
        insertFormatting('\n> 💡 **Note:** ', '\n');
        break;
      case 'quote':
        insertFormatting('\n> ', '\n');
        break;
      case 'code':
        insertFormatting('\n```javascript\n// write code here\n', '\n```\n');
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
    setIsImporting(true);
    setImportProgress(0);
    try {
      // The server extracts real content (Word headings/lists/tables, PDF text) instead of
      // reading binary files as text.
      const created = await api.importDocument(workspaceId, file, null, setImportProgress);
      if (onRefreshDocuments) await onRefreshDocuments();
      await Promise.all([loadDocumentTree(), refreshOriginals()]);
      handleSelectDoc(created);
      notify(`Imported "${created.title}".`, 'success');
    } catch (err) {
      notify(`Could not import ${file.name}: ${err.message}`, 'error');
    } finally {
      setIsImporting(false);
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

  const renderTreeNode = (node, depth = 0) => {
    const isSelected = selectedDoc?.id === node.id;
    const hasChildren = node.children && node.children.length > 0;
    const isExpanded = !!expandedNodes[node.id];

    return (
      <div key={node.id} className="select-none">
        <div
          className={`group flex items-center justify-between px-2 py-1.5 rounded-xl text-xs transition cursor-pointer ${
            isSelected
              ? 'bg-indigo-50 text-indigo-600 font-bold shadow-sm'
              : 'text-slate-700 hover:bg-slate-100'
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
              className="p-1 text-slate-400 hover:text-indigo-600 hover:bg-white rounded transition"
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
  const renderFormattedBlocks = (markdownText) => (
    <MarkdownDocument
      text={markdownText}
      workspaceId={workspaceId}
      onToggleCheckbox={handleToggleCheckbox}
      emptyText="Document is empty. Choose Edit to start writing."
    />
  );

  return (
    <div className={`h-full flex flex-col select-none ${isZenMode ? 'fixed inset-0 z-50 bg-white p-6' : ''}`}>
      {/* 0. Feature Header with Back Button (Item 1) */}
      {!isZenMode && (
        <FeatureHeader
          title="Docs"
          icon={BookOpen}
          badge={null}
          onBack={onBack}
          actions={
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-500 font-medium hidden sm:inline">
                {selectedDoc ? `${wordCount} words` : 'Ready'}
              </span>
              {selectedDoc && (
                <button
                  onClick={handleSaveDoc}
                  disabled={isSaving}
                  className="flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-700 text-white px-3 py-1.5 rounded-xl text-xs font-bold shadow-sm transition active:scale-95"
                >
                  <Save className="w-3.5 h-3.5" />
                  <span>{isSaving ? 'Saving…' : 'Save'}</span>
                </button>
              )}
            </div>
          }
        />
      )}

      {/* Hidden File Input for direct document uploads */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".docx,.pdf,.md,.markdown,.txt,.csv,.json"
        className="hidden"
        onChange={handleFileUpload}
      />

      {/* Main Workspace Body */}
      <div className="flex-1 flex gap-3 xl:gap-6 overflow-hidden min-h-0 pt-2">
        {/* 1. Left Sidebar: Notion Document Tree & Quick Action Rail */}
        {!isZenMode && (
          // Below lg the page list and the open page take turns (the app's own sidebars use the room).
          <div className={`${selectedDoc ? 'hidden lg:flex' : 'flex'} w-full lg:w-64 xl:w-80 p-4 rounded-2xl border border-slate-200 flex-col h-full bg-white shadow-sm flex-shrink-0`}>
            {/* Header */}
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <BookOpen className="w-4 h-4 text-indigo-600" />
                <h3 className="font-extrabold text-xs text-slate-700">
                  Pages & Hierarchy
                </h3>
              </div>
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isImporting}
                  title="Import a document (.docx, .pdf, .md, .txt)"
                  aria-label="Import a document"
                  className="p-1.5 bg-slate-100 hover:bg-slate-200 disabled:opacity-60 text-slate-700 rounded-xl border border-slate-200 transition"
                >
                  {isImporting ? <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" /> : <Upload className="w-3.5 h-3.5" aria-hidden="true" />}
                </button>
                {isImporting && (
                  <span className="text-xs text-slate-600 tabular-nums" role="status">{importProgress < 100 ? `${importProgress}%` : 'Importing…'}</span>
                )}
                <button
                  onClick={() => {
                    setCreateParentId(null);
                    setNewDocTitle('');
                    setNewDocIcon('📄');
                    setShowCreateModal(true);
                  }}
                  className="flex items-center gap-1 bg-indigo-600 hover:bg-indigo-700 text-white px-2.5 py-1.5 rounded-xl text-xs font-bold transition shadow-sm active:scale-95"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>New Page</span>
                </button>
              </div>
            </div>

            {/* Real-time Document Search Input */}
            <div className="relative mb-3">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-2.5" />
              <input aria-label="Search pages or content"
                type="text"
                placeholder="Search pages or content…"
                className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-9 pr-3 py-2 text-xs text-slate-900 focus:outline-none focus:border-indigo-600 placeholder-slate-400 transition"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
              {isSearching && (
                <span className="absolute right-3 top-2.5 text-xs text-slate-400 tabular-nums animate-pulse">
                  ...
                </span>
              )}
            </div>

            {/* Starter Templates Quick Banner */}
            <button
              onClick={() => setShowTemplatesModal(true)}
              className="w-full mb-3 flex items-center justify-between p-2.5 rounded-2xl bg-indigo-50 border border-indigo-200 hover:border-indigo-300 text-xs text-indigo-700 transition group shadow-sm"
            >
              <div className="flex items-center gap-2">
                <Sparkles className="w-3.5 h-3.5 text-indigo-600 group-hover:rotate-12 transition" />
                <span className="font-bold">Templates</span>
              </div>
              <span className="text-xs bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded-full tabular-nums font-bold">
                3 Specs
              </span>
            </button>

            {/* Page List: Search Results or Nested Tree */}
            <div className="flex-1 overflow-y-auto space-y-1 pr-1">
              {searchResults !== null ? (
                <div className="space-y-1">
                  <div className="text-xs uppercase font-bold text-slate-400 px-2 py-1 flex items-center justify-between">
                    <span>Search Results ({searchResults.length})</span>
                    <button
                      onClick={() => setSearchQuery('')}
                      className="text-indigo-600 hover:underline"
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
                        className="w-full text-left p-2.5 rounded-xl border border-slate-200 bg-slate-50 hover:bg-indigo-50 hover:border-indigo-500 transition text-xs space-y-1"
                      >
                        <div className="flex items-center gap-1.5 font-bold text-slate-800">
                          <span>{res.icon || '📄'}</span>
                          <span className="truncate">{res.title}</span>
                        </div>
                        {res.match_snippet && (
                          <p className="text-xs text-slate-500 tabular-nums line-clamp-2 bg-white/70 p-1.5 rounded border border-slate-200">
                            {res.match_snippet}
                          </p>
                        )}
                      </button>
                    ))
                  )}
                </div>
              ) : (
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
                        className="text-indigo-600 hover:underline font-bold"
                      >
                        Create your first page
                      </button>
                    </div>
                  ) : (
                    docTree.map((node) => renderTreeNode(node))
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {/* 2. Center Notion Canvas: Direct-Write Interactive Preview (Item 13) */}
        {selectedDoc ? (
          <div className="flex-1 min-w-0 bg-white rounded-2xl border border-slate-200 shadow-sm flex flex-col h-full overflow-hidden min-h-0">
            {/* Top Toolbar: Breadcrumb + Action Controls */}
            <div className="p-3.5 border-b border-slate-200 flex items-center justify-between bg-slate-50/50 flex-wrap gap-2">
              <div className="flex items-center gap-1.5 text-xs text-slate-500 overflow-hidden">
                <button
                  type="button"
                  onClick={() => setSelectedDoc(null)}
                  className="hover:text-indigo-600 font-medium transition flex items-center gap-1"
                  aria-label="Back to all pages"
                >
                  <ArrowLeft className="w-3.5 h-3.5 lg:hidden" aria-hidden="true" />
                  Workspace
                </button>

                {breadcrumbs.map((crumb) => (
                  <React.Fragment key={crumb.id}>
                    <ChevronRight className="w-3 h-3 text-slate-300 shrink-0" />
                    <button
                      type="button"
                      onClick={() => handleSelectDoc(crumb)}
                      className="hover:text-indigo-600 font-medium transition truncate max-w-[120px]"
                    >
                      {crumb.icon || '📄'} {crumb.title}
                    </button>
                  </React.Fragment>
                ))}

                <ChevronRight className="w-3 h-3 text-slate-300 shrink-0" />
                <span className="font-bold text-slate-900 truncate max-w-[180px]">
                  {docIcon} {docTitle || 'Untitled'}
                </span>
              </div>

              {/* View Mode & Export Tools */}
              <div className="flex flex-wrap items-center gap-2 min-w-0 max-w-full">
                {/* Mode Selector */}
                <div className="bg-slate-100 p-1 rounded-xl border border-slate-200 flex items-center gap-1 text-xs overflow-x-auto max-w-full whitespace-nowrap" role="group" aria-label="View mode">
                  {pdfOriginal && (
                    <button
                      onClick={() => setViewMode('original')}
                      aria-pressed={viewMode === 'original'}
                      className={`px-3 py-1 rounded-lg font-bold flex items-center gap-1.5 transition ${
                        viewMode === 'original' ? 'bg-indigo-600 text-white shadow-sm' : 'text-slate-600 hover:text-slate-900'
                      }`}
                      title="The uploaded PDF exactly as it is"
                    >
                      <FileText className="w-3.5 h-3.5" aria-hidden="true" />
                      <span>Original PDF</span>
                    </button>
                  )}
                  <button
                    onClick={() => setViewMode('preview')}
                    aria-pressed={viewMode === 'preview'}
                    className={`px-3 py-1 rounded-lg font-bold flex items-center gap-1.5 transition ${
                      viewMode === 'preview'
                        ? 'bg-indigo-600 text-white shadow-sm'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                    title="Preview the formatted document"
                  >
                    <Eye className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>Preview</span>
                  </button>
                  <button
                    onClick={() => setViewMode('direct')}
                    aria-pressed={viewMode === 'direct'}
                    className={`px-3 py-1 rounded-lg font-bold flex items-center gap-1.5 transition ${
                      viewMode === 'direct'
                        ? 'bg-indigo-600 text-white shadow-sm'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                    title="Direct-Write Canvas (Write directly in formatted page)"
                  >
                    <Wand2 className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>Edit</span>
                  </button>
                  <button
                    onClick={() => setViewMode('split')}
                    className={`px-2.5 py-1 rounded-lg font-bold flex items-center gap-1 transition ${
                      viewMode === 'split'
                        ? 'bg-indigo-600 text-white shadow-sm'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                    title="Split Canvas"
                  >
                    <Columns className="w-3 h-3" />
                    <span>Split</span>
                  </button>
                  <button
                    onClick={() => setViewMode('code')}
                    className={`px-2.5 py-1 rounded-lg font-bold flex items-center gap-1 transition ${
                      viewMode === 'code'
                        ? 'bg-indigo-600 text-white shadow-sm'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                    title="Raw Markdown"
                  >
                    <Code className="w-3 h-3" />
                    <span>Raw MD</span>
                  </button>
                </div>

                {/* Export Dropdown */}
                <div className="flex items-center gap-1 bg-slate-100 border border-slate-200 rounded-xl p-1">
                  <button
                    onClick={() => handleExport('md')}
                    title="Download Markdown (.md)"
                    className="px-2.5 py-1 text-slate-700 hover:text-slate-900 text-xs font-semibold hover:bg-white rounded-lg transition flex items-center gap-1"
                  >
                    <Download className="w-3 h-3 text-indigo-600" />
                    <span>MD</span>
                  </button>
                  <button
                    onClick={() => handleExport('html')}
                    title="Download HTML"
                    className="px-2 py-1 text-slate-700 hover:text-slate-900 text-xs font-semibold hover:bg-white rounded-lg transition"
                  >
                    HTML
                  </button>
                </div>

                {/* Zen Mode */}
                <button
                  onClick={() => setIsZenMode(!isZenMode)}
                  className="p-1.5 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-xl border border-slate-200 transition"
                  title={isZenMode ? 'Exit Zen Mode' : 'Distraction-free Zen Mode'}
                >
                  {isZenMode ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4 text-indigo-600" />}
                </button>

                {/* Delete Doc */}
                <button
                  onClick={async () => {
                    const ok = await confirmDialog(`Delete page "${docTitle}" and its sub-pages?`, { confirmLabel: 'Delete' });
                    if (!ok) return;
                    try {
                      await api.deleteDocument(workspaceId, selectedDoc.id);
                      if (onRefreshDocuments) await onRefreshDocuments();
                      await loadDocumentTree();
                      setSelectedDoc(null);
                    } catch (err) {
                      notify(`Could not delete document: ${err.message}`, 'error');
                    }
                  }}
                  className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-xl border border-slate-200 transition"
                  title="Delete Document"
                  aria-label="Delete document"
                >
                  <Trash2 className="w-4 h-4" aria-hidden="true" />
                </button>
              </div>
            </div>

            {/* Document Header: Interactive Emoji Icon Picker + Large Title */}
            <div className="p-6 pb-2 border-b border-slate-100 flex items-center gap-4 relative">
              {/* Emoji Picker Button */}
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setShowEmojiPicker(!showEmojiPicker)}
                  title="Change page icon"
                  className="w-14 h-14 rounded-2xl bg-slate-100 hover:bg-indigo-50 border border-slate-200 hover:border-indigo-400 flex items-center justify-center text-3xl transition shadow-sm"
                >
                  {docIcon}
                </button>

                {/* Emoji Selection Popover */}
                {showEmojiPicker && (
                  <div className="absolute left-0 top-16 bg-white border border-slate-200 p-3 rounded-2xl shadow-2xl z-30 grid grid-cols-6 gap-2 w-64 animate-in fade-in zoom-in-95">
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
              <input aria-label="Document title"
                type="text"
                className="text-2xl sm:text-3xl font-extrabold bg-transparent text-slate-900 focus:outline-none flex-1 min-w-0 placeholder-slate-300 tracking-tight"
                value={docTitle}
                onChange={(e) => setDocTitle(e.target.value)}
                placeholder="Untitled Page…"
              />
            </div>

            {/* Notion Slash Command Ribbon & Block Inserters */}
            <div className={`relative ${viewMode === 'original' ? 'hidden' : 'flex'} items-center gap-1.5 bg-slate-50 px-4 py-2 border-b border-slate-200 overflow-x-auto text-xs`}>
              <button
                type="button"
                onClick={() => setShowSlashMenu(!showSlashMenu)}
                className="px-2.5 py-1 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 font-bold rounded-lg border border-indigo-200 transition flex items-center gap-1.5 shadow-xs"
              >
                <Plus className="w-3.5 h-3.5 text-indigo-600" />
                <span>Insert Block</span>
              </button>

              <div className="w-[1px] h-4 bg-slate-200 mx-1" />

              <button
                onClick={() => insertSlashBlock('h1')}
                className="px-2 py-1 hover:bg-slate-200 rounded-lg text-slate-700 font-bold transition flex items-center gap-1"
                title="Heading 1"
              >
                <Heading className="w-3.5 h-3.5" /> H1
              </button>
              <button
                onClick={() => insertSlashBlock('h2')}
                className="px-2 py-1 hover:bg-slate-200 rounded-lg text-slate-700 font-bold transition flex items-center gap-1"
                title="Heading 2"
              >
                <Heading className="w-3 h-3" /> H2
              </button>
              <button
                onClick={() => insertSlashBlock('todo')}
                className="px-2.5 py-1 hover:bg-slate-200 rounded-lg text-slate-700 font-semibold transition flex items-center gap-1"
                title="Interactive To-Do Checklist"
              >
                <CheckSquare className="w-3.5 h-3.5 text-emerald-600" />
                <span>To-Do</span>
              </button>
              <button
                onClick={() => insertSlashBlock('bullet')}
                className="px-2 py-1 hover:bg-slate-200 rounded-lg text-slate-700 font-semibold transition flex items-center gap-1"
                title="Bullet List"
              >
                <List className="w-3.5 h-3.5" />
                <span>Bullet</span>
              </button>
              <button
                onClick={() => insertSlashBlock('callout')}
                className="px-2 py-1 hover:bg-slate-200 rounded-lg text-slate-700 font-semibold transition flex items-center gap-1"
                title="Callout card"
              >
                <Lightbulb className="w-3.5 h-3.5 text-amber-500" />
                <span>Callout</span>
              </button>
              <button
                onClick={() => insertSlashBlock('code')}
                className="px-2 py-1 hover:bg-slate-200 rounded-lg text-slate-700 font-semibold transition flex items-center gap-1"
                title="Code Block"
              >
                <Code className="w-3.5 h-3.5 text-slate-600" />
                <span>Code</span>
              </button>
              <button
                onClick={() => insertSlashBlock('divider')}
                className="px-2 py-1 hover:bg-slate-200 rounded-lg text-slate-700 font-semibold transition flex items-center gap-1"
                title="Divider Line"
              >
                <Minus className="w-3.5 h-3.5" />
                <span>Divider</span>
              </button>
              <button
                onClick={() => imageInputRef.current?.click()}
                disabled={isUploadingImage}
                className="px-2 py-1 hover:bg-slate-200 disabled:opacity-60 rounded-lg text-slate-700 font-semibold transition flex items-center gap-1"
                title="Insert an image"
              >
                {isUploadingImage ? <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" /> : <ImageIcon className="w-3.5 h-3.5 text-emerald-600" aria-hidden="true" />}
                <span>Image</span>
              </button>
              <input
                ref={imageInputRef}
                type="file"
                accept="image/png,image/jpeg,image/gif,image/webp,image/bmp"
                className="hidden"
                aria-hidden="true"
                tabIndex={-1}
                onChange={handleInsertImage}
              />

              {/* Slash Command Dropdown Popover */}
              {showSlashMenu && (
                <div className="absolute left-4 top-10 bg-white border border-slate-200 p-2 rounded-2xl shadow-2xl z-40 w-56 space-y-1 animate-in fade-in zoom-in-95">
                  <div className="text-xs font-bold text-slate-400 px-2 py-1">
                    Basic Blocks
                  </div>
                  <button
                    onClick={() => insertSlashBlock('h1')}
                    className="w-full text-left px-2.5 py-1.5 hover:bg-indigo-50 rounded-lg flex items-center gap-2 text-slate-700 font-medium"
                  >
                    <Heading className="w-3.5 h-3.5 text-indigo-600" /> Heading 1
                  </button>
                  <button
                    onClick={() => insertSlashBlock('h2')}
                    className="w-full text-left px-2.5 py-1.5 hover:bg-indigo-50 rounded-lg flex items-center gap-2 text-slate-700 font-medium"
                  >
                    <Heading className="w-3.5 h-3.5 text-indigo-600" /> Heading 2
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

            {/* Document Statistics Footer */}
            <div className={`${viewMode === 'original' ? 'hidden' : 'flex'} flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs text-slate-500 px-3 sm:px-6 py-2 border-b border-slate-100 tabular-nums bg-slate-50/40 whitespace-nowrap`}>
              <div className="flex items-center gap-3">
                <span>{wordCount} words</span>
                <span>•</span>
                <span>{charCount} characters</span>
                <span>•</span>
                <span>~{readTime} min read</span>
              </div>

              <div className="flex items-center gap-2">
                {lastSaved && (
                  <span className="flex items-center gap-1">
                    <CheckCircle2 className="w-3 h-3 text-emerald-700" aria-hidden="true" />
                    Saved {lastSaved.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                  </span>
                )}
              </div>
            </div>

            {/* 3. Document Workspace Canvas: Direct-Write in Preview (Item 13) */}
            <div className="flex-1 overflow-hidden p-4 sm:p-6 flex gap-4 min-h-0 bg-slate-50/30">
              {/* ORIGINAL: the uploaded PDF, untouched (pages, fonts, images, layout) */}
              {viewMode === 'original' && pdfOriginal && (
                <div className="flex-1 h-full min-h-0 flex flex-col gap-2">
                  <p className="text-xs text-slate-600">
                    The original file, exactly as uploaded. "Edit" works on an extracted text copy; the PDF itself is never changed.
                  </p>
                  <div className="flex-1 min-h-[60vh]">
                    <FilePreview workspaceId={workspaceId} file={pdfOriginal} fill />
                  </div>
                </div>
              )}

              {/* PREVIEW MODE: the document as a formatted, read-only page */}
              {viewMode === 'preview' && (
                <article
                  aria-label={`Preview of ${docTitle || 'document'}`}
                  className="flex-1 h-full overflow-y-auto bg-white rounded-2xl border border-slate-200 shadow-xs"
                >
                  <div className="max-w-3xl mx-auto px-6 sm:px-10 py-8">
                    {docContent.trim() ? (
                      renderFormattedBlocks(docContent)
                    ) : (
                      <div className="text-center py-16 space-y-3">
                        <p className="text-sm text-slate-600">This page is empty.</p>
                        <button
                          type="button"
                          onClick={() => setViewMode('direct')}
                          className="text-sm font-semibold text-indigo-700 hover:underline"
                        >
                          Start writing
                        </button>
                      </div>
                    )}
                  </div>
                </article>
              )}

              {/* PRIMARY MODE: Direct Notion Canvas */}
              {viewMode === 'direct' && (
                <div className="flex-1 h-full flex flex-col bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
                  {/* Top Live Preview Header with Checklist Toggles */}
                  <div className="p-4 bg-slate-50/80 border-b border-slate-200 flex items-center justify-between text-xs text-slate-600">
                    <span className="font-semibold flex items-center gap-1.5 text-slate-800">
                      <Wand2 className="w-3.5 h-3.5 text-indigo-600" />
                      Write and preview simultaneously — type directly into the canvas below
                    </span>
                    <span className="text-xs text-slate-400 tabular-nums">
                      Markdown shortcuts rendered live
                    </span>
                  </div>

                  {/* Editor first, then a read-only formatted preview below it */}
                  <div className="flex-1 overflow-y-auto p-6 space-y-6">
                    <div className="space-y-2">
                      <label htmlFor="doc-direct-editor" className="text-xs font-bold text-slate-600 flex items-center justify-between">
                        <span>Write</span>
                        <span className="text-slate-500 font-medium normal-case">Markdown: # heading, - [ ] checklist, &gt; callout</span>
                      </label>
                      <textarea
                        id="doc-direct-editor"
                        ref={directTextareaRef}
                        value={docContent}
                        onChange={(e) => setDocContent(e.target.value)}
                        placeholder="Start writing… Use # for headings, - [ ] for checklists, > for callouts"
                        rows={12}
                        className="w-full bg-white border border-slate-300 rounded-2xl p-5 text-sm text-slate-900 focus:border-indigo-600 font-sans leading-relaxed resize-y shadow-xs"
                      />
                    </div>

                    <section aria-label="Formatted preview" className="p-4 bg-slate-50/60 rounded-2xl border border-slate-200/80">
                      <div className="text-xs font-bold text-slate-600 mb-3 flex items-center justify-between">
                        <span>Preview (read-only)</span>
                        <span className="text-slate-500 font-medium normal-case">Checkboxes can be toggled here</span>
                      </div>
                      <div
                        onClick={(e) => {
                          if (!e.target.closest('input, button, a')) directTextareaRef.current?.focus();
                        }}
                      >
                        {docContent.trim() ? (
                          renderFormattedBlocks(docContent)
                        ) : (
                          <p className="text-sm text-slate-500 italic">Nothing to preview yet.</p>
                        )}
                      </div>
                    </section>
                  </div>
                </div>
              )}

              {/* SPLIT VIEW MODE: Direct write on left, live formatted canvas on right */}
              {viewMode === 'split' && (
                <>
                  <div className="flex-1 h-full flex flex-col bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
                    <div className="p-3 bg-slate-50 border-b border-slate-200 text-xs font-bold text-slate-700">
                      Direct-Write Canvas
                    </div>
                    <textarea aria-label="Document content"
                      ref={directTextareaRef}
                      value={docContent}
                      onChange={(e) => setDocContent(e.target.value)}
                      placeholder="Write markdown directly…"
                      className="w-full flex-1 p-5 text-sm text-slate-900 focus:outline-none font-sans leading-relaxed resize-none"
                    />
                  </div>
                  <div className="flex-1 h-full bg-white rounded-2xl border border-slate-200 shadow-xs p-6 overflow-y-auto">
                    <div className="text-xs font-bold text-slate-400 mb-4">
                      Interactive Live Render
                    </div>
                    {renderFormattedBlocks(docContent)}
                  </div>
                </>
              )}

              {/* RAW CODE MODE */}
              {viewMode === 'code' && (
                <div className="flex-1 h-full bg-slate-900 rounded-2xl border border-slate-800 p-6 overflow-hidden flex flex-col shadow-inner">
                  <div className="text-xs tabular-nums text-slate-400 mb-3 flex items-center justify-between">
                    <span>Raw Markdown Content</span>
                    <span>UTF-8</span>
                  </div>
                  <textarea aria-label="Raw markdown content"
                    ref={rawTextareaRef}
                    value={docContent}
                    onChange={(e) => setDocContent(e.target.value)}
                    className="w-full flex-1 bg-transparent text-slate-100 font-mono text-xs focus:outline-none leading-relaxed resize-none"
                  />
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="hidden lg:flex flex-1 flex-col items-center justify-center text-center space-y-4 max-w-md mx-auto">
            <div className="w-16 h-16 rounded-2xl bg-indigo-50 border border-indigo-100 flex items-center justify-center text-indigo-600 shadow-sm">
              <BookOpen className="w-8 h-8" />
            </div>
            <div>
              <h3 className="font-bold text-lg text-slate-900">No Page Selected</h3>
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
                className="flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2.5 rounded-2xl text-xs font-bold shadow-md shadow-indigo-600/30 transition active:scale-95"
              >
                <Plus className="w-4 h-4" />
                <span>Create New Page</span>
              </button>
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={isImporting}
                className="flex items-center gap-1.5 bg-slate-900 hover:bg-slate-800 disabled:opacity-60 text-slate-200 px-4 py-2.5 rounded-2xl text-xs font-bold border border-slate-800 transition active:scale-95"
              >
                <Upload className="w-4 h-4 text-indigo-400" aria-hidden="true" />
                <span>{isImporting ? (importProgress < 100 ? `Uploading ${importProgress}%` : 'Importing…') : 'Import Word, PDF or Markdown'}</span>
              </button>
            </div>
          </div>
        )}
      </div>

      {/* New Page Creation Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div data-modal className="bg-white rounded-3xl border border-slate-200 p-6 w-full max-w-md shadow-2xl space-y-5 animate-in fade-in zoom-in-95">
            <div className="flex items-center justify-between">
              <h3 className="font-extrabold text-lg text-slate-900">
                {createParentId ? 'Create Nested Sub-page' : 'Create new page'}
              </h3>
              <button
                onClick={() => setShowCreateModal(false)}
                className="text-slate-400 hover:text-slate-600 text-lg font-bold"
              >
                ✕
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="text-xs font-bold text-slate-700 block mb-1.5">
                  Page Icon
                </label>
                <div className="flex items-center gap-2 overflow-x-auto pb-2">
                  {EMOJI_PICKER_OPTIONS.slice(0, 10).map((em) => (
                    <button
                      key={em}
                      type="button"
                      onClick={() => setNewDocIcon(em)}
                      className={`text-xl p-2 rounded-xl border transition ${
                        newDocIcon === em
                          ? 'border-indigo-600 bg-indigo-50 scale-110'
                          : 'border-slate-200 hover:bg-slate-50'
                      }`}
                    >
                      {em}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label htmlFor="documents-field-1" className="text-xs font-bold text-slate-700 block mb-1.5">
                  Page Title
                </label>
                <input id="documents-field-1"
                  type="text"
                  placeholder="e.g. Technical Architecture RFC"
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2.5 text-sm text-slate-900 focus:outline-none focus:border-indigo-600"
                  value={newDocTitle}
                  onChange={(e) => setNewDocTitle(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      handleCreateNewDoc(newDocTitle, '', createParentId, newDocIcon);
                    }
                  }}
                  autoFocus
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-2.5 pt-2">
              <button
                type="button"
                onClick={() => setShowCreateModal(false)}
                className="px-4 py-2 rounded-xl text-xs font-bold text-slate-600 hover:bg-slate-100 transition"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => handleCreateNewDoc(newDocTitle, '', createParentId, newDocIcon)}
                className="px-5 py-2 rounded-xl text-xs font-bold bg-indigo-600 hover:bg-indigo-700 text-white shadow-md shadow-indigo-600/30 transition active:scale-95"
              >
                Create Page
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Starter Templates Modal */}
      {showTemplatesModal && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div data-modal className="bg-white rounded-3xl border border-slate-200 p-6 w-full max-w-xl shadow-2xl space-y-5 animate-in fade-in zoom-in-95">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-indigo-600" />
                <h3 className="font-extrabold text-lg text-slate-900">
                  Select a template
                </h3>
              </div>
              <button
                onClick={() => setShowTemplatesModal(false)}
                className="text-slate-400 hover:text-slate-600 text-lg font-bold"
              >
                ✕
              </button>
            </div>

            <div className="space-y-3">
              {DOCUMENT_TEMPLATES.map((tmpl) => (
                <div
                  key={tmpl.title}
                  onClick={() => handleCreateNewDoc(tmpl.title, tmpl.content, null, tmpl.icon)}
                  className="p-4 rounded-2xl border border-slate-200 hover:border-indigo-600 hover:bg-indigo-50/50 cursor-pointer transition flex items-start gap-3.5 group shadow-xs"
                >
                  <span className="text-2xl p-2 rounded-xl bg-slate-100 group-hover:bg-white transition shrink-0">
                    {tmpl.icon}
                  </span>
                  <div className="flex-1 min-w-0">
                    <h4 className="font-bold text-sm text-slate-900 group-hover:text-indigo-600 transition">
                      {tmpl.title}
                    </h4>
                    <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">
                      {tmpl.description}
                    </p>
                  </div>
                  <ChevronRight className="w-4 h-4 text-slate-300 group-hover:text-indigo-600 self-center shrink-0" />
                </div>
              ))}
            </div>

            <div className="flex justify-end pt-2">
              <button
                type="button"
                onClick={() => setShowTemplatesModal(false)}
                className="px-4 py-2 rounded-xl text-xs font-bold text-slate-600 hover:bg-slate-100 transition"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
