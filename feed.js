/* Feed da sala (RimkRadio) em coluna vertical, estilo chat: balão de quem postou + mídia embaixo.
   Cores: o painel segue var(--cat) (categoria da sala) e cada balão usa a cor da pessoa, como no chat. */
(function () {
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
  const $ = id => document.getElementById(id);
  const css = `
  #feed-handle{position:fixed;left:0;top:clamp(110px,18vh,200px);z-index:74;display:none;writing-mode:vertical-rl;text-orientation:upright;background:#0d1210;color:var(--cat,#99FF00);border:1px solid var(--cat,#99FF00);border-left:0;border-radius:0 12px 12px 0;padding:14px 6px;font:20px 'VT323',monospace;letter-spacing:3px;cursor:pointer;opacity:.9;transition:left .35s cubic-bezier(.2,.8,.2,1),opacity .25s,color .4s,border-color .4s,box-shadow .4s}
  #feed-handle.on{display:block}
  #feed-handle:hover{opacity:1;box-shadow:0 0 14px color-mix(in srgb,var(--cat,#99FF00) 55%,transparent)}
  body.feed-open #feed-handle{left:min(420px,100vw)}
  #feed-handle.new{animation:fpulse 1s ease-in-out 3}
  @keyframes fpulse{50%{box-shadow:0 0 20px var(--cat,#99FF00)}}
  #feed-badge{display:block;writing-mode:horizontal-tb;text-align:center;background:var(--cat,#99FF00);color:#000;border-radius:10px;padding:0 6px;margin:8px auto 0;font-size:15px;letter-spacing:0}
  #feed-badge:empty{display:none}
  #feed-panel{position:fixed;top:0;left:0;bottom:0;width:min(420px,100vw);z-index:73;display:flex;flex-direction:column;background:rgba(7,9,10,.97);backdrop-filter:blur(8px);border-right:2px solid var(--cat,#99FF00);box-shadow:12px 0 50px color-mix(in srgb,var(--cat,#99FF00) 28%,#000);transform:translateX(-105%);visibility:hidden;transition:transform .35s cubic-bezier(.2,.8,.2,1),visibility 0s linear .35s,border-color .4s,box-shadow .4s}
  body.feed-open #feed-panel{transform:none;visibility:visible;transition:transform .35s cubic-bezier(.2,.8,.2,1),visibility 0s,border-color .4s,box-shadow .4s}
  .f-head{display:flex;align-items:center;justify-content:space-between;padding:14px 16px 8px;font:22px 'VT323',monospace;letter-spacing:2px;color:var(--cat,#99FF00)}
  .f-head button{background:none;border:0;color:#7f8a7a;font-size:18px;cursor:pointer}.f-head button:hover{color:#FF3860}
  .f-tabs{display:flex;gap:6px;padding:0 16px 10px;align-items:center}
  .f-tab{background:none;border:1px solid #1f2b1c;color:#7f8a7a;padding:4px 12px;border-radius:99px;cursor:pointer;font:13px 'Exo 2'}
  .f-tab.on{color:#000;background:var(--cat,#99FF00);border-color:var(--cat,#99FF00)}
  #feed-list{flex:1;min-height:0;overflow-y:auto;overflow-x:hidden;padding:6px 14px 10px;border-top:1px solid color-mix(in srgb,var(--cat,#99FF00) 22%,#0d1210)}
  .f-post{display:flex;flex-direction:column;align-items:stretch;margin-bottom:16px;min-width:0}
  .f-who{display:flex;align-items:center;gap:8px;margin-bottom:4px}
  .f-name{font:600 12px ui-monospace,Menlo,Consolas,monospace}
  .f-time{margin-left:auto;font-size:11px;color:#6B7566}
  .f-bub{position:relative;padding:8px 10px 10px;border-radius:16px;border-top-left-radius:4px;min-width:0}
  .f-lab{font:12px 'Exo 2',sans-serif;color:#C3CBBE;margin:0 22px 6px 2px;opacity:.85}
  .f-del{position:absolute;top:6px;right:8px;background:none;border:0;color:#7f8a7a;cursor:pointer;opacity:0;transition:opacity .15s}
  .f-bub:hover .f-del,.f-del:focus-visible{opacity:1}.f-del:hover{color:#FF3860}
  .f-media{display:flex;justify-content:center;min-width:0}
  .f-media img,.f-media video{width:100%;max-height:70vh;object-fit:contain;border-radius:10px;display:block;background:#000}
  .f-media iframe{width:100%;border:0;border-radius:10px;aspect-ratio:16/9}
  .f-media iframe.tall{aspect-ratio:9/16;width:auto;max-width:100%;max-height:70vh;min-width:240px}
  .f-media>div,.f-media .twitter-tweet{max-width:100%}
  .f-link{display:block;color:#e8e8e3;text-decoration:none;word-break:break-all;font-size:13px}.f-link b{color:var(--cat,#99FF00)}
  #feed-empty{color:#7f8a7a;text-align:center;padding:50px 10px;font-size:14px}
  .f-send{display:flex;gap:8px;padding:10px 14px calc(12px + env(safe-area-inset-bottom,0px));border-top:1px solid color-mix(in srgb,var(--cat,#99FF00) 22%,#0d1210)}
  .f-send input{flex:1;min-width:0;background:#000;border:1px solid #1f2b1c;color:#e8e8e3;padding:10px 12px;border-radius:8px;font:14px 'Exo 2',sans-serif;outline:none}
  .f-send input:focus{border-color:var(--cat,#99FF00)}
  .f-btn{font:600 14px 'Exo 2',sans-serif;background:transparent;color:var(--cat,#99FF00);border:1px solid var(--cat,#99FF00);padding:9px 14px;border-radius:8px;cursor:pointer;transition:.2s}
  .f-btn:hover{background:var(--cat,#99FF00);color:#000}`;
  const st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);

  const root = document.createElement('div');
  root.innerHTML = `<button id="feed-handle" type="button" title="Feed da sala">FEED<span id="feed-badge"></span></button>
  <aside id="feed-panel" aria-label="Feed da sala">
    <div class="f-head"><span>FEED DA SALA</span><button id="feed-hide" type="button" aria-label="Fechar">✕</button></div>
    <div id="feed-list"><div id="feed-inner"><div id="feed-empty">Nada por aqui ainda.<br>Cole um link lá embaixo.</div></div></div>
    <div class="f-send"><input id="feed-url" placeholder="Cole um link: X, YouTube, Instagram, TikTok, foto…" autocomplete="off"><button class="f-btn" id="feed-add" type="button">Postar</button></div>
  </aside>`;
  while (root.firstChild) document.body.appendChild(root.firstChild);

  let api = null, items = new Map(), filtro = 'all', unseen = 0, stick = true;
  const loaded = {};
  const loadScript = src => loaded[src] || (loaded[src] = new Promise((ok, err) => { const s = document.createElement('script'); s.src = src; s.async = true; s.onload = ok; s.onerror = err; document.head.appendChild(s); }));
  const list = $('feed-list'), inner = $('feed-inner');

  function parse(raw) {
    let u; try { u = new URL(String(raw).trim()); } catch (e) { return null; }
    if (u.protocol !== 'https:') return null;
    const h = u.hostname.replace(/^www\.|^m\./, ''), p = u.pathname; let m;
    if (/^(x|twitter)\.com$/.test(h) && (m = p.match(/status(?:es)?\/(\d+)/))) return { type: 'x', kind: 'video', id: m[1], label: 'Post do X' };
    if (h === 'youtube.com' || h === 'youtu.be') {
      const id = h === 'youtu.be' ? p.slice(1).split('/')[0] : (u.searchParams.get('v') || (p.match(/\/(?:shorts|embed|live)\/([\w-]+)/) || [])[1]);
      if (id && /^[\w-]{5,20}$/.test(id)) return { type: 'yt', kind: 'video', id, short: /shorts/.test(p), label: 'YouTube' };
    }
    if (h === 'instagram.com' && (m = p.match(/^\/(?:p|reel|tv)\/[\w-]+/))) return { type: 'ig', kind: 'video', label: 'Instagram', href: 'https://www.instagram.com' + m[0] + '/' };
    if (h === 'tiktok.com' && (m = p.match(/video\/(\d+)/))) return { type: 'tt', kind: 'video', id: m[1], label: 'TikTok' };
    if (/\.(jpe?g|png|gif|webp|avif)$/i.test(p)) return { type: 'img', kind: 'img', label: 'Foto / meme' };
    if (/\.(mp4|webm|mov|m4v)$/i.test(p)) return { type: 'vid', kind: 'video', label: 'Vídeo' };
    return { type: 'link', kind: 'img', label: h };
  }
  const avatar = n => (api && api.avatar) ? api.avatar(n) : esc((String(n).trim()[0] || '?').toUpperCase());

  async function draw(row) {
    const it = parse(row.url) || { type: 'link', kind: 'img', label: 'Link' };
    const name = row.user_name || 'Convidado';
    let col = api && api.color ? api.color(name) : ''; if (!/^#[0-9a-f]{6}$/i.test(col)) col = '#99FF00';
    const can = api && api.canRemove(row);
    const t = row.created_at ? new Date(row.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '';
    const el = document.createElement('div');
    el.className = 'f-post'; el.dataset.id = row.id; el.dataset.kind = it.kind;
    el.innerHTML = `<div class="f-who"><span class="f-av" data-n="${esc(name)}">${avatar(name)}</span><span class="f-name" style="color:${col};text-shadow:0 0 8px ${col}aa">${esc(name)}</span><span class="f-time">${esc(t)}</span></div>
      <div class="f-bub" style="background:${col}1F;border:1px solid ${col}88;box-shadow:0 0 12px ${col}26">${can ? '<button class="f-del" title="Remover" type="button">✕</button>' : ''}<div class="f-lab">${esc(it.label)}</div><div class="f-media"></div></div>`;
    const b = el.querySelector('.f-del'); if (b) b.onclick = () => api.remove(row.id).catch(() => {});
    const body = el.querySelector('.f-media');
    inner.appendChild(el); aplicar();
    const fb = () => { body.innerHTML = `<a class="f-link" target="_blank" rel="noopener noreferrer" href="${esc(row.url)}">Abrir <b>${esc(row.url)}</b></a>`; };
    try {
      if (it.type === 'x') { await loadScript('https://platform.twitter.com/widgets.js'); const w = await twttr.widgets.createTweet(it.id, body, { theme: 'dark', dnt: true, conversation: 'none', width: Math.max(250, Math.min(550, body.clientWidth)) }); if (!w) fb(); }
      else if (it.type === 'yt') body.innerHTML = `<iframe class="${it.short ? 'tall' : ''}" src="https://www.youtube.com/embed/${it.id}" allow="encrypted-media;picture-in-picture;fullscreen" allowfullscreen loading="lazy"></iframe>`;
      else if (it.type === 'tt') body.innerHTML = `<iframe class="tall" src="https://www.tiktok.com/embed/v2/${it.id}" allowfullscreen loading="lazy"></iframe>`;
      else if (it.type === 'ig') { body.innerHTML = `<blockquote class="instagram-media" data-instgrm-permalink="${esc(it.href)}" style="width:100%;margin:0"></blockquote>`; await loadScript('https://www.instagram.com/embed.js'); window.instgrm && instgrm.Embeds.process(); }
      else if (it.type === 'img') { const im = new Image(); im.loading = 'lazy'; im.referrerPolicy = 'no-referrer'; im.src = row.url; im.onerror = fb; body.appendChild(im); }
      else if (it.type === 'vid') { body.innerHTML = `<video src="${esc(row.url)}" controls playsinline preload="metadata"></video>`; body.firstChild.onerror = fb; }
      else fb();
    } catch (e) { fb(); }
  }

  function aplicar() { document.querySelectorAll('.f-post').forEach(c => { c.style.display = (filtro === 'all' || c.dataset.kind === filtro) ? '' : 'none'; }); }
  function vazio() { $('feed-empty').style.display = items.size ? 'none' : 'block'; $('feed-badge').textContent = unseen || ''; }
  function down() { list.scrollTop = list.scrollHeight; }
  function add(row, live) {
    if (!row || items.has(row.id)) return;
    items.set(row.id, row);
    const mine = !!(api && row.user_id === api.uid());
    if (mine) stick = true;
    draw(row);
    if (live) { try { api && api.sound && api.sound(); } catch (e) {} }
    if (live && !mine && !document.body.classList.contains('feed-open')) {
      unseen++; const h = $('feed-handle'); h.classList.add('new'); setTimeout(() => h.classList.remove('new'), 2500);
    }
    vazio();
    if (stick) requestAnimationFrame(down);
  }
  function del(id) { if (!items.delete(id)) return; const c = inner.querySelector(`.f-post[data-id="${id}"]`); if (c) c.remove(); vazio(); }
  function clear() { inner.querySelectorAll('.f-post').forEach(n => n.remove()); }

  // acompanha o fim da conversa enquanto as mídias carregam (e deixa de seguir se a pessoa rolar para cima)
  list.addEventListener('scroll', () => { stick = list.scrollHeight - list.scrollTop - list.clientHeight < 120; });
  if (window.ResizeObserver) new ResizeObserver(() => { if (stick) down(); }).observe(inner);

  function open(v) {
    document.body.classList.toggle('feed-open', v);
    if (v) {
      unseen = 0; vazio(); stick = true;
      document.querySelectorAll('.f-av').forEach(s => { s.innerHTML = avatar(s.dataset.n); });   // avatares que chegaram depois
      requestAnimationFrame(down); setTimeout(down, 400);
    }
  }
  $('feed-handle').onclick = () => open(!document.body.classList.contains('feed-open'));
  $('feed-hide').onclick = () => open(false);
  document.addEventListener('keydown', e => { if (e.key === 'Escape') open(false); });
  $('feed-add').onclick = async () => {
    const v = $('feed-url').value.trim(); if (!v || !api) return;
    if (!/^https:\/\//i.test(v) || !parse(v)) return alert('Cole um link https:// válido.');
    try { await api.add(v); $('feed-url').value = ''; }
    catch (e) {
      const m = String(e && e.message);
      alert(/duplicate|23505/.test(m) ? 'Esse link já está no feed.' : /slow_down/.test(m) ? 'Calma! Espere uns segundos para postar de novo.' : /feed_full/.test(m) ? 'O feed da sala está cheio (100 posts).' : 'Não consegui postar.');
    }
  };
  $('feed-url').addEventListener('keydown', e => { if (e.key === 'Enter') $('feed-add').click(); });

  window.RimkFeed = {
    // api = { list(), add(url), remove(id), uid(), canRemove(row), color(nome), avatar(nome) }; sem api (P2P/local) o botão nem aparece
    async enter(a) {
      this.leave(); if (!a) return; api = a; $('feed-handle').classList.add('on'); vazio();
      try { (await api.list()).forEach(r => add(r, false)); } catch (e) { console.warn('Feed:', e.message); }
    },
    leave() { api = null; items = new Map(); unseen = 0; stick = true; clear(); vazio(); $('feed-handle').classList.remove('on', 'new'); open(false); },
    push(ev) { if (!api || !ev) return; if (ev.k === 'add') add(ev.row, true); else if (ev.k === 'del') del(ev.id); }
  };
  vazio();
})();
