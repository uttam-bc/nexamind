import React, { useMemo, useState } from 'react';
import { marked } from 'marked';
import katex from 'katex';
import DOMPurify from 'dompurify';
import { Check, Copy } from 'lucide-react';

/**
 * Parses LaTeX mathematical expressions (both block $$...$$ and inline $...$)
 * and renders standard Markdown using marked + KaTeX.
 * Ensures currency like $4.4 billion is preserved and not mangled.
 */
function processMathAndMarkdown(rawText) {
  if (!rawText) return '';

  const mathTokens = [];
  let tokenCounter = 0;

  // 1. Process block math: $$...$$ or \[...\]
  let textWithPlaceholders = rawText.replace(
    /(\$\$[\s\S]*?\$\$|\\\[[\s\S]*?\\\])/g,
    (match) => {
      let formula = match;
      if (formula.startsWith('$$') && formula.endsWith('$$')) {
        formula = formula.slice(2, -2);
      } else if (formula.startsWith('\\[') && formula.endsWith('\\]')) {
        formula = formula.slice(2, -2);
      }

      try {
        const rendered = katex.renderToString(formula.trim(), {
          displayMode: true,
          throwOnError: false,
        });
        const placeholderId = `NXMKATEXBLOCK${tokenCounter++}X`;
        mathTokens.push({
          placeholder: placeholderId,
          html: `<div class="katex-block-wrapper my-2.5 overflow-x-auto text-center">${rendered}</div>`,
        });
        return placeholderId;
      } catch (err) {
        return match;
      }
    }
  );

  // 2. Process inline math: $...$ or \(...\)
  // Protect currency expressions like $4.4 billion, $100, $5.00
  textWithPlaceholders = textWithPlaceholders.replace(
    /(\\\([\s\S]*?\\\)|(?<=[^$0-9]|^)\$(?!\s)([^$\n]+?)(?<!\s)\$(?=[^$0-9]|$))/g,
    (match, p1, p2) => {
      let formula = p2 || match;
      if (formula.startsWith('\\(') && formula.endsWith('\\)')) {
        formula = formula.slice(2, -2);
      }

      // Check if this is a currency / financial figure (e.g. "$4.4 billion", "$100", "$50k")
      const trimmed = formula.trim();
      if (/^\d+(\.\d+)?\s*(billion|million|trillion|k|m|usd|dollars?|cents?)?$/i.test(trimmed)) {
        return match;
      }

      try {
        const rendered = katex.renderToString(trimmed, {
          displayMode: false,
          throwOnError: false,
        });
        const placeholderId = `NXMKATEXINLINE${tokenCounter++}X`;
        mathTokens.push({
          placeholder: placeholderId,
          html: `<span class="katex-inline-wrapper mx-0.5">${rendered}</span>`,
        });
        return placeholderId;
      } catch (err) {
        return match;
      }
    }
  );

  // 3. Render Markdown through marked
  marked.setOptions({
    gfm: true,
    breaks: true,
  });
  let html = marked.parse(textWithPlaceholders);

  // 4. Restore rendered KaTeX Math placeholders
  for (const token of mathTokens) {
    // Replace all occurrences of placeholder
    html = html.split(token.placeholder).join(token.html);
  }

  // 5. Sanitize HTML allowing KaTeX SVG and MathML tags
  const cleanHtml = DOMPurify.sanitize(html, {
    ADD_TAGS: [
      'math',
      'annotation',
      'semantics',
      'mrow',
      'mi',
      'mo',
      'mn',
      'msup',
      'msub',
      'mfrac',
      'mover',
      'munder',
      'munderover',
      'svg',
      'path',
      'span',
      'div',
    ],
    ADD_ATTR: [
      'xmlns',
      'display',
      'aria-hidden',
      'viewBox',
      'd',
      'style',
      'class',
      'target',
      'rel',
    ],
  });

  return cleanHtml;
}

export default function FormattedChatMessage({ content, isUser = false, className = '' }) {
  const [copied, setCopied] = useState(false);

  const formattedHtml = useMemo(() => {
    if (!content) return '';
    return processMathAndMarkdown(content);
  }, [content]);

  const handleCopyRaw = () => {
    if (!content) return;
    navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (!content) return null;

  return (
    <div className={`relative group/msg ${className}`}>
      <div
        className="formatted-chat-content text-sm leading-relaxed"
        dangerouslySetInnerHTML={{ __html: formattedHtml }}
      />

      {/* Copy button on hover for AI assistant answers */}
      {!isUser && content.length > 30 && (
        <button aria-label="Copy raw text"
          onClick={handleCopyRaw}
          title="Copy raw text"
          className="absolute -top-2 -right-2 opacity-0 group-hover/msg:opacity-100 transition-opacity p-1.5 rounded-lg bg-white border border-slate-200 shadow-sm text-slate-500 hover:text-slate-900 hover:bg-slate-50"
        >
          {copied ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
        </button>
      )}
    </div>
  );
}
