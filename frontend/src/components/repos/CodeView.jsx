import React, { useMemo } from 'react';
import 'highlight.js/styles/github.css';
import { highlightLines } from './repoUtils';

/** Read-only source with line numbers and syntax highlighting. */
export default function CodeView({ text, filename }) {
  const lines = useMemo(() => highlightLines(text, filename), [text, filename]);
  return (
    <div className="overflow-x-auto text-[13px] leading-5 font-mono" data-testid="code-view">
      <table className="min-w-full border-collapse">
        <tbody>
          {lines.map((html, i) => (
            <tr key={i} id={`L${i + 1}`} className="hover:bg-amber-50/60">
              <td className="select-none text-right text-slate-400 px-3 align-top w-1 whitespace-nowrap border-r border-slate-100">
                {i + 1}
              </td>
              {/* highlight.js output: the source text is HTML-escaped by the highlighter */}
              <td className="px-3 whitespace-pre text-slate-800 hljs !bg-transparent !p-0 !pl-3" dangerouslySetInnerHTML={{ __html: html || ' ' }} />
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
