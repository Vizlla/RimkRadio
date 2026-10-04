(function () {
    'use strict';

    /* ============================================================
       CONFIGURAÇÃO
       - Sem configurar nada: modo ONLINE P2P (funciona entre
         dispositivos diferentes; o criador da sala é o anfitrião e
         precisa manter a aba aberta).
       - Opcional: cole abaixo a config do seu Firebase (Firestore +
         Auth anônimo) para salas permanentes, sem anfitrião.
       ============================================================ */
    // Se usar Firebase: a config abaixo é pública por natureza, então a proteção de verdade
    // está nas "Regras de Segurança" do Firestore. Nunca deixe as regras em modo teste (allow read, write: if true).
    const FIREBASE_CONFIG = null;
    const SUPABASE_CONFIG = null;   // opcional: { url: "...", anonKey: "..." } (senão vem de /supabase-config.json, gerado no build)
    /* Exemplo:
    const FIREBASE_CONFIG = {
        apiKey: "...", authDomain: "...", projectId: "...",
        storageBucket: "...", messagingSenderId: "...", appId: "..."
    };
    */

    /* ============================================================
       BUSCA DE MÚSICAS POR NOME
       - Recomendado: cole sua chave da YouTube Data API v3 (gratuita
         no Google Cloud Console; ~100 buscas/dia no plano grátis).
       - Sem chave: tenta instâncias públicas do Piped/Invidious ao
         mesmo tempo e usa a primeira que responder. São serviços de
         terceiros e podem sair do ar; se todas falharem, o app avisa
         e você ainda pode colar o link do vídeo.
       ============================================================ */
    // ATENÇÃO: tudo que fica neste arquivo é público (qualquer pessoa vê pelo "ver código-fonte").
    // Se colocar uma chave aqui, restrinja ela por domínio (HTTP referrer) no Google Cloud
    // e limite a chave só à YouTube Data API v3. Nunca coloque senhas ou chaves secretas.
    // Prefira configurar no Render: variável de ambiente YOUTUBE_API_KEY (o build gera /youtube-config.json).
    // Se preferir, pode colar a chave direto aqui entre aspas — o que estiver aqui tem prioridade.
    let YOUTUBE_API_KEY = null;
    fetch('/youtube-config.json', { cache: 'no-store' })
        .then(r => r.ok ? r.json() : null)
        .then(j => { if (!YOUTUBE_API_KEY && j && /^AIza[\w-]{30,}$/.test(String(j.key || ''))) YOUTUBE_API_KEY = j.key; })
        .catch(() => {});
    const SEARCH_INSTANCES = [
        { type: 'piped',     url: 'https://api.piped.private.coffee' },
        { type: 'piped',     url: 'https://pipedapi.kavin.rocks' },
        { type: 'invidious', url: 'https://inv.nadeko.net' },
        { type: 'invidious', url: 'https://yewtu.be' },
    ];

    const appId = (typeof __app_id !== 'undefined') ? __app_id : 'symphonysync-vaporwave';

    let injectedConfig = null;
    try { injectedConfig = JSON.parse(__firebase_config); } catch (e) {}
    const firebaseConfig = FIREBASE_CONFIG || (injectedConfig && injectedConfig.projectId ? injectedConfig : null);

    /* ---------- Utilidades ---------- */
    const $ = (id) => document.getElementById(id);
    const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));

    let notifTimer = null;
    window.showNotification = function (text, type = 'info') {
        const modal = $('notification-modal');
        $('notification-text').innerText = text;
        $('notification-icon').className =
            type === 'success' ? 'fa-solid fa-circle-check text-nblue' :
            type === 'error'   ? 'fa-solid fa-triangle-exclamation text-nyellow' :
                                 'fa-solid fa-info-circle text-nblue';
        modal.classList.remove('translate-y-20', 'opacity-0', 'pointer-events-none');
        clearTimeout(notifTimer);
        notifTimer = setTimeout(() => modal.classList.add('translate-y-20', 'opacity-0', 'pointer-events-none'), 3500);
    };


    /* ============================================================
       SONS (sintetizados com Web Audio: nenhum arquivo de áudio)
       - entrada na sala: "chamado alienígena" futurista
       - mensagem no chat: blip suave
       ============================================================ */
    const sfx = (() => {
        const KEY = 'syncwave:sound';
        let ctx = null, master = null, echo = null, lastChat = 0, lastJoin = 0;
        let on = true;
        try { on = localStorage.getItem(KEY) !== 'off'; } catch (e) {}

        function init() {
            if (ctx) return ctx;
            const AC = window.AudioContext || window.webkitAudioContext;
            if (!AC) return null;
            try {
                ctx = new AC();
                const comp = ctx.createDynamicsCompressor();
                master = ctx.createGain(); master.gain.value = 0.6;
                master.connect(comp); comp.connect(ctx.destination);
                // eco curto: dá o clima "espacial"
                const dl = ctx.createDelay(0.5); dl.delayTime.value = 0.17;
                const fb = ctx.createGain(); fb.gain.value = 0.32;
                const wet = ctx.createGain(); wet.gain.value = 0.45;
                dl.connect(fb); fb.connect(dl); dl.connect(wet); wet.connect(master);
                echo = dl;
            } catch (e) { ctx = null; }
            return ctx;
        }
        // navegadores só liberam áudio depois de um clique/tecla
        const unlock = () => { const c = init(); if (c && c.state === 'suspended') c.resume().catch(() => {}); };
        ['pointerdown', 'keydown', 'touchstart'].forEach(ev => window.addEventListener(ev, unlock, { passive: true }));

        const ready = () => { if (!on) return null; const c = init(); if (!c) return null; if (c.state === 'suspended') c.resume().catch(() => {}); return c.state === 'running' ? c : null; };
        // oscilador com envelope: sobe rápido, decai suave
        function tone(c, { type = 'sine', f0, f1, t, dur, peak, attack = 0.01, wet = 0, dest }) {
            const o = c.createOscillator(), g = c.createGain();
            o.type = type;
            o.frequency.setValueAtTime(f0, t);
            if (f1 && f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t + dur);
            g.gain.setValueAtTime(0.0001, t);
            g.gain.exponentialRampToValueAtTime(peak, t + attack);
            g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
            o.connect(g); g.connect(dest || master);
            if (wet && echo) { const w = c.createGain(); w.gain.value = wet; g.connect(w); w.connect(echo); }
            o.start(t); o.stop(t + dur + 0.05);
            return o;
        }

        // alguém entrou: sobe e desce com vibrato (voz alienígena) + brilhos no final
        function join() {
            const c = ready(); if (!c) return;
            const now = Date.now(); if (now - lastJoin < 600) return; lastJoin = now;
            const t = c.currentTime + 0.02;

            // corpo: senoide com varredura de frequência e vibrato que acelera (FM)
            const o = tone(c, { type: 'sine', f0: 240, t, dur: 0.95, peak: 0.2, attack: 0.06, wet: 0.5 });
            o.frequency.setValueAtTime(240, t);
            o.frequency.exponentialRampToValueAtTime(980, t + 0.36);
            o.frequency.exponentialRampToValueAtTime(420, t + 0.9);
            const lfo = c.createOscillator(), lg = c.createGain();
            lfo.frequency.setValueAtTime(8, t); lfo.frequency.linearRampToValueAtTime(26, t + 0.9);
            lg.gain.value = 55; lfo.connect(lg); lg.connect(o.frequency);
            lfo.start(t); lfo.stop(t + 1);

            // "voz" metálica: serra filtrada por banda que varre o espectro
            const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 7;
            bp.frequency.setValueAtTime(500, t);
            bp.frequency.exponentialRampToValueAtTime(2600, t + 0.4);
            bp.frequency.exponentialRampToValueAtTime(900, t + 0.9);
            bp.connect(master);
            tone(c, { type: 'sawtooth', f0: 120, f1: 210, t, dur: 0.9, peak: 0.07, attack: 0.08, dest: bp });

            // brilhos finais (arpejo agudo)
            [1568, 2093, 2794].forEach((f, i) => {
                tone(c, { type: 'triangle', f0: f, f1: f * 1.02, t: t + 0.5 + i * 0.075, dur: 0.22, peak: 0.055, attack: 0.008, wet: 0.6 });
            });
        }

        // mensagem nova: dois "pings" curtos e macios (discreto)
        function chat() {
            const c = ready(); if (!c) return;
            const now = Date.now(); if (now - lastChat < 300) return; lastChat = now;
            const t = c.currentTime + 0.01;
            const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 3200; lp.connect(master);
            tone(c, { type: 'sine', f0: 740, f1: 780, t, dur: 0.11, peak: 0.07, attack: 0.008, dest: lp });
            tone(c, { type: 'sine', f0: 1110, f1: 1180, t: t + 0.07, dur: 0.16, peak: 0.06, attack: 0.008, wet: 0.35, dest: lp });
            tone(c, { type: 'triangle', f0: 2220, t: t + 0.07, dur: 0.1, peak: 0.012, attack: 0.005, dest: lp });
        }

        // like (Rimk): três notas curtas subindo, bem baixinhas (aprovação futurista e discreta)
        let lastReact = 0;
        function like() {
            const c = ready(); if (!c) return;
            const now = Date.now(); if (now - lastReact < 250) return; lastReact = now;
            const t = c.currentTime + 0.01;
            const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 3600; lp.connect(master);
            tone(c, { type: 'sine', f0: 520, f1: 660, t, dur: 0.16, peak: 0.05, attack: 0.01, dest: lp });
            tone(c, { type: 'sine', f0: 784, f1: 880, t: t + 0.09, dur: 0.2, peak: 0.05, attack: 0.01, wet: 0.5, dest: lp });
            tone(c, { type: 'triangle', f0: 1568, f1: 1760, t: t + 0.17, dur: 0.26, peak: 0.03, attack: 0.008, wet: 0.7, dest: lp });
        }
        // deslike (Zunk): duas notas graves caindo, "wuomp" de desaprovação (também baixinho)
        function dislike() {
            const c = ready(); if (!c) return;
            const now = Date.now(); if (now - lastReact < 250) return; lastReact = now;
            const t = c.currentTime + 0.01;
            const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.setValueAtTime(1400, t); lp.frequency.exponentialRampToValueAtTime(300, t + 0.45); lp.connect(master);
            tone(c, { type: 'sawtooth', f0: 330, f1: 196, t, dur: 0.2, peak: 0.045, attack: 0.01, dest: lp });
            tone(c, { type: 'sawtooth', f0: 233, f1: 110, t: t + 0.14, dur: 0.34, peak: 0.05, attack: 0.012, wet: 0.25, dest: lp });
            tone(c, { type: 'sine', f0: 110, f1: 70, t: t + 0.14, dur: 0.34, peak: 0.05, attack: 0.012, dest: master });
        }

        return {
            join, chat, like, dislike,
            isOn: () => on,
            set(v) { on = !!v; try { localStorage.setItem(KEY, on ? 'on' : 'off'); } catch (e) {} if (on) unlock(); }
        };
    })();

    function updateSoundBtn() {
        const b = $('sound-btn'); if (!b) return;
        const on = sfx.isOn();
        b.innerHTML = '<i class="fa-solid ' + (on ? 'fa-volume-high' : 'fa-volume-xmark') + '"></i>';
        b.setAttribute('aria-pressed', String(on));
        b.title = on ? 'Sons ligados (clique para silenciar)' : 'Sons desligados (clique para ligar)';
        b.setAttribute('aria-label', b.title);
        b.classList.toggle('text-nyellow', !on);
    }
    window.toggleSound = function () {
        sfx.set(!sfx.isOn()); updateSoundBtn();
        if (sfx.isOn()) sfx.chat();
        showNotification(sfx.isOn() ? 'Sons ligados.' : 'Sons desligados.', 'info');
    };
    window.addEventListener('DOMContentLoaded', updateSoundBtn);
    updateSoundBtn();

    /* ============================================================
       CAMADA DE DADOS  (local  ou  firebase)
       ============================================================ */
    let myAvatar = null;   // receita do avatar da conta logada (veja avatar.js)
    const store = { mode: 'local', getOffset: () => 0, isHost: () => false, isCohost: () => false, isAdmin: () => false, setCohost: () => false, kick: () => false, leave: () => {},
        transferHost: () => false, memberCount: () => 0, hasPass: () => false, getUsers: () => [], onRole: null,
        setColor: () => {}, setAvatar: () => {} };
    // modos com anfitrião de verdade (travar controles, expulsar, passar anfitrião, senha de sala)
    const hostMode = () => store.mode === 'p2p' || store.mode === 'supabase';

    /* ---------- Regras de negócio (reducers puros: estado + args -> patch) ---------- */
    const VIDEO_RE = /^[A-Za-z0-9_-]{11}$/;
    const clip = (v, n) => String(v ?? '').slice(0, n);
    // Lives não têm uma "posição" fixa para sincronizar (o ao vivo anda sozinho), então nunca damos seek nelas.
    // liveIds = lives que descobrimos só ao tocar (quando o link não avisou que era live).
    const liveIds = new Set();
    const isLiveSong = (sg) => !!sg && (sg.live === true || liveIds.has(sg.videoId));

    // Cores neon: cada pessoa da sala ganha uma (o anfitrião sorteia sem repetir enquanto der)
    const NEON = ['#FF2BD6', '#00F0FF', '#39FF14', '#FFE234', '#FF6B1A', '#B026FF',
                  '#FF3860', '#00FFA3', '#3D8BFF', '#F5FF00', '#FF71CE', '#01CDFE',
                  '#FF073A', '#C6FF00', '#7B61FF', '#FFB000', '#00FF66', '#E100FF'];
    const NEON_NAMES = {
        '#FF2BD6': 'Magenta', '#00F0FF': 'Ciano', '#39FF14': 'Verde neon', '#FFE234': 'Amarelo', '#FF6B1A': 'Laranja',
        '#B026FF': 'Roxo', '#FF3860': 'Rosa choque', '#00FFA3': 'Menta', '#3D8BFF': 'Azul', '#F5FF00': 'Limão',
        '#FF71CE': 'Rosa', '#01CDFE': 'Azul céu', '#FF073A': 'Vermelho', '#C6FF00': 'Verde-limão', '#7B61FF': 'Índigo',
        '#FFB000': 'Âmbar', '#00FF66': 'Verde primavera', '#E100FF': 'Violeta'
    };
    const safeColor = (c) => (typeof c === 'string' && NEON.includes(c.toUpperCase())) ? c.toUpperCase() : null;
    const nameColor = (name) => { let h = 0; for (const ch of String(name || '')) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return NEON[h % NEON.length]; };
    /* ---------- Categorias de sala (ícone + cor) ---------- */
    const CATEGORIES = [
        { key: 'musica',   label: 'Música',   icon: 'fa-music',            color: '#99FF00' },
        { key: 'podcast',  label: 'Podcast',  icon: 'fa-microphone-lines', color: '#FFD60A' },
        { key: 'video',    label: 'Vídeos',   icon: 'fa-video',            color: '#00E5FF' },
        { key: 'jogos',    label: 'Jogos',    icon: 'fa-gamepad',          color: '#B070FF' },
        { key: 'filmes',   label: 'Filmes',   icon: 'fa-clapperboard',     color: '#FF4D5E' },
        { key: 'aulas',    label: 'Aulas',    icon: 'fa-graduation-cap',   color: '#FF8A1F' },
        { key: 'noticias', label: 'Notícias', icon: 'fa-newspaper',        color: '#4D8DFF' },
        { key: 'esportes', label: 'Esportes', icon: 'fa-futbol',           color: '#1DE9A0' },
        { key: 'humor',    label: 'Humor',    icon: 'fa-face-laugh-beam',  color: '#FF2BD6' }
    ];
    const CAT_BY_KEY = Object.fromEntries(CATEGORIES.map(c => [c.key, c]));
    const catOf = (k) => CAT_BY_KEY[k] || CAT_BY_KEY.musica;

    const ops = {
        playback(room, a) {
            const p = { playbackUpdated: Date.now() };
            if (typeof a.isPlaying === 'boolean') p.isPlaying = a.isPlaying;
            if (Number.isFinite(a.currentTime)) p.currentTime = Math.max(0, a.currentTime);
            return p;
        },
        lock(room, a) {
            return { locked: !!a.value };
        },
        jump(room, a) {
            const list = room.playlist || [];
            if (!Number.isInteger(a.idx) || a.idx < 0 || a.idx >= list.length) return null;
            return { currentIndex: a.idx, isPlaying: true, currentTime: 0, playbackUpdated: Date.now() };
        },
        skip(room, a) {
            const list = room.playlist || [];
            if (!list.length || (a.dir !== 1 && a.dir !== -1)) return null;
            const cur = room.currentIndex || 0;
            // fromIndex evita "pular duas vezes" quando vários clientes recebem o fim da música
            if (a.fromIndex !== undefined && a.fromIndex !== null && cur !== a.fromIndex) return null;
            // "auto" = a música acabou sozinha (ninguém apertou "próxima")
            if (a.auto === true) {
                if (!room.isPlaying) return null;   // já parou: ignora o aviso repetido dos outros aparelhos
                // acabou a última faixa: PARA (não volta para a primeira)
                if (cur >= list.length - 1) return { isPlaying: false, currentTime: 0, playbackUpdated: Date.now() };
            }
            const next = (cur + a.dir + list.length) % list.length;
            return { currentIndex: next, isPlaying: true, currentTime: 0, playbackUpdated: Date.now() };
        },
        add(room, a) {
            const sg = a.song || {};
            if ((room.playlist || []).length >= 200) return null;   // limite da playlist
            if (!VIDEO_RE.test(String(sg.videoId))) return null;
            const song = { id: clip(sg.id, 20), videoId: sg.videoId, title: clip(sg.title, 200), requester: clip(sg.requester, 30),
                           ...(sg.live === true ? { live: true } : {}) };
            const playlist = [...(room.playlist || []), song];
            if (playlist.length === 1) return { playlist, currentIndex: 0, isPlaying: false, currentTime: 0, playbackUpdated: Date.now() };
            return { playlist };
        },
        // várias faixas de uma vez (playlist inteira do YouTube); respeita o limite de 200 da sala
        addMany(room, a) {
            const cur = room.playlist || [];
            const space = 200 - cur.length;
            if (space <= 0 || !Array.isArray(a.songs)) return null;
            const seen = new Set(), songs = [];
            for (const sg of a.songs.slice(0, 300)) {
                if (songs.length >= space) break;
                if (!sg || !VIDEO_RE.test(String(sg.videoId)) || seen.has(sg.videoId)) continue;
                seen.add(sg.videoId);
                songs.push({ id: clip(sg.id, 20), videoId: sg.videoId, title: clip(sg.title, 200), requester: clip(sg.requester, 30),
                             ...(sg.live === true ? { live: true } : {}) });
            }
            if (!songs.length) return null;
            const playlist = [...cur, ...songs];
            if (!cur.length) return { playlist, currentIndex: 0, isPlaying: false, currentTime: 0, playbackUpdated: Date.now() };
            return { playlist };
        },
        move(room, a) {
            const list = [...(room.playlist || [])], n = list.length;
            if (!Number.isInteger(a.from) || !Number.isInteger(a.to)) return null;
            if (a.from < 0 || a.to < 0 || a.from >= n || a.to >= n || a.from === a.to) return null;
            const [song] = list.splice(a.from, 1);
            list.splice(a.to, 0, song);
            // o índice da faixa atual acompanha a música (ela segue tocando, sem reiniciar)
            let cur = room.currentIndex || 0;
            if (cur === a.from) cur = a.to;
            else if (a.from < cur && a.to >= cur) cur -= 1;
            else if (a.from > cur && a.to <= cur) cur += 1;
            return { playlist: list, currentIndex: cur };
        },
        remove(room, a) {
            const playlist = [...(room.playlist || [])];
            if (!Number.isInteger(a.idx) || a.idx < 0 || a.idx >= playlist.length) return null;
            let currentIndex = room.currentIndex || 0;
            playlist.splice(a.idx, 1);
            if (!playlist.length) return { playlist, currentIndex: 0, isPlaying: false, currentTime: 0, playbackUpdated: Date.now() };
            if (a.idx < currentIndex) return { playlist, currentIndex: currentIndex - 1 };
            if (a.idx === currentIndex) {
                if (currentIndex >= playlist.length) currentIndex = 0;
                return { playlist, currentIndex, currentTime: 0, playbackUpdated: Date.now() };
            }
            return { playlist };
        },
        // Limpar fila: apaga as músicas que já tocaram (antes da atual) e mantém a atual e as próximas
        clearQueue(room) {
            const list = room.playlist || [];
            const cur = room.currentIndex || 0;
            if (cur <= 0 || cur >= list.length) return null;
            // a atual passa a ser a primeira da lista; ela segue tocando, sem reiniciar
            return { playlist: list.slice(cur), currentIndex: 0 };
        }
    };

    // Texto do aviso no chat quando alguém mexe no player ("quem pausou", "quem passou a música"...)
    // prev/next = estado da sala antes/depois; who = nick de quem fez (o anfitrião é quem sabe, nunca o convidado)
    function describeAction(prev, next, op, a, who, opts = {}) {
        const cur = (next.playlist || [])[next.currentIndex || 0];
        const nm = (sg) => sg ? `“${clip(sg.title || sg.videoId, 70)}”` : 'a música';
        if (op === 'playback') {
            if (typeof a.isPlaying !== 'boolean' || a.isPlaying === !!prev.isPlaying || !(prev.playlist || []).length) return null;
            return a.isPlaying ? `${who} deu play` : `${who} pausou a música`;
        }
        if (op === 'skip') {
            if (a.auto === true) return (opts.host && prev.isPlaying && !next.isPlaying) ? 'A playlist terminou.' : null;
            if (!cur) return null;
            return a.dir === 1 ? `${who} passou para a próxima música: ${nm(cur)}` : `${who} voltou para a música anterior: ${nm(cur)}`;
        }
        if (op === 'jump') return cur ? `${who} escolheu ${nm(cur)}` : null;
        if (op === 'move') {
            const song = (next.playlist || [])[a.to];
            return song ? `${who} moveu ${nm(song)} para a posição ${a.to + 1}` : null;
        }
        if (op === 'remove') {
            const gone = (prev.playlist || [])[a.idx];
            return gone ? `${who} removeu ${nm(gone)} da playlist` : null;
        }
        if (op === 'clearQueue') return `${who} limpou a playlist`;
        if (op === 'addMany') {
            const n = (next.playlist || []).length - (prev.playlist || []).length;
            if (n <= 0) return null;
            const t = clip(noCtl(a.listTitle), 60).trim();
            return `${who} adicionou ${n} ${n === 1 ? 'música' : 'músicas'}${t ? ` da playlist “${t}”` : ''}`;
        }
        return null;
    }

    // mensagem de chat vinda da rede: nunca confiamos, limpamos tudo
    const cleanId = (v) => clip(v, 24).replace(/[^A-Za-z0-9_-]/g, '');
    function cleanMsg(m) {
        if (!m || typeof m !== 'object') return null;
        const text = clip(m.text, 500);
        if (!text) return null;
        const out = { id: cleanId(m.id), user: clip(m.user, 30), text, time: Number.isFinite(m.time) ? m.time : 0,
                      color: safeColor(m.color), system: m.system === true };
        if (!out.system && m.replyTo && typeof m.replyTo === 'object') {
            out.replyTo = { id: cleanId(m.replyTo.id), user: clip(m.replyTo.user, 30), text: clip(m.replyTo.text, 120) };
        }
        return out;
    }

    /* ---------- Segurança: helpers ---------- */
    // só aceita nomes de operação que existem de verdade (evita "__proto__", "constructor" etc.)
    const getOp = (name) => (typeof name === 'string' && Object.prototype.hasOwnProperty.call(ops, name)) ? ops[name] : null;
    // o que um convidado (não-anfitrião) pode pedir; "lock" é exclusivo do anfitrião
    const GUEST_OPS = new Set(['playback', 'jump', 'skip', 'add', 'addMany', 'remove', 'move']);
    // operações bloqueadas para convidados quando o anfitrião trava os controles
    const CONTROL_OPS = new Set(['playback', 'jump', 'skip', 'remove', 'move']);
    // limitador simples: no máximo "max" eventos a cada "windowMs"
    const makeLimiter = (max, windowMs) => {
        let hits = [];
        return () => {
            const now = Date.now();
            hits = hits.filter(t => now - t < windowMs);
            if (hits.length >= max) return false;
            hits.push(now);
            return true;
        };
    };
    // nunca confiamos no estado da sala recebido pela rede: valida tudo antes de usar
    function sanitizeRoom(d) {
        d = (d && typeof d === 'object') ? d : {};
        const playlist = (Array.isArray(d.playlist) ? d.playlist : []).slice(0, 500)
            .filter(x => x && VIDEO_RE.test(String(x.videoId)))
            .map(x => ({ id: clip(x.id, 20), videoId: String(x.videoId), title: clip(x.title, 200), requester: clip(x.requester, 30),
                      ...(x.live === true ? { live: true } : {}) }));
        const num = (v) => Number.isFinite(v) ? v : 0;
        let idx = Number.isInteger(d.currentIndex) ? d.currentIndex : 0;
        if (idx < 0 || idx >= playlist.length) idx = 0;
        return {
            playlist, currentIndex: idx, isPlaying: d.isPlaying === true,
            currentTime: Math.max(0, num(d.currentTime)), playbackUpdated: num(d.playbackUpdated),
            lastUpdated: num(d.lastUpdated), locked: d.locked === true,
            name: clip(noCtl(d.name), 40).trim(),
            category: Object.prototype.hasOwnProperty.call(CAT_BY_KEY, d.category) ? d.category : 'musica'
        };
    }
    // código da sala: 8 caracteres aleatórios criptográficos (sem letras/números confusos)
    const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';   // 32 símbolos → sem viés no sorteio
    function newRoomCode(len = 8) {
        const buf = new Uint32Array(len);
        crypto.getRandomValues(buf);
        return Array.from(buf, x => CODE_ALPHABET[x % CODE_ALPHABET.length]).join('');
    }

    /* ============================================================
       LISTA DE SALAS (diretório)
       Cada modo tem o seu, todos com a mesma interface:
         dir.subscribe(cb)  -> cb(lista | null)   (retorna função p/ cancelar)
         dir.publish(info)  -> anuncia a sala que EU criei (null = retira)
       - P2P: um dos navegadores abertos vira o "lobby" e guarda a lista;
         se ele fechar a aba, outro assume e os anfitriões se re-registram.
       - Firebase: uma coleção no Firestore.
       - Local: localStorage (só entre abas deste navegador).
       A senha da sala NUNCA vai para a lista: só o aviso "tem senha".
       ============================================================ */
    /*@dir-start*/
    const ROOM_ID_RE = new RegExp('^[' + CODE_ALPHABET + ']{8}$');
    const DIR_TTL = 60000;        // sala some da lista se ficar 60s sem sinal de vida
    const DIR_BEAT = 20000;       // o anfitrião renova o sinal a cada 20s
    const noCtl = (s) => String(s ?? '').replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ');
    // nunca confiamos no que chega pela rede: valida e limpa cada item
    function cleanRoomInfo(x) {
        if (!x || typeof x !== 'object') return null;
        const id = String(x.id ?? '');
        if (!ROOM_ID_RE.test(id)) return null;
        const n = Number.isInteger(x.count) ? x.count : 1;
        return {
            id,
            name: clip(noCtl(x.name), 40).trim() || 'Sala sem nome',
            host: clip(noCtl(x.host), 30).trim(),
            count: Math.min(99, Math.max(1, n)),
            pass: x.pass === true,
            cat: Object.prototype.hasOwnProperty.call(CAT_BY_KEY, x.cat) ? x.cat : 'musica'
        };
    }
    const sortRooms = (a) => a.sort((p, q) => q.count - p.count || p.name.localeCompare(q.name));

    /* ============================================================
       SUPABASE
       - Salas e playlist: tabela "rooms" (Realtime avisa cada mudança)
       - Chat: tabela "messages" (Realtime)
       - Quem está na sala: Realtime Presence
       - Contas: Supabase Auth (e-mail + senha, nome de usuário no perfil)
       ============================================================ */
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    async function loadSupabaseConfig() {
        if (SUPABASE_CONFIG && SUPABASE_CONFIG.url && SUPABASE_CONFIG.anonKey) return SUPABASE_CONFIG;
        // Render (site estático): o build gera supabase-config.json a partir das variáveis de ambiente.
        // Fallback /api/supabase-config mantém compatibilidade com hospedagens que têm função serverless.
        let r = await fetch('/supabase-config.json', { headers: { accept: 'application/json' }, cache: 'no-store' }).catch(() => null);
        if (!r || !r.ok) r = await fetch('/api/supabase-config', { headers: { accept: 'application/json' } });
        if (!r.ok) throw new Error('Supabase não configurado');
        const c = await r.json();
        if (!c || !c.url || !c.anonKey) throw new Error('Supabase não configurado');
        return c;
    }

    async function initSupabaseStore() {
        // espera a biblioteca supabase-js (até 5s)
        for (let i = 0; i < 50 && !(window.supabase && window.supabase.createClient); i++) await sleep(100);
        if (!(window.supabase && window.supabase.createClient)) throw new Error('supabase-js não carregou');
        const cfg = await loadSupabaseConfig();
        const sb = window.supabase.createClient(cfg.url, cfg.anonKey, { auth: { persistSession: true, autoRefreshToken: true } });
        store.sb = sb;
        store.mode = 'supabase';

        // sessão do Supabase Auth: o banco só aceita quem está logado (auth.uid())
        store.uid = null;
        try {
            const { data } = await sb.auth.getSession();
            store.uid = (data && data.session && data.session.user) ? data.session.user.id : null;
        } catch (e) { console.error(e); }
        sb.auth.onAuthStateChange((event, session) => {
            store.uid = (session && session.user) ? session.user.id : null;
            if (event === 'SIGNED_OUT' && currentUser) setTimeout(() => resetToLogin(true), 0);
        });

        // relógio do servidor: todo mundo calcula "onde a música está" com a mesma hora
        let clockOffset = 0;
        const syncClock = async () => {
            const t0 = Date.now();
            const { data, error } = await sb.rpc('server_time');
            const t1 = Date.now();
            if (!error && Number.isFinite(Number(data))) clockOffset = Number(data) - (t0 + t1) / 2;
        };
        syncClock().catch(() => {});
        setInterval(() => { syncClock().catch(() => {}); }, 5 * 60 * 1000);
        store.getOffset = () => clockOffset;
        const serverNow = () => Date.now() + clockOffset;

        const myUid = () => store.uid || null;
        store.myId = myUid;

        /* ---------- Lista de salas ---------- */
        store.dir = {
            subscribe(cb) {
                let stopped = false;
                const load = async () => {
                    const [res, cats] = await Promise.all([
                        sb.rpc('list_rooms'),
                        sb.rpc('room_categories').then(r => r, () => ({ data: null }))   // sem o SQL novo, todas viram "Música"
                    ]);
                    if (stopped || res.error) return;
                    const catMap = new Map(((cats && cats.data) || []).map(x => [x.rid, x.cat]));
                    cb(sortRooms((res.data || []).map(x => cleanRoomInfo({ ...x, cat: catMap.get(x.id) })).filter(Boolean)));
                };
                load();
                const t = setInterval(load, 5000);
                return () => { stopped = true; clearInterval(t); };
            },
            publish() {},   // a lista vem do banco (list_rooms); nada para publicar daqui
            refresh() {}
        };

        /* ---------- Sala atual ---------- */
        let roomId = null, channel = null, row = null, beatTimer = null;
        let users = [], hostAwaySince = 0, cohostAwaySince = 0;
        const roomCbs = new Set(), chatCbs = new Set(), presenceCbs = new Set();
        let chat = [];
        const toRoom = (r) => ({ ...(r.state || {}), name: r.name, locked: r.locked === true, category: r.category });
        const emitRoom = () => { if (row) { const d = toRoom(row); roomCbs.forEach(cb => cb(d)); } };
        const emitChat = () => chatCbs.forEach(cb => cb(chat));
        const emitPresence = () => { const list = users.map(u => ({ ...u, host: !!row && u.id === row.host_id, cohost: !!row && !!row.cohost_id && u.id === row.cohost_id })); presenceCbs.forEach(cb => cb(list)); };
        const roleEvent = (ev) => { try { if (typeof store.onRole === 'function') store.onRole(ev); } catch (e) { console.error(e); } };

        function setRow(next) {
            if (!next || next.id !== roomId) return;
            // O Realtime NÃO manda colunas grandes que não mudaram naquela atualização (ex.: o batimento da sala
            // mexe só em outras colunas). Com playlist grande, o "state" some do evento — e a playlist parecia vazia.
            if (next.state == null) {
                if (row && row.state) next = { ...next, state: row.state };
                else { fetchRow(next.id).then(r => { if (r && r.state) setRow(r); }).catch(() => {}); return; }
            }
            if (row && Number(next.version) < Number(row.version)) return;   // chegou atrasado: já temos um estado mais novo
            const wasHost = store.isHost(), wasCohost = store.isCohost();
            const hostChanged = !row || row.host_id !== next.host_id || (row.cohost_id || null) !== (next.cohost_id || null);
            row = next;
            emitRoom();
            if (hostChanged) {
                emitPresence();
                if (wasHost !== store.isHost()) roleEvent({ type: 'role', host: store.isHost() });
                else if (wasCohost !== store.isCohost()) roleEvent({ type: 'cohost', cohost: store.isCohost() });
            }
        }
        const fetchRow = async (id) => {
            const { data, error } = await sb.from('rooms').select('*').eq('id', id).maybeSingle();
            if (error) throw error;
            return data;
        };

        const memberCountNow = () => Math.max(1, users.length);
        async function heartbeat() {
            if (!roomId || !row) return;
            const hostHere = users.some(u => u.id === row.host_id);
            if (store.isHost() || !hostHere) await sb.rpc('room_heartbeat', { p_room: roomId, p_count: memberCountNow() }).then(() => {}, () => {});
            // o anfitrião sumiu faz mais de 1 minuto: a primeira pessoa da lista assume a sala
            if (!hostHere && !store.isHost()) {
                if (!hostAwaySince) hostAwaySince = Date.now();
                // o sub-host (se estiver na sala) tem prioridade; senão, a primeira pessoa da lista
                const cohostHere = !!row.cohost_id && users.some(u => u.id === row.cohost_id);
                const first = cohostHere ? row.cohost_id : users.map(u => u.id).sort()[0];
                if (Date.now() - hostAwaySince > 65000 && first === myUid()) {
                    const patch = { host_id: myUid() };
                    if (row.cohost_id) patch.cohost_id = null;
                    const { data } = await sb.from('rooms').update(patch).eq('id', roomId).select('*').maybeSingle();
                    if (data) setRow(data);
                }
            } else hostAwaySince = 0;
            // o sub-host saiu da sala: o anfitrião tira o cargo dele depois de 30s (dá tempo de reconectar)
            if (store.isHost() && row.cohost_id && !users.some(u => u.id === row.cohost_id)) {
                if (!cohostAwaySince) cohostAwaySince = Date.now();
                if (Date.now() - cohostAwaySince > 30000) {
                    cohostAwaySince = 0;
                    const { data } = await sb.from('rooms').update({ cohost_id: null }).eq('id', roomId).select('*').maybeSingle();
                    if (data) setRow(data);
                }
            } else cohostAwaySince = 0;
        }

        function openChannel(id) {
            if (channel && roomId === id) return;
            closeChannel();
            roomId = id; row = null; chat = []; users = []; hostAwaySince = 0; cohostAwaySince = 0;
            const ch = sb.channel(`room:${id}`, { config: { presence: { key: myUid() || Math.random().toString(36).slice(2) } } });
            ch.on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'rooms', filter: `id=eq.${id}` }, (p) => setRow(p.new));
            // DELETE não aceita filtro no Realtime: escuta tudo e confere o id (a chave primária vem em p.old)
            ch.on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'rooms' }, (p) => {
                if (roomId !== id || !p.old || p.old.id !== id) return;
                showNotification('A sala foi encerrada.', 'error'); leaveRoomUI();
            });
            ch.on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `room_id=eq.${id}` }, (p) => {
                const r = p.new || {}, b = (r.body && typeof r.body === 'object') ? r.body : {};
                // "time" = quando chegou aqui (o relógio de quem mandou pode estar errado)
                const m = cleanMsg({ ...b, id: b.id || String(r.id), user: b.system === true ? '' : r.user_name, time: Date.now() });
                if (m) { chat = [...chat, m].slice(-200); emitChat(); }
            });
            ch.on('presence', { event: 'sync' }, () => {
                const st = ch.presenceState();
                users = Object.entries(st).map(([uid, metas]) => {
                    const m = (metas && metas[0]) || {};
                    return { id: uid, name: clip(noCtl(m.name), 30) || 'Convidado', color: safeColor(m.color), av: window.RimkAvatar ? RimkAvatar.clean(m.av) : null };
                });
                emitPresence();
            });
            ch.on('broadcast', { event: 'kick' }, async ({ payload }) => {
                if (!payload || payload.id !== myUid() || roomId !== id) return;
                // confere no banco (qualquer um poderia mandar esse aviso)
                const { error } = await sb.rpc('join_room', { p_id: id, p_pass: null });
                if (error && /kicked/.test(error.message || '')) { showNotification('Você foi expulso da sala pelo anfitrião.', 'error'); leaveRoomUI(); }
            });
            ch.on('broadcast', { event: 'react' }, ({ payload }) => {
                if (roomId !== id || !payload || (payload.k !== 'up' && payload.k !== 'down')) return;
                try { if (typeof store.onReaction === 'function') store.onReaction({ k: payload.k, by: clip(noCtl(payload.by), 30) }); } catch (e) { console.error(e); }
            });
            channel = ch;
            // assina no próximo ciclo, depois que a interface registrou todos os ouvintes
            setTimeout(() => {
                if (channel !== ch) return;
                ch.subscribe(async (status) => {
                    if (status !== 'SUBSCRIBED' || channel !== ch) return;
                    track();
                    // pega o estado atual (pode ter mudado entre o join e a assinatura)
                    try { setRow(await fetchRow(id)); } catch (e) { console.error(e); }
                });
            }, 0);
            fetchRow(id).then(setRow).catch(e => console.error(e));
            beatTimer = setInterval(() => { heartbeat().catch(() => {}); }, 20000);
            setTimeout(() => { heartbeat().catch(() => {}); }, 2500);
        }
        function track() {
            if (channel) channel.track({ name: clip(clientUsername, 30), color: myColor, av: myAvatar || null }).catch(() => {});
        }
        function closeChannel() {
            clearInterval(beatTimer); beatTimer = null;
            const ch = channel; channel = null;
            if (ch) { try { ch.untrack(); } catch (e) {} sb.removeChannel(ch).catch(() => {}); }
            roomId = null; row = null; chat = []; users = [];
        }

        store.isHost = () => !!row && !!myUid() && row.host_id === myUid();
        store.isCohost = () => !!row && !!myUid() && !!row.cohost_id && row.cohost_id === myUid() && row.host_id !== myUid();
        store.isAdmin = () => store.isHost() || store.isCohost();   // anfitrião ou sub-host: mesmos poderes
        store.memberCount = () => Math.max(0, users.length - 1);
        store.getUsers = () => users.map(u => ({ ...u, host: !!row && u.id === row.host_id, cohost: !!row && !!row.cohost_id && u.id === row.cohost_id }));
        store.hasPass = () => false;

        store.createRoom = async (id, data, pass, opts) => {
            const { error } = await sb.rpc('create_room', { p_id: id, p_name: data.name, p_state: data, p_pass: pass || null });
            if (error) {
                if (error.code === '23505') throw Object.assign(new Error('id em uso'), { type: 'unavailable-id' });
                throw error;
            }
            // categoria escolhida pelo anfitrião (se o SQL novo ainda não foi rodado, só fica "Música")
            if (opts && opts.category && opts.category !== 'musica') {
                sb.rpc('set_room_category', { p_room: id, p_category: opts.category })
                    .then(r => { if (r.error) console.warn('Categoria não salva (rode supabase-likes-categorias.sql):', r.error.message); }, () => {});
            }
        };

        /* ---------- Categoria, likes e ranking ---------- */
        store.setCategory = async (key) => {
            if (!roomId) return false;
            const { error } = await sb.rpc('set_room_category', { p_room: roomId, p_category: key });
            if (error) { console.error(error); return false; }
            fetchRow(roomId).then(setRow).catch(() => {});
            return true;
        };
        const voteRow = (data) => { const r = Array.isArray(data) ? data[0] : data; return r ? { up: r.n_likes | 0, down: r.n_dislikes | 0, mine: r.my_vote | 0 } : null; };
        store.vote = async (rid, key, val) => {
            const { data, error } = await sb.rpc('vote_song', { p_room: rid, p_song: key, p_value: val });
            if (error) throw error;
            return voteRow(data);
        };
        store.voteCounts = async (rid, key) => {
            const { data, error } = await sb.rpc('song_votes_for', { p_room: rid, p_song: key });
            return error ? null : voteRow(data);
        };
        store.sendReaction = (kind) => {
            if (!channel) return;
            try { channel.send({ type: 'broadcast', event: 'react', payload: { k: kind === 'down' ? 'down' : 'up', by: clip(clientUsername, 30) } }).catch?.(() => {}); } catch (e) {}
        };
        store.getRoom = async (id, pass) => {
            const { data, error } = await sb.rpc('join_room', { p_id: id, p_pass: pass || null });
            if (error) {
                const reason = (String(error.message || '').match(/password|kicked/) || [])[0];
                if (reason) throw Object.assign(new Error('denied'), { type: 'denied', reason });
                throw error;
            }
            return data || null;
        };

        // aplica a regra (ops) sobre o estado mais recente; se alguém mudou junto, tenta de novo
        store.updateRoom = async (id, op, args) => {
            const fn = getOp(op);
            if (!fn) return;
            if (op === 'clearQueue' && !store.isHost()) return;   // só o anfitrião limpa a playlist
            try {
                if (op === 'lock') {
                    const { data, error } = await sb.from('rooms').update({ locked: !!(args && args.value) }).eq('id', id).select('*').maybeSingle();
                    if (error) throw error;
                    if (data) setRow(data);
                    return;
                }
                let cur = (row && row.id === id) ? row : await fetchRow(id);
                for (let i = 0; i < 6 && cur; i++) {
                    const state = { ...(cur.state || {}), locked: cur.locked === true };
                    const patch = fn(state, args || {});
                    if (!patch) return;
                    delete patch.locked;
                    const next = { ...(cur.state || {}), ...patch, lastUpdated: serverNow() };
                    if ('playbackUpdated' in patch) next.playbackUpdated = serverNow();
                    const { data, error } = await sb.from('rooms').update({ state: next, version: Number(cur.version) + 1 })
                        .eq('id', id).eq('version', cur.version).select('*');
                    if (error) throw error;
                    if (data && data.length) { setRow(data[0]); return; }
                    await sleep(60 + Math.random() * 120);
                    cur = await fetchRow(id);
                }
            } catch (e) {
                if (/locked|only_host/.test(String(e && e.message))) showNotification('Os anfitriões travaram os controles do player.', 'error');
                else console.error(e);
            }
        };
        store.subscribeRoom = (id, cb) => {
            openChannel(id);
            roomCbs.add(cb);
            if (row) setTimeout(() => cb(toRoom(row)), 0);
            return () => roomCbs.delete(cb);
        };
        store.addChat = async (id, msg) => {
            const body = { id: cleanId(msg.id), text: clip(msg.text, 500), color: safeColor(msg.color), system: msg.system === true };
            if (msg.replyTo) body.replyTo = { id: cleanId(msg.replyTo.id), user: clip(msg.replyTo.user, 30), text: clip(msg.replyTo.text, 120) };
            const { error } = await sb.from('messages').insert({ room_id: id, body });
            if (error) throw error;
        };
        store.subscribeChat = (id, cb) => {
            openChannel(id);
            chatCbs.add(cb);
            setTimeout(() => cb(chat), 0);
            return () => chatCbs.delete(cb);
        };
        store.joinPresence = (id) => {
            openChannel(id);
            store.setColor = () => track();
            store.setAvatar = () => track();
            return () => { store.setColor = () => {}; store.setAvatar = () => {}; };
        };
        store.subscribePresence = (id, cb) => {
            presenceCbs.add(cb);
            setTimeout(() => { if (users.length) cb(store.getUsers()); }, 0);
            return () => presenceCbs.delete(cb);
        };

        store.kick = (uid) => {
            if (!store.isAdmin() || !roomId) return false;
            const id = roomId, name = (users.find(u => u.id === uid) || {}).name || 'Alguém';
            sb.rpc('kick_member', { p_room: id, p_user: uid }).then(({ error }) => {
                if (error) return showNotification('Não consegui expulsar essa pessoa.', 'error');
                if (channel) channel.send({ type: 'broadcast', event: 'kick', payload: { id: uid } });
                store.addChat(id, { id: Math.random().toString(16).slice(2, 12), system: true, text: `${name} foi expulso da sala por ${clientUsername}.` }).catch(() => {});
            });
            return true;
        };
        store.transferHost = (uid) => {
            if (!store.isHost() || !roomId) return false;
            sb.from('rooms').update({ host_id: uid }).eq('id', roomId).select('*').maybeSingle().then(({ data, error }) => {
                if (error) return showNotification('Não consegui passar o anfitrião.', 'error');
                if (data) setRow(data);
            });
            return true;
        };
        // anfitrião dá (ou tira, com uid = null) os poderes de anfitrião para outra pessoa da sala
        store.setCohost = (uid) => {
            if (!store.isHost() || !roomId) return false;
            sb.from('rooms').update({ cohost_id: uid || null }).eq('id', roomId).select('*').maybeSingle().then(({ data, error }) => {
                if (error) return showNotification('Não consegui alterar o sub-host. O banco já tem a coluna cohost_id? (veja o arquivo supabase-cohost.sql)', 'error');
                if (data) setRow(data);
            });
            return true;
        };
        // anfitrião saindo com gente na sala: o sub-host assume; sem sub-host, passa para alguém aleatório
        store.leave = () => {
            if (store.isHost() && roomId) {
                const others = users.filter(u => u.id !== myUid());
                if (others.length) {
                    const sub = row && row.cohost_id ? others.find(u => u.id === row.cohost_id) : null;
                    const pick = sub || others[Math.floor(Math.random() * others.length)];
                    const patch = { host_id: pick.id };
                    if (row && row.cohost_id) patch.cohost_id = null;   // só mexe na coluna se ela existir
                    sb.from('rooms').update(patch).eq('id', roomId).then(() => {}, () => {});
                }
            }
            closeChannel();
        };
        window.addEventListener('pagehide', () => { if (roomId) store.leave(); });
    }

    const storeReady = (async () => {
        try { await initSupabaseStore(); }
        catch (err) {
            console.error('Erro ao conectar no Supabase:', err);
            store.mode = 'offline';
            setTimeout(() => showNotification('Não consegui conectar ao servidor. Verifique a configuração do Supabase.', 'error'), 300);
        }
    })();

    /* ============================================================
       ESTADO DA SALA
       ============================================================ */
    let currentRoomId = null;
    let currentRoomName = '';        // nome da sala em que estou
    let myListing = null;            // dados da sala que EU criei (é o que vai para a lista de salas)
    let currentUser = null;          // conta logada (o nome dela é o nickname nas salas)
    let clientUsername = 'Guest';
    let joinedAt = 0;                // hora em que entrei na sala (usado para não mostrar histórico)
    let replyingTo = null;           // mensagem que estou respondendo
    let chatView = [];               // mensagens exibidas agora
    const COLOR_KEY = 'syncwave:color';
    let myColor = (() => { try { return safeColor(localStorage.getItem(COLOR_KEY)); } catch (e) { return null; } })()
        || NEON[Math.floor(Math.random() * NEON.length)];
    const userColors = new Map();   // nickname -> cor neon (atualizado pela lista de pessoas)
    let unsubRoom = null, unsubChat = null, unsubPresence = null, leavePresence = null, knownUsers = null;

    let ytPlayer = null;
    let playerReady = false;
    let suppressUntil = 0;          // ignora eventos do player causados por nós mesmos
    let pendingData = null;         // estado recebido antes do player ficar pronto
    let lastRoom = { playlist: [], currentIndex: 0, isPlaying: false, currentTime: 0, playbackUpdated: 0 };
    let lastAppliedStamp = -1;
    let lastAppliedIndex = -1;

    const suppress = (ms = 1500) => { suppressUntil = Date.now() + ms; };

    // Trava de controles (só em salas P2P): convidados não mexem no player quando o anfitrião trava
    let lastChatAt = 0, resyncTimer = null;
    const controlsBlocked = () => hostMode() && !store.isAdmin() && !!lastRoom.locked;
    function canControl() {
        if (controlsBlocked()) { showNotification('Os anfitriões travaram os controles do player.', 'error'); return false; }
        return true;
    }
    // se um convidado mexe no player do YouTube com os controles travados, volta ao estado da sala
    function resyncSoon() {
        clearTimeout(resyncTimer);
        resyncTimer = setTimeout(() => { if (playerReady && ytPlayer) applyPlayback(lastRoom); }, 400);
    }
    window.toggleLock = function () {
        if (!hostMode() || !store.isAdmin() || !currentRoomId) return;
        const next = !lastRoom.locked;
        store.updateRoom(currentRoomId, 'lock', { value: next });
        showNotification(next ? 'Só os anfitriões controlam o player agora.' : 'Todos podem controlar o player de novo.', 'info');
    };
    // A trava fica no cabeçalho de "Membros da sessão" (não ocupa linha extra): assim o vídeo não muda de tamanho
    function updateLockUI() {
        const box = $('lock-row'), st = $('lock-status'), btn = $('lock-btn');
        const admin = hostMode() && store.isAdmin(), locked = !!lastRoom.locked;
        if (!hostMode() || (!admin && !locked)) { box.classList.add('hidden'); box.classList.remove('flex'); return; }
        box.classList.remove('hidden'); box.classList.add('flex');
        st.innerHTML = locked
            ? '<i class="fa-solid fa-lock mr-1.5 text-nyellow"></i><span class="lock-text">Só anfitriões controlam</span>'
            : '<i class="fa-solid fa-lock-open mr-1.5 text-nblue"></i><span class="lock-text">Todos controlam</span>';
        btn.classList.toggle('hidden', !admin);
        btn.textContent = locked ? 'Liberar' : 'Travar';
        btn.title = locked ? 'Liberar os controles para todos' : 'Travar os controles (só anfitriões controlam)';
    }

    /* ---------- Entrar / criar sala ---------- */
    window.copyRoomLink = function () {
        const url = window.location.href.split('?')[0].split('#')[0] + '?room=' + currentRoomId;
        const done = () => showNotification('Link da sala copiado!', 'success');
        if (navigator.clipboard) navigator.clipboard.writeText(url).then(done, done);
        else {
            const tmp = document.createElement('input');
            tmp.value = url; document.body.appendChild(tmp); tmp.select();
            try { document.execCommand('copy'); } catch (e) {}
            document.body.removeChild(tmp); done();
        }
    };

    window.createRoom = async function () {
        const name = currentUser;
        const pass = $('room-password-input').value.trim();
        const roomName = clip(noCtl($('room-name-input').value), 40).trim() || `Sala de ${name}`;
        if (!name) return showNotification('Faça login primeiro', 'error');
        await storeReady;
        clientUsername = name;
        if (pass && !hostMode()) showNotification('Senha só funciona com o servidor conectado — esta sala foi aberta sem senha.', 'info');
        for (let attempt = 0; attempt < 3; attempt++) {
            const id = newRoomCode();
            try {
                await store.createRoom(id, {
                    name: roomName,
                    createdAt: Date.now(), playlist: [], currentIndex: 0,
                    isPlaying: false, currentTime: 0, playbackUpdated: Date.now(), lastUpdated: Date.now(), locked: false
                }, pass, { category: createCat });
                currentRoomId = id;
                currentRoomName = roomName;
                enterCatHint = createCat;
                myListing = { id, name: roomName, host: name, count: 1, pass: !!pass && hostMode() };
                $('room-name-input').value = ''; $('room-password-input').value = '';
                enterRoomUI();
                publishListing();
                return;
            } catch (e) {
                console.error(e);
                if (!(e && e.type === 'unavailable-id')) break;   // só repete se o código já existir
            }
        }
        showNotification('Erro ao criar sala. Verifique sua conexão.', 'error');
    };

    window.joinRoom = async function () {
        const name = currentUser;
        const code = $('room-code-input').value.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
        const pass = $('join-password-input').value.trim();
        if (!name) return showNotification('Faça login primeiro', 'error');
        if (!code) return showNotification('Digite o código da sala', 'error');
        await storeReady;
        clientUsername = name;
        try {
            const room = await store.getRoom(code, pass);
            if (!room) return showNotification('Sala não encontrada!', 'error');
            currentRoomId = code;
            currentRoomName = clip(noCtl(room.name), 40).trim();
            $('join-password-input').value = '';
            enterRoomUI();
        } catch (e) {
            console.error(e);
            if (e && e.type === 'denied') {
                const msg = e.reason === 'password' ? (pass ? 'Senha incorreta.' : 'Essa sala tem senha. Digite a senha e tente de novo.')
                          : e.reason === 'nick' ? 'Já existe alguém na sala com esse nick. Peça para a pessoa sair ou use outra conta.'
                          : e.reason === 'kicked' ? 'Você foi expulso dessa sala. Tente de novo mais tarde.'
                          : e.reason === 'full' ? 'Essa sala está cheia.'
                          : e.reason === 'busy' ? 'Muitas tentativas. Espere um minuto e tente de novo.'
                          : 'Entrada negada pelo anfitrião.';
                showNotification(msg, 'error');
            } else showNotification('Não consegui conectar. Verifique sua conexão e tente de novo.', 'error');
        }
    };

    function enterRoomUI() {
        $('setup-view').classList.add('hidden');
        $('room-view').classList.remove('hidden');
        $('room-header-info').classList.remove('hidden');
        $('room-header-info').classList.add('flex');
        setRoomTitle();
        updateLockUI();
        { const known = (roomList || []).find(r => r.id === currentRoomId); applyRoomCategory(enterCatHint || (known && known.cat) || 'musica'); enterCatHint = null; }
        voteState = { key: null, up: 0, down: 0, mine: 0 }; resetRoomRank(); refreshVotes(true);
        joinedAt = Date.now();
        replyingTo = null; chatView = []; seenMsgs = new Set(); chatSoundArmed = false;
        $('chat-messages').innerHTML = '<div class="text-center text-xs text-[#6B7566] my-2">Conexão estabelecida</div>';

        ensurePlayer();
        if (unsubRoom) unsubRoom();
        if (unsubChat) unsubChat();
        unsubRoom = store.subscribeRoom(currentRoomId, onRoomData);
        unsubChat = store.subscribeChat(currentRoomId, renderChat);

        if (unsubPresence) unsubPresence();
        if (leavePresence) leavePresence();
        knownUsers = null;
        leavePresence = store.joinPresence(currentRoomId, clientUsername);
        unsubPresence = store.subscribePresence(currentRoomId, onPresence);
        onPresence([]);   // mostra você mesmo até a lista completa chegar

        showNotification(`Conectado à sala ${currentRoomId}`, 'success');
        if (store.mode === 'p2p') {
            setTimeout(() => showNotification('Sala P2P: se o anfitrião sair, outra pessoa assume a sala.', 'info'), 3800);
        } else if (store.mode === 'local') {
            setTimeout(() => showNotification('Modo local: só sincroniza entre abas deste navegador.', 'info'), 3800);
        }
    }

    // Volta para a tela inicial (sair da sala, ser expulso ou fazer logout)
    function leaveRoomUI() {
        try { store.leave(); } catch (e) {}
        if (unsubRoom) unsubRoom(); if (unsubChat) unsubChat(); if (unsubPresence) unsubPresence(); if (leavePresence) leavePresence();
        unsubRoom = unsubChat = unsubPresence = leavePresence = null; knownUsers = null;
        currentRoomId = null; currentRoomName = ''; replyingTo = null; chatView = []; pendingData = null; seenMsgs = new Set(); chatSoundArmed = false;
        if (myListing) { myListing = null; try { if (store.dir) store.dir.publish(null); } catch (e) {} }
        lastRoom = { playlist: [], currentIndex: 0, isPlaying: false, currentTime: 0, playbackUpdated: 0 };
       
        lastAppliedStamp = -1; lastAppliedIndex = -1; lastPoll = null;
        try { if (ytPlayer && playerReady) { suppress(); ytPlayer.stopVideo(); } } catch (e) {}
        cancelReply();
        $('chat-messages').innerHTML = '';
        $('members-list').innerHTML = '';
        $('room-view').classList.add('hidden');
        $('room-header-info').classList.add('hidden'); $('room-header-info').classList.remove('flex');
        clearRoomCategory(); voteState = { key: null, up: 0, down: 0, mine: 0 }; renderVotes(); resetRoomRank();
        if (currentUser) $('setup-view').classList.remove('hidden');
    }

    /* ---------- Janela de confirmação (no lugar do confirm() do navegador) ---------- */
    let askOpen = null;
    function askConfirm({ title, message, okText = 'Confirmar', cancelText = 'Cancelar', danger = false, icon = 'fa-circle-question' }) {
        if (askOpen) askOpen(false);   // só uma janela por vez
        return new Promise((resolve) => {
            const box = $('confirm-modal');
            const ok = $('confirm-ok'), cancel = $('confirm-cancel');
            $('confirm-title').textContent = title || 'Confirmar';
            $('confirm-text').textContent = message || '';
            $('confirm-icon').className = 'fa-solid ' + icon + (danger ? ' text-red-400' : ' text-nblue');
            ok.textContent = okText; cancel.textContent = cancelText;
            ok.className = 'btn px-5 py-2.5 text-sm ' + (danger ? 'btn-danger' : 'btn-yellow');
            const prevFocus = document.activeElement;
            const close = (val) => {
                box.classList.remove('open');
                box.setAttribute('aria-hidden', 'true');
                document.removeEventListener('keydown', onKey, true);
                ok.onclick = cancel.onclick = box.onclick = null;
                askOpen = null;
                if (prevFocus && prevFocus.focus) { try { prevFocus.focus(); } catch (e) {} }
                resolve(val);
            };
            const onKey = (ev) => {
                if (ev.key === 'Escape') { ev.preventDefault(); close(false); }
                else if (ev.key === 'Tab') {   // mantém o foco dentro da janela
                    ev.preventDefault();
                    (document.activeElement === ok ? cancel : ok).focus();
                }
            };
            askOpen = close;
            ok.onclick = () => close(true);
            cancel.onclick = () => close(false);
            box.onclick = (ev) => { if (ev.target === box) close(false); };
            document.addEventListener('keydown', onKey, true);
            box.setAttribute('aria-hidden', 'false');
            box.classList.add('open');
            (danger ? cancel : ok).focus();
        });
    }

    window.leaveRoom = async function () {
        if (!currentRoomId) return;
        if (!(await confirmHostLeave())) return;
        leaveRoomUI();
    };

    // anfitrião saindo: avisa o que vai acontecer (outra pessoa assume, ou a sala fecha se estiver sozinho)
    async function confirmHostLeave() {
        if (!hostMode() || !store.isHost()) return true;
        const hasSub = store.getUsers().some(u => u.cohost);
        const alone = !(store.memberCount() > 0);
        return askConfirm({
            title: alone ? 'Encerrar a sala?' : 'Sair da sala?',
            message: alone
                ? 'Você é o único na sala: se sair, a sala é encerrada.'
                : (hasSub ? 'Você é o anfitrião: ao sair, o sub-host da sala vira o anfitrião.' : 'Você é o anfitrião: ao sair, uma pessoa aleatória da sala vira o anfitrião.'),
            okText: alone ? 'Encerrar e sair' : 'Sair',
            danger: alone,
            icon: 'fa-right-from-bracket'
        });
    }

    // anfitrião dá os poderes de anfitrião (sub-host) para alguém, ou tira se a pessoa já for sub-host
    window.promoteUser = async function (id, name) {
        if (!currentRoomId || !hostMode() || !store.isHost()) return;
        const already = store.getUsers().some(u => u.id === id && u.cohost);
        const yes = await askConfirm({
            title: already ? 'Tirar o sub-host?' : 'Dar poderes de anfitrião?',
            message: already
                ? `${name} deixa de ser sub-host e volta a ser convidado.`
                : `${name} vira sub-host: pode controlar o player, travar os controles e expulsar pessoas, igual a você. Se você sair da sala, ${name} vira o anfitrião.`,
            okText: already ? 'Tirar sub-host' : 'Dar poderes',
            icon: 'fa-crown'
        });
        if (!yes || !currentRoomId || !store.isHost()) return;
        if (!store.setCohost(already ? null : id)) showNotification('Não consegui alterar o sub-host.', 'error');
    };

    window.kickUser = async function (id, name) {
        if (!currentRoomId || !hostMode() || !store.isAdmin()) return;
        const yes = await askConfirm({
            title: 'Expulsar da sala?',
            message: `${name} será removido da sala e não poderá voltar por 5 minutos.`,
            okText: 'Expulsar',
            danger: true,
            icon: 'fa-user-slash'
        });
        if (!yes || !currentRoomId || !store.isAdmin()) return;
        if (store.getUsers().some(u => u.id === id && u.cohost) && store.isHost()) store.setCohost(null);
        if (!store.kick(id)) showNotification('Não consegui expulsar essa pessoa.', 'error');
    };

    /* ---------- Lista de salas (interface) ---------- */
    let roomList = null;          // null = ainda procurando
    let roomListKey = '';
    let pendingRoom = null;       // sala clicada na tela de login (entra depois do login)

    const publishListing = () => { try { if (store.dir && myListing) store.dir.publish(myListing); } catch (e) { console.error(e); } };

    // troca de anfitrião (só P2P): quem vira anfitrião passa a anunciar a sala na lista; quem deixa de ser, para
    let quietUntil = 0;       // durante a troca, não mostra aviso de "entrou/saiu" de cada pessoa
    store.onRole = (ev) => {
        if (!currentRoomId || !ev) return;
        if (ev.type === 'migrating') {
            quietUntil = Date.now() + 10000;
            showNotification(ev.name ? `${ev.name} agora é o anfitrião. Reconectando...` : 'Trocando de anfitrião...', 'info');
        } else if (ev.type === 'role') {
            quietUntil = Date.now() + 8000;
            if (ev.host) {
                myListing = { id: currentRoomId, name: currentRoomName, host: clientUsername, count: Math.max(1, store.getUsers().length), pass: store.hasPass() };
                publishListing();
                showNotification('Você agora é o anfitrião da sala.', 'success');
            } else if (myListing) {
                myListing = null;
                try { if (store.dir) store.dir.publish(null); } catch (e) {}
            }
            updateLockUI();
            onPresence(store.getUsers());
        } else if (ev.type === 'cohost') {
            showNotification(ev.cohost ? 'O anfitrião deu poderes de anfitrião para você (sub-host).' : 'Você não é mais sub-host.', ev.cohost ? 'success' : 'info');
            updateLockUI();
            onPresence(store.getUsers());
        } else if (ev.type === 'failed') {
            showNotification('Não consegui reconectar à sala depois da troca de anfitrião.', 'error');
            leaveRoomUI();
        }
    };

    // título da sala no cabeçalho: nome (e o código pequeno ao lado)
    function setRoomTitle(name) {
        if (typeof name === 'string' && name.trim()) currentRoomName = clip(noCtl(name), 40).trim();
        $('current-room-code').textContent = currentRoomName || currentRoomId;
        $('current-room-code').title = 'Código da sala: ' + currentRoomId;
        $('current-room-id').textContent = currentRoomName ? currentRoomId : '';
    }

    function fillRoomLists(html) { document.querySelectorAll('.room-list').forEach(el => { el.innerHTML = html; }); }
    function renderRoomLists(list) {
        roomList = Array.isArray(list) ? list : null;
        const key = JSON.stringify(roomList);
        if (key === roomListKey) return;          // nada mudou: não mexe na tela
        roomListKey = key;
        if (roomList === null) fillRoomLists('<div class="room-empty">Procurando salas abertas...</div>');
        else if (!roomList.length) fillRoomLists('<div class="room-empty"><i class="fa-regular fa-moon text-2xl mb-2 block text-[#99FF00]"></i>Nenhuma sala aberta agora.<br>Crie a primeira!</div>');
        else fillRoomLists(roomList.map(r => { const c = catOf(r.cat); return `<button type="button" class="room-item" data-room="${r.id}" style="--cat:${c.color}" title="Código da sala: ${r.id} · ${esc(c.label)}">
                <span class="room-ico"><i class="fa-solid ${c.icon}" aria-hidden="true"></i></span>
                <span class="room-main">
                    <span class="room-name">${esc(r.name)}${r.pass ? '<i class="fa-solid fa-lock room-lock" aria-hidden="true"></i>' : ''}</span>
                    <span class="room-meta"><span class="room-cat">${esc(c.label)}</span>${r.host ? 'Anfitrião: ' + esc(r.host) : 'Sala aberta'}${r.pass ? ' · com senha' : ''}</span>
                </span>
                <span class="room-people" title="Pessoas na sala"><i class="fa-solid fa-user-group" aria-hidden="true"></i>${r.count}</span>
                <span class="room-go">Entrar</span>
            </button>`; }).join(''));
        const n = roomList ? roomList.length : 0;
        document.querySelectorAll('.room-count').forEach(el => { el.textContent = String(n); });
    }

    function pickRoom(id) {
        const r = (roomList || []).find(x => x.id === id);
        if (!r) return showNotification('Essa sala não está mais aberta.', 'error');
        if (!currentUser) {
            pendingRoom = id;
            showNotification(`Entre na sua conta para participar de “${r.name}”.`, 'info');
            $('auth-name').focus();
            return;
        }
        if (currentRoomId) return;
        $('room-code-input').value = r.id;
        if (r.pass) {
            showNotification(`“${r.name}” tem senha. Digite e clique em Entrar.`, 'info');
            $('join-password-input').focus();
        } else window.joinRoom();
    }
    document.addEventListener('click', (e) => {
        const b = e.target.closest && e.target.closest('.room-item[data-room]');
        if (b) pickRoom(b.dataset.room);
    });

    // liga a lista assim que o modo de armazenamento estiver pronto
    storeReady.then(() => { if (store.dir) store.dir.subscribe(renderRoomLists); });
    setTimeout(() => {
        if (roomList === null) fillRoomLists('<div class="room-empty">Não consegui carregar a lista de salas agora.<br>Você ainda pode entrar com um código.</div>');
    }, 15000);

    /* ============================================================
       CATEGORIAS DA SALA, LIKES / DESLIKES (Rimk e Zunk) e RANKING
       - só funcionam com o servidor (Supabase) + o arquivo supabase-likes-categorias.sql
       ============================================================ */
    let createCat = 'musica';        // categoria escolhida na hora de criar a sala
    let currentCat = 'musica';       // categoria da sala em que estou
    let enterCatHint = null;

    const catButtons = (selected) => CATEGORIES.map(c =>
        `<button type="button" role="radio" class="cat-opt" data-cat="${c.key}" aria-checked="${c.key === selected}" style="--c:${c.color}" title="${esc(c.label)}"><i class="fa-solid ${c.icon}" aria-hidden="true"></i><span>${esc(c.label)}</span></button>`
    ).join('');
    const markChecked = (grid, key) => grid.querySelectorAll('.cat-opt').forEach(x => x.setAttribute('aria-checked', String(x.dataset.cat === key)));
    $('cat-grid-create').innerHTML = catButtons(createCat);
    $('cat-grid-room').innerHTML = catButtons(currentCat);

    function updateCatAdminUI() {
        const admin = hostMode() && !!currentRoomId && store.isAdmin();
        const chip = $('cat-chip');
        chip.classList.toggle('is-admin', admin);
        $('cat-chip-caret').classList.toggle('hidden', !admin);
        chip.title = admin ? 'Mudar a categoria da sala' : 'Categoria da sala: ' + catOf(currentCat).label;
        if (!admin) closeCatPopover();
    }
    // a sala inteira ganha a cor da categoria (variável --cat no <body>)
    function applyRoomCategory(key) {
        const c = catOf(key);
        currentCat = c.key;
        document.body.dataset.cat = c.key;
        document.body.style.setProperty('--cat', c.color);
        $('cat-chip-icon').className = 'fa-solid ' + c.icon + ' text-xs';
        $('cat-chip-label').textContent = c.label;
        markChecked($('cat-grid-room'), c.key);
        updateCatAdminUI();
    }
    function clearRoomCategory() {
        delete document.body.dataset.cat;
        document.body.style.removeProperty('--cat');
        currentCat = 'musica';
        closeCatPopover();
    }
    function closeCatPopover() {
        const p = $('cat-popover'); if (p) p.classList.add('hidden');
        const c = $('cat-chip'); if (c) c.setAttribute('aria-expanded', 'false');
    }
    window.toggleCatPopover = function () {
        if (!(hostMode() && currentRoomId && store.isAdmin())) return;
        const pop = $('cat-popover'), open = pop.classList.contains('hidden');
        pop.classList.toggle('hidden', !open);
        $('cat-chip').setAttribute('aria-expanded', String(open));
    };
    async function changeRoomCategory(key) {
        closeCatPopover();
        if (!store.setCategory || !store.isAdmin() || key === currentCat) return;
        const ok = await store.setCategory(key);
        if (!ok) return showNotification('Não consegui mudar a categoria. O arquivo supabase-likes-categorias.sql já foi rodado no Supabase?', 'error');
        applyRoomCategory(key);
        store.addChat(currentRoomId, { id: Math.random().toString(16).slice(2, 12), system: true, user: '', text: `${clientUsername} mudou a categoria da sala para ${catOf(key).label}`, time: Date.now() }).catch(() => {});
    }
    document.addEventListener('click', (e) => {
        const t = e.target;
        if (!t.closest) return;
        const b = t.closest('.cat-opt[data-cat]');
        if (b && CAT_BY_KEY[b.dataset.cat]) {
            if (b.closest('#cat-grid-create')) { createCat = b.dataset.cat; markChecked($('cat-grid-create'), createCat); }
            else if (b.closest('#cat-grid-room')) changeRoomCategory(b.dataset.cat);
            return;
        }
        if (!t.closest('#cat-popover') && !t.closest('#cat-chip')) closeCatPopover();
    });

    /* ---------- Like / deslike na música que está tocando ---------- */
    let voteState = { key: null, up: 0, down: 0, mine: 0 };
    let voteBusy = false, reactTimer = null, lastReactAt = 0;
    const curSong = () => (lastRoom.playlist || [])[lastRoom.currentIndex || 0] || null;
    const curKey = () => { const s = curSong(); return s && s.id ? s.id : ''; };

    function renderVotes() {
        const lb = $('like-btn'), db = $('dislike-btn'); if (!lb || !db) return;
        const supported = !!store.vote;                       // só no modo com servidor
        lb.style.display = db.style.display = supported ? '' : 'none';
        const key = curKey(), has = supported && !!key && !!currentRoomId;
        lb.disabled = db.disabled = !has;
        const same = has && voteState.key === key;
        $('like-count').textContent = String(same ? voteState.up : 0);
        $('dislike-count').textContent = String(same ? voteState.down : 0);
        lb.setAttribute('aria-pressed', String(same && voteState.mine === 1));
        db.setAttribute('aria-pressed', String(same && voteState.mine === -1));
    }
    async function refreshVotes(force) {
        const key = curKey();
        if (!key || !currentRoomId) { voteState = { key: null, up: 0, down: 0, mine: 0 }; renderVotes(); return; }
        if (!force && voteState.key === key) { renderVotes(); return; }
        if (voteState.key !== key) voteState = { key, up: 0, down: 0, mine: 0 };
        renderVotes();
        if (!store.voteCounts) return;
        const r = await store.voteCounts(currentRoomId, key).catch(() => null);
        if (r && curKey() === key) { voteState = { key, ...r }; renderVotes(); noteVotes(key, r); }
    }
    // o mascote sobe acima dos botões do player, com animação e um sonzinho discreto
    function playReaction(kind, by) {
        const stage = $('reaction-stage'); if (!stage) return;
        const up = kind === 'up';
        stage.innerHTML = `<div class="react ${up ? 'react-up' : 'react-down'}"><img src="${up ? 'rimk-like.png' : 'zunk-dislike.png'}" alt="${up ? 'Rimk dando joinha' : 'Zunk dando deslike'}" width="108" height="108"><span class="react-by">${esc(by || 'Alguém')} ${up ? 'curtiu' : 'não curtiu'}</span></div>`;
        clearTimeout(reactTimer); reactTimer = setTimeout(() => { stage.innerHTML = ''; }, 2500);
        if (up) sfx.like(); else sfx.dislike();
    }
    window.voteCurrent = async function (val) {
        if (!currentRoomId || !store.vote || voteBusy) return;
        const song = curSong(), key = curKey();
        if (!song || !key) return showNotification('Nenhuma música tocando para avaliar.', 'info');
        if (String(song.requester).toLowerCase() === String(clientUsername || '').toLowerCase()) return showNotification('Você não pode avaliar a sua própria música 😉', 'info');
        voteBusy = true;
        const next = (voteState.key === key && voteState.mine === val) ? 0 : val;   // clicar de novo tira o voto
        try {
            const r = await store.vote(currentRoomId, key, next);
            if (!r) throw new Error('vote');
            if (curKey() === key) { voteState = { key, ...r }; renderVotes(); }
            noteVotes(key, r);
            const btn = $(val === 1 ? 'like-btn' : 'dislike-btn');
            btn.classList.remove('pop'); void btn.offsetWidth; btn.classList.add('pop');
            if (next !== 0) {
                const kind = next === 1 ? 'up' : 'down';
                playReaction(kind, clientUsername);
                store.sendReaction(kind);
            }
        } catch (e) {
            const m = String((e && e.message) || '');
            if (/own_song/.test(m)) showNotification('Você não pode avaliar a sua própria música 😉', 'info');
            else { console.error(e); showNotification('Não consegui registrar o voto. O arquivo supabase-likes-categorias.sql já foi rodado no Supabase?', 'error'); }
        } finally { voteBusy = false; }
    };
    // reação de outra pessoa da sala: mostra o mascote e atualiza a contagem
    store.onReaction = (p) => {
        if (!p || (p.k !== 'up' && p.k !== 'down')) return;
        const now = Date.now(); if (now - lastReactAt < 500) return; lastReactAt = now;
        playReaction(p.k, p.by);
        setTimeout(() => refreshVotes(true), 400);
    };

    /* ---------- Ranking DA SALA: músicas com mais likes (cada sala tem o seu) ----------
       Soma os likes de todas as músicas de cada pessoa. Usa a mesma função song_votes_for que o botão de like já usa, então não precisa de SQL novo.
       Só busca no servidor quando a aba "Ranking" está aberta; músicas já lidas ficam em cache e
       as curtidas novas chegam pelas reações em tempo real. */
    const roomVotes = new Map();      // id da música -> { up, down }
    const rankPending = new Set();    // ids sendo buscados agora
    let rankRoom = null;              // sala a que o cache pertence
    let rankTab = 'list';             // aba aberta no painel da esquerda
    let rankLoaded = false;           // já buscou os votos desta sala (evita piscar "sem likes")
    const RANK_ICON = ['<i class="fa-solid fa-crown" aria-hidden="true"></i>', '', ''];
    const RANK_MAX = 10;

    function resetRoomRank() {
        roomVotes.clear(); rankPending.clear(); rankRoom = null; rankLoaded = false;
        const l = $('rank-list'); if (l) l.innerHTML = '';
        setPlaylistTab('list');
    }
    function renderRoomRank() {
        const list = $('rank-list'); if (!list) return;
        const pl = lastRoom.playlist || [];
        const curS = curSong(), curWho = curS ? String(curS.requester || '').trim().toLowerCase() : '';
        // soma os likes de TODAS as músicas de cada pessoa (quem pediu). Músicas já removidas da
        // fila continuam contando, porque o cache guarda o dono de cada música.
        const byUser = new Map();
        const addUser = (who, v) => {
            const name = String(who || '').trim(); if (!name || !v || !(v.up > 0)) return;
            const k = name.toLowerCase();
            const u = byUser.get(k) || { name, up: 0, down: 0, songs: 0 };
            u.up += v.up; u.down += v.down; u.songs += 1;
            byUser.set(k, u);
        };
        const seen = new Set();
        pl.forEach(s => { seen.add(s.id); const v = roomVotes.get(s.id); if (v) addUser(s.requester || v.by, v); });
        roomVotes.forEach((v, id) => { if (!seen.has(id)) addUser(v.by, v); });   // músicas que saíram da fila
        const rows = [...byUser.entries()].map(([k, u]) => ({ k, ...u }));
        rows.sort((a, b) => (b.up - a.up) || (a.down - b.down) || a.name.localeCompare(b.name));
        const top = rows.slice(0, RANK_MAX);
        avFetch(top.map(r => r.name));
        $('rank-empty').hidden = top.length > 0 || !rankLoaded;
        list.innerHTML = top.map((r, k) => {
            const n = esc(r.name);
            const sub = r.songs === 1 ? '1 música curtida' : r.songs + ' músicas curtidas';
            return `<li class="rank-row${k === 0 ? ' is-first' : ''}${r.k === curWho ? ' is-now' : ''}"><span class="rank-pos">${RANK_ICON[k] || (k + 1)}</span>${avBubble(r.name, 'rank-av')}<span class="rank-who"><span class="rank-name" title="${n}">${n}</span><span class="rank-sub">${sub}</span></span><span class="rank-likes" title="${r.up} likes no total"><i class="fa-solid fa-thumbs-up" aria-hidden="true"></i>${r.up}</span></li>`;
        }).join('');
    }
    // busca os votos das músicas da sala que ainda não estão no cache (ou todas, se force)
    async function refreshRoomRank(force) {
        if (rankTab !== 'rank' || !currentRoomId || !store.voteCounts) return;
        const rid = currentRoomId;
        if (rankRoom !== rid) { roomVotes.clear(); rankPending.clear(); rankRoom = rid; rankLoaded = false; }
        const ownerOf = {}; (lastRoom.playlist || []).forEach(s => { if (s.id) ownerOf[s.id] = s.requester; });
        const ids = [...new Set((lastRoom.playlist || []).map(s => s.id).filter(Boolean))]
            .filter(id => !rankPending.has(id) && (force || !roomVotes.has(id)));
        renderRoomRank();
        for (let i = 0; i < ids.length; i += 6) {        // de 6 em 6, para não sobrecarregar
            const chunk = ids.slice(i, i + 6);
            chunk.forEach(id => rankPending.add(id));
            await Promise.all(chunk.map(async (id) => {
                const r = await store.voteCounts(rid, id).catch(() => null);
                rankPending.delete(id);
                if (r && currentRoomId === rid) roomVotes.set(id, { up: r.up, down: r.down, by: ownerOf[id] });
            }));
            if (currentRoomId !== rid || rankTab !== 'rank') return;
            renderRoomRank();
        }
        rankLoaded = true;
        renderRoomRank();
    }
    // chamado quando a contagem da música que está tocando muda
    function noteVotes(key, r) {
        if (!key || !r || rankRoom !== currentRoomId) return;
        const cs = curSong();
        roomVotes.set(key, { up: r.up, down: r.down, by: cs && cs.id === key ? cs.requester : (roomVotes.get(key) || {}).by });
        if (rankTab === 'rank') renderRoomRank();
    }
    window.setPlaylistTab = function (tab) {
        rankTab = tab === 'rank' ? 'rank' : 'list';
        const isRank = rankTab === 'rank';
        $('ptab-list').setAttribute('aria-selected', String(!isRank));
        $('ptab-rank').setAttribute('aria-selected', String(isRank));
        $('playlist-search').classList.toggle('hidden', isRank);
        $('playlist-container').classList.toggle('hidden', isRank);
        $('room-rank').classList.toggle('hidden', !isRank);
        if (isRank) { const sr = $('search-results'); if (sr) sr.classList.add('hidden'); refreshRoomRank(true); }
    };
    storeReady.then(() => {
        const ok = store.mode === 'supabase';
        // sem servidor não há categoria, likes nem ranking: esconde para não confundir
        const wrap = $('cat-grid-create') && $('cat-grid-create').parentElement;
        if (wrap) wrap.style.display = ok ? '' : 'none';
        $('cat-chip').parentElement.style.display = ok ? '' : 'none';
        $('ptab-rank').style.display = ok ? '' : 'none';
        renderVotes();
    });
    renderVotes();

    /* ---------- Cor do meu nome ---------- */
    let roomUsers = [];
    const hueOf = (hex) => {
        const r = parseInt(hex.slice(1, 3), 16) / 255, g = parseInt(hex.slice(3, 5), 16) / 255, b = parseInt(hex.slice(5, 7), 16) / 255;
        const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
        if (!d) return 0;
        const h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
        return (h * 60 + 360) % 360;
    };
    const PICKER_ORDER = [...NEON].sort((a, b) => hueOf(a) - hueOf(b));   // arco-íris, não a ordem da lista

    function refreshChatColors() {
        const box = $('chat-messages'), top = box.scrollTop, atEnd = box.scrollHeight - box.clientHeight - top < 40;
        renderChat(chatView);
        if (!atEnd) box.scrollTop = top;    // não puxa a tela para baixo se a pessoa estava lendo mensagens antigas
    }
    const myUserId = () => (typeof store.myId === 'function' ? store.myId() : null);
    function renderColorPicker() {
        const grid = $('color-grid'); if (!grid) return;
        const me = myUserId();
        const takenBy = new Map();
        roomUsers.forEach(u => { if (u.id !== me && u.color) takenBy.set(u.color, u.name); });
        grid.innerHTML = PICKER_ORDER.map(c => {
            const sel = c === myColor, other = takenBy.get(c);
            const label = NEON_NAMES[c] + (sel ? ' (sua cor)' : other ? ` (em uso por ${other})` : '');
            return `<button type="button" class="color-swatch${sel ? ' is-selected' : ''}${other ? ' is-taken' : ''}" data-color="${c}" style="--c:${c}" ${other ? 'disabled' : ''} role="radio" aria-checked="${sel}" title="${esc(label)}" aria-label="${esc(label)}">${sel ? '<i class="fa-solid fa-check"></i>' : ''}</button>`;
        }).join('');
        const dot = $('color-btn-dot'); if (dot) dot.style.background = myColor;
        const prev = $('color-preview'); if (prev) { prev.style.color = myColor; prev.style.textShadow = `0 0 10px ${myColor}aa`; prev.textContent = clientUsername || 'Seu nome'; }
    }
    function setMyColor(c) {
        c = safeColor(c); if (!c || c === myColor) return;
        myColor = c;
        try { localStorage.setItem(COLOR_KEY, c); } catch (e) {}
        store.setColor(c);
        if (myUserId()) { userColors.set(clientUsername, c); onPresence(roomUsers.map(u => u.id === myUserId() ? { ...u, color: c } : u)); }
        else renderColorPicker();
    }
    window.toggleColorPicker = function (force) {
        const pop = $('color-popover'), btn = $('color-btn');
        const open = typeof force === 'boolean' ? force : pop.classList.contains('hidden');
        pop.classList.toggle('hidden', !open);
        btn.setAttribute('aria-expanded', String(open));
        if (open) renderColorPicker();
    };
    $('color-grid').addEventListener('click', (e) => {
        const b = e.target.closest('[data-color]'); if (!b || b.disabled) return;
        e.stopPropagation();    // o seletor re-desenha os botões; sem isso o "clique fora" fecharia o painel
        setMyColor(b.dataset.color);
    });
    document.addEventListener('click', (e) => {
        if (!$('color-popover').classList.contains('hidden') && !e.target.closest('#color-popover') && !e.target.closest('#color-btn')) toggleColorPicker(false);
    });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') toggleColorPicker(false); });


    /* ---------- Avatar (avatar.js): bolinha com o avatar da pessoa, ou a inicial se ela ainda não criou um ---------- */
    function avBubble(name, cls, col) {
        const mineName = String(name).toLowerCase() === String(clientUsername || '').toLowerCase();
        const av = window.RimkAvatar ? (mineName ? myAvatar : RimkAvatar.get(name)) : null;
        col = col || userColors.get(name) || nameColor(name);
        const ini = esc((String(name).trim()[0] || '?').toUpperCase());
        return `<span class="${cls}${av ? ' has-av' : ''}" style="color:${col};border-color:${col}">${av ? RimkAvatar.html(av) : ini}</span>`;
    }
    // busca no servidor o avatar de quem aparece no ranking e ainda não conhecemos (ex.: quem já saiu da sala)
    function avFetch(names) {
        if (!window.RimkAvatar || !store.sb) return;
        RimkAvatar.fetchMissing((fn, args) => store.sb.rpc(fn, args), names, () => { if (currentRoomId) renderRoomRank(); });
    }
    function paintChipAvatar() {
        const box = $('user-chip-av'), ico = $('user-chip-icon'); if (!box) return;
        const has = !!(myAvatar && window.RimkAvatar);
        box.innerHTML = has ? RimkAvatar.html(myAvatar) : '';
        box.classList.toggle('hidden', !has);
        if (ico) ico.classList.toggle('hidden', has);
    }
    async function loadMyAvatar() {
        myAvatar = null; paintChipAvatar();
        if (!window.RimkAvatar || !store.sb || !currentUser) return;
        const who = currentUser;
        try {
            const { data, error } = await store.sb.rpc('avatars_for', { p_names: [who] });
            if (error) throw error;
            if (currentUser !== who) return;      // trocou de conta no meio do caminho
            const row = (data || [])[0];
            myAvatar = row ? RimkAvatar.clean(row.avatar) : null;
            RimkAvatar.remember(who, myAvatar);
            paintChipAvatar();
            store.setAvatar();
            if (currentRoomId) onPresence(roomUsers);
        } catch (e) { console.warn('Não consegui carregar o avatar (rode supabase-avatar.sql):', e && e.message || e); }
    }
    async function saveMyAvatar(av) {
        const { error } = await store.sb.rpc('set_my_avatar', { p_avatar: av });
        if (error) {
            console.error(error);
            showNotification('Não consegui salvar o avatar. O arquivo supabase-avatar.sql já foi rodado no Supabase?', 'error');
            return false;
        }
        myAvatar = av; RimkAvatar.remember(currentUser, av);
        paintChipAvatar(); store.setAvatar();
        if (currentRoomId) { onPresence(roomUsers); renderRoomRank(); }
        showNotification('Avatar salvo na sua conta!', 'info');
        return true;
    }
    window.openAvatarEditor = function () {
        if (!window.RimkAvatar) return;
        if (store.mode !== 'supabase' || !currentUser) return showNotification('Entre na sua conta para criar o seu avatar.', 'info');
        RimkAvatar.open({ current: myAvatar, onSave: saveMyAvatar });
    };

    /* ---------- Pessoas na sala ---------- */
    function onPresence(list) {
        const me = store.myId();
        const users = (Array.isArray(list) ? list : []).filter(u => u && u.id)
            .map(u => ({ id: u.id, name: clip(u.name, 30) || 'Convidado', host: !!u.host, cohost: !!u.cohost, color: safeColor(u.color), av: u.av || null }));
        if (!users.some(u => u.id === me)) users.unshift({ id: me, name: clientUsername, host: false, color: myColor, av: myAvatar });
        const colorsBefore = JSON.stringify([...userColors]);
        users.forEach(u => {
            if (!u.color) u.color = nameColor(u.name);
            if (u.id === me) { u.color = myColor; u.av = myAvatar; }
            if (u.av && window.RimkAvatar) RimkAvatar.remember(u.name, u.av);   // guarda para o ranking e o chat
            userColors.set(u.name, u.color);
        });
        roomUsers = users;
        renderColorPicker();
        if (JSON.stringify([...userColors]) !== colorsBefore) refreshChatColors();

        // avisos de entrada/saída (a primeira lista completa não gera avisos)
        const next = new Map(users.map(u => [u.id, u.name]));
        if (Array.isArray(list) && list.length) {
            if (knownUsers) {
                if (Date.now() > quietUntil) {
                    let someoneJoined = false;
                    next.forEach((name, id) => { if (id !== me && !knownUsers.has(id)) { someoneJoined = true; showNotification(`${name} entrou na sala`, 'info'); } });
                    if (someoneJoined) sfx.join();
                    knownUsers.forEach((name, id) => { if (!next.has(id)) showNotification(`${name} saiu da sala`, 'info'); });
                }
            }
            knownUsers = next;
        }

        const n = users.length;
        $('members-count').textContent = n === 1 ? '1 pessoa' : `${n} pessoas`;
        if (myListing && myListing.count !== n) { myListing.count = n; publishListing(); }
        $('header-online').textContent = n;
        const canKick = hostMode() && store.isAdmin();      // anfitrião e sub-host expulsam
        const canPromote = hostMode() && store.isHost();    // só o anfitrião dá/tira o sub-host
        $('chat-online-n').textContent = n;
        // a faixa de ferramentas existe em TODOS os cartões (vazia para quem não é admin): a altura do painel nunca muda
        $('members-list').innerHTML = users.map(u => {
            const mine = u.id === me;
            const ini = esc((String(u.name).trim()[0] || '?').toUpperCase());
            const show = !mine && !u.host;
            const promoteTxt = u.cohost ? `Tirar ${u.name} de sub-host` : `Dar poderes de anfitrião para ${u.name}`;
            const tools = `<div class="member-tools">${
                (canPromote && show) ? `<button type="button" class="promote-btn${u.cohost ? ' on' : ''}" data-promote="${esc(u.id)}" data-name="${esc(u.name)}" title="${esc(promoteTxt)}" aria-label="${esc(promoteTxt)}"><i class="fa-solid fa-crown"></i></button>` : ''
            }${
                (canKick && show) ? `<button type="button" class="kick-btn" data-kick="${esc(u.id)}" data-name="${esc(u.name)}" title="Expulsar ${esc(u.name)}" aria-label="Expulsar ${esc(u.name)}"><i class="fa-solid fa-user-xmark"></i></button>` : ''
            }</div>`;
            const crown = u.host ? '<i class="fa-solid fa-crown member-crown" title="Anfitrião"></i>'
                : (u.cohost ? '<i class="fa-solid fa-crown member-crown cohost" title="Sub-host"></i>' : '');
            return `<div class="member-card" title="${esc(u.name)}">
                <div class="member-avatar${u.av ? ' has-av' : ''}" style="color:${u.color};border-color:${u.color};box-shadow:0 0 14px ${u.color}44">${(u.av && window.RimkAvatar) ? RimkAvatar.html(u.av) : ini}${crown}</div>
                <div class="member-name">${esc(u.name)}${mine ? ' <span class="text-[11px] text-[#8E9A88]">(você)</span>' : ''}</div>
                <div class="member-status"><span></span>${u.host ? 'Anfitrião' : (u.cohost ? 'Sub-host' : 'Online')}</div>
                ${tools}
            </div>`;
        }).join('');
    }

    window.addEventListener('DOMContentLoaded', () => {
        const roomParam = new URLSearchParams(window.location.search).get('room');
        if (roomParam) $('room-code-input').value = roomParam.toUpperCase();
    });

    /* ============================================================
       PLAYER DO YOUTUBE
       ============================================================ */
    function extractYouTubeId(url) {
        const m = String(url).trim().match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/|live\/|v\/))([A-Za-z0-9_-]{11})/);
        if (m) return m[1];
        return /^[A-Za-z0-9_-]{11}$/.test(String(url).trim()) ? String(url).trim() : null;
    }

    const liveNow = () => isLiveSong((lastRoom.playlist || [])[lastRoom.currentIndex || 0]);
    // Se o link não avisou que era live, o próprio player entrega: marcamos e passamos a não sincronizar posição.
    let liveCheckTimer = null;
    function checkLiveRuntime() {
        clearTimeout(liveCheckTimer);
        liveCheckTimer = setTimeout(() => {
            try {
                if (!playerReady || !ytPlayer || ytPlayer.getPlayerState() !== YT.PlayerState.PLAYING) return;
                const d = ytPlayer.getVideoData() || {};
                const id = d.video_id;
                if (!VIDEO_RE.test(String(id)) || liveIds.has(id)) return;
                if (d.isLive === true || ytPlayer.getDuration() === 0) {
                    liveIds.add(id);
                    renderPlaylist(lastRoom.playlist, lastRoom.currentIndex);
                    // entrou numa posição "de vídeo comum": volta para o ao vivo
                    if (lastRoom.isPlaying) { suppress(4000); ytPlayer.loadVideoById({ videoId: id }); }
                }
            } catch (e) {}
        }, 1500);
    }

    function ensurePlayer() {
        if (ytPlayer || !(window.YT && YT.Player)) return;
        ytPlayer = new YT.Player('youtube-player', {
            height: '100%', width: '100%',
            playerVars: { playsinline: 1, controls: 1, enablejsapi: 1, rel: 0, origin: window.location.origin.startsWith('http') ? window.location.origin : undefined },
            events: {
                onReady: () => {
                    playerReady = true;
                    if (pendingData) { applyPlayback(pendingData); pendingData = null; }
                },
                onStateChange: onPlayerStateChange,
                onError: onPlayerError
            }
        });
    }
    window.onYouTubeIframeAPIReady = ensurePlayer;

    let pauseTimer = null;
    function onPlayerStateChange(e) {
        if (e.data === YT.PlayerState.PLAYING) { errorStreak = 0; checkLiveRuntime(); }
        if (!playerReady) return;
        // qualquer estado diferente de PAUSED cancela um "pause" pendente
        if (e.data !== YT.PlayerState.PAUSED) { clearTimeout(pauseTimer); pauseTimer = null; }
        if (Date.now() < suppressUntil) return;
        if (controlsBlocked()) { if (e.data !== YT.PlayerState.ENDED) resyncSoon(); return; }
        const t = ytPlayer.getCurrentTime();
        if (e.data === YT.PlayerState.PLAYING) {
            // a sala já está tocando e a posição bate → nada a avisar (evita "eco" entre aparelhos)
            const live = liveNow();
            if (lastRoom.isPlaying && (live || Math.abs(t - expectedTime(lastRoom)) < 2.5)) return;
            playback({ isPlaying: true, currentTime: live ? 0 : t });
        } else if (e.data === YT.PlayerState.PAUSED) {
            // Ao arrastar a barra de progresso o YouTube dispara um PAUSED passageiro e logo volta a tocar.
            // Se enviássemos esse pause, a sala pararia (e o nosso próprio player também).
            // Então esperamos um instante: se ainda estiver pausado, foi uma pausa de verdade.
            clearTimeout(pauseTimer);
            pauseTimer = setTimeout(() => {
                pauseTimer = null;
                if (!playerReady || Date.now() < suppressUntil) return;
                let st; try { st = ytPlayer.getPlayerState(); } catch (err) { return; }
                if (st !== YT.PlayerState.PAUSED) return;   // voltou a tocar/carregar → era só um seek
                const pt = ytPlayer.getCurrentTime();
                const live = liveNow();
                if (!lastRoom.isPlaying && (live || Math.abs(pt - (lastRoom.currentTime || 0)) < 2.5)) return;
                playback({ isPlaying: false, currentTime: live ? 0 : pt });
            }, 450);
        } else if (e.data === YT.PlayerState.ENDED) skipSong(1, lastRoom.currentIndex, true);
    }

    // Detecta pulos na barra de progresso (inclusive com o vídeo pausado) e sincroniza a nova posição
    let lastPoll = null;
    setInterval(() => {
        if (!playerReady || !ytPlayer || !currentRoomId || !window.YT) return;
        if (liveNow()) { lastPoll = null; return; }   // live não tem barra de progresso para vigiar
        let st, t;
        try { st = ytPlayer.getPlayerState(); t = ytPlayer.getCurrentTime(); } catch (err) { return; }
        const now = Date.now();
        if (st === YT.PlayerState.BUFFERING) { if (lastPoll) lastPoll.at = now; return; }
        if (st !== YT.PlayerState.PLAYING && st !== YT.PlayerState.PAUSED) { lastPoll = null; return; }
        if (lastPoll && now >= suppressUntil) {
            const expected = lastPoll.t + (st === YT.PlayerState.PLAYING ? (now - lastPoll.at) / 1000 : 0);
            if (Math.abs(t - expected) > 1.5) { if (controlsBlocked()) resyncSoon(); else playback({ isPlaying: st === YT.PlayerState.PLAYING, currentTime: t }); }
        }
        lastPoll = { t, at: now };
    }, 500);

    // Vídeo bloqueado para incorporação (comum em clipes oficiais): avisa e pula para a próxima
    let errorStreak = 0;
    function onPlayerError() {
        errorStreak++;
        const idx = lastRoom.currentIndex;
        const total = (lastRoom.playlist || []).length;
        if (total > 1 && errorStreak < total) {
            showNotification('Esse vídeo não pode ser tocado aqui — pulando para o próximo.', 'error');
            setTimeout(() => skipSong(1, idx, true), 1500);   // fromIndex evita que todos pulem ao mesmo tempo
        } else {
            showNotification('Esse vídeo não pode ser tocado aqui (bloqueado pelo dono).', 'error');
        }
    }

    // Escreve uma mudança de reprodução (carimbo permite sincronizar só quando o playback muda)
    function playback(patch) {
        if (!currentRoomId) return Promise.resolve();
        return act('playback', patch);
    }

    // Toda ação no player passa por aqui. No P2P o anfitrião avisa o chat (ele sabe quem foi);
    // nos outros modos quem fez a ação escreve o aviso.
    async function act(op, args) {
        if (!currentRoomId) return;
        if (store.mode !== 'p2p' && !(args && args.auto)) {
            const fn = getOp(op);
            const patch = fn ? fn(lastRoom, args || {}) : null;
            if (patch) {
                const text = describeAction(lastRoom, { ...lastRoom, ...patch }, op, args || {}, clientUsername);
                if (text) store.addChat(currentRoomId, { id: Math.random().toString(16).slice(2, 12), system: true, user: '', text, time: Date.now() }).catch(() => {});
            }
        }
        return store.updateRoom(currentRoomId, op, args);
    }

    function expectedTime(data) {
        const base = data.currentTime || 0;
        if (!data.isPlaying) return base;
        const now = Date.now() + store.getOffset();
        const elapsed = (now - (data.playbackUpdated || now)) / 1000;
        return base + Math.max(0, Math.min(elapsed, 3 * 3600));
    }

    function applyPlayback(data) {
        const song = (data.playlist || [])[data.currentIndex || 0];
        if (!playerReady || !ytPlayer) return;
        suppress();
        if (!song) { try { ytPlayer.stopVideo(); } catch (e) {} return; }

        const t = expectedTime(data);
        const curId = ytPlayer.getVideoData ? ytPlayer.getVideoData().video_id : null;

        const live = isLiveSong(song);
        if (curId !== song.videoId) {
            suppress(4000);   // carregar um vídeo novo demora mais que 1,5s para estabilizar
            // live entra sempre no "ao vivo" (sem posição inicial)
            const opts = (live || t < 1) ? { videoId: song.videoId } : { videoId: song.videoId, startSeconds: t };
            if (data.isPlaying) ytPlayer.loadVideoById(opts);
            else ytPlayer.cueVideoById(opts);
        } else {
            if (!live && Math.abs(ytPlayer.getCurrentTime() - t) > 1.5) ytPlayer.seekTo(t, true);
            if (data.isPlaying) ytPlayer.playVideo(); else ytPlayer.pauseVideo();
        }
    }

    function onRoomData(data) {
        lastRoom = sanitizeRoom(data);
        if (lastRoom.name && lastRoom.name !== currentRoomName) setRoomTitle(lastRoom.name);
        renderPlaylist(lastRoom.playlist, lastRoom.currentIndex);
        refreshSongTip();
        $('play-pause-btn').innerHTML = lastRoom.isPlaying ? '<i class="fa-solid fa-pause"></i>' : '<i class="fa-solid fa-play ml-1"></i>';

        updateLockUI();
        if (lastRoom.category !== currentCat || document.body.dataset.cat !== lastRoom.category) applyRoomCategory(lastRoom.category); else updateCatAdminUI();
        refreshVotes();
        refreshRoomRank(false);   // músicas novas / removidas entram e saem do ranking

        const changed = lastRoom.playbackUpdated !== lastAppliedStamp || lastRoom.currentIndex !== lastAppliedIndex;
        if (!changed) return;   // ex.: alguém só adicionou música → não mexe no player
        lastAppliedStamp = lastRoom.playbackUpdated;
        lastAppliedIndex = lastRoom.currentIndex;

        if (!playerReady) { pendingData = lastRoom; ensurePlayer(); return; }
        applyPlayback(lastRoom);
    }

    /* ============================================================
       CONTROLES
       ============================================================ */
    window.togglePlayPause = function () {
        if (!canControl()) return;
        if (!currentRoomId || !lastRoom.playlist.length) return showNotification('Adicione uma música primeiro', 'error');
        let t = lastRoom.currentTime;
        if (playerReady && ytPlayer) { try { t = ytPlayer.getCurrentTime(); } catch (e) {} }
        playback({ isPlaying: !lastRoom.isPlaying, currentTime: t });
    };

    window.nextSong = () => { if (canControl()) skipSong(1); };
    window.previousSong = () => { if (canControl()) skipSong(-1); };

    window.playSpecificSong = (idx) => {
        if (!currentRoomId || !canControl()) return;
        act('jump', { idx });
    };

    function skipSong(dir, fromIndex, auto) {
        if (!currentRoomId) return;
        return act('skip', { dir, fromIndex, auto: auto === true });
    }

    /* ============================================================
       PLAYLIST
       ============================================================ */
    async function noembedTitle(url) {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 4000);
        try {
            const r = await fetch('https://noembed.com/embed?url=' + encodeURIComponent(url), { signal: ctrl.signal });
            const j = await r.json();
            if (j && j.title) return String(j.title);
        } catch (e) {}
        finally { clearTimeout(timer); }
        return '';
    }
    async function fetchTitle(videoId) {
        return (await noembedTitle('https://www.youtube.com/watch?v=' + videoId)) || `Vídeo ${videoId}`;
    }

    // Descobre se o vídeo é uma live (melhor esforço: se nada responder, assume que não é;
    // o player ainda confirma sozinho quando começar a tocar)
    async function detectLive(videoId) {
        if (YOUTUBE_API_KEY) {
            try {
                const j = await fetchJSON('https://www.googleapis.com/youtube/v3/videos?part=snippet&id=' + videoId + '&key=' + encodeURIComponent(YOUTUBE_API_KEY), 4000);
                const it = (j.items || [])[0];
                if (it) return it.snippet && it.snippet.liveBroadcastContent === 'live';
            } catch (e) {}
        }
        try {
            return await Promise.any(SEARCH_INSTANCES.map(inst => inst.type === 'piped'
                ? fetchJSON(inst.url + '/streams/' + videoId, 4000).then(j => { if (typeof j.livestream !== 'boolean') throw 0; return j.livestream; })
                : fetchJSON(inst.url + '/api/v1/videos/' + videoId + '?fields=liveNow', 4000).then(j => { if (typeof j.liveNow !== 'boolean') throw 0; return j.liveNow; })));
        } catch (e) { return false; }
    }

    const isYouTubeLink = (t) => /youtu\.?be/i.test(String(t));
    window.updateAddButton = function () {
        const v = $('song-url-input').value;
        $('add-song-btn').textContent = isYouTubeLink(v) ? 'Adicionar' : 'Buscar';
        if (!v.trim()) closeSearchResults();
    };

    async function pushSong(videoId, title, live) {
        if ((lastRoom.playlist || []).length >= 200) { showNotification('A playlist chegou ao limite de 200 faixas.', 'error'); return false; }
        const song = { id: Math.random().toString(16).slice(2), videoId, title, requester: clientUsername, ...(live ? { live: true } : {}) };
        try {
            await store.updateRoom(currentRoomId, 'add', { song });
            // aviso no chat da sala (todo mundo vê quem adicionou o quê)
            store.addChat(currentRoomId, { id: Math.random().toString(16).slice(2, 12), system: true, user: '', text: `${clientUsername} adicionou “${clip(noCtl(title) || videoId, 70)}”${live ? ' (ao vivo)' : ''}`, time: Date.now() }).catch(() => {});
            showNotification('Faixa adicionada', 'success');
            return true;
        } catch (e) { console.error(e); showNotification('Erro ao adicionar', 'error'); return false; }
    }

    const extractListId = (t) => { const m = String(t).match(/[?&]list=([A-Za-z0-9_-]{10,64})/); return m ? m[1] : null; };

    // Link de vídeo/live → adiciona direto. Link de playlist → lê a playlist e pergunta. Texto → busca pelo nome.
    window.addSong = async function () {
        const input = $('song-url-input');
        const text = input.value.trim();
        if (!text || !currentRoomId) return;
        if (isYouTubeLink(text)) {
            const videoId = extractYouTubeId(text);
            const listId = extractListId(text);
            // "RD..." é o Mix automático do YouTube (infinito): se veio junto com um vídeo, vale só o vídeo
            if (listId && !(videoId && /^RD/.test(listId))) return openPlaylist(listId, videoId);
            if (!videoId) {
                if (/\/(@[^/?#]+|channel\/[^/?#]+|c\/[^/?#]+|user\/[^/?#]+)\/live/i.test(text))
                    return showNotification('Abra a live e cole o link do vídeo dela (youtube.com/watch?v=… ou /live/…)', 'error');
                return showNotification('Link inválido', 'error');
            }
            input.value = ''; updateAddButton();
            const [title, live] = await Promise.all([fetchTitle(videoId), detectLive(videoId)]);
            await pushSong(videoId, title, live);
        } else if (/^https?:\/\//i.test(text)) {
            showNotification('Só links do YouTube — ou pesquise pelo nome', 'error');
        } else {
            runSearch(text);
        }
    };

    /* ---------- Playlist inteira do YouTube ---------- */
    const MAX_PLAYLIST = 200;   // mesmo limite da sala
    let pendingPlaylist = null, addingPlaylist = false;

    const playlistProviders = {
        // YouTube Data API v3 (precisa de YOUTUBE_API_KEY)
        async api(id) {
            let title = '';
            try {
                const m = await fetchJSON('https://www.googleapis.com/youtube/v3/playlists?part=snippet&id=' + id + '&key=' + encodeURIComponent(YOUTUBE_API_KEY));
                title = decodeHtml(((m.items || [])[0] || {}).snippet?.title || '');
            } catch (e) {}
            const items = []; let token = '';
            for (let page = 0; page < 5; page++) {
                const j = await fetchJSON('https://www.googleapis.com/youtube/v3/playlistItems?part=snippet&maxResults=50&playlistId=' + id
                    + (token ? '&pageToken=' + encodeURIComponent(token) : '') + '&key=' + encodeURIComponent(YOUTUBE_API_KEY));
                for (const it of (j.items || [])) {
                    const sn = it.snippet || {}, vid = sn.resourceId && sn.resourceId.videoId;
                    if (!VIDEO_RE.test(String(vid)) || /^(private|deleted) video$/i.test(sn.title || '')) continue;
                    items.push({ videoId: vid, title: decodeHtml(sn.title || '') });
                }
                token = j.nextPageToken;
                if (!token || items.length >= MAX_PLAYLIST) break;
            }
            return { title, items };
        },
        async piped(base, id) {
            let j = await fetchJSON(base + '/playlists/' + id, 8000);
            const title = j.name || '', items = [];
            const take = (arr) => (arr || []).forEach(i => {
                const m = /[?&]v=([A-Za-z0-9_-]{11})/.exec(i.url || '');
                if (m) items.push({ videoId: m[1], title: i.title || '', live: i.duration === -1 });
            });
            take(j.relatedStreams);
            try {
                for (let page = 0; page < 3 && j.nextpage && items.length < MAX_PLAYLIST; page++) {
                    j = await fetchJSON(base + '/nextpage/playlists/' + id + '?nextpage=' + encodeURIComponent(j.nextpage), 8000);
                    take(j.relatedStreams);
                }
            } catch (e) { /* fica com o que já veio */ }
            return { title, items };
        },
        async invidious(base, id) {
            const items = []; let title = '';
            for (let page = 1; page <= 3 && items.length < MAX_PLAYLIST; page++) {
                let j;
                try { j = await fetchJSON(base + '/api/v1/playlists/' + id + '?page=' + page, 8000); }
                catch (e) { if (page === 1) throw e; break; }
                title = title || j.title || '';
                const vids = j.videos || [];
                vids.forEach(v => { if (v.videoId) items.push({ videoId: v.videoId, title: v.title || '', live: v.liveNow === true }); });
                if (vids.length < 100) break;
            }
            return { title, items };
        }
    };

    // Último recurso (sem chave e sem instâncias): um player escondido do próprio YouTube lista os vídeos da playlist
    function playlistViaPlayer(id) {
        return new Promise((resolve, reject) => {
            if (!(window.YT && YT.Player)) return reject(new Error('player indisponível'));
            const holder = document.createElement('div');
            holder.style.cssText = 'position:fixed;left:-9999px;top:0;width:220px;height:140px;opacity:0;pointer-events:none';
            const target = document.createElement('div');
            holder.appendChild(target);
            document.body.appendChild(holder);
            let done = false, probe = null, iv = null;
            const finish = (err, ids) => {
                if (done) return; done = true;
                clearInterval(iv); clearTimeout(to);
                try { probe && probe.destroy(); } catch (e) {}
                holder.remove();
                err ? reject(err) : resolve(ids);
            };
            const to = setTimeout(() => finish(new Error('tempo esgotado')), 12000);
            probe = new YT.Player(target, {
                height: '140', width: '220',
                playerVars: { listType: 'playlist', list: id, autoplay: 0, playsinline: 1, origin: window.location.origin.startsWith('http') ? window.location.origin : undefined },
                events: {
                    onReady: () => {
                        iv = setInterval(() => {
                            try { const ids = probe.getPlaylist(); if (ids && ids.length) finish(null, ids); } catch (e) {}
                        }, 400);
                    },
                    onError: () => finish(new Error('playlist indisponível'))
                }
            });
        });
    }

    async function fetchPlaylist(id) {
        let res = null;
        if (YOUTUBE_API_KEY) {
            try { const r = await playlistProviders.api(id); if (r.items.length) res = r; }
            catch (e) { console.warn('YouTube API falhou, tentando instâncias públicas:', e); }
        }
        if (!res) {
            try {
                res = await Promise.any(SEARCH_INSTANCES.map(async (inst) => {
                    const r = await playlistProviders[inst.type](inst.url, id);
                    if (!r.items.length) throw new Error('vazio');
                    return r;
                }));
            } catch (e) { /* cai para o player escondido */ }
        }
        if (!res) {
            const ids = await playlistViaPlayer(id);
            const title = await noembedTitle('https://www.youtube.com/playlist?list=' + id);
            res = { title, items: ids.filter(v => VIDEO_RE.test(String(v))).map(v => ({ videoId: v, title: '' })) };
        }
        const seen = new Set();
        res.items = res.items.filter(it => VIDEO_RE.test(String(it.videoId)) && !seen.has(it.videoId) && seen.add(it.videoId));
        if (!res.items.length) throw new Error('playlist vazia');
        return res;
    }

    // busca os títulos que faltam, 6 por vez
    async function fillTitles(items, onEach) {
        let i = 0;
        const worker = async () => {
            while (i < items.length) {
                const it = items[i++];
                if (it.title) continue;
                it.title = await fetchTitle(it.videoId);
                if (onEach) onEach();
            }
        };
        await Promise.all(Array.from({ length: 6 }, worker));
    }

    async function openPlaylist(listId, videoId) {
        const box = $('search-results');
        const seq = ++searchSeq;
        pendingPlaylist = null;
        box.classList.remove('hidden');
        box.innerHTML = '<div class="p-4 text-center text-xs font-mono text-gray-400"><i class="fa-solid fa-circle-notch fa-spin mr-2 text-nblue"></i>Lendo a playlist...</div>';
        try {
            const pl = await fetchPlaylist(listId);
            if (seq !== searchSeq) return;
            pendingPlaylist = { ...pl, videoId: videoId || null };
            renderPlaylistPanel();
        } catch (e) {
            if (seq !== searchSeq) return;
            console.error(e);
            const mix = /^RD/.test(listId);
            box.innerHTML = `<div class="p-4 text-xs font-mono text-gray-300">
                <p class="text-nyellow mb-1"><i class="fa-solid fa-triangle-exclamation mr-2"></i>Não consegui ler essa playlist.</p>
                <p class="text-gray-500">${mix ? 'Mixes automáticos do YouTube não são playlists de verdade.' : 'Ela pode ser privada, ter sido apagada ou estar indisponível agora.'}</p>
                <button onclick="closeSearchResults()" class="btn btn-blue px-3 py-1 text-xs mt-3">Fechar</button>
            </div>`;
        }
    }

    function renderPlaylistPanel() {
        const pl = pendingPlaylist;
        if (!pl) return;
        const space = Math.max(0, MAX_PLAYLIST - (lastRoom.playlist || []).length);
        const total = pl.items.length, n = Math.min(total, space);
        let info = `${total} ${total === 1 ? 'faixa' : 'faixas'}`;
        if (n < total) info += ` · cabem só ${n} (limite de ${MAX_PLAYLIST} por sala)`;
        $('search-results').innerHTML = `
            <div class="flex items-center justify-between px-3 py-2 border-b border-white/5 sticky top-0 bg-npanel">
                <span class="text-xs text-nblue"><i class="fa-solid fa-list mr-1"></i>Playlist do YouTube</span>
                <button onclick="closeSearchResults()" class="text-gray-400 hover:text-nyellow text-xs px-1" title="Fechar"><i class="fa-solid fa-xmark"></i></button>
            </div>
            <div class="p-4">
                <p class="text-sm text-gray-200 truncate">${esc(pl.title || 'Playlist sem nome')}</p>
                <p class="text-xs text-gray-500 font-mono mb-3">${esc(info)}</p>
                <div class="flex gap-2">
                    <button id="pl-add-all" onclick="addWholePlaylist()" class="btn btn-yellow px-4 py-2 text-sm flex-1" ${n ? '' : 'disabled'}>Adicionar ${n} ${n === 1 ? 'faixa' : 'faixas'}</button>
                    ${pl.videoId ? '<button onclick="addOnlyLinkedVideo()" class="btn btn-blue px-4 py-2 text-sm">Só este vídeo</button>' : ''}
                </div>
                <p id="pl-progress" class="text-xs font-mono text-gray-500 mt-2 hidden"></p>
            </div>`;
    }

    window.addWholePlaylist = async function () {
        const pl = pendingPlaylist;
        if (!pl || !currentRoomId || addingPlaylist) return;
        const space = MAX_PLAYLIST - (lastRoom.playlist || []).length;
        const items = pl.items.slice(0, Math.max(0, space));
        if (!items.length) return showNotification(`A playlist chegou ao limite de ${MAX_PLAYLIST} faixas.`, 'error');
        addingPlaylist = true;
        const btn = $('pl-add-all');
        if (btn) { btn.disabled = true; btn.style.opacity = '.6'; }
        try {
            const missing = items.filter(it => !it.title).length;
            if (missing) {
                let done = 0;
                await fillTitles(items, () => {
                    const p = $('pl-progress');
                    if (p) { p.classList.remove('hidden'); p.textContent = `Buscando títulos... ${++done}/${missing}`; }
                });
            }
            const songs = items.map(it => ({
                id: Math.random().toString(16).slice(2), videoId: it.videoId, title: it.title || `Vídeo ${it.videoId}`,
                requester: clientUsername, live: it.live === true
            }));
            await act('addMany', { songs, listTitle: pl.title || '' });
            showNotification(`${songs.length} ${songs.length === 1 ? 'faixa adicionada' : 'faixas adicionadas'}`, 'success');
            pendingPlaylist = null;
            $('song-url-input').value = ''; updateAddButton();
        } catch (e) { console.error(e); showNotification('Erro ao adicionar a playlist', 'error'); }
        finally { addingPlaylist = false; }
    };

    window.addOnlyLinkedVideo = async function () {
        const pl = pendingPlaylist;
        if (!pl || !pl.videoId || !currentRoomId) return;
        const id = pl.videoId;
        pendingPlaylist = null;
        $('song-url-input').value = ''; updateAddButton();
        const [title, live] = await Promise.all([fetchTitle(id), detectLive(id)]);
        await pushSong(id, title, live);
    };

    /* ---------- Busca por nome ---------- */
    const decodeHtml = (s) => { const t = document.createElement('textarea'); t.innerHTML = String(s ?? ''); return t.value; };
    const fmtDur = (sec) => {
        sec = Number(sec);
        if (!Number.isFinite(sec) || sec <= 0) return '';
        const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), r = Math.floor(sec % 60);
        return (h ? `${h}:${String(m).padStart(2, '0')}` : `${m}`) + ':' + String(r).padStart(2, '0');
    };
    async function fetchJSON(url, ms = 6000) {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), ms);
        try {
            const r = await fetch(url, { signal: ctrl.signal });
            if (!r.ok) throw new Error('HTTP ' + r.status);
            return await r.json();
        } finally { clearTimeout(timer); }
    }
    const searchProviders = {
        async api(q) {
            const j = await fetchJSON('https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&maxResults=8&videoEmbeddable=true&q='
                + encodeURIComponent(q) + '&key=' + encodeURIComponent(YOUTUBE_API_KEY));
            return (j.items || []).filter(i => i.id && i.id.videoId)
                .map(i => ({ videoId: i.id.videoId, title: decodeHtml(i.snippet.title), channel: decodeHtml(i.snippet.channelTitle), duration: '', live: i.snippet.liveBroadcastContent === 'live' }));
        },
        async piped(base, q) {
            const j = await fetchJSON(base + '/search?filter=videos&q=' + encodeURIComponent(q));
            return (j.items || []).filter(i => /watch\?v=/.test(i.url || '')).slice(0, 8)
                .map(i => ({ videoId: i.url.split('v=')[1].slice(0, 11), title: i.title, channel: i.uploaderName, duration: fmtDur(i.duration), live: i.duration === -1 }));
        },
        async invidious(base, q) {
            const j = await fetchJSON(base + '/api/v1/search?type=video&q=' + encodeURIComponent(q));
            return (Array.isArray(j) ? j : []).filter(i => i.videoId).slice(0, 8)
                .map(i => ({ videoId: i.videoId, title: i.title, channel: i.author, duration: fmtDur(i.lengthSeconds), live: i.liveNow === true }));
        }
    };
    async function searchYouTube(q) {
        let results;
        if (YOUTUBE_API_KEY) {
            try { results = await searchProviders.api(q); }
            catch (e) { console.warn('YouTube API falhou, tentando instâncias públicas:', e); }
        }
        if (!results) {
            const tasks = SEARCH_INSTANCES.map(async (inst) => {
                const r = await searchProviders[inst.type](inst.url, q);
                if (!r.length) throw new Error('vazio');
                return r;
            });
            try { results = await Promise.any(tasks); }
            catch (agg) {
                if ((agg.errors || []).some(e => e && e.message === 'vazio')) results = [];
                else throw agg;
            }
        }
        return results.filter(r => VIDEO_RE.test(String(r.videoId)));
    }

    let searchSeq = 0, lastResults = [];
    window.closeSearchResults = () => { searchSeq++; $('search-results').classList.add('hidden'); };

    async function runSearch(q) {
        const box = $('search-results');
        const seq = ++searchSeq;
        box.classList.remove('hidden');
        box.innerHTML = '<div class="p-4 text-center text-xs font-mono text-gray-400"><i class="fa-solid fa-circle-notch fa-spin mr-2 text-nblue"></i>Procurando...</div>';
        try {
            const results = await searchYouTube(q);
            if (seq !== searchSeq) return;
            lastResults = results;
            renderSearchResults(results);
        } catch (e) {
            if (seq !== searchSeq) return;
            console.error(e);
            box.innerHTML = `<div class="p-4 text-xs font-mono text-gray-300">
                <p class="text-nyellow mb-1"><i class="fa-solid fa-triangle-exclamation mr-2"></i>Busca indisponível agora.</p>
                <p class="text-gray-500">Cole o link do vídeo, da live ou da playlist do YouTube, ou configure YOUTUBE_API_KEY no código para uma busca estável.</p>
            </div>`;
        }
    }

    function renderSearchResults(results) {
        const head = `<div class="flex items-center justify-between px-3 py-2 border-b border-white/5 sticky top-0 bg-npanel">
            <span class="text-xs text-nblue">Toque para adicionar</span>
            <button onclick="closeSearchResults()" class="text-gray-400 hover:text-nyellow text-xs px-1" title="Fechar"><i class="fa-solid fa-xmark"></i></button>
        </div>`;
        if (!results.length) { $('search-results').innerHTML = head + '<div class="p-4 text-center text-xs font-mono text-gray-500">Nenhum resultado.</div>'; return; }
        $('search-results').innerHTML = head + results.map((r, i) => `
            <div class="flex items-center gap-3 p-2 hover:bg-white/5 cursor-pointer" data-tip="${esc(r.title)}" onclick="addFromSearch(${i})">
                <img src="https://i.ytimg.com/vi/${r.videoId}/default.jpg" loading="lazy" alt="" class="w-16 h-12 object-cover rounded bg-black/50 shrink-0" onerror="this.style.visibility='hidden'">
                <div class="min-w-0 flex-1">
                    <p class="text-sm text-gray-200 truncate">${esc(r.title)}</p>
                    <p class="text-xs text-gray-500 font-mono truncate">${esc(r.channel || '')}${r.live ? ' · <span class="text-red-400">● AO VIVO</span>' : (r.duration ? ' · ' + esc(r.duration) : '')}</p>
                </div>
                <span id="sr-btn-${i}" class="shrink-0 w-8 h-8 flex items-center justify-center rounded-full border border-nyellow/50 text-nyellow"><i class="fa-solid fa-plus text-xs"></i></span>
            </div>`).join('');
    }

    window.addFromSearch = async function (i) {
        const r = lastResults[i];
        if (!r || !currentRoomId) return;
        if (await pushSong(r.videoId, r.title, r.live)) {
            const b = $('sr-btn-' + i);
            if (b) { b.className = 'shrink-0 w-8 h-8 flex items-center justify-center rounded-full border border-nblue text-nblue'; b.innerHTML = '<i class="fa-solid fa-check text-xs"></i>'; }
        }
    };

    window.moveSong = async function (from, to) {
        if (!currentRoomId || !canControl()) return;
        const n = lastRoom.playlist.length;
        if (from === to || to < 0 || to >= n) return;
        try { await act('move', { from, to }); }
        catch (e) { console.error(e); }
    };

    // Botão "Limpar fila": só o anfitrião. Apaga as músicas que já tocaram (antes da atual) e avisa no chat uma única vez.
    const queueLeft = () => Math.max(0, Math.min((lastRoom.currentIndex || 0), (lastRoom.playlist || []).length));
    function updateClearBtn() {
        const b = $('clear-queue-btn'); if (!b) return;
        const mayClear = !hostMode() || store.isHost();
        const n = queueLeft();
        b.classList.toggle('hidden', !mayClear || !currentRoomId);
        b.disabled = n === 0;
        b.title = n ? `Limpar as músicas que já tocaram (${n} ${n === 1 ? 'música' : 'músicas'})` : 'Não há músicas que já tocaram';
    }
    window.clearPlaylist = async function () {
        if (!currentRoomId || (hostMode() && !store.isHost())) return showNotification('Só o anfitrião pode limpar a playlist.', 'error');
        const n = queueLeft(); if (!n) return;
        const yes = await askConfirm({
            title: 'Limpar a playlist?',
            message: `${n === 1 ? '1 música antes da atual será removida' : n + ' músicas antes da atual serão removidas'}. A música que está tocando e as próximas ficam.`,
            okText: 'Limpar', danger: true, icon: 'fa-broom'
        });
        if (!yes || !currentRoomId) return;
        try { await act('clearQueue', {}); }
        catch (e) { console.error(e); }
    };

    window.removeSong = async function (idx) {
        if (!currentRoomId || !canControl()) return;
        try { await act('remove', { idx }); }
        catch (e) { console.error(e); }
    };

    let dragFrom = null;          // índice da música que está sendo arrastada
    let renderAfterDrag = false;  // a fila mudou durante o arraste: redesenha quando soltar
    function renderPlaylist(playlist, currentIndex) {
        if (dragFrom !== null) { renderAfterDrag = true; return; }   // não destrói a linha que está no ar
        const container = $('playlist-container');
        const placeholder = $('player-placeholder');

        updateClearBtn();
        if (!playlist.length) {
            container.innerHTML = '<div class="text-center py-6 text-gray-500 text-xs font-mono">Nenhuma faixa na fila.</div>';
            placeholder.classList.remove('hidden');
            $('current-song-title').innerText = 'Aguardando...';
            $('current-song-requester').innerText = '--';
            return;
        }
        placeholder.classList.add('hidden');

        container.innerHTML = playlist.map((song, i) => {
            const active = i === currentIndex;
            return `
            <div data-idx="${i}" draggable="true" class="song-row flex items-center justify-between p-3 rounded-lg mb-2 transition ${active ? 'bg-nblue/10 border border-nblue shadow-[0_0_14px_rgba(153,255,0,0.25)]' : 'bg-black/40 border border-white/5 hover:border-white/20'}">
                <div class="flex-1 cursor-pointer flex items-center min-w-0" data-tip="${esc(song.title || song.videoId)}" onclick="playSpecificSong(${i})">
                    <div class="w-8 h-8 shrink-0 rounded-full flex items-center justify-center font-mono text-xs mr-3 ${active ? 'bg-nyellow text-black' : 'bg-white/5 text-gray-400'}">
                        ${active ? '<i class="fa-solid fa-music animate-pulse"></i>' : (i + 1)}
                    </div>
                    <div class="truncate">
                        <p class="text-sm font-medium truncate ${active ? 'text-nblue' : 'text-gray-200'}">${isLiveSong(song) ? '<span class="live-badge">AO VIVO</span>' : ''}${esc(song.title || song.videoId)}</p>
                        <p class="text-xs text-gray-500 font-mono">Por: ${esc(song.requester)}</p>
                    </div>
                </div>
                <div class="flex items-center shrink-0 ml-1">
                    <span class="drag-handle" title="Arraste para mudar a ordem" aria-hidden="true"><i class="fa-solid fa-grip-vertical"></i></span>
                    <span class="flex flex-col">
                        <button onclick="moveSong(${i}, ${i - 1})" class="move-btn" ${i === 0 ? 'disabled' : ''} title="Subir na fila" aria-label="Subir na fila"><i class="fa-solid fa-chevron-up"></i></button>
                        <button onclick="moveSong(${i}, ${i + 1})" class="move-btn" ${i === playlist.length - 1 ? 'disabled' : ''} title="Descer na fila" aria-label="Descer na fila"><i class="fa-solid fa-chevron-down"></i></button>
                    </span>
                    <button onclick="removeSong(${i})" class="text-gray-500 hover:text-nyellow p-2 ml-1 transition" title="Remover"><i class="fa-solid fa-trash-can text-sm"></i></button>
                </div>
            </div>`;
        }).join('');

        const cur = playlist[currentIndex];
        if (cur) {
            $('current-song-title').innerText = cur.title || cur.videoId;
            $('current-song-requester').innerText = `Pedido por ${cur.requester}`;
        }
    }

    /* ---------- Arrastar para mudar a ordem ---------- */
    (() => {
        const box = $('playlist-container');
        const rowOf = (el) => (el && el.closest) ? el.closest('.song-row') : null;
        const clearMarks = () => box.querySelectorAll('.drop-above, .drop-below, .is-dragging').forEach(r => r.classList.remove('drop-above', 'drop-below', 'is-dragging'));
        box.addEventListener('dragstart', (e) => {
            const row = rowOf(e.target);
            if (!row || !canControl()) { e.preventDefault(); return; }
            dragFrom = Number(row.dataset.idx);
            hideSongTip();
            e.dataTransfer.effectAllowed = 'move';
            try { e.dataTransfer.setData('text/plain', String(dragFrom)); } catch (err) {}   // o Firefox exige algum dado
            setTimeout(() => row.classList.add('is-dragging'), 0);
        });
        box.addEventListener('dragover', (e) => {
            if (dragFrom === null) return;
            const row = rowOf(e.target); if (!row) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            const r = row.getBoundingClientRect();
            const below = e.clientY > r.top + r.height / 2;
            box.querySelectorAll('.drop-above, .drop-below').forEach(x => x.classList.remove('drop-above', 'drop-below'));
            if (Number(row.dataset.idx) !== dragFrom) row.classList.add(below ? 'drop-below' : 'drop-above');
        });
        box.addEventListener('drop', (e) => {
            if (dragFrom === null) return;
            const row = rowOf(e.target); if (!row) return;
            e.preventDefault();
            const r = row.getBoundingClientRect();
            const below = e.clientY > r.top + r.height / 2;
            let to = Number(row.dataset.idx) + (below ? 1 : 0);   // posição de inserção na lista ANTES de tirar a música
            if (dragFrom < to) to -= 1;                           // ao tirar a música de cima, tudo abaixo sobe uma casa
            const from = dragFrom;
            clearMarks();
            dragFrom = null;
            if (to !== from) moveSong(from, to);
        });
        const finish = () => {
            clearMarks();
            dragFrom = null;
            if (renderAfterDrag) { renderAfterDrag = false; renderPlaylist(lastRoom.playlist, lastRoom.currentIndex); }
        };
        box.addEventListener('dragend', finish);
    })();

    /* ---------- Balão com o nome completo da música (mouse parado em cima) ---------- */
    const TIP_DELAY = 500;                      // ms com o mouse parado antes de aparecer
    let tipEl = null, tipTimer = null, tipTarget = null, tipX = 0, tipY = 0;
    const tipAt = () => { const el = document.elementFromPoint(tipX, tipY); return el ? el.closest('[data-tip]') : null; };
    function hideSongTip() { clearTimeout(tipTimer); tipTimer = null; tipTarget = null; if (tipEl) tipEl.classList.remove('show'); }
    function showSongTip(target) {
        if (!tipEl) { tipEl = document.createElement('div'); tipEl.className = 'song-tip'; tipEl.setAttribute('role', 'tooltip'); document.body.appendChild(tipEl); }
        tipTarget = target;
        tipEl.textContent = target.dataset.tip;
        const r = target.getBoundingClientRect(), margin = 8;
        tipEl.style.left = '0px'; tipEl.style.top = '0px';
        const w = tipEl.offsetWidth, h = tipEl.offsetHeight;
        let left = Math.min(Math.max(margin, r.left + 12), innerWidth - w - margin);
        let top = r.bottom + 6;
        if (top + h > innerHeight - margin) top = Math.max(margin, r.top - h - 6);   // sem espaço embaixo: vai por cima
        tipEl.style.left = left + 'px'; tipEl.style.top = top + 'px';
        tipEl.classList.add('show');
    }
    // a fila é redesenhada de tempos em tempos: confere se ainda há uma música sob o mouse
    function refreshSongTip() {
        if (!tipEl || !tipEl.classList.contains('show')) return;
        const t = tipAt();
        if (t && t.dataset.tip) showSongTip(t); else hideSongTip();
    }
    document.addEventListener('mousemove', (e) => { tipX = e.clientX; tipY = e.clientY; });
    document.addEventListener('mouseover', (e) => {
        const t = e.target.closest ? e.target.closest('[data-tip]') : null;
        if (t === tipTarget && t) return;
        hideSongTip();
        if (!t || !t.dataset.tip) return;
        tipX = e.clientX; tipY = e.clientY;
        tipTimer = setTimeout(() => { const now = tipAt(); if (now && now.dataset.tip) showSongTip(now); }, TIP_DELAY);
    });
    document.addEventListener('mouseout', (e) => {
        if (!tipTarget && !tipTimer) return;
        const to = e.relatedTarget;
        if (to && to.closest && to.closest('[data-tip]') === (tipTarget || e.target.closest('[data-tip]'))) return;   // só mudou de filho
        hideSongTip();
    });
    document.addEventListener('mousedown', hideSongTip);
    document.addEventListener('scroll', hideSongTip, true);
    document.addEventListener('keydown', hideSongTip);

    /* ============================================================
       CHAT
       ============================================================ */
    window.sendChatMessage = async function (e) {
        e.preventDefault();
        const input = $('chat-input');
        const text = input.value.trim();
        if (!text || !currentRoomId) return;
        const nowTs = Date.now();
        if (nowTs - lastChatAt < 600) return showNotification('ÉGUA, mano. te acalma! bicho agoniado', 'error');
        lastChatAt = nowTs;
        const msg = { id: Math.random().toString(16).slice(2, 12), user: clientUsername, text, time: Date.now(), color: myColor };
        if (replyingTo) msg.replyTo = { id: replyingTo.id, user: replyingTo.user, text: replyingTo.text };
        input.value = '';
        cancelReply();
        try { await store.addChat(currentRoomId, msg); }
        catch (err) { console.error(err); showNotification('Erro ao enviar mensagem', 'error'); }
    };

    /* ---------- Responder mensagem ---------- */
    function startReply(id) {
        const m = chatView.find(x => x.id === id && !x.system);
        if (!m) return;
        replyingTo = { id: m.id, user: m.user, text: clip(m.text, 120) };
        $('reply-preview-user').textContent = m.user;
        $('reply-preview-text').textContent = replyingTo.text;
        $('reply-preview').classList.remove('hidden'); $('reply-preview').classList.add('flex');
        $('chat-input').focus();
    }
    window.cancelReply = function () {
        replyingTo = null;
        $('reply-preview').classList.add('hidden'); $('reply-preview').classList.remove('flex');
    };
    function scrollToMsg(id) {
        const el = [...$('chat-messages').children].find(x => x.dataset && x.dataset.mid === id);
        if (!el) return showNotification('Essa mensagem não está mais no chat.', 'info');
        el.scrollIntoView({ block: 'center', behavior: 'smooth' });
        el.classList.remove('msg-flash'); void el.offsetWidth; el.classList.add('msg-flash');
    }
    $('chat-messages').addEventListener('click', (e) => {
        const r = e.target.closest('[data-reply]'); if (r) return startReply(r.dataset.reply);
        const q = e.target.closest('[data-goto]'); if (q) scrollToMsg(q.dataset.goto);
    });
    $('chat-input').addEventListener('keydown', (e) => { if (e.key === 'Escape' && replyingTo) cancelReply(); });
    $('members-list').addEventListener('click', (e) => {
        const pr = e.target.closest('[data-promote]'); if (pr) return promoteUser(pr.dataset.promote, pr.dataset.name);
        const b = e.target.closest('[data-kick]'); if (b) kickUser(b.dataset.kick, b.dataset.name);
    });

    let seenMsgs = new Set(), chatSoundArmed = false;
    function renderChat(list) {
        const c = $('chat-messages');
        // sem histórico: no P2P o chat já começa vazio; nos outros modos escondemos o que veio antes de eu entrar
        const msgs = (Array.isArray(list) ? list : []).map(cleanMsg).filter(Boolean)
            .filter(m => store.mode === 'p2p' || m.time >= joinedAt);
        chatView = msgs;
        // som só para mensagens novas de outras pessoas (a 1ª renderização apenas registra o que já existe)
        let fresh = false;
        msgs.forEach(m => { if (m.id && !seenMsgs.has(m.id)) { seenMsgs.add(m.id); if (!m.system && m.user !== clientUsername) fresh = true; } });
        if (seenMsgs.size > 600) seenMsgs = new Set(msgs.map(m => m.id));
        if (chatSoundArmed && fresh) sfx.chat();
        chatSoundArmed = true;
        let html = '<div class="text-center text-xs text-[#6B7566] my-2">Conexão estabelecida</div>';
        // estilo WhatsApp: mensagens seguidas da mesma pessoa formam um grupo (nome só na 1ª, balões coladinhos)
        const sameGroup = (a, b) => !!a && !!b && !a.system && !b.system && a.user === b.user;
        msgs.forEach((m, i) => {
            if (m.system) {
                html += `<div data-mid="${esc(m.id)}" class="text-center text-xs text-[#8E9A88] my-1 py-1.5 px-3 bg-white/5 rounded-lg"><i class="fa-solid fa-circle-info mr-1.5 text-nblue"></i>${esc(m.text)}</div>`;
                return;
            }
            const me = m.user === clientUsername;
            const col = userColors.get(m.user) || m.color || nameColor(m.user);
            const first = !sameGroup(msgs[i - 1], m), more = sameGroup(m, msgs[i + 1]);
            let quote = '';
            if (m.replyTo) {
                const qc = userColors.get(m.replyTo.user) || nameColor(m.replyTo.user);
                quote = `<div class="reply-quote" data-goto="${esc(m.replyTo.id)}" style="border-color:${qc}"><div class="font-semibold truncate" style="color:${qc}">${esc(m.replyTo.user)}</div><div class="truncate text-[#C3CBBE]">${esc(m.replyTo.text)}</div></div>`;
            }
            const head = first
                ? `<span class="flex items-center gap-2 mb-1 ${me ? 'flex-row-reverse' : ''}">${avBubble(m.user, 'chat-avatar', col)}<span class="text-xs font-mono font-semibold" style="color:${col};text-shadow:0 0 8px ${col}aa">${esc(m.user)}</span></span>`
                : '';
            const corner = first ? (me ? 'rounded-tr-sm' : 'rounded-tl-sm') : '';   // só o 1º balão do grupo tem a "pontinha"
            html += `
            <div class="msg flex flex-col ${me ? 'items-end' : 'items-start'} w-full ${more ? 'mb-0.5' : 'mb-3'}" data-mid="${esc(m.id)}">
                ${head}
                <div class="flex items-end gap-1 max-w-[92%] ${me ? 'flex-row-reverse' : ''}">
                    <div class="px-4 py-2 rounded-2xl min-w-0 text-sm break-words text-white ${corner}" style="background:${col}1F;border:1px solid ${col}88;box-shadow:0 0 12px ${col}26">
                        ${quote}${esc(m.text)}
                    </div>
                    ${m.id ? `<button type="button" class="reply-btn" data-reply="${esc(m.id)}" title="Responder" aria-label="Responder ${esc(m.user)}"><i class="fa-solid fa-reply"></i></button>` : ''}
                </div>
            </div>`;
        });
        c.innerHTML = html;
        c.scrollTop = c.scrollHeight;
    }

    /* ============================================================
       CONTA (Supabase Auth)
       - O Supabase exige e-mail, então o nome de usuário vira um e-mail interno
         (hash do nome @syncwave.app). O nome de verdade fica no perfil.
       - No painel do Supabase, desligue "Confirm email" (Authentication > Sign In / Providers > Email).
       ============================================================ */
    const NAME_RE = /^[\p{L}\p{N}_.\-]{3,20}$/u;
    async function authEmail(name) {
        const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(name).trim().toLowerCase()));
        return 'u' + Array.from(new Uint8Array(d), x => x.toString(16).padStart(2, '0')).join('').slice(0, 32) + '@syncwave.app';
    }
    const CONFIRM_MSG = 'O Supabase está exigindo confirmação por e-mail. No painel, desligue “Confirm email” em Authentication > Sign In / Providers > Email.';
    function authErrorText(err) {
        const code = String((err && err.code) || ''), msg = String((err && err.message) || '');
        if (code === 'user_already_exists' || /already (registered|been registered)/i.test(msg)) return 'Esse nome já está em uso. Escolha outro.';
        if (code === 'email_not_confirmed' || /not confirmed/i.test(msg)) return CONFIRM_MSG;
        if (code === 'weak_password') return 'Senha fraca demais. Use uma senha mais longa.';
        if (code === 'signup_disabled') return 'Criar contas está desativado no Supabase.';
        if (/rate.?limit/i.test(code) || (err && err.status === 429)) return 'Muitas tentativas. Espere um pouco e tente de novo.';
        if (/email_address_invalid|validation_failed/.test(code)) return 'O Supabase recusou o cadastro (e-mail interno inválido). Confira as configurações de Auth.';
        if (/Database error/i.test(msg)) return 'Esse nome já está em uso ou não é válido. Tente outro.';
        return '';
    }

    let authMode = 'login', authFails = [], authBusy = false;
    const setAuthError = (msg) => {
        $('auth-error-text').textContent = msg || '';
        $('auth-error').classList.toggle('hidden', !msg); $('auth-error').classList.toggle('flex', !!msg);
    };
    window.setAuthMode = function (mode) {
        authMode = mode === 'register' ? 'register' : 'login';
        const reg = authMode === 'register';
        $('tab-login').setAttribute('aria-selected', String(!reg));
        $('tab-register').setAttribute('aria-selected', String(reg));
        $('auth-pass2-wrap').classList.toggle('hidden', !reg);
        $('auth-pass').autocomplete = reg ? 'new-password' : 'current-password';
        $('auth-title').textContent = reg ? 'Criar sua conta' : 'Entrar na sua conta';
        $('auth-submit').textContent = reg ? 'Criar conta' : 'Entrar';
        setAuthError('');
    };

    function showLoggedIn() {
        $('auth-view').classList.add('hidden');
        $('setup-view').classList.remove('hidden');
        $('user-chip').classList.remove('hidden'); $('user-chip').classList.add('flex');
        $('user-chip-name').textContent = currentUser;
        $('setup-user').textContent = currentUser;
    }
    function loginAs(user, fallbackName) {
        currentUser = (user && user.user_metadata && user.user_metadata.username) || fallbackName;
        store.uid = user.id;
        $('auth-pass').value = ''; $('auth-pass2').value = ''; setAuthError('');
        showLoggedIn();
        loadMyAvatar();
        if (pendingRoom) { const id = pendingRoom; pendingRoom = null; setTimeout(() => pickRoom(id), 60); }   // clicou numa sala antes de entrar
    }

    window.submitAuth = async function (e) {
        e.preventDefault();
        if (authBusy) return;
        const name = $('auth-name').value.trim(), pass = $('auth-pass').value;
        setAuthError('');
        if (!(window.crypto && crypto.subtle)) return setAuthError('Seu navegador não suporta criptografia aqui. Abra o site por HTTPS.');
        if (!NAME_RE.test(name)) return setAuthError('O nome precisa ter de 3 a 20 caracteres: letras, números, _ . ou -');
        if (pass.length < 6) return setAuthError('A senha precisa ter pelo menos 6 caracteres.');
        authBusy = true; $('auth-submit').disabled = true;
        try {
            await storeReady;
            if (store.mode !== 'supabase') return setAuthError('Não consegui falar com o servidor. Confira a configuração do Supabase e recarregue a página.');
            const sb = store.sb, email = await authEmail(name);
            if (authMode === 'register') {
                if (pass !== $('auth-pass2').value) return setAuthError('As senhas não conferem.');
                const { data: free, error: freeErr } = await sb.rpc('username_available', { p_name: name });
                if (!freeErr && free === false) return setAuthError('Esse nome já está em uso. Escolha outro.');
                const { data, error } = await sb.auth.signUp({ email, password: pass, options: { data: { username: name } } });
                if (error) { console.error(error); return setAuthError(authErrorText(error) || 'Não consegui criar a conta. Tente de novo.'); }
                if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) return setAuthError('Esse nome já está em uso. Escolha outro.');
                let session = data.session;
                if (!session) {
                    const r = await sb.auth.signInWithPassword({ email, password: pass });
                    if (r.error) { console.error(r.error); return setAuthError(authErrorText(r.error) || CONFIRM_MSG); }
                    session = r.data.session;
                }
                loginAs(session.user, name);
            } else {
                authFails = authFails.filter(t => Date.now() - t < 60000);
                if (authFails.length >= 5) return setAuthError('Muitas tentativas erradas. Espere 1 minuto.');
                const { data, error } = await sb.auth.signInWithPassword({ email, password: pass });
                if (error) {
                    console.error(error);
                    const t = authErrorText(error);
                    if (t) return setAuthError(t);
                    authFails.push(Date.now());
                    return setAuthError('Nome ou senha incorretos.');
                }
                loginAs(data.user, name);
            }
        } catch (err) {
            console.error(err); setAuthError('Algo deu errado. Tente de novo.');
        } finally { authBusy = false; $('auth-submit').disabled = false; }
    };

    function resetToLogin(expired) {
        if (currentRoomId) { try { leaveRoomUI(); } catch (e) {} }
        currentUser = null; pendingRoom = null; store.uid = null;
        myAvatar = null; paintChipAvatar();
        $('setup-view').classList.add('hidden');
        $('user-chip').classList.add('hidden'); $('user-chip').classList.remove('flex');
        $('auth-view').classList.remove('hidden');
        $('auth-name').value = ''; $('auth-pass').value = '';
        setAuthMode('login');
        if (expired) showNotification('Sua sessão terminou. Entre de novo.', 'info');
    }
    window.logout = async function () {
        if (currentRoomId) {
            if (!(await confirmHostLeave())) return;
            leaveRoomUI();
        }
        const sb = store.sb;
        resetToLogin(false);
        if (sb) sb.auth.signOut().catch(e => console.error(e));
    };

    // mantém a sessão ao recarregar a página (o Supabase guarda a sessão no navegador)
    (async function initAuth() {
        await storeReady;
        if (store.mode !== 'supabase') return;
        try {
            const { data } = await store.sb.auth.getSession();
            const u = data && data.session && data.session.user;
            if (!u) return;
            let name = u.user_metadata && u.user_metadata.username;
            if (!name) {
                const r = await store.sb.from('profiles').select('username').eq('id', u.id).maybeSingle();
                name = r.data && r.data.username;
            }
            if (name) loginAs({ ...u, user_metadata: { ...(u.user_metadata || {}), username: name } }, name);
        } catch (e) { console.error(e); }
    })();
})();

