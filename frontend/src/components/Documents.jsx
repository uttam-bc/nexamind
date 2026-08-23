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
  Clock,
  Quote,
  Upload,
  Eye,
  Edit3,
  Columns,
  Maximize2,
  Minimize2,
  FileUp,
  FileCheck,
  BookOpen,
  Share2,
  Printer,
  Sparkle,
  Layers,
} from 'lucide-react';
import { api } from '../api';

const DOCUMENT_TEMPLATES = [
  {
    title: 'Product Requirement Document (PRD)',
    description: 'Executive overview, target personas, user stories, and acceptance criteria.',
    content: `# Product Requirement Document (PRD)

## 1. Executive Summary
Briefly describe the product vision, primary problem solved, and expected business impact.

## 2. Target Audience & User Personas
- **Primary Persona:** Software Engineers & Tech Leads
- **Secondary Persona:** Engineering Managers & Product Owners

## 3. Core Features & Functional Requirements
1. **Real-Time Collaboration:** Synchronized workspace state.
2. **AI-Driven Automation:** Automated meeting minutes and task detection.
3. **Enterprise Security:** Row-level security and workspace isolation.

## 4. Technical Constraints & Architecture
- Supabase PostgreSQL with asynchronous SQLAlchemy ORM.
- Fast, reactive React 18 frontend with Tailwind styling.

## 5. Success Metrics & KPIs
- Daily Active Users (DAU)
- Meeting MoM generation completion rate > 98%
`,
  },
  {
    title: 'System Architecture Spec (RFC)',
    description: 'Detailed system architecture, data models, API endpoints, and sequence flows.',
    content: `# System Architecture Specification (RFC)

## 1. Context & Motivation
Explain the architectural rationale and key design trade-offs.

## 2. Proposed Architecture
\`\`\`
[ Client App ] ─── (REST / WS) ───> [ FastAPI Gateway ] ───> [ Supabase PostgreSQL ]
                                           │
                                           └───> [ Groq / Gemini AI Engine ]
\`\`\`

## 3. Data Schema & Entities
- **Workspaces:** Scopes data isolation across teams.
- **Documents:** Rich text specifications with markdown serialization.
- **Tasks:** Sprint Kanban items with status, priority, and assignees.

## 4. Security & Access Control
- JWT Bearer Authentication with HMAC SHA-256 signatures.
- Workspace membership verification on every API request.
`,
  },
  {
    title: 'Sprint Kickoff & Meeting Notes',
    description: 'Discussion agenda, key architectural decisions, and assigned action items.',
    content: `# Sprint Kickoff & Meeting Notes

**Date:** ${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}  
**Attendees:** Team Leads, Core Engineers, Product Lead  

---

## 🎯 Sprint Goals
- Deliver end-to-end meeting transcript and MoM synthesis.
- Provide WhatsApp-style quick notes in Solo workspace.
- Deploy full-page document editor with drag-and-drop file upload.

## 💡 Key Decisions
1. Documents will support direct .txt/.md upload and instant conversion.
2. Login will always default to private Solo mode.

## 📋 Action Items
- [ ] Implement document file dropzone parser (@frontend)
- [ ] Verify test suite passes 100% green (@qa)
- [ ] Deploy v2.0 release candidate (@devops)
`,
  },
];

