import React, { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, MessageSquarePlus } from 'lucide-react';
import { Avatar, Badge, Btn, inputClass } from './ui';
import { highlightLines, timeAgo } from './repoUtils';

const STATUS_TONE = { added: 'green', deleted: 'red', renamed: 'purple', modified: 'slate' };

/** Rows of a unified patch with old/new line numbers. */
export function parsePatch(patch) {
  const rows = [];
  let oldNo = 0;
  let newNo = 0;
  for (const line of (patch || '').split('\n')) {
    const hunk = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/);
    if (hunk) {
      oldNo = Number(hunk[1]);
      newNo = Number(hunk[2]);
      rows.push({ type: 'hunk', text: line });
    } else if (line.startsWith('+')) {
      rows.push({ type: 'add', text: line.slice(1), newNo: newNo++ });
    } else if (line.startsWith('-')) {
      rows.push({ type: 'del', text: line.slice(1), oldNo: oldNo++ });
    } else if (line.startsWith(' ')) {
      rows.push({ type: 'ctx', text: line.slice(1), oldNo: oldNo++, newNo: newNo++ });
    }
  }
  return rows;
}

const ROW_BG = { add: 'bg-emerald-50', del: 'bg-rose-50', ctx: '', hunk: 'bg-sky-50 text-sky-800' };
const SIGN = { add: '+', del: '-', ctx: ' ' };

function InlineThread({ comments }) {
  return (
    <div className="space-y-2 my-2 mx-2 sm:mx-12">
      {comments.map((c) => (
        <div key={c.id} className="border border-slate-200 rounded-lg bg-white p-3 font-sans text-sm" data-testid="inline-comment">
          <div className="flex items-center gap-2 text-xs text-slate-500 mb-1">
            <Avatar user={c.author} size={5} />
            <span className="font-semibold text-slate-800">{c.author?.name || 'Someone'}</span>
            <span>{timeAgo(c.created_at)}</span>
          </div>
          <p className="whitespace-pre-wrap break-words text-slate-800">{c.body}</p>
        </div>
      ))}
    </div>
  );
}

function CommentBox({ onSubmit, onCancel }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <div className="my-2 mx-2 sm:mx-12 font-sans">
      <textarea
        autoFocus
        aria-label="Comment on this line"
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={3}
        className={inputClass}
        placeholder="Leave a comment"
      />
      <div className="flex justify-end gap-2 mt-2">
        <Btn size="sm" onClick={onCancel}>Cancel</Btn>
        <Btn
          size="sm"
          variant="primary"
          busy={busy}
          disabled={!text.trim()}
          onClick={async () => {
            setBusy(true);
            try {
              await onSubmit(text.trim());
            } finally {
              setBusy(false);
            }
          }}
        >
          Comment
        </Btn>
      </div>
    </div>
  );
}

