'use strict';
const $ = s => document.querySelector(s);
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { toast('Storage unavailable – changes are not saved'); } }
};
const DEF = { theme: 'system', accent: '#7c8cff', font: 16, blur: 22, splash: 'full', anim: true, enter: true, web: true, wiki: true, lang: 'en', count: 4 };
let S = { ...DEF, ...store.get('aivora.settings', {}) };
let chats = store.get('aivora.chats', []);
let cur = store.get('aivora.cur', null);
let ctrl = null;

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const esc = t => String(t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function toast(t) { const el = $('#toast'); el.textContent = t; el.classList.add('on'); clearTimeout(toast.t); toast.t = setTimeout(() => el.classList.remove('on'), 2200); }
const save = () => { store.set('aivora.chats', chats); store.set('aivora.cur', cur); };
const chat = () => chats.find(c => c.id === cur);

function applySettings() {
  const r = document.documentElement;
  const dark = matchMedia('(prefers-color-scheme: dark)').matches;
  r.dataset.theme = S.theme === 'system' ? (dark ? 'dark' : 'light') : S.theme;
  r.style.setProperty('--accent', S.accent);
  r.style.setProperty('--fs', S.font + 'px');
  r.style.setProperty('--blur', S.blur + 'px');
  document.body.classList.toggle('noanim', !S.anim);
  store.set('aivora.settings', S);
}

/* ---------- chats ---------- */
function newChat() {
  const c = { id: uid(), title: 'New chat', pinned: false, archived: false, msgs: [], t: Date.now() };
  chats.unshift(c); cur = c.id; save(); renderAll(); $('#input').focus();
}
function renderList() {
  const q = $('#chatSearch').value.toLowerCase();
  const list = chats.filter(c => c.title.toLowerCase().includes(q))
    .sort((a, b) => (b.pinned - a.pinned) || (b.t - a.t));
  $('#chatList').innerHTML = list.map(c => `<div class="ci ${c.id === cur ? 'on' : ''}" data-id="${c.id}">
    <span>${c.pinned ? '📌 ' : ''}${c.archived ? '🗄 ' : ''}${esc(c.title)}</span>
    <button data-a="pin" title="Pin">📌</button><button data-a="ren" title="Rename">✎</button>
    <button data-a="dup" title="Duplicate">⧉</button><button data-a="arc" title="Archive">🗄</button><button data-a="del" title="Delete">✕</button></div>`).join('') || '<small>No chats</small>';
}
function renderMsgs() {
  const c = chat(); $('#title').textContent = c ? c.title : 'AIVORA';
  const box = $('#msgs');
  if (!c || !c.msgs.length) {
    box.innerHTML = '<div class="m"><div class="b"><b>AIVORA</b> — Think. Create. Discover.<br>Ask me anything. I search Wikipedia and the web, then show my sources.</div></div>';
  } else box.innerHTML = c.msgs.map((m, i) => `<div class="m ${m.role}"><div class="b">${m.html || esc(m.text)}
    <small>${new Date(m.t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} · <a href="#" data-copy="${i}">copy</a>${m.role === 'ai' ? ` · <a href="#" data-retry="${i}">retry</a>` : ''}</small></div></div>`).join('');
  box.scrollTop = box.scrollHeight;
}
function renderAll() { renderList(); renderMsgs(); }

/* ---------- search ---------- */
async function getJSON(url, signal) {
  const r = await fetch(url, { signal });
  if (r.status === 429) throw new Error('rate-limited');
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json();
}
async function wikiSearch(q, signal) {
  const lang = /^[a-z-]{2,5}$/i.test(S.lang) ? S.lang : 'en';
  const u = `https://${lang}.wikipedia.org/w/api.php?action=query&format=json&origin=*&generator=search&gsrsearch=${encodeURIComponent(q)}&gsrlimit=${S.count}&prop=extracts|pageimages|info&exintro=1&explaintext=1&exsentences=3&piprop=thumbnail&pithumbsize=160&inprop=url`;
  const d = await getJSON(u, signal);
  return Object.values(d.query?.pages || {}).sort((a, b) => a.index - b.index).map(p => ({
    title: p.title, snippet: p.extract || '', url: p.fullurl, img: p.thumbnail?.source, source: lang + '.wikipedia.org'
  }));
}
async function webSearch(q, signal) {
  const d = await getJSON(`https://api.duckduckgo.com/?q=${encodeURIComponent(q)}&format=json&no_html=1&skip_disambig=1`, signal);
  const out = [];
  if (d.AbstractText) out.push({ title: d.Heading || q, snippet: d.AbstractText, url: d.AbstractURL, img: d.Image ? 'https://duckduckgo.com' + d.Image : '', source: new URL(d.AbstractURL || 'https://duckduckgo.com').hostname });
  (d.RelatedTopics || []).flatMap(t => t.Topics || t).filter(t => t.FirstURL && t.Text).slice(0, S.count)
    .forEach(t => out.push({ title: t.Text.split(' - ')[0].slice(0, 80), snippet: t.Text, url: t.FirstURL, source: new URL(t.FirstURL).hostname }));
  return out;
}
const isCurrent = q => /latest|news|today|current|price|weather|score|202\d|now|recent/i.test(q);
async function answer(q, signal) {
  if (/who (made|created|built)|your creator/i.test(q))
    return { text: 'I\'m AIVORA, created by Shiv Yogi. I answer by searching Wikipedia and the web, and I show my sources.', res: [] };
  if (!S.web && !S.wiki) return { text: 'Search is turned off. Enable Web search or Wikipedia in Settings.', res: [] };
  if (!navigator.onLine) return { text: 'You appear to be offline. Reconnect and try again.', res: [] };
  const jobs = [], errs = [];
  const run = (on, fn, name) => on && jobs.push(fn(q, signal).catch(e => { if (e.name === 'AbortError') throw e; errs.push(name + ': ' + e.message); return []; }));
  run(S.wiki, wikiSearch, 'Wikipedia'); run(S.web, webSearch, 'Web');
  let res = (await Promise.all(jobs)).flat();
  if (isCurrent(q)) res.sort((a, b) => (a.source.includes('wikipedia') ? 1 : 0) - (b.source.includes('wikipedia') ? 1 : 0));
  res = res.slice(0, S.count + 1);
  if (!res.length) return { text: errs.length ? `I couldn't reach the search sources (${errs.join('; ')}). They may be blocked or rate-limited — try again shortly.` : 'No results found. Try different keywords.', res: [] };
  const note = isCurrent(q) ? '\n\n(Current topics change quickly — check the sources below for the latest.)' : '';
  return { text: res[0].snippet.slice(0, 600) + note, res };
}
const card = r => `<a class="src" href="${esc(r.url)}" target="_blank" rel="noopener noreferrer">${r.img ? `<img src="${esc(r.img)}" alt="" loading="lazy">` : ''}<b>${esc(r.title)}</b><br><small>${esc(r.source)}</small><br>${esc(r.snippet.slice(0, 140))}…</a>`;

/* ---------- sending ---------- */
async function send(text) {
  text = (text ?? $('#input').value).trim();
  if (!text) return toast('Type a message first');
  if (ctrl) return;
  if (!chat()) newChat();
  const c = chat();
  c.msgs.push({ role: 'user', text, t: Date.now() });
  if (c.title === 'New chat') c.title = text.slice(0, 40);
  c.t = Date.now();
  $('#input').value = ''; localStorage.removeItem('aivora.draft'); resize();
  renderAll();
  ctrl = new AbortController(); $('#send').textContent = 'Stop';
  const ph = { role: 'ai', text: 'Searching…', t: Date.now() }; c.msgs.push(ph); renderMsgs();
  try {
    const a = await answer(text, ctrl.signal);
    ph.text = a.text; ph.html = esc(a.text) + a.res.map(card).join('');
  } catch (e) {
    ph.text = e.name === 'AbortError' ? 'Stopped.' : 'Something went wrong: ' + e.message; ph.html = esc(ph.text);
  }
  ph.t = Date.now(); ctrl = null; $('#send').textContent = 'Send'; save(); renderAll();
}
function resize() { const i = $('#input'); i.style.height = 'auto'; i.style.height = i.scrollHeight + 'px'; $('#count').textContent = i.value.length ? i.value.length + ' chars' : ''; }
const download = (name, data) => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000); };

