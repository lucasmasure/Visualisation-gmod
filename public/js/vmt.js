// Lecture des matériaux Valve (.vmt, format KeyValues)

function tokenize(text) {
  const tokens = [];
  let i = 0;
  const n = text.length;
  while (i < n) {
    const c = text[i];
    if (c <= ' ') { i++; continue; }
    if (c === '/' && text[i + 1] === '/') { while (i < n && text[i] !== '\n') i++; continue; }
    if (c === '{' || c === '}') { tokens.push(c); i++; continue; }
    if (c === '"') {
      let j = i + 1;
      while (j < n && text[j] !== '"' && text[j] !== '\n') j++;
      tokens.push({ s: text.slice(i + 1, j) });
      i = j + 1;
      continue;
    }
    let j = i;
    while (j < n && text[j] > ' ' && text[j] !== '{' && text[j] !== '}' && text[j] !== '"') j++;
    tokens.push({ s: text.slice(i, j) });
    i = j;
  }
  return tokens;
}

function parseBlock(tokens, pos) {
  const obj = {};
  while (pos.i < tokens.length) {
    const t = tokens[pos.i++];
    if (t === '}') break;
    if (t === '{') continue;
    const key = t.s.toLowerCase();
    let next = tokens[pos.i];
    // ignore les conditions du type [$WIN32]
    if (next && next.s && /^\[.*\]$/.test(next.s)) next = tokens[++pos.i];
    if (next === '{') {
      pos.i++;
      obj[key] = parseBlock(tokens, pos);
    } else if (next && next.s !== undefined) {
      pos.i++;
      if (!(key in obj)) obj[key] = next.s;
    }
    const after = tokens[pos.i];
    if (after && after.s && /^\[.*\]$/.test(after.s)) pos.i++;
  }
  return obj;
}

export function parseVmt(text) {
  const tokens = tokenize(text.replace(/^﻿/, ''));
  if (!tokens.length || !tokens[0].s) return null;
  const shader = tokens[0].s.toLowerCase();
  const pos = { i: 1 };
  const params = tokens[1] === '{' ? (pos.i = 2, parseBlock(tokens, pos)) : {};
  return { shader, params };
}
