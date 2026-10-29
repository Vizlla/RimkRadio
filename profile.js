/* ============================================================
   RimkRadio: CARD DE PERFIL
   - Abre ao clicar na fotinha (avatar) de alguém na sala, no chat ou no ranking.
   - Mostra avatar, nome, @usuario, bio e quantos likes a pessoa já recebeu nos vídeos.
   - Os dados vêm do servidor (função profile_card, arquivo supabase-perfil.sql).
   - Todo texto que vem de fora passa por esc() antes de virar HTML.
   ============================================================ */
(function () {
    'use strict';
    const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const fmt = (n) => Number(n || 0).toLocaleString('pt-BR');
    const safeColor = (c) => (/^#[0-9a-fA-F]{6}$/.test(String(c || '')) ? c : '#99FF00');

    let root = null, st = null, lastFocus = null;

    function build() {
        root = document.createElement('div');
        root.id = 'profile-modal'; root.className = 'av-backdrop pf-backdrop'; root.setAttribute('aria-hidden', 'true');
        root.innerHTML = `
        <div class="panel pf-card" role="dialog" aria-modal="true" aria-labelledby="pf-title">
            <button type="button" class="icon-btn pf-close" data-pf="close" aria-label="Fechar" style="width:2.2rem;height:2.2rem"><i class="fa-solid fa-xmark"></i></button>
            <div id="pf-body"></div>
        </div>`;
        document.body.appendChild(root);
        root.addEventListener('click', (e) => {
            if (e.target === root) return close();
            const b = e.target.closest('[data-pf]'); if (!b || !st) return;
            if (b.dataset.pf === 'close') return close();
            if (b.dataset.pf === 'edit') { const fn = st.onEdit; close(); if (typeof fn === 'function') fn(); }
        });
        document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && root.classList.contains('open')) close(); });
    }

    function paint() {
        if (!root || !st) return;
        const s = st, col = safeColor(s.color);
        const ini = esc((String(s.name).trim()[0] || '?').toUpperCase());
        const avatar = (s.av && window.RimkAvatar) ? window.RimkAvatar.html(s.av) : '';
        const shown = s.card && s.card.name ? s.card.name : s.name;       // nome de exibição, ou o @usuario se ainda não tem
        const likes = s.state === 'ok' ? fmt(s.card ? s.card.likes : 0) : (s.state === 'loading' ? '…' : '—');
        const bio = s.card && s.card.bio ? s.card.bio : '';
        const empty = s.isMe ? 'Você ainda não escreveu uma bio. Toque em “Editar perfil” para contar algo sobre você.' : 'Esta pessoa ainda não escreveu uma bio.';
        const badge = s.role ? `<span class="pf-badge"><i class="fa-solid fa-crown" aria-hidden="true"></i>${esc(s.role)}</span>` : '';
        const note = s.state === 'error' ? '<p class="pf-note">Não consegui carregar o perfil agora. O arquivo supabase-perfil.sql já foi rodado no Supabase?</p>' : '';
        root.querySelector('#pf-body').innerHTML = `
            <div class="pf-top">
                <div class="pf-avatar${avatar ? ' has-av' : ''}" style="color:${col};border-color:${col};box-shadow:0 0 22px ${col}55">${avatar || ini}</div>
                <h3 id="pf-title" class="pf-name" title="${esc(shown)}">${esc(shown)}</h3>
                <div class="pf-user" style="color:${col}">@${esc(s.name)}${s.online ? '<span class="pf-dot" title="Na sala agora"></span>' : ''}</div>
                ${badge}
            </div>
            <p class="pf-bio${bio ? '' : ' is-empty'}">${bio ? esc(bio) : esc(empty)}</p>
            <div class="pf-likes" title="Likes que as músicas pedidas por ${esc(s.name)} já receberam">
                <i class="fa-solid fa-thumbs-up" aria-hidden="true"></i>
                <span class="pf-likes-n" id="pf-likes-n">${likes}</span>
                <span class="pf-likes-l">${s.state === 'ok' && s.card && s.card.likes === 1 ? 'like recebido' : 'likes recebidos'}</span>
            </div>
            ${note}
            ${s.isMe ? '<button type="button" class="btn btn-yellow px-5 py-2.5 text-sm pf-edit" data-pf="edit"><i class="fa-solid fa-pen mr-1"></i>Editar perfil</button>' : ''}`;
    }

    // opts: { name, color, av, role, online, isMe, mine:{name,bio}, load(name)->{name,bio,likes}|null, onEdit() }
    function open(opts) {
        if (!opts || !String(opts.name || '').trim()) return;
        if (!root) build();
        lastFocus = document.activeElement;
        const token = {};
        st = {
            token, name: String(opts.name).trim(), color: opts.color, av: opts.av || null, role: opts.role || '', online: !!opts.online,
            isMe: !!opts.isMe, onEdit: opts.onEdit,
            // do próprio usuário já sabemos nome e bio: aparecem na hora, só os likes esperam o servidor
            card: opts.mine ? { name: opts.mine.name || '', bio: opts.mine.bio || '', likes: 0 } : null,
            state: 'loading'
        };
        paint();
        root.classList.add('open'); root.setAttribute('aria-hidden', 'false');
        const f = root.querySelector('.pf-close'); if (f) f.focus({ preventScroll: true });
        Promise.resolve().then(() => (typeof opts.load === 'function' ? opts.load(st.name) : null)).then((row) => {
            if (!st || st.token !== token) return;                   // fechou ou abriu outro card enquanto buscava
            st.card = row ? { name: row.name || '', bio: row.bio || '', likes: row.likes | 0 } : { name: '', bio: '', likes: 0 };
            st.state = 'ok'; paint();
        }).catch((e) => {
            if (!st || st.token !== token) return;
            console.warn('Perfil não carregado (rode supabase-perfil.sql):', e && e.message || e);
            st.state = 'error'; paint();
        });
    }

    function close() {
        if (!root) return;
        root.classList.remove('open'); root.setAttribute('aria-hidden', 'true'); st = null;
        try { if (lastFocus && lastFocus.focus && document.contains(lastFocus)) lastFocus.focus({ preventScroll: true }); } catch (e) {}
        lastFocus = null;
    }

    window.RimkProfile = { open, close };
})();
