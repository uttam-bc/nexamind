import React, { useState } from 'react';
import { Users, Copy, Check, Sparkles, ArrowRight, X, Shield, UserPlus } from 'lucide-react';
import { api } from '../api';

export default function CreateGroupModal({
  isOpen,
  onClose,
  onGroupCreated,
}) {
  const [step, setStep] = useState('form'); // 'form' | 'success'
  const [groupName, setGroupName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [createdWorkspace, setCreatedWorkspace] = useState(null);
  const [copiedCode, setCopiedCode] = useState(false);

  if (!isOpen) return null;

  const handleCreate = async (e) => {
    e.preventDefault();
    if (!groupName.trim() || loading) return;
    setLoading(true);
    setError('');

    try {
      const ws = await api.createWorkspace(groupName.trim());
      setCreatedWorkspace(ws);
      setStep('success');
      if (onGroupCreated) onGroupCreated(ws, false); // Notify app but don't close yet
    } catch (err) {
      setError(err.message || 'Failed to create group');
    } finally {
      setLoading(false);
    }
  };

  const handleCopyCode = () => {
    if (createdWorkspace?.join_code) {
      navigator.clipboard.writeText(createdWorkspace.join_code);
      setCopiedCode(true);
      setTimeout(() => setCopiedCode(false), 2500);
    }
  };

  const handleDone = () => {
    if (createdWorkspace && onGroupCreated) {
      onGroupCreated(createdWorkspace, true); // true = switch workspace & close
    }
    setStep('form');
    setGroupName('');
    setCreatedWorkspace(null);
    onClose();
  };

  const handleClose = () => {
    if (step === 'success' && createdWorkspace && onGroupCreated) {
      onGroupCreated(createdWorkspace, true);
    }
    setStep('form');
    setGroupName('');
    setCreatedWorkspace(null);
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-slate-950/60 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-in fade-in duration-150">
      <div data-modal className="bg-white border border-slate-200 rounded-3xl max-w-md w-full p-6 sm:p-8 shadow-2xl relative space-y-6">
        <button
          onClick={handleClose}
          className="absolute top-5 right-5 text-slate-400 hover:text-slate-700 p-1 rounded-lg"
        >
          <X className="w-5 h-5" />
        </button>

        {step === 'form' ? (
          <>
            <div className="text-center space-y-2">
              <div className="w-12 h-12 rounded-2xl bg-indigo-50 border border-indigo-100 flex items-center justify-center mx-auto text-indigo-600">
                <Users className="w-6 h-6" />
              </div>
              <h3 className="text-xl font-extrabold text-slate-900 tracking-tight">
                Create Team Group
              </h3>
              <p className="text-xs text-slate-500 font-sans">
                Set up a shared collaborative space for your engineering team, project, or department.
              </p>
            </div>

            {error && (
              <div className="p-3 bg-rose-50 border border-rose-200 text-rose-700 text-xs rounded-xl font-medium">
                {error}
              </div>
            )}

            <form onSubmit={handleCreate} className="space-y-4">
              <div className="space-y-1">
                <label htmlFor="create-group-modal-field-1" className="text-xs font-bold text-slate-700">Group / Workspace Name</label>
                <input id="create-group-modal-field-1"
                  type="text"
                  required
                  autoFocus
                  placeholder="e.g. Core Engineering Team"
                  className="w-full bg-slate-50 border border-slate-200 focus:border-indigo-600 focus:bg-white rounded-xl px-4 py-2.5 text-xs text-slate-900 outline-none transition font-sans"
                  value={groupName}
                  onChange={(e) => setGroupName(e.target.value)}
                />
              </div>

              <div className="p-3.5 bg-indigo-50/60 border border-indigo-100 rounded-2xl text-xs text-indigo-900 space-y-1 leading-relaxed">
                <p className="font-bold flex items-center gap-1.5">
                  <Shield className="w-3.5 h-3.5 text-indigo-600" />
                  <span>Instant Join Code Generated</span>
                </p>
                <p className="text-slate-600">
                  Once created, an 8-character join code will be generated so teammates can join immediately without complex invites.
                </p>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={handleClose}
                  className="px-4 py-2 text-xs font-bold text-slate-500 hover:text-slate-700"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={loading || !groupName.trim()}
                  className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white px-5 py-2.5 rounded-xl text-xs font-bold shadow-md shadow-indigo-600/30 transition flex items-center gap-1.5"
                >
                  {loading ? 'Creating…' : 'Create Group'}
                </button>
              </div>
            </form>
          </>
        ) : (
          /* STEP 2: SHOW JOIN CODE PROMINENTLY */
          <div className="text-center space-y-5 animate-in zoom-in-95 duration-200">
            <div className="w-14 h-14 rounded-3xl bg-emerald-100 border border-emerald-200 flex items-center justify-center mx-auto text-emerald-600">
              <Sparkles className="w-7 h-7" />
            </div>

            <div className="space-y-1">
              <h3 className="text-xl font-extrabold text-slate-900 tracking-tight">
                Group Created Successfully!
              </h3>
              <p className="text-xs text-slate-500 font-sans">
                <strong>{createdWorkspace?.name}</strong> is ready. Share this join code with your teammates:
              </p>
            </div>

            {/* Prominent Join Code Display Card */}
            <div className="p-5 bg-slate-50 border border-slate-200 rounded-2xl space-y-3">
              <div className="text-xs tabular-nums font-bold text-indigo-700">
                TEAM JOIN CODE
              </div>
              <div className="text-3xl font-semibold font-mono tracking-widest text-slate-900 select-all">
                {createdWorkspace?.join_code || 'NM-TEAM'}
              </div>
              <button
                type="button"
                onClick={handleCopyCode}
                className="w-full bg-white hover:bg-slate-50 text-indigo-600 border border-indigo-200 hover:border-indigo-300 py-2 rounded-xl text-xs font-bold shadow-sm transition flex items-center justify-center gap-2"
              >
                {copiedCode ? (
                  <>
                    <Check className="w-4 h-4 text-emerald-600" />
                    <span className="text-emerald-700">Copied to Clipboard!</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-4 h-4" />
                    <span>Copy Join Code</span>
                  </>
                )}
              </button>
            </div>

            <p className="text-xs text-slate-500 font-sans">
              Teammates can click <strong>Join Group</strong> in their sidebar and paste this code to join in one click.
            </p>

            <button
              type="button"
              onClick={handleDone}
              className="w-full bg-indigo-600 hover:bg-indigo-700 text-white py-3 rounded-xl text-xs font-bold shadow-md shadow-indigo-600/30 transition flex items-center justify-center gap-2"
            >
              <span>Enter {createdWorkspace?.name}</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
