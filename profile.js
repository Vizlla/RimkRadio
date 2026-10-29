/* ============================================================
   RimkRadio: CARD DE PERFIL (balãozinho preso na fotinha)
   - Passe o mouse na fotinha de alguém (ou toque nela, no celular) e o card abre EM CIMA dela;
     sem espaço em cima, abre embaixo. Clicar/tocar "fixa" o card; clicar fora, Esc ou sair com o mouse fecha.
   - Mostra avatar, nome, @usuario, bio e quantos likes a pessoa já recebeu nos vídeos.
   - Os dados vêm do servidor (função profile_card, arquivo supabase-perfil.sql).
   - Todo texto que vem de fora passa por esc() antes de virar HTML.
   ============================================================ */
(function () {
    'use strict';
    const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const fmt = (n) => Number(n || 0).toLocaleString('pt-BR');
    const safeColor = (c) => (/^#[0-9a-fA-F]{6}$/.test(String(c || '')) ? c : '#99FF00');
    const GAP = 10, EDGE = 8, CACHE_MS = 15000, CLOSE_MS = 220;

    let root = null, st = null, closeT = null, watch = null;
    const cache = new Map();                       // nome em minúsculas -> { t, row }

    function build() {
        root = document.createElement('div');
        root.id = 'profile-pop'; root.className = 'pf-pop'; root.setAttribute('role', 'dialog'); root.setAttribute('aria-hidden', 'true');
        root.innerHTML = '<div class="pf-pop-in"><div id="pf-body"></div></div><span class="pf-arrow" aria-hidden="true"></span>';
        document.body.appendChild(root);
        root.addEventListener('mouseenter', () => clearTimeout(closeT));
        root.addEventListener('mouseleave', () => { if (st && !st.pinned) scheduleClose(); });
        root.addEventListener('click', (e) => {
            const b = e.target.closest('[data-pf]'); if (!b || !st) return;
            if (b.dataset.pf === 'edit') { const fn = st.onEdit; close(); if (typeof fn === 'function') fn(); }
        });
        document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && st) close(); });
        document.addEventListener('pointerdown', (e) => {                       // clicar/tocar fora fecha
            if (!st || root.contains(e.target)) return;
            if (e.target.closest && e.target.closest('[data-profile]')) return;  // o clique na fotinha é tratado por quem chamou
            close();
        }, true);
        window.addEventListener('resize', () => { if (st) place(); });
        window.addEventListener('scroll', () => { if (st) place(); }, true);
    }

    // acha a fotinha de novo se a lista foi redesenhada (a lista de pessoas se refaz a cada mudança)
    function anchorEl() {
        if (!st) return null;
        if (st.anchor && st.anchor.isConnected) return st.anchor;
        if (!st.key) return null;
        const all = document.querySelectorAll('[data-profile]');
        for (const el of all) if (String(el.dataset.profile).trim().toLowerCase() === st.key && el.offsetParent !== null) { st.anchor = el; return el; }
        return null;
    }

    // posiciona em cima da fotinha (ou embaixo se faltar espaço) e aponta a setinha para o centro dela
    function place() {
        if (!root || !st) return;
        const a = anchorEl();
        if (!a) return close();
        const r = a.getBoundingClientRect();
        if (r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth) return close();   // a fotinha saiu da tela
        const w = root.offsetWidth, h = root.offsetHeight;
        let left = r.left + r.width / 2 - w / 2;
        left = Math.max(EDGE, Math.min(left, innerWidth - w - EDGE));
        const above = r.top - h - GAP >= EDGE || r.bottom + h + GAP > innerHeight - EDGE;
        let top = above ? r.top - h - GAP : r.bottom + GAP;
        top = Math.max(EDGE, Math.min(top, innerHeight - h - EDGE));
        root.style.left = Math.round(left) + 'px'; root.style.top = Math.round(top) + 'px';
        root.classList.toggle('is-below', !above);
        const ax = Math.max(18, Math.min(w - 18, r.left + r.width / 2 - left));
        root.style.setProperty('--ax', Math.round(ax) + 'px');
    }

    function paint() {
        if (!root || !st) return;
        const s = st, col = safeColor(s.color);
        const ini = esc((String(s.name).trim()[0] || '?').toUpperCase());
        const avatar = (s.av && window.RimkAvatar) ? window.RimkAvatar.html(s.av) : '';
        const shown = s.card && s.card.name ? s.card.name : s.name;       // nome de exibição, ou o @usuario se ainda não tem
        const likes = s.state === 'ok' ? fmt(s.card ? s.card.likes : 0) : (s.state === 'loading' ? '…' : '—');
        const bio = s.card && s.card.bio ? s.card.bio : '';
        const empty = s.isMe ? 'Você ainda não escreveu uma bio.' : 'Sem bio ainda.';
        const badge = s.role ? `<span class="pf-badge"><i class="fa-solid fa-crown" aria-hidden="true"></i>${esc(s.role)}</span>` : '';
        const note = s.state === 'error' ? '<p class="pf-note">Não consegui carregar o perfil agora. O arquivo supabase-perfil.sql já foi rodado no Supabase?</p>' : '';
        root.style.setProperty('--pf-col', col);
        root.setAttribute('aria-label', 'Perfil de ' + s.name);
        root.querySelector('#pf-body').innerHTML = `
            <div class="pf-head">
                <div class="pf-avatar${avatar ? ' has-av' : ''}" style="color:${col};border-color:${col};box-shadow:0 0 16px ${col}55">${avatar || ini}</div>
                <div class="pf-id">
                    <h3 class="pf-name" title="${esc(shown)}">${esc(shown)}</h3>
                    <div class="pf-user" style="color:${col}"><span class="pf-at">@${esc(s.name)}</span>${s.online ? '<span class="pf-dot" title="Na sala agora"></span>' : ''}</div>
                    ${badge}
                </div>
            </div>
            <p class="pf-bio${bio ? '' : ' is-empty'}">${bio ? esc(bio) : esc(empty)}</p>
            <div class="pf-likes" title="Likes que as músicas pedidas por ${esc(s.name)} já receberam">
                <i class="fa-solid fa-thumbs-up" aria-hidden="true"></i>
                <span class="pf-likes-n">${likes}</span>
                <span class="pf-likes-l">${s.state === 'ok' && s.card && s.card.likes === 1 ? 'like recebido' : 'likes recebidos'}</span>
            </div>
            ${note}
            ${s.isMe ? '<button type="button" class="btn btn-yellow px-4 py-2 text-xs pf-edit" data-pf="edit"><i class="fa-solid fa-pen mr-1"></i>Editar perfil</button>' : ''}`;
        place();
    }

    function scheduleClose() { clearTimeout(closeT); closeT = setTimeout(() => { if (st && !st.pinned) close(); }, CLOSE_MS); }

    // opts: { anchor, name, color, av, role, online, isMe, pinned, mine:{name,bio}, load(name)->{name,bio,likes}|null, onEdit() }
    function open(opts) {
        if (!opts || !String(opts.name || '').trim()) return;
        if (!root) build();
        clearTimeout(closeT);
        const key = String(opts.name).trim().toLowerCase();
        if (st && st.key === key && st.anchor === opts.anchor) { if (opts.pinned) st.pinned = true; return; }   // já está aberto nessa fotinha
        const token = {};
        const hit = cache.get(key);
        const fresh = !!(hit && Date.now() - hit.t < CACHE_MS);
        st = {
            token, key, anchor: opts.anchor || null, pinned: !!opts.pinned,
            name: String(opts.name).trim(), color: opts.color, av: opts.av || null, role: opts.role || '', online: !!opts.online,
            isMe: !!opts.isMe, onEdit: opts.onEdit,
            // do próprio usuário já sabemos nome e bio; de quem já foi aberto há pouco, tudo — só os likes esperam o servidor
            card: hit ? hit.row : (opts.mine ? { name: opts.mine.name || '', bio: opts.mine.bio || '', likes: 0 } : null),
            state: fresh ? 'ok' : 'loading'
        };
        root.classList.remove('open'); root.style.visibility = 'hidden';
        paint();
        root.setAttribute('aria-hidden', 'false'); root.style.visibility = ''; root.classList.add('open');
        clearInterval(watch); watch = setInterval(() => { if (st) place(); }, 400);
        if (fresh) return;
        Promise.resolve().then(() => (typeof opts.load === 'function' ? opts.load(st.name) : null)).then((row) => {
            const card = row ? { name: row.name || '', bio: row.bio || '', likes: row.likes | 0 } : { name: '', bio: '', likes: 0 };
            cache.set(key, { t: Date.now(), row: card });
            if (!st || st.token !== token) return;                   // fechou ou abriu outro card enquanto buscava
            st.card = card; st.state = 'ok'; paint();
        }).catch((e) => {
            if (!st || st.token !== token) return;
            console.warn('Perfil não carregado (rode supabase-perfil.sql):', e && e.message || e);
            st.state = 'error'; paint();
        });
    }

    function leave() { if (st && !st.pinned) scheduleClose(); }
    function forget() { cache.clear(); }
    function isOpenFor(name) { return !!st && st.key === String(name || '').trim().toLowerCase(); }
    function close() {
        clearTimeout(closeT); clearInterval(watch); watch = null;
        if (!root) return;
        root.classList.remove('open'); root.setAttribute('aria-hidden', 'true'); st = null;
    }

    window.RimkProfile = { open, close, leave, forget, isOpenFor };
})();
