import React, { createContext, useContext, useEffect, useState } from 'react';
import { Check, Copy, ImageOff, Lightbulb } from 'lucide-react';
import { api } from '../api';

// Renders a page's Markdown the same way everywhere (Pages preview, Files preview).
// Pictures are written ![alt](file:<file id>) and loaded with the user's session; plain https
// images are shown as-is. Everything is built as React elements, never as HTML strings.
const WorkspaceContext = createContext(null);

export function DocumentImage({ src, alt, block = false }) {
  const workspaceId = useContext(WorkspaceContext);
  const fileId = src.startsWith('file:') ? src.slice(5) : null;
  const [url, setUrl] = useState(fileId ? null : /^https:\/\//i.test(src) ? src : '');
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!fileId || !workspaceId) return undefined;
    let objectUrl = null;
    let cancelled = false;
    setFailed(false);
    // <img> never runs scripts, whatever the bytes are; the type only helps the browser decode.
    api
      .fetchFileBlob(workspaceId, fileId, 'image/png')
      .then((blob) => {
        objectUrl = URL.createObjectURL(blob);
        if (!cancelled) setUrl(objectUrl);
      })
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [fileId, workspaceId]);

  if (failed || url === '') {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-slate-600 bg-slate-100 border border-slate-200 rounded-lg px-2 py-1">
        <ImageOff className="w-3.5 h-3.5" aria-hidden="true" />
        {alt || 'Image'} (not available)
      </span>
    );
  }
  if (!url) {
    return <span className="inline-block w-40 h-24 rounded-xl bg-slate-100 animate-pulse" role="img" aria-label={`Loading ${alt || 'image'}`} />;
  }
  const img = <img src={url} alt={alt || ''} className="max-w-full h-auto rounded-xl border border-slate-200" />;
  return block ? <figure className="my-3">{img}{alt && <figcaption className="text-xs text-slate-600 mt-1">{alt}</figcaption>}</figure> : img;
}