function FileDiff({ file, comments, onComment, defaultOpen }) {
  const [open, setOpen] = useState(defaultOpen);
  const [composer, setComposer] = useState(null);
  const rows = useMemo(() => parsePatch(file.patch), [file.patch]);
  const highlighted = useMemo(() => {
    if (rows.length > 3000) return null;
    return rows.map((r) => (r.type === 'hunk' ? null : highlightLines(r.text, file.path)[0]));
  }, [rows, file.path]);
  const byLine = useMemo(() => {
    const map = {};
    (comments || []).forEach((c) => {
      const key = `${c.side || 'new'}:${c.line}`;
      (map[key] = map[key] || []).push(c);
    });
    return map;
  }, [comments]);

  return (
    <div className="border border-slate-200 rounded-xl overflow-hidden bg-white" data-testid="file-diff">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2 px-3 py-2.5 bg-slate-50 border-b border-slate-200 text-left"
        aria-expanded={open}
      >
        {open ? <ChevronDown className="w-4 h-4 shrink-0" /> : <ChevronRight className="w-4 h-4 shrink-0" />}
        <span className="font-mono text-[13px] font-semibold text-slate-800 break-all min-w-0">
          {file.old_path && file.status === 'renamed' ? `${file.old_path} → ${file.path}` : file.path}
        </span>
        <Badge tone={STATUS_TONE[file.status]} className="ml-auto">{file.status}</Badge>
        <span className="text-xs font-mono shrink-0">
          <span className="text-emerald-700">+{file.additions}</span> <span className="text-rose-700">−{file.deletions}</span>
        </span>
      </button>
      {open && (
        <div className="overflow-x-auto text-[12.5px] leading-5 font-mono">
          {file.binary && <p className="px-4 py-3 text-sm text-slate-500 font-sans">Binary file: not shown.</p>}
          {file.truncated && <p className="px-4 py-3 text-sm text-slate-500 font-sans">This diff is too large to show. Download the file to compare it.</p>}
          {!file.binary && !file.truncated && rows.length === 0 && (
            <p className="px-4 py-3 text-sm text-slate-500 font-sans">No content changes (renamed or mode changed).</p>
          )}
          <table className="min-w-full border-collapse">
            <tbody>
              {rows.map((row, i) => {
                if (row.type === 'hunk') {
                  return (
                    <tr key={i} className={ROW_BG.hunk}>
                      <td colSpan={3} className="px-3 py-1 whitespace-pre">{row.text}</td>
                    </tr>
                  );
                }
                const side = row.type === 'del' ? 'old' : 'new';
                const line = side === 'old' ? row.oldNo : row.newNo;
                const key = `${side}:${line}`;
                return (
                  <React.Fragment key={i}>
                    <tr className={`${ROW_BG[row.type]} group`}>
                      <td className="select-none text-right text-slate-400 px-2 w-1 whitespace-nowrap align-top">{row.oldNo ?? ''}</td>
                      <td className="select-none text-right text-slate-400 px-2 w-1 whitespace-nowrap align-top relative">
                        {row.newNo ?? ''}
                        {onComment && (
                          <button
                            type="button"
                            onClick={() => setComposer(key)}
                            className="absolute -right-2 top-0 flex items-center justify-center w-5 h-5 rounded bg-indigo-600 text-white opacity-0 group-hover:opacity-100 focus:opacity-100"
                            aria-label={`Comment on line ${line}`}
                          >
                            <MessageSquarePlus className="w-3 h-3" />
                          </button>
                        )}
                      </td>
                      <td className="px-3 whitespace-pre text-slate-800">
                        <span className="select-none text-slate-400 mr-1">{SIGN[row.type]}</span>
                        {highlighted ? <span className="hljs !bg-transparent !p-0" dangerouslySetInnerHTML={{ __html: highlighted[i] || '' }} /> : row.text}
                      </td>
                    </tr>
                    {(byLine[key] || composer === key) && (
                      <tr>
                        <td colSpan={3} className="bg-slate-50 border-y border-slate-200">
                          {byLine[key] && <InlineThread comments={byLine[key]} />}
                          {composer === key && (
                            <CommentBox
                              onCancel={() => setComposer(null)}
                              onSubmit={async (body) => {
                                await onComment({ path: file.path, line, side, body });
                                setComposer(null);
                              }}
                            />
                          )}
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/** A list of changed files. `comments` are inline comments (path/line/side); `onComment` enables adding them. */
export default function DiffView({ diff, comments = [], onComment }) {
  if (!diff) return null;
  const many = diff.files.length > 25;
  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-600">
        {diff.files.length} file{diff.files.length === 1 ? '' : 's'} changed ·{' '}
        <span className="text-emerald-700 font-semibold">+{diff.additions}</span>{' '}
        <span className="text-rose-700 font-semibold">−{diff.deletions}</span>
        {diff.truncated && ' · some large diffs are hidden'}
      </p>
      {diff.files.map((f) => (
        <FileDiff
          key={`${f.old_path || ''}:${f.path}`}
          file={f}
          defaultOpen={!many}
          comments={comments.filter((c) => c.path === f.path)}
          onComment={onComment}
        />
      ))}
    </div>
  );
}
