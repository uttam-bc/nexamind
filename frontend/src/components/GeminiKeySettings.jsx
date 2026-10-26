import React, { useEffect, useState } from 'react';
import { AlertCircle, CheckCircle2, Key, RefreshCw, Trash2 } from 'lucide-react';
import { api } from '../api';

const LEGACY_STORAGE_KEY = 'nexamind_gemini_key';

// Personal Gemini key management. The key is verified and stored encrypted on the server;
// the browser never keeps it after saving.
export default function GeminiKeySettings({ onChange, compact = false }) {
  const [config, setConfig] = useState(null);
  const [keyInput, setKeyInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState(null); // { ok, message }

  useEffect(() => {
    // Older versions kept the key in localStorage. Move it into the form and forget it here.
    try {
      const legacy = localStorage.getItem(LEGACY_STORAGE_KEY);
      if (legacy) {
        setKeyInput(legacy);
        setStatus({ ok: true, message: 'Found a key saved in this browser. Click Save to move it to your account.' });
        localStorage.removeItem(LEGACY_STORAGE_KEY);
      }
    } catch {
      // storage unavailable
    }
    api.getAiConfig().then(update).catch(() => {});
  }, []);

  const update = (next) => {
    setConfig(next);
    onChange?.(next);
  };

  const handleSave = async () => {
    if (!keyInput.trim()) {
      setStatus({ ok: false, message: 'Paste a Gemini API key first.' });
      return;
    }
    setBusy(true);
    setStatus(null);
    try {
      update(await api.saveGeminiKey(keyInput.trim()));
      setKeyInput('');
      setStatus({ ok: true, message: 'Key verified and saved to your account.' });
    } catch (err) {
      setStatus({ ok: false, message: err.message });
    } finally {
      setBusy(false);
    }
  };

  const handleRemove = async () => {
    setBusy(true);
    setStatus(null);
    try {
      update(await api.deleteGeminiKey());
      setStatus({ ok: true, message: 'Your saved key was removed.' });
    } catch (err) {
      setStatus({ ok: false, message: err.message });
    } finally {
      setBusy(false);
    }
  };

  const handleTest = async () => {
    setBusy(true);
    setStatus(null);
    try {
      const res = await api.testGeminiKey(keyInput.trim() || undefined);
      setStatus({ ok: !!res.valid, message: res.message });
    } catch (err) {
      setStatus({ ok: false, message: err.message });
    } finally {
      setBusy(false);
    }
  };

  const activeSource = config?.has_personal_key
    ? `Your key (${config.personal_key_hint}) is active.`
    : config?.server_gemini_available
      ? 'Using the server’s shared Gemini key.'
      : config?.server_groq_available
        ? 'Using the server’s Groq model. Add a Gemini key for better results.'
        : 'No AI model configured. The copilot only runs explicit commands.';

  return (
    <div className={`space-y-3 ${compact ? '' : 'p-5 bg-slate-50 rounded-2xl border border-slate-200'}`}>
      <div className="flex items-center gap-2">
        <Key className="w-4 h-4 text-indigo-600" />
        <span className="font-bold text-sm text-slate-900">Google Gemini API key</span>
      </div>
      <p className="text-xs text-slate-600">{config ? activeSource : 'Checking AI configuration…'}</p>

      <input aria-label="Gemini API key"
        type="password"
        autoComplete="off"
        placeholder={config?.has_personal_key ? 'Paste a new key to replace yours' : 'AIza…'}
        value={keyInput}
        onChange={(e) => setKeyInput(e.target.value)}
        className="w-full bg-white border border-slate-300 rounded-xl px-3.5 py-2.5 text-xs text-slate-900 focus:outline-none focus:border-indigo-600 tabular-nums"
      />
      <p className="text-xs text-slate-500">
        Stored encrypted on the server and never sent back to the browser. Get a key at aistudio.google.com.
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={handleSave}
          disabled={busy || !keyInput.trim()}
          className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white rounded-xl text-xs font-bold transition"
        >
          Verify &amp; save
        </button>
        <button
          type="button"
          onClick={handleTest}
          disabled={busy}
          className="px-4 py-2 bg-white border border-slate-200 hover:bg-slate-100 text-slate-800 rounded-xl text-xs font-bold transition flex items-center gap-1.5"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${busy ? 'animate-spin' : ''}`} />
          Test
        </button>
        {config?.has_personal_key && (
          <button
            type="button"
            onClick={handleRemove}
            disabled={busy}
            className="px-4 py-2 text-rose-700 hover:bg-rose-50 rounded-xl text-xs font-bold transition flex items-center gap-1.5"
          >
            <Trash2 className="w-3.5 h-3.5" />
            Remove my key
          </button>
        )}
      </div>

      {status && (
        <div
          role="status"
          className={`p-2.5 rounded-xl text-xs flex items-center gap-2 ${
            status.ok
              ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
              : 'bg-rose-50 text-rose-800 border border-rose-200'
          }`}
        >
          {status.ok ? (
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
          ) : (
            <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
          )}
          <span>{status.message}</span>
        </div>
      )}
    </div>
  );
}