/* ---------- events ---------- */
$('#send').onclick = () => ctrl ? ctrl.abort() : send();
$('#newChat').onclick = newChat;
$('#input').addEventListener('input', () => { resize(); try { localStorage.setItem('aivora.draft', $('#input').value); } catch {} });
$('#input').addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey && S.enter) { e.preventDefault(); send(); } });
$('#chatSearch').oninput = renderList;
$('#menu').onclick = () => $('#side').classList.toggle('open');
$('#clearChat').onclick = () => { const c = chat(); if (c && confirm('Clear this conversation?')) { c.msgs = []; save(); renderMsgs(); } };
$('#exportChat').onclick = () => chat() ? download('aivora-chat.json', chat()) : toast('No chat to export');
$('#chatList').onclick = e => {
  const row = e.target.closest('.ci'); if (!row) return;
  const c = chats.find(x => x.id === row.dataset.id), a = e.target.dataset.a;
  if (a === 'pin') c.pinned = !c.pinned;
  else if (a === 'arc') c.archived = !c.archived;
  else if (a === 'ren') { const n = prompt('Rename chat', c.title); if (n?.trim()) c.title = n.trim().slice(0, 60); }
  else if (a === 'dup') chats.unshift({ ...c, id: uid(), title: c.title + ' (copy)', t: Date.now() });
  else if (a === 'del') { if (!confirm('Delete this chat?')) return; chats = chats.filter(x => x !== c); if (cur === c.id) cur = chats[0]?.id ?? null; }
  else { cur = c.id; $('#side').classList.remove('open'); }
  save(); renderAll();
};
$('#msgs').onclick = e => {
  const t = e.target;
  if (t.dataset.copy !== undefined) { e.preventDefault(); navigator.clipboard?.writeText(chat().msgs[t.dataset.copy].text).then(() => toast('Copied')); }
  if (t.dataset.retry !== undefined) { e.preventDefault(); const c = chat(), i = +t.dataset.retry; const q = c.msgs[i - 1]?.text; c.msgs.splice(i - 1, 2); if (q) send(q); }
};
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
if (!SR) { $('#mic').disabled = true; $('#mic').title = 'Voice input not supported in this browser'; }
else $('#mic').onclick = () => { const r = new SR(); r.lang = S.lang; r.onresult = e => { $('#input').value += e.results[0][0].transcript; resize(); }; r.onerror = () => toast('Voice input failed'); r.start(); };
addEventListener('online', netState); addEventListener('offline', netState);
function netState() { const n = $('#net'); n.textContent = navigator.onLine ? 'online' : 'offline'; n.classList.toggle('off', !navigator.onLine); }
addEventListener('keydown', e => { if ((e.ctrlKey || e.metaKey) && e.key === 'k') { e.preventDefault(); newChat(); } });