export default function Documents({ workspaceId, documents, onRefreshDocuments }) {
  const [selectedDoc, setSelectedDoc] = useState(null);
  const [docTitle, setDocTitle] = useState('');
  const [docContent, setDocContent] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [lastSaved, setLastSaved] = useState(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showTemplatesModal, setShowTemplatesModal] = useState(false);
  const [newDocTitle, setNewDocTitle] = useState('');
  const [editorMode, setEditorMode] = useState('split'); // 'edit' | 'preview' | 'split'
  const [isZenMode, setIsZenMode] = useState(false);
  const [isUploading, setIsUploading] = useState(false);

  const fileInputRef = useRef(null);
  const textareaRef = useRef(null);

  useEffect(() => {
    if (documents && documents.length > 0) {
      if (!selectedDoc || !documents.some((d) => d.id === selectedDoc.id)) {
        handleSelectDoc(documents[0]);
      }
    } else {
      setSelectedDoc(null);
      setDocTitle('');
      setDocContent('');
    }
  }, [documents]);

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
    setLastSaved(new Date());
  };

  // Debounced auto-save
  useEffect(() => {
    if (!selectedDoc) return;
    const timer = setTimeout(() => {
      handleSilentSave();
    }, 2500);
    return () => clearTimeout(timer);
  }, [docContent, docTitle]);

  const handleSilentSave = async () => {
    if (!selectedDoc || !docTitle.trim()) return;
    try {
      await api.updateDocument(workspaceId, selectedDoc.id, {
        title: docTitle.trim(),
        content: { text: docContent },
      });
      setLastSaved(new Date());
      if (onRefreshDocuments) onRefreshDocuments();
    } catch (err) {
      // silent background save
    }
  };

  const handleSaveDoc = async () => {
    if (!selectedDoc) return;
    setIsSaving(true);
    try {
      await api.updateDocument(workspaceId, selectedDoc.id, {
        title: docTitle.trim() || 'Untitled Document',
        content: { text: docContent },
      });
      setLastSaved(new Date());
      if (onRefreshDocuments) await onRefreshDocuments();
    } catch (err) {
      alert(`Save error: ${err.message}`);
    } finally {
      setIsSaving(false);
    }
  };

  const handleCreateNewDoc = async (title = 'Untitled Document', initialContent = '') => {
    try {
      const created = await api.createDocument(workspaceId, title.trim() || 'Untitled Document', {
        text: initialContent || `# ${title}\n\nStart writing your document here...`,
      });
      if (onRefreshDocuments) await onRefreshDocuments();
      handleSelectDoc(created);
      setShowCreateModal(false);
      setShowTemplatesModal(false);
      setNewDocTitle('');
    } catch (err) {
      alert(`Could not create document: ${err.message}`);
    }
  };

  // Direct Document File Upload (.txt, .md, .docx, .json)
  const handleFileUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsUploading(true);
    try {
      const reader = new FileReader();
      reader.onload = async (event) => {
        const textContent = event.target.result;
        const baseName = file.name.replace(/\.[^/.]+$/, '');
        const created = await api.createDocument(workspaceId, baseName, {
          text: typeof textContent === 'string' ? textContent : '',
        });
        if (onRefreshDocuments) await onRefreshDocuments();
        handleSelectDoc(created);
        setIsUploading(false);
      };
      reader.onerror = () => {
        alert('Could not read file.');
        setIsUploading(false);
      };
      reader.readAsText(file);
    } catch (err) {
      alert(`Upload error: ${err.message}`);
      setIsUploading(false);
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
      contentToExport = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${docTitle}</title><style>body{font-family:system-ui,sans-serif;max-width:800px;margin:40px auto;padding:0 20px;line-height:1.6;color:#1e293b;}</style></head><body><h1>${docTitle}</h1><pre style="white-space:pre-wrap;">${docContent}</pre></body></html>`;
    }

    const blob = new Blob([contentToExport], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${docTitle.replace(/\s+/g, '_')}.${ext}`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Helper to insert markdown syntax at cursor position
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

  // Document statistics
  const wordCount = docContent.trim() ? docContent.trim().split(/\s+/).length : 0;
  const charCount = docContent.length;
  const readTime = Math.max(1, Math.ceil(wordCount / 200));

  const filteredDocs = (documents || []).filter((d) =>
    d.title.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className={`h-full flex gap-6 select-none ${isZenMode ? 'fixed inset-0 z-50 bg-slate-950 p-6' : ''}`}>
      {/* Hidden File Input for direct document uploads */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".txt,.md,.markdown,.json,.csv,.doc,.docx"
        className="hidden"
        onChange={handleFileUpload}
      />

      {/* Left Sidebar: Document List & Actions */}
      {!isZenMode && (
        <div className="w-80 glass-panel p-4 rounded-3xl border border-slate-800 flex flex-col h-full bg-slate-900/80 shadow-2xl">
          {/* Header */}
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <BookOpen className="w-4 h-4 text-indigo-400" />
              <h3 className="font-extrabold text-xs uppercase tracking-wider text-slate-300">
                Documents ({filteredDocs.length})
              </h3>
            </div>
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => fileInputRef.current?.click()}
                title="Upload document file (.txt, .md, .docx)"
                className="p-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl border border-slate-700/80 transition"
              >
                <Upload className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => setShowCreateModal(true)}
                className="flex items-center gap-1 bg-indigo-600 hover:bg-indigo-500 text-white px-2.5 py-1.5 rounded-xl text-xs font-bold transition shadow-md shadow-indigo-600/30 active:scale-95"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>New</span>
              </button>
            </div>
          </div>

          {/* Search bar */}
          <div className="relative mb-3">
            <Search className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-2.5" />
            <input
              type="text"
              placeholder="Search documents..."
              className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-9 pr-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-indigo-500"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>

          {/* Template Quick Starter Banner */}
          <button
            onClick={() => setShowTemplatesModal(true)}
            className="w-full mb-3 flex items-center justify-between p-2.5 rounded-2xl bg-gradient-to-r from-indigo-950/60 to-purple-950/60 border border-indigo-500/30 hover:border-indigo-500/60 text-xs text-indigo-300 transition group"
          >
            <div className="flex items-center gap-2">
              <Sparkles className="w-3.5 h-3.5 text-indigo-400 group-hover:rotate-12 transition" />
              <span className="font-bold">Starter Templates</span>
            </div>
            <span className="text-[10px] bg-indigo-500/20 px-2 py-0.5 rounded-full font-mono font-bold">
              3 Specs
            </span>
          </button>

          {/* Document list */}
          <div className="flex-1 overflow-y-auto space-y-1.5 pr-1">
            {filteredDocs.map((doc) => {
              const isSelected = selectedDoc?.id === doc.id;
              return (
                <button
                  key={doc.id}
                  onClick={() => handleSelectDoc(doc)}
                  className={`w-full text-left p-3 rounded-2xl transition border group relative ${
                    isSelected
                      ? 'bg-indigo-600/20 border-indigo-500 text-slate-100 font-bold shadow-md shadow-indigo-600/10'
                      : 'bg-slate-950/40 border-slate-800/80 text-slate-300 hover:bg-slate-800/60'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <FileText
                        className={`w-4 h-4 flex-shrink-0 ${
                          isSelected ? 'text-indigo-400' : 'text-slate-500 group-hover:text-slate-300'
                        }`}
                      />
                      <span className="text-xs truncate">{doc.title}</span>
                    </div>
                  </div>
                  <div className="flex items-center justify-between mt-1 text-[10px] text-slate-500">
                    <span>{doc.created_at ? new Date(doc.created_at).toLocaleDateString() : 'Draft'}</span>
                    <span className="font-mono">{isSelected ? 'Active' : ''}</span>
                  </div>
                </button>
              );
            })}

            {filteredDocs.length === 0 && (
              <div className="text-center text-slate-500 py-12 text-xs space-y-2">
                <FileText className="w-8 h-8 mx-auto text-slate-600 opacity-50" />
                <p>No documents found.</p>
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="text-indigo-400 hover:underline font-bold"
                >
                  Upload a document
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Main Document Canvas & Rich Editor */}
      <div className="flex-1 glass-panel p-6 rounded-3xl border border-slate-800 flex flex-col h-full bg-slate-950/70 shadow-2xl overflow-hidden">
        {selectedDoc ? (
          <div className="flex flex-col h-full space-y-4">
            {/* Top Bar: Title & Primary Actions */}
            <div className="flex items-center justify-between border-b border-slate-800/80 pb-3 gap-4">
              <input
                type="text"
                className="text-2xl font-black bg-transparent text-slate-100 focus:outline-none flex-1 placeholder-slate-600 tracking-tight"
                value={docTitle}
                onChange={(e) => setDocTitle(e.target.value)}
                placeholder="Document Title..."
              />

              <div className="flex items-center gap-2">
                {/* View Mode Toggle: Edit | Split | Preview */}
                <div className="bg-slate-900 p-1 rounded-xl border border-slate-800 flex items-center gap-1 text-xs">
                  <button
                    onClick={() => setEditorMode('edit')}
                    className={`px-2.5 py-1 rounded-lg font-bold flex items-center gap-1 transition ${
                      editorMode === 'edit'
                        ? 'bg-indigo-600 text-white shadow-sm'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                    title="Edit Markdown text"
                  >
                    <Edit3 className="w-3 h-3" />
                    <span>Write</span>
                  </button>
                  <button
                    onClick={() => setEditorMode('split')}
                    className={`px-2.5 py-1 rounded-lg font-bold flex items-center gap-1 transition ${
                      editorMode === 'split'
                        ? 'bg-indigo-600 text-white shadow-sm'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                    title="Split view: Editor & Live Preview"
                  >
                    <Columns className="w-3 h-3" />
                    <span>Split</span>
                  </button>
                  <button
                    onClick={() => setEditorMode('preview')}
                    className={`px-2.5 py-1 rounded-lg font-bold flex items-center gap-1 transition ${
                      editorMode === 'preview'
                        ? 'bg-indigo-600 text-white shadow-sm'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                    title="Full formatted preview"
                  >
                    <Eye className="w-3 h-3" />
                    <span>Preview</span>
                  </button>
                </div>

                {/* Export dropdown */}
                <div className="flex items-center gap-1 bg-slate-900 border border-slate-800 rounded-xl p-1">
                  <button
                    onClick={() => handleExport('md')}
                    title="Download Markdown (.md)"
                    className="px-2.5 py-1 text-slate-300 hover:text-white text-xs font-semibold hover:bg-slate-800 rounded-lg transition flex items-center gap-1"
                  >
                    <Download className="w-3 h-3 text-indigo-400" />
                    <span>MD</span>
                  </button>
                  <button
                    onClick={() => handleExport('html')}
                    title="Download HTML"
                    className="px-2 py-1 text-slate-400 hover:text-slate-200 text-xs font-semibold hover:bg-slate-800 rounded-lg transition"
                  >
                    HTML
                  </button>
                </div>

                {/* Fullscreen Zen Mode */}
                <button
                  onClick={() => setIsZenMode(!isZenMode)}
                  className="p-2 text-slate-400 hover:text-slate-200 hover:bg-slate-900 rounded-xl border border-slate-800 transition"
                  title={isZenMode ? 'Exit Zen Mode' : 'Distraction-free Zen Mode'}
                >
                  {isZenMode ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4 text-indigo-400" />}
                </button>

                {/* Save Button */}
                <button
                  onClick={handleSaveDoc}
                  disabled={isSaving}
                  className="flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-500 text-white px-4 py-2 rounded-xl text-xs font-bold shadow-md shadow-indigo-600/30 transition active:scale-95"
                >
                  <Save className="w-3.5 h-3.5" />
                  <span>{isSaving ? 'Saving...' : 'Save'}</span>
                </button>

                {/* Delete Doc */}
                <button
                  onClick={async () => {
                    if (confirm(`Delete document "${docTitle}"?`)) {
                      await api.deleteDocument(workspaceId, selectedDoc.id);
                      if (onRefreshDocuments) await onRefreshDocuments();
                      setSelectedDoc(null);
                    }
                  }}
                  className="p-2 text-slate-400 hover:text-rose-400 hover:bg-slate-900 rounded-xl border border-slate-800 transition"
                  title="Delete Document"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Quick Formatting Ribbon */}
            {editorMode !== 'preview' && (
              <div className="flex items-center gap-1 bg-slate-900/90 p-1.5 rounded-2xl border border-slate-800/80 overflow-x-auto text-xs">
                <button
                  onClick={() => insertFormatting('# ', '')}
                  className="px-2 py-1 hover:bg-slate-800 rounded-lg text-slate-300 font-bold transition flex items-center gap-1"
                  title="Heading 1"
                >
                  <Heading className="w-3 h-3" /> H1
                </button>
                <button
                  onClick={() => insertFormatting('## ', '')}
                  className="px-2 py-1 hover:bg-slate-800 rounded-lg text-slate-300 font-bold transition flex items-center gap-1"
                  title="Heading 2"
                >
                  <Heading className="w-3 h-3" /> H2
                </button>
                <button
                  onClick={() => insertFormatting('**', '**')}
                  className="px-2.5 py-1 hover:bg-slate-800 rounded-lg text-slate-300 font-black transition"
                  title="Bold"
                >
                  B
                </button>
                <button
                  onClick={() => insertFormatting('*', '*')}
                  className="px-2.5 py-1 hover:bg-slate-800 rounded-lg text-slate-300 italic font-serif transition"
                  title="Italic"
                >
                  I
                </button>
                <div className="w-[1px] h-4 bg-slate-800 mx-1" />
                <button
                  onClick={() => insertFormatting('- ', '')}
                  className="px-2 py-1 hover:bg-slate-800 rounded-lg text-slate-300 transition flex items-center gap-1"
                  title="Bullet List"
                >
                  <List className="w-3 h-3" /> Bullet
                </button>
                <button
                  onClick={() => insertFormatting('1. ', '')}
                  className="px-2 py-1 hover:bg-slate-800 rounded-lg text-slate-300 transition flex items-center gap-1"
                  title="Numbered List"
                >
                  <ListOrdered className="w-3 h-3" /> 1. 2. 3.
                </button>
                <button
                  onClick={() => insertFormatting('- [ ] ', '')}
                  className="px-2 py-1 hover:bg-slate-800 rounded-lg text-slate-300 transition flex items-center gap-1"
                  title="Task Checkbox"
                >
                  <CheckSquare className="w-3 h-3" /> Task
                </button>
                <div className="w-[1px] h-4 bg-slate-800 mx-1" />
                <button
                  onClick={() => insertFormatting('`', '`')}
                  className="px-2 py-1 hover:bg-slate-800 rounded-lg text-slate-300 font-mono transition flex items-center gap-1"
                  title="Inline Code"
                >
                  <Code className="w-3 h-3" /> Code
                </button>
                <button
                  onClick={() => insertFormatting('```\n', '\n```')}
                  className="px-2 py-1 hover:bg-slate-800 rounded-lg text-slate-300 font-mono transition"
                  title="Code Block"
                >
                  {'{ } Block'}
                </button>
                <button
                  onClick={() => insertFormatting('> ', '')}
                  className="px-2 py-1 hover:bg-slate-800 rounded-lg text-slate-300 transition flex items-center gap-1"
                  title="Blockquote"
                >
                  <Quote className="w-3 h-3" /> Quote
                </button>
                <button
                  onClick={() => insertFormatting('\n---\n', '')}
                  className="px-2 py-1 hover:bg-slate-800 rounded-lg text-slate-300 transition"
                  title="Horizontal Divider"
                >
                  Divider
                </button>
              </div>
            )}

            {/* Document Statistics Footer Info */}
            <div className="flex items-center justify-between text-[11px] text-slate-500 px-2">
              <div className="flex items-center gap-3">
                <span>{wordCount} words</span>
                <span>•</span>
                <span>{charCount} characters</span>
                <span>•</span>
                <span>~{readTime} min read</span>
              </div>

              <div className="flex items-center gap-2">
                <span className="flex items-center gap-1 text-emerald-400 font-mono">
                  <CheckCircle2 className="w-3 h-3" />
                  <span>Auto-saved to Supabase</span>
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
                    placeholder="Start typing your document, paste notes, or use Markdown formatting..."
                    className="w-full flex-1 bg-slate-900/60 border border-slate-800/80 rounded-2xl p-6 text-sm text-slate-100 focus:outline-none focus:border-indigo-500/60 font-sans leading-relaxed resize-none selection:bg-indigo-600/40"
                  />
                </div>
              )}

              {/* Formatted Preview */}
              {(editorMode === 'preview' || editorMode === 'split') && (
                <div className="flex-1 h-full bg-slate-900/40 border border-slate-800/80 rounded-2xl p-6 overflow-y-auto font-sans leading-relaxed text-sm text-slate-200">
                  <div className="prose prose-invert max-w-none space-y-4">
                    {docContent ? (
                      <div className="whitespace-pre-wrap font-sans text-slate-200 leading-relaxed">
                        {docContent}
                      </div>
                    ) : (
                      <div className="text-slate-600 italic py-12 text-center">
                        Document is empty. Write in the editor or choose a starter template.
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-center space-y-4 max-w-md mx-auto">
            <div className="w-16 h-16 rounded-3xl bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center text-indigo-400 shadow-xl shadow-indigo-600/10">
              <BookOpen className="w-8 h-8" />
            </div>
            <div>
              <h3 className="font-extrabold text-lg text-slate-100">No Document Selected</h3>
              <p className="text-xs text-slate-400 mt-1 leading-relaxed">
                Create a new document, choose a template spec, or upload existing notes (.txt, .md, .docx).
              </p>
            </div>
            <div className="flex items-center gap-3 pt-2">
              <button
                onClick={() => setShowCreateModal(true)}
                className="flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-500 text-white px-4 py-2.5 rounded-2xl text-xs font-bold shadow-lg shadow-indigo-600/30 transition active:scale-95"
              >
                <Plus className="w-4 h-4" />
                <span>Create New Doc</span>
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

      {/* New Document Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-black/75 flex items-center justify-center p-4 z-50">
          <div className="glass-panel p-6 rounded-3xl border border-slate-800 max-w-md w-full space-y-4 bg-slate-950/95 shadow-2xl">
            <div className="flex items-center gap-2">
              <FileText className="w-5 h-5 text-indigo-400" />
              <h3 className="text-base font-extrabold text-slate-100">Create New Document</h3>
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleCreateNewDoc(newDocTitle);
              }}
              className="space-y-4"
            >
              <input
                type="text"
                required
                autoFocus
                placeholder="e.g. Architecture Design RFC"
                className="w-full bg-slate-900 border border-slate-800 rounded-2xl px-4 py-3 text-xs text-slate-100 focus:outline-none focus:border-indigo-500"
                value={newDocTitle}
                onChange={(e) => setNewDocTitle(e.target.value)}
              />
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-slate-400 rounded-xl text-xs font-semibold transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-bold shadow-md shadow-indigo-600/30 transition active:scale-95"
                >
                  Create Document
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Starter Templates Modal */}
      {showTemplatesModal && (
        <div className="fixed inset-0 bg-black/75 flex items-center justify-center p-4 z-50">
          <div className="glass-panel p-6 rounded-3xl border border-slate-800 max-w-2xl w-full space-y-4 bg-slate-950/95 shadow-2xl">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-indigo-400" />
                <h3 className="text-base font-extrabold text-slate-100">Starter Document Templates</h3>
              </div>
              <button
                onClick={() => setShowTemplatesModal(false)}
                className="text-slate-500 hover:text-slate-300 text-xs font-bold"
              >
                Close
              </button>
            </div>

            <p className="text-xs text-slate-400">
              Initialize a production-ready engineering specification with 1-click:
            </p>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {DOCUMENT_TEMPLATES.map((tmpl, idx) => (
                <div
                  key={idx}
                  onClick={() => handleCreateNewDoc(tmpl.title, tmpl.content)}
                  className="p-4 rounded-2xl bg-slate-900/80 hover:bg-indigo-950/30 border border-slate-800 hover:border-indigo-500/50 cursor-pointer transition flex flex-col justify-between space-y-2 group shadow-md"
                >
                  <div className="space-y-1.5">
                    <h4 className="font-bold text-xs text-slate-200 group-hover:text-indigo-300 transition">
                      {tmpl.title}
                    </h4>
                    <p className="text-[11px] text-slate-400 line-clamp-3 leading-relaxed">
                      {tmpl.description}
                    </p>
                  </div>
                  <div className="pt-2 text-[10px] font-bold text-indigo-400 flex items-center justify-between">
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
