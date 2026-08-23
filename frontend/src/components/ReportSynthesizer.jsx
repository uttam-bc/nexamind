import React, { useState, useEffect } from 'react';
import {
  FileBarChart,
  Plus,
  Trash2,
  Download,
  Sparkles,
  CheckCircle2,
  Copy,
  Check,
  FilePlus,
  Printer,
} from 'lucide-react';
import { api } from '../api';
import { useToast } from '../context/ToastContext';
import { PageHeader, Badge, Modal, EmptyState } from './ui';

export default function ReportSynthesizer({
  workspaceId,
  reports,
  sessions,
  documents,
  onRefreshReports,
  onRefreshDocuments,
}) {
  const { success: toastSuccess, error: toastError, confirm } = useToast();

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
      toastSuccess('Report synthesized successfully!');
    } catch (err) {
      toastError(`Report generation error: ${err.message}`);
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
      toastSuccess('Report converted and saved to your Documents module!');
    } catch (err) {
      toastError(`Could not convert to document: ${err.message}`);
    } finally {
      setConvertingDoc(false);
    }
  };

  const copyMarkdown = () => {
    if (selectedReport?.content) {
      navigator.clipboard.writeText(selectedReport.content);
      setCopiedMd(true);
      setTimeout(() => setCopiedMd(false), 2000);
      toastSuccess('Markdown report copied to clipboard!');
    }
  };

  const handleDelete = async (reportId) => {
    const confirmed = await confirm(
      'Are you sure you want to permanently delete this synthesized report?',
      {
        title: 'Delete Report?',
        confirmLabel: 'Delete',
        cancelLabel: 'Cancel',
        variant: 'danger',
      }
    );
    if (confirmed) {
      try {
        await api.deleteReport(workspaceId, reportId);
        await onRefreshReports();
        setSelectedReport(null);
        toastSuccess('Report deleted successfully.');
      } catch (err) {
        toastError(err.message);
      }
    }
  };

  return (
    <div className="h-full flex flex-col md:flex-row gap-6">
      {/* Reports Sidebar */}
      <div className="w-full md:w-80 glass-panel p-4 rounded-2xl border border-slate-800/80 flex flex-col h-full bg-slate-900/50">
        <div className="flex items-center justify-between mb-4 pb-2 border-b border-slate-800/80">
          <h3 className="font-bold text-xs uppercase tracking-wider text-slate-400">
            Reports ({reports.length})
          </h3>
          <button
            onClick={() => setShowGenerateModal(true)}
            className="btn-primary py-1.5 px-3 text-xs"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Synthesize</span>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto space-y-2 pr-1 max-h-[300px] md:max-h-none">
          {reports.map((rep) => {
            const isSelected = selectedReport?.id === rep.id;
            return (
              <button
                key={rep.id}
                onClick={() => setSelectedReport(rep)}
                className={`w-full text-left p-3.5 rounded-xl transition border ${
                  isSelected
                    ? 'bg-indigo-650/15 border-indigo-500 text-slate-100 font-semibold shadow-sm'
                    : 'bg-slate-950/40 border-slate-800/80 text-slate-350 hover:bg-slate-850'
                }`}
              >
                <div className="flex items-center gap-2 mb-1">
                  <FileBarChart className={`w-4 h-4 ${isSelected ? 'text-indigo-400' : 'text-slate-500'}`} />
                  <span className="text-xs font-bold truncate">{rep.title}</span>
                </div>
                <div className="text-[10px] text-slate-500 flex justify-between items-center capitalize font-medium">
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
      <div className="flex-1 glass-panel p-6 md:p-8 rounded-2xl border border-slate-800/80 flex flex-col h-full overflow-y-auto bg-slate-950/40 min-w-0">
        {selectedReport ? (
          <div className="space-y-6 max-w-4xl mx-auto w-full">
            <div className="flex flex-col sm:flex-row sm:items-start justify-between border-b border-slate-800/80 pb-4 gap-4">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <Sparkles className="w-5 h-5 text-indigo-400 animate-pulse" />
                  <h3 className="text-xl font-extrabold text-slate-100 tracking-tight">{selectedReport.title}</h3>
                </div>
                <div className="text-xs text-slate-500 flex items-center gap-3">
                  <span>Template: <strong className="text-indigo-400 uppercase font-semibold">{selectedReport.report_type}</strong></span>
                  <span>•</span>
                  <span>Synthesized: {new Date(selectedReport.created_at).toLocaleString()}</span>
                </div>
              </div>

              <div className="flex items-center gap-2 flex-wrap">
                <button
                  onClick={handleConvertToDoc}
                  disabled={convertingDoc}
                  className="btn-secondary py-1.5 px-3 text-xs"
                  title="Create Document from Report"
                >
                  <FilePlus className="w-3.5 h-3.5 text-purple-400" />
                  <span>{convertingDoc ? 'Saving Doc...' : 'Save as Doc'}</span>
                </button>

                <button
                  onClick={copyMarkdown}
                  className="btn-secondary py-1.5 px-3 text-xs"
                  title="Copy Raw Markdown"
                >
                  {copiedMd ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>{copiedMd ? 'Copied' : 'Copy MD'}</span>
                </button>

                <button
                  onClick={() => window.print()}
                  className="btn-secondary py-1.5 px-3 text-xs"
                >
                  <Printer className="w-3.5 h-3.5" />
                  <span>Print / PDF</span>
                </button>

                <button
                  onClick={() => handleDelete(selectedReport.id)}
                  className="p-2 text-slate-450 hover:text-rose-400 hover:bg-slate-850 rounded-xl transition border border-slate-800/80"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Source Citations */}
            <div className="flex flex-wrap gap-2 text-xs bg-slate-900/40 p-3.5 rounded-xl border border-slate-800/80">
              <span className="font-bold text-slate-500 uppercase text-[10px] self-center mr-2">
                Source Citations:
              </span>
              <Badge variant="indigo">
                {selectedReport.source_session_ids?.length || 0} Sessions
              </Badge>
              <Badge variant="emerald">
                {selectedReport.source_document_ids?.length || 0} Documents
              </Badge>
            </div>

            {/* Markdown Report Content */}
            <div className="bg-slate-950/40 p-6 rounded-2xl border border-slate-800/80 text-sm text-slate-200 leading-relaxed whitespace-pre-wrap font-sans">
              {selectedReport.content}
            </div>
          </div>
        ) : (
          <EmptyState
            icon={FileBarChart}
            title="No Report Selected"
            description="Select an existing report or generate a new workspace summary."
            action={
              <button
                onClick={() => setShowGenerateModal(true)}
                className="btn-primary py-2 px-4 text-xs"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Synthesize Report</span>
              </button>
            }
          />
        )}
      </div>

      {/* Synthesize Report Modal */}
      <Modal
        open={showGenerateModal}
        onClose={() => setShowGenerateModal(false)}
        title="Synthesize Workspace Report"
        size="md"
      >
        <form onSubmit={handleGenerate} className="space-y-4">
          <div>
            <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-1.5">
              Report Title
            </label>
            <input
              type="text"
              required
              placeholder="e.g. Q3 Sprint Retrospective & Strategy"
              className="input-base"
              value={reportTitle}
              onChange={(e) => setReportTitle(e.target.value)}
            />
          </div>

          <div>
            <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-1.5">
              Report Template
            </label>
            <select
              className="input-base py-2.5 font-medium"
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

          <div>
            <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-1.5">
              Select Target Sessions (Optional)
            </label>
            <div className="max-h-32 overflow-y-auto bg-slate-950/80 p-2.5 rounded-xl border border-slate-800/80 space-y-1.5 text-xs">
              {sessions.map((s) => (
                <label key={s.id} className="flex items-center gap-2 cursor-pointer p-1.5 hover:bg-slate-900/60 rounded-lg">
                  <input
                    type="checkbox"
                    checked={selectedSessions.includes(s.id)}
                    onChange={(e) => {
                      if (e.target.checked) setSelectedSessions([...selectedSessions, s.id]);
                      else setSelectedSessions(selectedSessions.filter((id) => id !== s.id));
                    }}
                    className="rounded text-indigo-650 bg-slate-950 border-slate-800 focus:ring-indigo-500/30"
                  />
                  <span className="truncate text-slate-350">{s.title}</span>
                </label>
              ))}
              {sessions.length === 0 && <span className="text-slate-550 block py-1">No sessions available</span>}
            </div>
          </div>

          <div>
            <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-1.5">
              Special Instructions
            </label>
            <textarea
              placeholder="e.g. Focus on risks, blockers, and timelines..."
              className="input-base resize-none h-20"
              value={customPrompt}
              onChange={(e) => setCustomPrompt(e.target.value)}
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setShowGenerateModal(false)}
              className="btn-ghost"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={generating}
              className="btn-primary py-2 px-4"
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>{generating ? 'Synthesizing...' : 'Generate Report'}</span>
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
