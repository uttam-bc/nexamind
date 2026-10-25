import hljs from 'highlight.js/lib/core';
import bash from 'highlight.js/lib/languages/bash';
import c from 'highlight.js/lib/languages/c';
import cpp from 'highlight.js/lib/languages/cpp';
import csharp from 'highlight.js/lib/languages/csharp';
import css from 'highlight.js/lib/languages/css';
import dockerfile from 'highlight.js/lib/languages/dockerfile';
import go from 'highlight.js/lib/languages/go';
import ini from 'highlight.js/lib/languages/ini';
import java from 'highlight.js/lib/languages/java';
import javascript from 'highlight.js/lib/languages/javascript';
import json from 'highlight.js/lib/languages/json';
import kotlin from 'highlight.js/lib/languages/kotlin';
import markdown from 'highlight.js/lib/languages/markdown';
import php from 'highlight.js/lib/languages/php';
import plaintext from 'highlight.js/lib/languages/plaintext';
import python from 'highlight.js/lib/languages/python';
import ruby from 'highlight.js/lib/languages/ruby';
import rust from 'highlight.js/lib/languages/rust';
import sql from 'highlight.js/lib/languages/sql';
import swift from 'highlight.js/lib/languages/swift';
import typescript from 'highlight.js/lib/languages/typescript';
import xml from 'highlight.js/lib/languages/xml';
import yaml from 'highlight.js/lib/languages/yaml';

const LANGUAGES = {
  bash, c, cpp, csharp, css, dockerfile, go, ini, java, javascript, json, kotlin, markdown, php, plaintext, python,
  ruby, rust, sql, swift, typescript, xml, yaml,
};
Object.entries(LANGUAGES).forEach(([name, lang]) => hljs.registerLanguage(name, lang));

const BY_EXTENSION = {
  js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript', ts: 'typescript', tsx: 'typescript',
  py: 'python', pyw: 'python', json: 'json', html: 'xml', htm: 'xml', xml: 'xml', svg: 'xml', vue: 'xml',
  css: 'css', scss: 'css', less: 'css', sh: 'bash', bash: 'bash', zsh: 'bash', java: 'java', go: 'go', rs: 'rust',
  c: 'c', h: 'c', cpp: 'cpp', cc: 'cpp', hpp: 'cpp', cs: 'csharp', sql: 'sql', yml: 'yaml', yaml: 'yaml',
  md: 'markdown', markdown: 'markdown', php: 'php', rb: 'ruby', kt: 'kotlin', kts: 'kotlin', swift: 'swift',
  ini: 'ini', toml: 'ini', cfg: 'ini', env: 'ini', conf: 'ini',
};

export function languageFor(filename = '') {
  const name = filename.split('/').pop().toLowerCase();
  if (name === 'dockerfile' || name.endsWith('.dockerfile')) return 'dockerfile';
  if (name === 'makefile') return 'bash';
  return BY_EXTENSION[name.split('.').pop()] || 'plaintext';
}

/** Highlighted HTML for each line (highlight.js escapes the source, so this is safe to render). */
export function highlightLines(text, filename) {
  const language = languageFor(filename);
  let html;
  try {
    html = text.length > 400_000 ? escapeHtml(text) : hljs.highlight(text, { language, ignoreIllegals: true }).value;
  } catch {
    html = escapeHtml(text);
  }
  return splitHighlighted(html);
}

export function escapeHtml(text) {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Spans may cross line breaks; close and reopen them per line so every line stands alone.
function splitHighlighted(html) {
  const lines = [];
  let open = [];
  let current = '';
  const tokens = html.split(/(<span[^>]*>|<\/span>|\n)/);
  for (const token of tokens) {
    if (token === '\n') {
      lines.push(current + '</span>'.repeat(open.length));
      current = open.join('');
    } else if (token.startsWith('<span')) {
      open.push(token);
      current += token;
    } else if (token === '</span>') {
      open.pop();
      current += token;
    } else {
      current += token;
    }
  }
  lines.push(current + '</span>'.repeat(open.length));
  if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();
  return lines;
}

const RANK = { read: 1, reviewer: 2, write: 3, maintainer: 4, admin: 5, owner: 6 };
export const can = (role, need) => (RANK[role] || 0) >= RANK[need];

export function timeAgo(iso) {
  if (!iso) return '';
  const seconds = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 45) return 'just now';
  const units = [['year', 31536000], ['month', 2592000], ['week', 604800], ['day', 86400], ['hour', 3600], ['minute', 60]];
  for (const [unit, size] of units) {
    const n = Math.floor(seconds / size);
    if (n >= 1) return `${n} ${unit}${n > 1 ? 's' : ''} ago`;
  }
  return 'just now';
}

export function formatBytes(bytes) {
  if (bytes == null) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export const joinPath = (...parts) => parts.filter(Boolean).join('/').replace(/\/+/g, '/').replace(/^\/|\/$/g, '');
export const parentPath = (path) => path.split('/').slice(0, -1).join('/');

/** Shareable in-app link to a repository view (opened through the URL hash). */
export function repoLink(repoId, view = 'code', extra = '') {
  return `${window.location.origin}${window.location.pathname}#/code/${repoId}/${view}${extra ? `/${extra}` : ''}`;
}

// What a folder upload leaves out unless the person adds it back: dependencies, builds, VCS data.
export const DEFAULT_EXCLUDES = ['node_modules', '.git', '__pycache__', '.venv', 'venv', 'dist', 'build', '.next',
  '.DS_Store', 'Thumbs.db', '.idea', '.pytest_cache', '.mypy_cache', 'coverage'];

const SECRET_NAME = /(^|\/)(\.env(\.[^/]+)?|id_(rsa|dsa|ecdsa|ed25519)|[^/]+\.(pem|key|p12|pfx|keystore|jks|ppk)|credentials(\.json)?|\.npmrc|\.pypirc|\.netrc|\.git-credentials|\.htpasswd|secrets?\.(json|ya?ml|toml|env))$/i;
const SAFE_NAME = /(^|\/)\.env\.(example|sample|template|dist|defaults)$/i;

/** Files that look like secrets: shown for review and left out unless explicitly included. */
export const looksSecret = (path) => SECRET_NAME.test(path) && !SAFE_NAME.test(path);

export function isExcluded(path, excludes = DEFAULT_EXCLUDES) {
  return path.split('/').some((part) => excludes.includes(part));
}
