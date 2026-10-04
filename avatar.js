/* ============================================================
   RimkRadio: AVATARES EM CAMADAS
   - O avatar é só uma receita pequena: { b: 'rimk', bg: 'rei', i: ['cabelo-julian', 'chapeu-chef'] }
   - Ele é montado empilhando PNGs transparentes (fundo > alien > acessórios), todos 500x500.
   - A receita fica salva na conta (coluna profiles.avatar) e viaja na presença da sala.
   - Tudo que vem de fora (outras pessoas) passa por clean() antes de virar HTML.
   ============================================================ */
(function () {
    'use strict';
    const CATALOG = {"bases": [{"id": "rimk", "label": "Rimk"}, {"id": "sahrin", "label": "Sahrin"}, {"id": "vharn", "label": "Vharn"}, {"id": "thraak", "label": "Thraak"}, {"id": "ferrum", "label": "Ferrum"}, {"id": "nereids", "label": "Nereids"}], "cats": [{"id": "cabelo", "label": "Cabelo", "fa": "fa-scissors", "z": 50, "multi": false, "ctx": false, "items": [{"id": "julian", "label": "Julian", "bb": [37, 0, 460, 465]}, {"id": "moicano", "label": "Moicano", "bb": [200, 0, 325, 141]}, {"id": "azul", "label": "Azul", "bb": [48, 42, 450, 321]}, {"id": "feminino1", "label": "Longo preto", "bb": [35, 57, 396, 500]}, {"id": "feminino2", "label": "Vermelho", "bb": [13, 11, 423, 422]}]}, {"id": "chapeu", "label": "Chapéus", "fa": "fa-hat-cowboy", "z": 70, "multi": false, "ctx": false, "items": [{"id": "chef", "label": "Chef", "bb": [87, 16, 413, 195]}, {"id": "cowboy", "label": "Cowboy", "bb": [57, 2, 442, 216]}, {"id": "zezinho", "label": "Zezinho", "bb": [101, 50, 393, 246]}, {"id": "aluminio", "label": "Papel alumínio", "bb": [98, 5, 397, 232]}, {"id": "turbante", "label": "Turbante", "bb": [18, 20, 448, 448]}, {"id": "coroa", "label": "Coroa", "bb": [158, 16, 340, 139]}]}, {"id": "antena", "label": "Antenas", "fa": "fa-satellite-dish", "z": 80, "multi": false, "ctx": false, "items": [{"id": "verde", "label": "Verde", "bb": [164, 10, 333, 95]}, {"id": "azul", "label": "Azul", "bb": [164, 10, 333, 95]}, {"id": "amarela", "label": "Amarela", "bb": [164, 10, 333, 95]}, {"id": "vermelha", "label": "Vermelha", "bb": [164, 10, 333, 95]}, {"id": "branca", "label": "Branca", "bb": [164, 10, 333, 95]}, {"id": "roxa", "label": "Roxa", "bb": [164, 10, 333, 95]}]}, {"id": "olhos", "label": "Óculos e olhos", "fa": "fa-glasses", "z": 40, "multi": false, "ctx": true, "items": [{"id": "cilios", "label": "Cílios", "bb": [130, 143, 376, 233]}, {"id": "binoculo", "label": "Monóculo", "bb": [275, 224, 378, 500]}, {"id": "cool", "label": "Óculos cool", "bb": [124, 297, 377, 346]}, {"id": "scanner", "label": "Scanner", "bb": [271, 194, 431, 338]}, {"id": "tapaolho", "label": "Tapa-olho", "bb": [133, 139, 385, 347]}]}, {"id": "boca", "label": "Bocas", "fa": "fa-face-smile", "z": 20, "multi": false, "ctx": true, "items": [{"id": "slay", "label": "Slay", "bb": [188, 346, 300, 412]}, {"id": "dentuca", "label": "Dentuça", "bb": [189, 357, 298, 400]}, {"id": "linguinha", "label": "Linguinha", "bb": [200, 362, 292, 423]}, {"id": "sorrindo", "label": "Sorrindo", "bb": [200, 350, 300, 407]}]}, {"id": "bigode", "label": "Bigodes", "fa": "fa-grip-lines", "z": 25, "multi": false, "ctx": true, "items": [{"id": "rimk", "label": "Rimk", "bb": [141, 342, 353, 401]}, {"id": "sahrin", "label": "Sahrin", "bb": [125, 314, 368, 499]}, {"id": "ferrum", "label": "Ferrum", "bb": [148, 345, 348, 401]}, {"id": "nereids", "label": "Nereids", "bb": [123, 322, 373, 386]}]}, {"id": "roupa", "label": "Roupas", "fa": "fa-shirt", "z": 30, "multi": false, "ctx": false, "items": [{"id": "jaleco", "label": "Jaleco", "bb": [126, 429, 373, 500]}, {"id": "chef", "label": "Roupa de chef", "bb": [149, 420, 345, 500]}, {"id": "bandana", "label": "Bandana", "bb": [191, 429, 298, 500]}, {"id": "astronauta", "label": "Astronauta", "bb": [80, 89, 416, 500], "z": 90}, {"id": "rei", "label": "Traje de rei", "bb": [144, 400, 350, 500]}, {"id": "chocker", "label": "Choker", "bb": [208, 428, 288, 451]}]}, {"id": "marcas", "label": "Cicatrizes e marcas", "fa": "fa-skull", "z": 10, "multi": true, "ctx": true, "items": [{"id": "cicatriz1", "label": "Costura", "bb": [252, 171, 319, 262]}, {"id": "cicatriz2", "label": "Garras", "bb": [143, 314, 234, 388]}, {"id": "cicatriz3", "label": "Risco", "bb": [214, 181, 282, 241]}, {"id": "cicatriz4", "label": "Corte", "bb": [137, 225, 244, 336]}, {"id": "osso1", "label": "Rachadura 1", "bb": [113, 185, 246, 349]}, {"id": "osso2", "label": "Rachadura 2", "bb": [240, 105, 312, 250]}, {"id": "osso3", "label": "Rachadura 3", "bb": [214, 328, 367, 424]}]}, {"id": "fone", "label": "Fone", "fa": "fa-headphones", "z": 60, "multi": false, "ctx": false, "items": [{"id": "fone", "label": "Fone de ouvido", "bb": [10, 0, 490, 351]}]}], "bgs": [{"id": "rimkopolis", "label": "Rimkópolis"}, {"id": "ferrum", "label": "Ferrum"}, {"id": "kaal7", "label": "Kaal-7"}, {"id": "nereid", "label": "Nereids"}, {"id": "rei", "label": "Reino"}, {"id": "cowboy", "label": "Faroeste"}, {"id": "cozinha", "label": "Cozinha"}]};
    const DIR = 'avatar/';

    const baseIds = new Set(CATALOG.bases.map(b => b.id));
    const bgIds = new Set(CATALOG.bgs.map(b => b.id));
    const itemInfo = new Map();   // 'cabelo-julian' -> { cat, z, label }
    CATALOG.cats.forEach(c => c.items.forEach(it => itemInfo.set(c.id + '-' + it.id, { cat: c, z: it.z || c.z, label: it.label })));

    const esc = (s) => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

    // Valida e normaliza uma receita (nunca confie no que chega pela rede).
    function clean(av) {
        if (!av || typeof av !== 'object') return null;
        if (!baseIds.has(av.b)) return null;
        const out = { b: av.b, bg: bgIds.has(av.bg) ? av.bg : null, i: [] };
        const usedCats = new Set();
        (Array.isArray(av.i) ? av.i : []).forEach(f => {
            const inf = itemInfo.get(f);
            if (!inf || out.i.includes(f)) return;
            if (!inf.cat.multi && usedCats.has(inf.cat.id)) return;   // um item por categoria (marcas aceitam vários)
            usedCats.add(inf.cat.id); out.i.push(f);
        });
        out.i = out.i.slice(0, 12);
        return out;
    }

    // HTML do avatar: um quadrado/círculo que se adapta ao tamanho do elemento pai (use a classe cls para o formato).
    function html(av, cls) {
        const a = clean(av); if (!a) return '';
        const img = (src) => `<img src="${DIR}${src}" alt="" draggable="false" decoding="async">`;
        const layers = a.i.map(f => ({ f, z: itemInfo.get(f).z })).sort((x, y) => x.z - y.z);
        return `<span class="av ${cls || ''}" aria-hidden="true">${a.bg ? img('bg/' + a.bg + '.jpg') : ''}${img('base/' + a.b + '.png')}${layers.map(l => img('item/' + l.f + '.png')).join('')}</span>`;
    }

    /* ---------- cache de avatares por nome (presença da sala + conta) ---------- */
    const cache = new Map();      // nome em minúsculas -> receita (ou null = não tem avatar)
    const asked = new Set();      // nomes já consultados no servidor
    const key = (n) => String(n || '').trim().toLowerCase();
    const get = (name) => cache.get(key(name)) || null;
    function remember(name, av) { const k = key(name); if (k) { cache.set(k, clean(av)); asked.add(k); } }
    // Busca no servidor os avatares de quem ainda não conhecemos (ranking, chat de quem já saiu...).
    async function fetchMissing(rpc, names, done) {
        const need = [...new Set((names || []).map(key).filter(k => k && !asked.has(k) && !cache.has(k)))].slice(0, 50);
        if (!need.length || typeof rpc !== 'function') return;
        need.forEach(k => asked.add(k));
        try {
            const { data, error } = await rpc('avatars_for', { p_names: need });
            if (error) throw error;
            need.forEach(k => { if (!cache.has(k)) cache.set(k, null); });
            (data || []).forEach(r => cache.set(key(r.username), clean(r.avatar)));
            if (typeof done === 'function') done();
        } catch (e) {
            need.forEach(k => asked.delete(k));    // tenta de novo mais tarde
            console.warn('Avatares não carregados (rode supabase-avatar.sql):', e && e.message || e);
        }
    }

    /* ---------- editor: 1) cor do alien  2) acessórios  3) fundo ---------- */
    const STEPS = [['Cor', 'fa-palette'], ['Acessórios', 'fa-hat-cowboy'], ['Fundo', 'fa-image']];
    let root = null, st = null;

    function build() {
        root = document.createElement('div');
        root.id = 'avatar-modal'; root.className = 'av-backdrop'; root.setAttribute('aria-hidden', 'true');
        root.innerHTML = `
        <div class="panel av-card" role="dialog" aria-modal="true" aria-labelledby="av-title">
            <div class="av-head">
                <h3 id="av-title" class="font-display text-lg text-white"><i class="fa-solid fa-user-astronaut text-nblue mr-2"></i>Crie seu avatar</h3>
                <button type="button" class="icon-btn" data-act="close" aria-label="Fechar" style="width:2.2rem;height:2.2rem"><i class="fa-solid fa-xmark"></i></button>
            </div>
            <div class="av-body">
                <div class="av-side">
                    <div id="av-preview" class="av-preview"></div>
                    <button type="button" class="btn btn-blue px-4 py-2 text-xs" data-act="random"><i class="fa-solid fa-dice mr-1"></i>Sortear</button>
                </div>
                <div class="av-main">
                    <div id="av-steps" class="av-steps" role="tablist"></div>
                    <div id="av-panel" class="av-panel"></div>
                </div>
            </div>
            <div class="av-foot">
                <button type="button" class="btn btn-blue px-5 py-2.5 text-sm" data-act="back">Voltar</button>
                <span id="av-msg" class="av-msg" role="status"></span>
                <button type="button" class="btn btn-yellow px-5 py-2.5 text-sm" data-act="next">Continuar</button>
            </div>
        </div>`;
        document.body.appendChild(root);
        root.addEventListener('click', onClick);
        document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && root.classList.contains('open')) close(); });
    }

    function opt(act, id, icon, label, sel, extra) {
        return `<button type="button" class="av-opt${sel ? ' is-sel' : ''}" data-act="${act}" data-id="${esc(id)}" title="${esc(label)}" aria-pressed="${!!sel}">${icon}<span>${esc(label)}</span>${extra || ''}</button>`;
    }
    // Ícones recortados por CSS a partir das próprias imagens (sem arquivos de ícone separados)
    const ico = (bgImgs, size, pos) => `<span class="av-ico" style="background-image:${bgImgs};background-size:${size};background-position:${pos}"></span>`;
    function cropStyle(bb) {   // enquadra o item (com folga) dentro do quadradinho
        const w = bb[2] - bb[0], h = bb[3] - bb[1];
        const side = Math.min(500, Math.max(Math.max(w, h) * 1.25, 110));
        if (side >= 499) return ['100%', '0% 0%'];
        const left = (bb[0] + bb[2]) / 2 - side / 2, top = (bb[1] + bb[3]) / 2 - side / 2;
        return [(500 / side * 100).toFixed(2) + '%', (left / (500 - side) * 100).toFixed(2) + '% ' + (top / (500 - side) * 100).toFixed(2) + '%'];
    }
    const itemIcon = (cat, it) => {
        const [size, pos] = cropStyle(it.bb);
        const url = `url(${DIR}item/${cat.id}-${it.id}.png)`;
        return ico(cat.ctx ? `${url},url(${DIR}base/rimk.png)` : url, cat.ctx ? `${size},${size}` : size, cat.ctx ? `${pos},${pos}` : pos);
    };
    const baseIcon = (id) => ico(`url(${DIR}base/${id}.png)`, '131.58%', '50% 50%');
    const bgIcon = (id) => `<span class="av-ico av-ico-bg" style="background-image:url(${DIR}bg/${id}.jpg)"></span>`;
    const noneIcon = '<i class="fa-solid fa-ban av-none"></i>';

    function draw() {
        if (!root) return;
        const d = st.draft;
        root.querySelector('#av-preview').innerHTML = html(d, 'av-lg');
        root.querySelector('#av-steps').innerHTML = STEPS.map((s, k) =>
            `<button type="button" role="tab" class="av-step${k === st.step ? ' is-on' : ''}${k < st.step ? ' is-done' : ''}" data-act="step" data-id="${k}" aria-selected="${k === st.step}"><b>${k + 1}</b><i class="fa-solid ${s[1]}"></i><span>${s[0]}</span></button>`).join('');
        let p = '';
        if (st.step === 0) {
            p = `<p class="av-hint">Escolha a cor do seu alien.</p><div class="av-grid">${
                CATALOG.bases.map(b => opt('base', b.id, baseIcon(b.id), b.label, d.b === b.id)).join('')}</div>`;
        } else if (st.step === 1) {
            const cats = CATALOG.cats;
            p = `<div class="av-cats" role="tablist">${cats.map(c => {
                const n = d.i.filter(f => itemInfo.get(f).cat.id === c.id).length;
                return `<button type="button" role="tab" class="av-cat${c.id === st.cat ? ' is-on' : ''}" data-act="cat" data-id="${c.id}" aria-selected="${c.id === st.cat}" title="${esc(c.label)}"><i class="fa-solid ${c.fa}"></i><span>${esc(c.label)}</span>${n ? `<em>${n}</em>` : ''}</button>`;
            }).join('')}</div>`;
            const c = cats.find(x => x.id === st.cat) || cats[0];
            const none = !d.i.some(f => itemInfo.get(f).cat.id === c.id);
            p += `<div class="av-grid">${opt('none', c.id, noneIcon, 'Nenhum', none)}${
                c.items.map(it => { const f = c.id + '-' + it.id; return opt('item', f, itemIcon(c, it), it.label, d.i.includes(f)); }).join('')}</div>`
                + (c.multi ? '<p class="av-hint">Aqui dá para combinar vários.</p>' : '');
        } else {
            p = `<p class="av-hint">Por último, o plano de fundo.</p><div class="av-grid">${
                opt('bg', '', noneIcon, 'Sem fundo', !d.bg)}${
                CATALOG.bgs.map(b => opt('bg', b.id, bgIcon(b.id), b.label, d.bg === b.id)).join('')}</div>`;
        }
        root.querySelector('#av-panel').innerHTML = p;
        const back = root.querySelector('[data-act="back"]'), next = root.querySelector('[data-act="next"]');
        back.style.visibility = st.step === 0 ? 'hidden' : 'visible';
        back.disabled = next.disabled = !!st.busy;
        next.innerHTML = st.step < 2 ? 'Continuar <i class="fa-solid fa-arrow-right ml-1"></i>' : '<i class="fa-solid fa-floppy-disk mr-1"></i>Salvar avatar';
    }

    function setMsg(t) { const m = root && root.querySelector('#av-msg'); if (m) m.textContent = t || ''; }

    async function onClick(e) {
        if (e.target === root) return close();
        const b = e.target.closest('[data-act]'); if (!b || !st || st.busy) return;
        const act = b.dataset.act, id = b.dataset.id, d = st.draft;
        if (act === 'close') return close();
        if (act === 'step') st.step = +id;
        else if (act === 'back') st.step = Math.max(0, st.step - 1);
        else if (act === 'next') {
            if (st.step < 2) st.step++;
            else {
                st.busy = true; setMsg('Salvando…'); draw();
                let ok = false;
                try { ok = await st.onSave(clean(d)); } catch (err) { console.error(err); }
                st.busy = false;
                if (ok) return close();
                setMsg('Não consegui salvar.'); return draw();
            }
        }
        else if (act === 'base') d.b = id;
        else if (act === 'bg') d.bg = id || null;
        else if (act === 'cat') st.cat = id;
        else if (act === 'none') d.i = d.i.filter(f => itemInfo.get(f).cat.id !== id);
        else if (act === 'item') {
            const c = itemInfo.get(id).cat;
            if (d.i.includes(id)) d.i = d.i.filter(f => f !== id);
            else d.i = [...(c.multi ? d.i : d.i.filter(f => itemInfo.get(f).cat.id !== c.id)), id];
        }
        else if (act === 'random') {
            const pick = (a) => a[Math.floor(Math.random() * a.length)];
            d.b = pick(CATALOG.bases).id;
            d.bg = Math.random() < .8 ? pick(CATALOG.bgs).id : null;
            d.i = [];
            CATALOG.cats.forEach(c => { if (Math.random() < (c.multi ? .25 : .4)) d.i.push(c.id + '-' + pick(c.items).id); });
            d.i = d.i.filter(f => f !== 'roupa-astronauta' || Math.random() < .15);   // o capacete esconde tudo: raro
        }
        setMsg(''); draw();
    }

    function open(opts) {
        if (!root) build();
        const cur = clean(opts && opts.current);
        st = { draft: cur || { b: 'rimk', bg: null, i: [] }, step: 0, cat: CATALOG.cats[0].id, busy: false, onSave: (opts && opts.onSave) || (async () => true) };
        setMsg(''); draw();
        root.classList.add('open'); root.setAttribute('aria-hidden', 'false');
        const f = root.querySelector('.av-opt'); if (f) f.focus();
    }
    function close() { if (!root) return; root.classList.remove('open'); root.setAttribute('aria-hidden', 'true'); st = null; }

    window.RimkAvatar = { clean, html, get, remember, fetchMissing, open, close };
})();
