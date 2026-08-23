import React, { useState, useEffect } from 'react';
import {
  FileBarChart,
  Plus,
  Trash2,
  Download,
  Sparkles,
  CheckCircle2,
  FileText,
  Video,
  Copy,
  Check,
  FilePlus,
  Printer,
} from 'lucide-react';
import { api } from '../api';

export default function ReportSynthesizer({
  workspaceId,
  reports,
  sessions,
  documents,
  onRefreshReports,
  onRefreshDocuments,
}) {
  const [selectedReport, setSelectedReport] = useState(null);
  const [showGenerateModal, setShowGenerateModal] = useState(false);
  const [reportTitle, setReportTitle] = useState('');
  const [reportType, setReportType] = useState('sprint_summary');
  const [selectedSessions, setSelectedSessions] = useState([]);
  const [selectedDocs, setSelectedDocs] = useState([]);
  const [customPrompt, setCustomPrompt] = useState('');
  const [generating, setGenerating] = useState(false);
  const [copiedMd, setCopiedMd] = useState(false);
  const [convertingDoc, setConvertingDoc] = useState(false);

  useEffect(() => {
    if (reports && reports.length > 0 && !selectedReport) {
      setSelectedReport(reports[0]);
    }
  }, [reports]);

  const handleGenerate = async (e) => {
    e.preventDefault();
    if (!reportTitle.trim() || generating) return;
    setGenerating(true);
    try {
      const r = await api.generateReport(workspaceId, {
        title: reportTitle.trim(),
        report_type: reportType,
        session_ids: selectedSessions,
        document_ids: selectedDocs,
        custom_prompt: customPrompt.trim() || undefined,
      });
      setShowGenerateModal(false);
      setReportTitle('');
      setCustomPrompt('');
      setSelectedSessions([]);
      setSelectedDocs([]);
      await onRefreshReports();
      setSelectedReport(r);
    } catch (err) {
      alert(`Report generation error: ${err.message}`);
    } finally {
      setGenerating(false);
    }
  };

  const handleConvertToDoc = async () => {
    if (!selectedReport || convertingDoc) return;
    setConvertingDoc(true);
    try {
      const initialBlocks = [
        { id: '1', type: 'heading', level: 1, text: selectedReport.title },
        { id: '2', type: 'paragraph', text: selectedReport.content },
      ];
      await api.createDocument(workspaceId, `Report: ${selectedReport.title}`, { blocks: initialBlocks });
      if (onRefreshDocuments) await onRefreshDocuments();
      alert('Report converted and saved to your Documents module!');
    } catch (err) {
      alert(`Could not convert to document: ${err.message}`);
    } finally {
      setConvertingDoc(false);
    }
  };

  const copyMarkdown = () => {
    if (selectedReport?.content) {
      navigator.clipboard.writeText(selectedReport.content);
      setCopiedMd(true);
      setTimeout(() => setCopiedMd(false), 2000);
    }
  };

  const handleDelete = async (reportId) => {
    if (confirm('Delete this report?')) {
      try {
        await api.deleteReport(workspaceId, reportId);
        await onRefreshReports();
        setSelectedReport(null);
      } catch (err) {
        alert(err.message);
      }
    }
  };

  return (
    <div className="h-full flex gap-6">
      {/* Reports Sidebar */}
      <div className="w-80 glass-panel p-4 rounded-2xl border border-slate-800 flex flex-col h-full">
        <div className="flex items-center justify-between mb-4 pb-2 border-b border-slate-800">
          <h3 className="font-bold text-xs uppercase tracking-wider text-slate-400">
            Reports ({reports.length})
          </h3>
          <button
            onClick={() => setShowGenerateModal(true)}
            className="flex items-center gap-1 bg-indigo-600 hover:bg-indigo-500 text-white px-2.5 py-1.5 rounded-lg text-xs font-bold transition shadow-md shadow-indigo-600/30"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Synthesize</span>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto space-y-2 pr-1">
          {reports.map((rep) => {
            const isSelected = selectedReport?.id === rep.id;
            return (
              <button
                key={rep.id}
                onClick={() => setSelectedReport(rep)}
                className={`w-full text-left p-3.5 rounded-xl transition border ${
                  isSelected
                    ? 'bg-indigo-600/15 border-indigo-500 text-slate-100 font-semibold shadow-sm'
                    : 'bg-slate-900/60 border-slate-800/80 text-slate-300 hover:bg-slate-800'
                }`}
              >
                <div className="flex items-center gap-2 mb-1">
                  <FileBarChart className={`w-4 h-4 ${isSelected ? 'text-indigo-400' : 'text-slate-500'}`} />
                  <span className="text-xs font-bold truncate">{rep.title}</span>
                </div>
                <div className="text-[10px] text-slate-500 flex justify-between items-center capitalize">
                  <span>{rep.report_type.replace('_', ' ')}</span>
                  <span>{new Date(rep.created_at).toLocaleDateString()}</span>
                </div>
              </button>
            );
          })}

          {reports.length === 0 && (
            <div className="text-center text-slate-500 py-10 text-xs">No reports synthesized yet.</div>
          )}
        </div>
      </div>

      {/* Rendered Report Area */}
      <div className="flex-1 glass-panel p-8 rounded-2xl border border-slate-800 flex flex-col h-full overflow-y-auto bg-slate-950/40">
        {selectedReport ? (
          <div className="space-y-6 max-w-4xl mx-auto w-full">
            <div className="flex items-start justify-between border-b border-slate-800 pb-4">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <Sparkles className="w-5 h-5 text-indigo-400" />
                  <h3 className="text-2xl font-extrabold text-slate-100">{selectedReport.title}</h3>
                </div>
                <div className="text-xs text-slate-400 flex items-center gap-3">
                  <span>Type: <strong className="text-indigo-300 uppercase">{selectedReport.report_type}</strong></span>
                  <span>•</span>
                  <span>Synthesized: {new Date(selectedReport.created_at).toLocaleString()}</span>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={handleConvertToDoc}
                  disabled={convertingDoc}
                  className="px-3 py-1.5 bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-300 border border-indigo-500/30 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition"
                  title="Create Document from Report"
                >
                  <FilePlus className="w-3.5 h-3.5" />
                  <span>{convertingDoc ? 'Saving Doc...' : 'Save as Doc'}</span>
                </button>

                <button
                  onClick={copyMarkdown}
                  className="px-3 py-1.5 bg-slate-900 hover:bg-slate-800 text-slate-300 rounded-xl text-xs font-semibold flex items-center gap-1.5 border border-slate-800 transition"
                  title="Copy Raw Markdown"
                >
                  {copiedMd ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>{copiedMd ? 'Copied' : 'Copy MD'}</span>
                </button>

                <button
                  onClick={() => window.print()}
                  className="px-3 py-1.5 bg-slate-900 hover:bg-slate-800 text-slate-300 rounded-xl text-xs font-semibold flex items-center gap-1.5 border border-slate-800 transition"
                >
                  <Printer className="w-3.5 h-3.5" />
                  <span>Print / PDF</span>
                </button>

                <button
                  onClick={() => handleDelete(selectedReport.id)}
                  className="p-2 text-slate-400 hover:text-rose-400 hover:bg-slate-800 rounded-xl transition"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Source Citations */}
            <div className="flex flex-wrap gap-2 text-xs bg-slate-900/90 p-3 rounded-xl border border-slate-800">
              <span className="font-bold text-slate-400 uppercase text-[10px] self-center mr-1">
                Source Citations:
              </span>
              <span className="px-2 py-0.5 rounded bg-indigo-500/10 text-indigo-300 border border-indigo-500/20 font-mono">
                {selectedReport.source_session_ids?.length || 0} Sessions
              </span>
              <span className="px-2 py-0.5 rounded bg-purple-500/10 text-purple-300 border border-purple-500/20 font-mono">
                {selectedReport.source_document_ids?.length || 0} Documents
              </span>
            </div>

            {/* Markdown Report Content */}
            <div className="bg-slate-900/60 p-6 rounded-2xl border border-slate-800 text-sm text-slate-200 leading-relaxed whitespace-pre-wrap font-sans">
              {selectedReport.content}
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center h-full text-slate-500 py-16">
            <FileBarChart className="w-12 h-12 mb-3 text-slate-600" />
            <span className="text-sm font-semibold">Select or synthesize a report</span>
          </div>
        )}
      </div>

      {/* Synthesize Report Modal */}
      {showGenerateModal && (
        <div className="fixed inset-0 bg-black/75 flex items-center justify-center p-4 z-50 animate-fade-in">
          <div className="glass-panel p-6 rounded-2xl border border-slate-800 max-w-lg w-full space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-indigo-400" />
              <h3 className="text-base font-bold text-slate-100">Synthesize Workspace Report</h3>
            </div>

            <form onSubmit={handleGenerate} className="space-y-4">
              <div>
                <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-1">
                  Report Title
                </label>
                <input
                  type="text"
                  required
                  autoFocus
                  placeholder="e.g. Q3 Sprint Retrospective & Strategy"
                  className="w-full bg-slate-900 border border-slate-800 rounded-xl px-4 py-2 text-xs text-slate-100 focus:outline-none focus:border-indigo-500"
                  value={reportTitle}
                  onChange={(e) => setReportTitle(e.target.value)}
                />
              </div>

              <div>
                <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-1">
                  Report Template
                </label>
                <select
                  className="w-full bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-indigo-500"
                  value={reportType}
                  onChange={(e) => setReportType(e.target.value)}
                >
                  <option value="sprint_summary">Sprint Retrospective Summary</option>
                  <option value="financial_overview">Financial Health & Runway Overview</option>
                  <option value="meeting_digest">Executive Meeting Digest</option>
                  <option value="project_status">Project Milestones & Deliverables</option>
                  <option value="custom">Custom Synthesis</option>
                </select>
              </div>

              {/* Scoped Sessions Selection */}
              <div>
                <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-1">
                  Select Target Sessions (Optional)
                </label>
                <div className="max-h-28 overflow-y-auto bg-slate-900 p-2 rounded-xl border border-slate-800 space-y-1 text-xs">
                  {sessions.map((s) => (
                    <label key={s.id} className="flex items-center gap-2 cursor-pointer p-1 hover:bg-slate-800 rounded">
                      <input
                        type="checkbox"
                        checked={selectedSessions.includes(s.id)}
                        onChange={(e) => {
                          if (e.target.checked) setSelectedSessions([...selectedSessions, s.id]);
                          else setSelectedSessions(selectedSessions.filter((id) => id !== s.id));
                        }}
                      />
                      <span className="truncate">{s.title}</span>
                    </label>
                  ))}
                  {sessions.length === 0 && <span className="text-slate-500">No sessions available</span>}
                </div>
              </div>

              {/* Custom Prompt Instructions */}
              <div>
                <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-1">
                  Special Instructions
                </label>
                <textarea
                  placeholder="e.g. Focus on risks, blockers, and timelines..."
                  className="w-full bg-slate-900 border border-slate-800 rounded-xl px-4 py-2 text-xs text-slate-200 focus:outline-none focus:border-indigo-500 resize-none h-16"
                  value={customPrompt}
                  onChange={(e) => setCustomPrompt(e.target.value)}
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowGenerateModal(false)}
                  className="px-4 py-2 text-xs font-semibold text-slate-400 hover:text-slate-200"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={generating}
                  className="bg-indigo-600 hover:bg-indigo-500 text-white px-5 py-2 rounded-xl text-xs font-bold shadow-md shadow-indigo-600/30 flex items-center gap-1.5"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>{generating ? 'Synthesizing...' : 'Generate Report'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