// Inline Markdown for the preview: **bold**, *italic*, `code`, ~~strike~~ and [links](https://…).
// Built as React elements (never HTML strings), and only http(s)/mailto links are made clickable.
const INLINE_PATTERN = /(!\[[^\]]*\]\([^)\s]+\)|\*\*[^*]+\*\*|__[^_]+__|\*[^*\s][^*]*\*|(?<![\w])_[^_\s][^_]*_(?![\w])|`[^`]+`|~~[^~]+~~|\[[^\]]+\]\([^)\s]+\))/g;

export function renderInline(text) {
  if (!text) return text;
  const pieces = String(text).split(INLINE_PATTERN);
  return pieces.map((piece, i) => {
    if (!piece) return null;
    const image = piece.match(/^!\[([^\]]*)\]\(([^)\s]+)\)$/);
    if (image) return <DocumentImage key={i} src={image[2]} alt={image[1]} />;
    if ((piece.startsWith('**') && piece.endsWith('**')) || (piece.startsWith('__') && piece.endsWith('__'))) {
      return <strong key={i} className="font-bold">{renderInline(piece.slice(2, -2))}</strong>;
    }
    if (piece.startsWith('~~') && piece.endsWith('~~')) return <del key={i}>{piece.slice(2, -2)}</del>;
    if (piece.startsWith('`') && piece.endsWith('`')) {
      return <code key={i} className="px-1.5 py-0.5 rounded bg-slate-100 text-rose-700 font-mono text-[0.9em]">{piece.slice(1, -1)}</code>;
    }
    const link = piece.match(/^\[([^\]]+)\]\(([^)\s]+)\)$/);
    if (link) {
      const safe = /^(https?:|mailto:)/i.test(link[2]);
      return safe ? (
        <a key={i} href={link[2]} target="_blank" rel="noopener noreferrer" className="text-indigo-700 underline">
          {link[1]}
        </a>
      ) : (
        <span key={i}>{link[1]}</span>
      );
    }
    if ((piece.startsWith('*') && piece.endsWith('*') && piece.length > 2) || (piece.startsWith('_') && piece.endsWith('_') && piece.length > 2)) {
      return <em key={i}>{renderInline(piece.slice(1, -1))}</em>;
    }
    return <React.Fragment key={i}>{piece}</React.Fragment>;
  });
}

function splitTableRow(line) {
  return line.trim().replace(/^\|/, '').replace(/\|$/, '').split(/(?<!\\)\|/).map((cell) => cell.replace(/\\\|/g, '|').trim());
}

function renderTable(rows, key) {
  const isDivider = (row) => row.every((cell) => /^:?-{2,}:?$/.test(cell));
  const parsed = rows.map(splitTableRow);
  const hasHeader = parsed.length > 1 && isDivider(parsed[1]);
  const head = hasHeader ? parsed[0] : null;
  const body = parsed.filter((row, i) => !(hasHeader && (i === 0 || i === 1)) && !isDivider(row));
  return (
    <div key={key} className="my-3 overflow-x-auto">
      <table className="min-w-full text-sm border border-slate-200 rounded-xl overflow-hidden">
        {head && (
          <thead className="bg-slate-50">
            <tr>
              {head.map((cell, i) => (
                <th key={i} scope="col" className="text-left font-bold text-slate-900 px-3 py-2 border-b border-slate-200">
                  {renderInline(cell)}
                </th>
              ))}
            </tr>
          </thead>
        )}
        <tbody>
          {body.map((row, r) => (
            <tr key={r} className="border-b border-slate-100 last:border-0">
              {row.map((cell, c) => (
                <td key={c} className="px-3 py-2 text-slate-800 align-top">{renderInline(cell)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function MarkdownDocument({ text: markdownText, workspaceId, onToggleCheckbox, emptyText }) {
  const [copiedCodeIdx, setCopiedCodeIdx] = useState(null);

  if (!markdownText || !markdownText.trim()) {
    return <p className="text-sm text-slate-500 italic py-8 text-center">{emptyText || 'This page is empty.'}</p>;
  }

  const lines = markdownText.split('\n');
  let inCodeBlock = false;
  let codeBuffer = [];
  let codeLang = '';
  let tableBuffer = [];
  const renderedElements = [];
  const flushTable = (idx) => {
    if (tableBuffer.length) {
      renderedElements.push(renderTable(tableBuffer, `table-${idx}`));
      tableBuffer = [];
    }
  };

  lines.forEach((line, idx) => {
    if (!inCodeBlock && line.trim().startsWith('|')) {
      tableBuffer.push(line);
      return;
    }
    flushTable(idx);
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
            <div className="flex items-center justify-between px-4 py-2 bg-slate-950/70 border-b border-slate-800 text-xs text-slate-400">
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

    // Pictures on their own line
    const picture = line.trim().match(/^!\[([^\]]*)\]\(([^)\s]+)\)$/);
    if (picture) {
      renderedElements.push(<DocumentImage key={idx} src={picture[2]} alt={picture[1]} block />);
      return;
    }

    // Headings
    if (line.startsWith('# ')) {
      renderedElements.push(
        <h2 key={idx} className="text-2xl font-black text-slate-900 mt-6 mb-2 tracking-tight">
          {renderInline(line.replace('# ', ''))}
        </h2>
      );
    } else if (line.startsWith('## ')) {
      renderedElements.push(
        <h3 key={idx} className="text-xl font-bold text-slate-900 mt-5 mb-2 tracking-tight border-b border-slate-200 pb-1.5">
          {renderInline(line.replace('## ', ''))}
        </h3>
      );
    } else if (line.startsWith('### ')) {
      renderedElements.push(
        <h4 key={idx} className="text-base font-bold text-slate-900 mt-4 mb-1">
          {renderInline(line.replace('### ', ''))}
        </h4>
      );
    }
    // Interactive Task Checkboxes
    else if (line.trim().startsWith('- [ ]') || line.trim().startsWith('- [x]')) {
      const isChecked = line.trim().startsWith('- [x]');
      const text = line.replace(/- \[[ x]\]\s*/, '');
      renderedElements.push(
        <div
          key={idx}
          onClick={onToggleCheckbox ? () => onToggleCheckbox(idx) : undefined}
          className="flex items-start gap-2.5 py-1 px-2 rounded-xl hover:bg-indigo-50/70 transition cursor-pointer group"
        >
          <input
            type="checkbox"
            checked={isChecked}
            onChange={() => onToggleCheckbox?.(idx)}
            disabled={!onToggleCheckbox}
            aria-label={text}
            className="mt-1 rounded border-slate-300 text-indigo-600 focus:ring-0 cursor-pointer w-4 h-4"
          />
          <span
            className={`text-sm leading-relaxed ${
              isChecked ? 'line-through text-slate-400' : 'text-slate-800 font-medium'
            }`}
          >
            {text}
          </span>
        </div>
      );
    }
    // Notion Callout block
    else if (line.trim().startsWith('> 💡') || line.trim().startsWith('> Note:')) {
      renderedElements.push(
        <div
          key={idx}
          className="my-3 p-3.5 rounded-2xl bg-amber-50 border border-amber-200/80 text-amber-900 flex items-start gap-3 shadow-sm text-sm"
        >
          <Lightbulb className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
          <div className="leading-relaxed font-sans">{renderInline(line.replace(/^>\s*(💡|Note:)?\s*/, ''))}</div>
        </div>
      );
    }
    // Blockquote
    else if (line.trim().startsWith('> ')) {
      renderedElements.push(
        <blockquote
          key={idx}
          className="my-2 pl-4 border-l-4 border-indigo-500 text-slate-600 italic text-sm py-1"
        >
          {renderInline(line.replace('> ', ''))}
        </blockquote>
      );
    }
    // Bullet list
    else if (line.trim().startsWith('- ') || line.trim().startsWith('* ')) {
      renderedElements.push(
        <li key={idx} className="ml-5 list-disc text-slate-800 text-sm py-0.5 leading-relaxed">
          {renderInline(line.replace(/^[-*]\s*/, ''))}
        </li>
      );
    }
    // Numbered list
    else if (/^\d+\.\s/.test(line.trim())) {
      renderedElements.push(
        <li key={idx} className="ml-5 list-decimal text-slate-800 text-sm py-0.5 leading-relaxed">
          {renderInline(line.replace(/^\d+\.\s*/, ''))}
        </li>
      );
    }
    // Horizontal Rule
    else if (line.trim() === '---' || line.trim() === '***') {
      renderedElements.push(<hr key={idx} className="my-5 border-t border-slate-200" />);
    }
    // Spacer
    else if (!line.trim()) {
      renderedElements.push(<div key={idx} className="h-2" />);
    }
    // Paragraph
    else {
      renderedElements.push(
        <p key={idx} className="text-slate-800 text-sm leading-relaxed">
          {renderInline(line)}
        </p>
      );
    }
  });
  flushTable(lines.length);

  return (
    <WorkspaceContext.Provider value={workspaceId}>
      <div className="space-y-1 select-text">{renderedElements}</div>
    </WorkspaceContext.Provider>
  );
}