/* settings */
const bind = { 's-theme': 'theme', 's-accent': 'accent', 's-font': 'font', 's-blur': 'blur', 's-splash': 'splash', 's-anim': 'anim', 's-enter': 'enter', 's-web': 'web', 's-wiki': 'wiki', 's-lang': 'lang', 's-count': 'count' };
for (const [id, k] of Object.entries(bind)) {
  const el = document.getElementById(id), chk = el.type === 'checkbox';
  chk ? el.checked = S[k] : el.value = S[k];
  el.addEventListener('input', () => { S[k] = chk ? el.checked : el.type === 'range' || el.type === 'number' ? +el.value : el.value; applySettings(); });
}
$('#openSettings').onclick = () => $('#dlg').showModal();
$('#closeSettings').onclick = () => $('#dlg').close();
$('#exportAll').onclick = () => download('aivora-data.json', { settings: S, chats });
$('#importAll').onchange = async e => {
  try {
    const d = JSON.parse(await e.target.files[0].text());
    if (!Array.isArray(d.chats)) throw new Error('missing chats');
    const ids = new Set(chats.map(c => c.id));
    d.chats.filter(c => c && c.id && Array.isArray(c.msgs) && !ids.has(c.id)).forEach(c => chats.push({ title: 'Imported', t: Date.now(), ...c }));
    if (d.settings) { S = { ...DEF, ...d.settings }; applySettings(); }
    save(); renderAll(); toast('Import complete');
  } catch (err) { toast('Invalid file: ' + err.message); }
  e.target.value = '';
};
$('#wipe').onclick = () => { if (confirm('Erase all AIVORA chats and settings?')) { ['settings', 'chats', 'cur', 'draft'].forEach(k => localStorage.removeItem('aivora.' + k)); location.reload(); } };

/* chips + splash + boot */
$('#chips').innerHTML = ['Who is Ada Lovelace?', 'Latest news about space', 'What is photosynthesis?'].map(t => `<button class="btn">${t}</button>`).join('');
$('#chips').onclick = e => e.target.matches('.btn') && send(e.target.textContent);
function splash() {
  const sp = $('#splash'), reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (S.splash === 'off') return sp.remove();
  const ms = reduced ? 600 : S.splash === 'short' ? 1400 : 2900;
  if (S.splash === 'short') sp.style.setProperty('--x', 1);
  setTimeout(() => { sp.classList.add('hide'); setTimeout(() => sp.remove(), 700); }, ms);
}
applySettings(); netState(); splash();
if (!chats.length) newChat(); else { if (!chat()) cur = chats[0].id; renderAll(); }
try { $('#input').value = localStorage.getItem('aivora.draft') || ''; resize(); } catch {}
