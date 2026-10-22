/* Feed da sala (RimkRadio): links do X, YouTube, Instagram, TikTok, imagens e vídeos.
   Cores: tudo usa var(--cat), que o script.js já troca conforme a categoria da sala. */
(function () {
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
  const $ = id => document.getElementById(id);
  const css = `
  #feed-handle{position:fixed;top:0;left:50%;transform:translate(-50%,-72%);z-index:74;display:none;background:#0d1210;color:var(--cat,#99FF00);border:1px solid var(--cat,#99FF00);border-top:0;border-radius:0 0 14px 14px;padding:14px 22px 6px;font:20px 'VT323',monospace;letter-spacing:2px;cursor:pointer;opacity:.35;transition:transform .25s,opacity .25s,color .4s,border-color .4s}
  #feed-handle.on{display:block}
  #feed-handle:hover,body.feed-open #feed-handle,#feed-handle.new{transform:translate(-50%,0);opacity:1}
  #feed-badge{background:var(--cat,#99FF00);color:#000;border-radius:10px;padding:0 7px;margin-left:6px;font-size:16px}
  #feed-badge:empty{display:none}
  #feed-panel{position:fixed;inset:0 0 auto 0;height:86%;z-index:73;display:flex;flex-direction:column;background:rgba(7,9,10,.97);backdrop-filter:blur(8px);border-bottom:2px solid var(--cat,#99FF00);box-shadow:0 12px 50px color-mix(in srgb,var(--cat,#99FF00) 28%,#000);transform:translateY(-104%);transition:transform .35s cubic-bezier(.2,.8,.2,1),border-color .4s,box-shadow .4s;visibility:hidden}
  body.feed-open #feed-panel{transform:none;visibility:visible}
  #feed-panel .f-top{display:flex;gap:8px;padding:18px 18px 10px;flex-wrap:wrap}
  #feed-panel input{flex:1;min-width:200px;background:#000;border:1px solid #1f2b1c;color:#e8e8e3;padding:10px 12px;border-radius:8px;font:14px 'Exo 2',sans-serif;outline:none}
  #feed-panel input:focus{border-color:var(--cat,#99FF00)}
  .f-btn{font:600 14px 'Exo 2',sans-serif;background:transparent;color:var(--cat,#99FF00);border:1px solid var(--cat,#99FF00);padding:9px 16px;border-radius:8px;cursor:pointer;transition:.2s}
  .f-btn:hover{background:var(--cat,#99FF00);color:#000}
  .f-tabs{display:flex;gap:6px;padding:0 18px 10px;align-items:center}
  .f-tab{background:none;border:1px solid #1f2b1c;color:#7f8a7a;padding:4px 12px;border-radius:99px;cursor:pointer;font:13px 'Exo 2'}
  .f-tab.on{color:#000;background:var(--cat,#99FF00);border-color:var(--cat,#99FF00)}
  .f-hint{margin-left:auto;color:#7f8a7a;font-size:12px}
  #feed-grid{flex:1;overflow:auto;padding:0 18px 40px;columns:2 300px;column-gap:14px}
  .f-card{break-inside:avoid;background:color-mix(in srgb,var(--cat,#99FF00) 7%,#0d1210);border:1px solid color-mix(in srgb,var(--cat,#99FF00) 30%,#0d1210);border-radius:12px;margin:0 0 14px;overflow:hidden;transition:border-color .4s,background .4s}
  .f-bar{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:6px 10px;font:16px 'VT323',monospace;color:var(--cat,#99FF00);border-bottom:1px solid color-mix(in srgb,var(--cat,#99FF00) 25%,#0d1210)}
  .f-bar em{font-style:normal;color:#7f8a7a;font-size:14px;margin-left:auto}
  .f-bar button{background:none;border:0;color:#7f8a7a;cursor:pointer}.f-bar button:hover{color:#FF3860}
  .f-body{padding:8px;display:flex;justify-content:center}
  .f-body img,.f-body video{max-width:100%;border-radius:8px;display:block}
  .f-body iframe{width:100%;border:0;border-radius:8px;aspect-ratio:16/9}
  .f-body iframe.tall{aspect-ratio:9/16;max-height:560px;width:auto;min-width:260px}
  .f-link{display:block;padding:14px;color:#e8e8e3;text-decoration:none;word-break:break-all}.f-link b{color:var(--cat,#99FF00)}
  .f-empty{color:#7f8a7a;text-align:center;padding:50px 10px;column-span:all}`;
  const st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);

  const root = document.createElement('div');
  root.innerHTML = `<button id="feed-handle" type="button" title="Feed da sala">◢ FEED <span id="feed-badge"></span></button>
  <section id="feed-panel" aria-label="Feed da sala">
    <div class="f-top"><input id="feed-url" placeholder="Cole um link: X, YouTube, Instagram, TikTok, imagem ou vídeo…" autocomplete="off">
      <button class="f-btn" id="feed-add" type="button">Postar</button><button class="f-btn" id="feed-hide" type="button">Fechar ✕</button></div>
    <div class="f-tabs"><button class="f-tab on" data-f="all">Tudo</button><button class="f-tab" data-f="video">Vídeos</button><button class="f-tab" data-f="img">Fotos/memes</button><span class="f-hint">O feed some quando a sala fecha</span></div>
    <div id="feed-grid"></div></section>`;
  while (root.firstChild) document.body.appendChild(root.firstChild);

  let api = null, items = new Map(), filtro = 'all', unseen = 0;
  const loaded = {};
  const loadScript = src => loaded[src] || (loaded[src] = new Promise((ok, err) => { const s = document.createElement('script'); s.src = src; s.async = true; s.onload = ok; s.onerror = err; document.head.appendChild(s); }));

  function parse(raw) {
    let u; try { u = new URL(String(raw).trim()); } catch (e) { return null; }
    if (u.protocol !== 'https:') return null;
    const h = u.hostname.replace(/^www\.|^m\./, ''), p = u.pathname; let m;
    if (/^(x|twitter)\.com$/.test(h) && (m = p.match(/status(?:es)?\/(\d+)/))) return { type: 'x', kind: 'video', id: m[1], label: 'X' };
    if (h === 'youtube.com' || h === 'youtu.be') {
      const id = h === 'youtu.be' ? p.slice(1).split('/')[0] : (u.searchParams.get('v') || (p.match(/\/(?:shorts|embed|live)\/([\w-]+)/) || [])[1]);
      if (id && /^[\w-]{5,20}$/.test(id)) return { type: 'yt', kind: 'video', id, short: /shorts/.test(p), label: 'YouTube' };
    }
    if (h === 'instagram.com' && /^\/(p|reel|tv)\/[\w-]+/.test(p)) return { type: 'ig', kind: 'video', label: 'Instagram', href: 'https://www.instagram.com' + p.match(/^\/(?:p|reel|tv)\/[\w-]+/)[0] + '/' };
    if (h === 'tiktok.com' && (m = p.match(/video\/(\d+)/))) return { type: 'tt', kind: 'video', id: m[1], label: 'TikTok' };
    if (/\.(jpe?g|png|gif|webp|avif)$/i.test(p)) return { type: 'img', kind: 'img', label: 'Imagem' };
    if (/\.(mp4|webm|mov|m4v)$/i.test(p)) return { type: 'vid', kind: 'video', label: 'Vídeo' };
    return { type: 'link', kind: 'img', label: h };
  }

  async function draw(row) {
    const it = parse(row.url) || { type: 'link', kind: 'img', label: 'Link' };
    const card = document.createElement('div');
    card.className = 'f-card'; card.dataset.id = row.id; card.dataset.kind = it.kind;
    const can = api && api.canRemove(row);
    card.innerHTML = `<div class="f-bar"><span>${esc(it.label)}</span><em>${esc(row.user_name || '')}</em>${can ? '<button title="Remover">✕</button>' : ''}</div><div class="f-body"></div>`;
    const b = card.querySelector('button'); if (b) b.onclick = () => api.remove(row.id).catch(() => {});
    const body = card.querySelector('.f-body');
    $('feed-grid').prepend(card); aplicar();
    const fb = () => { body.innerHTML = `<a class="f-link" target="_blank" rel="noopener noreferrer" href="${esc(row.url)}">Abrir <b>${esc(row.url)}</b></a>`; };
    try {
      if (it.type === 'x') { await loadScript('https://platform.twitter.com/widgets.js'); const el = await twttr.widgets.createTweet(it.id, body, { theme: 'dark', dnt: true, conversation: 'none' }); if (!el) fb(); }
      else if (it.type === 'yt') body.innerHTML = `<iframe class="${it.short ? 'tall' : ''}" src="https://www.youtube.com/embed/${it.id}" allow="encrypted-media;picture-in-picture;fullscreen" allowfullscreen loading="lazy"></iframe>`;
      else if (it.type === 'tt') body.innerHTML = `<iframe class="tall" src="https://www.tiktok.com/embed/v2/${it.id}" allowfullscreen loading="lazy"></iframe>`;
      else if (it.type === 'ig') { body.innerHTML = `<blockquote class="instagram-media" data-instgrm-permalink="${esc(it.href)}" style="width:100%;margin:0"></blockquote>`; await loadScript('https://www.instagram.com/embed.js'); window.instgrm && instgrm.Embeds.process(); }
      else if (it.type === 'img') { const im = new Image(); im.loading = 'lazy'; im.referrerPolicy = 'no-referrer'; im.src = row.url; im.onerror = fb; body.appendChild(im); }
      else if (it.type === 'vid') { body.innerHTML = `<video src="${esc(row.url)}" controls playsinline preload="metadata"></video>`; body.firstChild.onerror = fb; }
      else fb();
    } catch (e) { fb(); }
  }

  function aplicar() { document.querySelectorAll('.f-card').forEach(c => { c.style.display = (filtro === 'all' || c.dataset.kind === filtro) ? '' : 'none'; }); }
  function vazio() {
    const g = $('feed-grid');
    if (!items.size && !g.querySelector('.f-empty')) g.innerHTML = '<div class="f-empty">Nada por aqui ainda. Cole um link lá em cima.</div>';
    $('feed-badge').textContent = unseen || '';
  }
  function add(row, live) {
    if (!row || items.has(row.id)) return;
    items.set(row.id, row);
    const e = $('feed-grid').querySelector('.f-empty'); if (e) e.remove();
    draw(row);
    if (live && !document.body.classList.contains('feed-open') && !(api && row.user_id === api.uid())) {
      unseen++; const h = $('feed-handle'); h.classList.add('new'); setTimeout(() => h.classList.remove('new'), 2500);
    }
    vazio();
  }
  function del(id) { if (!items.delete(id)) return; const c = $('feed-grid').querySelector(`.f-card[data-id="${id}"]`); if (c) c.remove(); vazio(); }

  function open(v) { document.body.classList.toggle('feed-open', v); if (v) { unseen = 0; vazio(); } }
  $('feed-handle').onclick = () => open(!document.body.classList.contains('feed-open'));
  $('feed-hide').onclick = () => open(false);
  document.addEventListener('keydown', e => { if (e.key === 'Escape') open(false); });
  $('feed-add').onclick = async () => {
    const v = $('feed-url').value.trim(); if (!v || !api) return;
    if (!parse(v)) return alert('Cole um link https:// válido.');
    try { await api.add(v); $('feed-url').value = ''; }
    catch (e) {
      const m = String(e && e.message);
      alert(/duplicate|23505/.test(m) ? 'Esse link já está no feed.' : /slow_down/.test(m) ? 'Calma! Espere uns segundos para postar de novo.' : /feed_full/.test(m) ? 'O feed da sala está cheio (100 posts).' : 'Não consegui postar.');
    }
  };
  $('feed-url').addEventListener('keydown', e => { if (e.key === 'Enter') $('feed-add').click(); });
  document.querySelectorAll('.f-tab').forEach(b => b.onclick = () => { document.querySelectorAll('.f-tab').forEach(x => x.classList.remove('on')); b.classList.add('on'); filtro = b.dataset.f; aplicar(); });

  window.RimkFeed = {
    // entra na sala: api = { list(), add(url), remove(id), uid(), canRemove(row) }; sem api (P2P/local) o botão nem aparece
    async enter(a) {
      this.leave(); if (!a) return; api = a; $('feed-handle').classList.add('on'); vazio();
      try { (await api.list()).forEach(r => add(r, false)); } catch (e) { console.warn('Feed:', e.message); }
    },
    leave() { api = null; items = new Map(); unseen = 0; $('feed-grid').innerHTML = ''; $('feed-handle').classList.remove('on', 'new'); open(false); },
    push(ev) { if (!api || !ev) return; if (ev.k === 'add') add(ev.row, true); else if (ev.k === 'del') del(ev.id); }
  };
})();
