import React, { useState } from 'react';
import {
  FolderOpen,
  Upload,
  File,
  Image,
  FileText,
  Trash2,
  Eye,
  Download,
  X,
  Search,
  Filter,
  FileCode,
  Film,
  Music,
  Archive,
} from 'lucide-react';
import { api } from '../api';

export default function FileManager({ workspaceId, filesList, onRefreshFiles }) {
  const [previewFile, setPreviewFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeCategory, setActiveCategory] = useState('all'); // 'all' | 'image' | 'doc' | 'code' | 'media'

  const handleUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      await api.uploadFile(workspaceId, fd);
      await onRefreshFiles();
    } catch (err) {
      alert(`File upload error: ${err.message}`);
    } finally {
      setUploading(false);
    }
  };

  const handleDelete = async (fileId) => {
    if (confirm('Delete this file?')) {
      try {
        await api.deleteFile(workspaceId, fileId);
        await onRefreshFiles();
        if (previewFile?.id === fileId) setPreviewFile(null);
      } catch (err) {
        alert(err.message);
      }
    }
  };

  const formatFileSize = (bytes) => {
    if (!bytes) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  };

  const getFileCategory = (mime, filename) => {
    if (!mime && !filename) return 'other';
    const m = (mime || '').toLowerCase();
    const f = (filename || '').toLowerCase();
    if (m.startsWith('image/') || /\.(png|jpg|jpeg|gif|webp|svg)$/.test(f)) return 'image';
    if (m.startsWith('text/') || /\.(txt|md|doc|docx|pdf)$/.test(f)) return 'doc';
    if (/\.(js|jsx|ts|tsx|py|json|sql|html|css)$/.test(f)) return 'code';
    if (m.startsWith('video/') || m.startsWith('audio/') || /\.(mp4|webm|mp3|wav)$/.test(f)) return 'media';
    return 'other';
  };

  const filteredFiles = (filesList || []).filter((f) => {
    const matchesSearch = f.filename.toLowerCase().includes(searchQuery.toLowerCase());
    const cat = getFileCategory(f.mime_type, f.filename);
    const matchesCat = activeCategory === 'all' || cat === activeCategory;
    return matchesSearch && matchesCat;
  });

  return (
    <div className="h-full flex flex-col space-y-6">
      {/* Header & Controls */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-extrabold text-slate-100 tracking-tight">
            Workspace File Storage
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Store documents, design assets, and code files with instant in-app previews.
          </p>
        </div>

        <div className="flex items-center gap-3">
          {/* Search Box */}
          <div className="relative w-56">
            <Search className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-3" />
            <input
              type="text"
              placeholder="Search files..."
              className="w-full bg-slate-900 border border-slate-800 rounded-xl pl-9 pr-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-indigo-500"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>

          <label className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500 text-white px-4 py-2 rounded-xl text-xs font-bold shadow-lg shadow-indigo-600/30 cursor-pointer transition">
            <Upload className="w-4 h-4" />
            <span>{uploading ? 'Uploading...' : 'Upload File'}</span>
            <input type="file" className="hidden" disabled={uploading} onChange={handleUpload} />
          </label>
        </div>
      </div>

      {/* Category Tabs */}
      <div className="flex items-center gap-2 bg-slate-900/80 p-1.5 rounded-xl border border-slate-800 w-fit">
        {[
          { id: 'all', label: 'All Files' },
          { id: 'image', label: 'Images' },
          { id: 'doc', label: 'Documents' },
          { id: 'code', label: 'Code' },
          { id: 'media', label: 'Media' },
        ].map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveCategory(tab.id)}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
              activeCategory === tab.id
                ? 'bg-indigo-600 text-white shadow'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Files Grid */}
      <div className="grid grid-cols-4 gap-4 flex-1 overflow-y-auto min-h-0 pr-1">
        {filteredFiles.map((f) => {
          const cat = getFileCategory(f.mime_type, f.filename);
          return (
            <div
              key={f.id}
              className="glass-panel p-4 rounded-2xl border border-slate-800 hover:border-indigo-500/40 transition flex flex-col justify-between group space-y-3 shadow-md"
            >
              <div className="flex items-start justify-between">
                <div className="w-10 h-10 rounded-xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400">
                  {cat === 'image' && <Image className="w-5 h-5" />}
                  {cat === 'doc' && <FileText className="w-5 h-5" />}
                  {cat === 'code' && <FileCode className="w-5 h-5 text-emerald-400" />}
                  {cat === 'media' && <Film className="w-5 h-5 text-purple-400" />}
                  {cat === 'other' && <File className="w-5 h-5" />}
                </div>
                <button
                  onClick={() => handleDelete(f.id)}
                  className="opacity-0 group-hover:opacity-100 p-1 text-slate-500 hover:text-rose-400 transition"
                  title="Delete file"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>

              <div>
                <h4 className="font-bold text-xs text-slate-200 truncate" title={f.filename}>
                  {f.filename}
                </h4>
                <div className="text-[10px] text-slate-500 mt-0.5">
                  {formatFileSize(f.file_size)} • {new Date(f.created_at).toLocaleDateString()}
                </div>
              </div>

              <button
                onClick={() => setPreviewFile(f)}
                className="w-full py-1.5 bg-slate-900 hover:bg-slate-800 rounded-lg text-xs font-semibold text-slate-300 flex items-center justify-center gap-1.5 border border-slate-800 transition"
              >
                <Eye className="w-3.5 h-3.5" />
                <span>Preview Details</span>
              </button>
            </div>
          );
        })}

        {filteredFiles.length === 0 && (
          <div className="col-span-4 flex flex-col items-center justify-center py-20 text-slate-500">
            <FolderOpen className="w-12 h-12 mb-3 text-slate-600" />
            <span className="text-sm font-semibold">No files found matching criteria</span>
          </div>
        )}
      </div>

      {/* File Preview & Metadata Drawer Modal */}
      {previewFile && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center p-6 z-50 animate-fade-in">
          <div className="glass-panel p-6 rounded-2xl border border-slate-700 max-w-2xl w-full space-y-4 max-h-[85vh] flex flex-col bg-slate-900/95">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2 truncate">
                <FileText className="w-5 h-5 text-indigo-400" />
                <span className="font-bold text-sm text-slate-100 truncate">{previewFile.filename}</span>
              </div>
              <button
                onClick={() => setPreviewFile(null)}
                className="p-1 text-slate-400 hover:text-slate-200"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Preview Box */}
            <div className="flex-1 overflow-auto bg-slate-950 rounded-xl p-6 border border-slate-800 flex items-center justify-center text-xs text-slate-400 font-mono min-h-[220px]">
              {getFileCategory(previewFile.mime_type, previewFile.filename) === 'image' ? (
                <div className="text-center space-y-2">
                  <Image className="w-20 h-20 text-indigo-400 mx-auto" />
                  <span className="font-bold text-slate-300 block">{previewFile.filename}</span>
                  <span className="text-slate-500 text-[11px]">Image Asset</span>
                </div>
              ) : (
                <div className="text-center space-y-2">
                  <FileText className="w-20 h-20 text-slate-600 mx-auto" />
                  <span className="font-bold text-slate-300 block">{previewFile.filename}</span>
                  <span className="text-slate-500 text-[11px]">Preview File Ready</span>
                </div>
              )}
            </div>

            {/* Metadata Information Grid */}
            <div className="grid grid-cols-3 gap-3 bg-slate-950/80 p-3 rounded-xl border border-slate-800 text-xs">
              <div>
                <span className="text-[10px] text-slate-500 uppercase font-bold block">Size</span>
                <span className="font-bold text-slate-200">{formatFileSize(previewFile.file_size)}</span>
              </div>
              <div>
                <span className="text-[10px] text-slate-500 uppercase font-bold block">MIME Type</span>
                <span className="text-slate-200 truncate block">{previewFile.mime_type || 'application/octet-stream'}</span>
              </div>
              <div>
                <span className="text-[10px] text-slate-500 uppercase font-bold block">Uploaded</span>
                <span className="text-slate-200">{new Date(previewFile.created_at).toLocaleDateString()}</span>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => {
                  alert(`Downloading ${previewFile.filename}...`);
                }}
                className="flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-500 text-white px-4 py-2 rounded-xl text-xs font-bold shadow-md shadow-indigo-600/30 transition"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Download File</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
