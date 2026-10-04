/* ============================================================
   RIMK FM: mini rádio das telas de login e "criar sala".
   Toca lives de música do YouTube sorteadas por gênero.

   COMO EDITAR AS LISTAS (GENRES, logo abaixo)
   - Cada item é o ID de um vídeo/live do YouTube: em
     youtube.com/watch?v=ABCDEFGHIJK o ID é ABCDEFGHIJK (11 caracteres).
   - Ou "ch:UC..." = "a live que esse canal estiver transmitindo agora".
     Esse formato continua funcionando mesmo quando o canal troca o ID da live.
   - Lives caem de vez em quando (direitos autorais, canal reinicia a transmissão).
     Não tem problema: se uma live não abrir, a rádio pula sozinha para a próxima
     da lista. Quanto mais itens por gênero, mais difícil ficar sem som.
   - Para criar um gênero novo, é só acrescentar uma linha aqui.
   ============================================================ */
(function () {
    'use strict';

    const GENRES = {
        lofi: {
            label: 'Lofi',
            items: [
                'ch:UCSJ4gkVC6NrvII8umztf0Ow',   // Lofi Girl: a live principal do canal
                'jfKfPfyJRdk',                    // Lofi Girl: beats to relax/study to
                'rUxyKA_-grg',                    // Lofi Girl: beats to sleep/chill to
                '5yx6BWlEVcY',                    // Chillhop Radio
                'ch:UCOxqgCwgOqC2lMqC5PYz_Dg',   // Chillhop Music: live do canal
                'F45VjqUG50g'                     // Coffee Shop Radio: lofi e jazzhop
            ]
        },
        synthwave: {
            label: 'Synthwave',
            items: [
                '4xDzrJKXOOY',                    // Lofi Girl: synthwave radio
                'FQBBDo9HuJw',                    // New Retro FM
                'qWmQB6ZI6Z4',                    // Night Drive Radio
                'ylW6bU_COFI',                    // Retro Future TV
                'edEtJ7pt0Gc'                     // 1985 Synthwave Rider FM
            ]
        },
        jazz: {
            label: 'Jazz',
            items: [
                'E2vONfzoyRI',                    // Lofi Girl: jazz lofi radio
                'HuFYqnbVbzY',                    // Lofi Girl: jazz lofi radio (live anterior)
                'fu0CVjECxaI',                    // Smooth Jazz & Relaxing R&B Radio
                'psEr3_r9Yqw',                    // Smooth Jazz Radio: cafe jazz
                'a0VEGKAVXzg',                    // Relaxing Acoustic Jazz Radio
                'XOdkLeg30Dw',                    // Morning Smooth Jazz Radio
                'cEyzOqjkY1M'                     // Smooth jazz guitar: city night
            ]
        },
        rock: {
            label: 'Rock',
            items: [
                'azMujFR8pOM',                    // 24/7 Classic Rock Radio
                'iemujlJ3q_c',                    // Classic Rock Radio (Classic Rock Revival)
                'CuroyKtk-fY',                    // RGN Rock/Metal Radio
                'VjJBTWuhQik',                    // Classic Rock Radio
                'KrExkKoN9y4'                     // Burning Station: rock & metal
            ]
        }
    };

    const WATCHDOG_MS = 12000;      // se a live não começar a tocar em 12s, pula para a próxima
    const PREF_KEY = 'rimk:radio';

    /* ---------- utilidades ---------- */
    const $ = (id) => document.getElementById(id);
    const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
    const VIDEO_RE = /^[A-Za-z0-9_-]{11}$/, CHANNEL_RE = /^UC[A-Za-z0-9_-]{22}$/;
    const validEntry = (e) => typeof e === 'string' && (VIDEO_RE.test(e) || (e.startsWith('ch:') && CHANNEL_RE.test(e.slice(3))));
    const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
    const safe = (fn, fb) => { try { return fn(); } catch (e) { return fb; } };

    if (!$('radio-card')) return;

    // só entradas válidas entram (o que estiver escrito errado na lista é ignorado)
    Object.keys(GENRES).forEach((g) => {
        const ok = GENRES[g].items.filter((e) => { const v = validEntry(e); if (!v) console.warn('[rádio] item inválido ignorado:', e); return v; });
        GENRES[g].items = ok;
        if (!ok.length) delete GENRES[g];
    });
    const genreKeys = Object.keys(GENRES);

    /* ---------- preferências (gênero e volume ficam salvos no navegador) ---------- */
    const prefs = { genre: 'random', volume: 60 };
    safe(() => {
        const j = JSON.parse(localStorage.getItem(PREF_KEY) || 'null');
        if (!j) return;
        if (j.genre === 'random' || has(GENRES, j.genre)) prefs.genre = j.genre;
        if (Number.isFinite(j.volume)) prefs.volume = Math.min(100, Math.max(0, Math.round(j.volume)));
    });
    const savePrefs = () => safe(() => localStorage.setItem(PREF_KEY, JSON.stringify(prefs)));

    /* ---------- estado ---------- */
    let active = false;          // a rádio deve estar tocando (telas de login / criar sala visíveis)
    let player = null;           // YT.Player atual
    let item = null;             // { e: entrada, g: gênero } que está carregada
    let queue = [];              // fila embaralhada
    let fails = 0;               // falhas seguidas (zera quando algo toca)
    let watchdog = null;
    let token = 0;               // invalida respostas de players antigos
    let soundOn = false;         // a pessoa ligou o som (vale até recarregar a página)
    let playing = false;
    let gateMode = null;         // 'sound' | 'idle' | 'blocked' | null
    let userPaused = false;
    let waitingApi = false;
    let seq = 0;

    /* ---------- fila ---------- */
    function buildQueue() {
        if (prefs.genre !== 'random' && has(GENRES, prefs.genre)) {
            return shuffle(GENRES[prefs.genre].items.slice()).map((e) => ({ e, g: prefs.genre }));
        }
        // aleatório: intercala os gêneros (lofi, jazz, rock...) para cada "outra rádio" variar o estilo
        const lists = shuffle(genreKeys.slice()).map((g) => shuffle(GENRES[g].items.slice()).map((e) => ({ e, g })));
        const out = [];
        while (lists.some((l) => l.length)) lists.forEach((l) => { if (l.length) out.push(l.shift()); });
        return out;
    }
    const nextItem = () => { if (!queue.length) queue = buildQueue(); return queue.shift() || null; };
    const failLimit = () => (prefs.genre !== 'random' && has(GENRES, prefs.genre)) ? Math.max(3, GENRES[prefs.genre].items.length) : 10;

    /* ---------- interface ---------- */
    function setNow(g, title, live) {
        $('radio-genre').textContent = (g && has(GENRES, g)) ? GENRES[g].label : 'Rádio';
        const t = $('radio-title');
        t.textContent = title || '';
        t.title = title || '';
        $('radio-live').hidden = !live;
    }
    function setMsg(text) {
        const m = $('radio-msg');
        m.textContent = text || '';
        m.hidden = !text;
    }
    function isMuted() { return player ? safe(() => player.isMuted(), true) : true; }

    function refreshUI() {
        const muted = isMuted();
        const pp = $('radio-toggle'), mu = $('radio-mute'), gate = $('radio-gate');
        pp.innerHTML = playing ? '<i class="fa-solid fa-pause"></i>' : '<i class="fa-solid fa-play" style="margin-left:2px"></i>';
        pp.setAttribute('aria-label', playing ? 'Pausar rádio' : 'Tocar rádio');
        pp.title = playing ? 'Pausar' : 'Tocar';
        const silent = muted || prefs.volume === 0;
        mu.innerHTML = '<i class="fa-solid ' + (silent ? 'fa-volume-xmark' : 'fa-volume-high') + '"></i>';
        mu.setAttribute('aria-pressed', String(silent));
        mu.setAttribute('aria-label', silent ? 'Ligar o som da rádio' : 'Silenciar a rádio');
        mu.title = silent ? 'Ligar o som' : 'Silenciar';
        $('radio-vol').value = String(prefs.volume);

        let mode = null;
        if (gateMode === 'idle') mode = 'idle';
        else if (gateMode === 'blocked') mode = 'blocked';
        else if (playing && muted) mode = 'sound';
        gateMode = mode;
        gate.hidden = !mode;
        gate.textContent = mode === 'sound' ? '🔊 ATIVAR SOM' : (mode === 'idle' || mode === 'blocked') ? '▶ TOCAR' : '';
        gate.setAttribute('aria-label', mode === 'sound' ? 'Ativar o som da rádio' : 'Tocar a rádio');
    }

    function refreshChips() {
        document.querySelectorAll('#radio-chips .radio-chip').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.genre === prefs.genre)));
    }

    function refreshNow() {
        if (!player || !item) return;
        const d = safe(() => player.getVideoData(), null) || {};
        const live = d.isLive === true || safe(() => player.getDuration(), -1) === 0;
        const title = d.title || (live ? 'Ao vivo' : '');
        setNow(item.g, title, live);
    }

    /* ---------- player ---------- */
    function destroyPlayer() {
        clearTimeout(watchdog);
        const p = player;
        player = null; playing = false;
        if (p) safe(() => p.destroy());
        const host = $('radio-frame');
        if (host) host.textContent = '';
    }

    function idle(message) {
        token++;
        destroyPlayer();
        gateMode = 'idle';
        setNow(item && item.g, 'Rádio parada', false);
        setMsg(message || '');
        refreshUI();
    }

    function fail(why) {
        clearTimeout(watchdog);
        if (!active) return;
        fails++;
        console.warn('[rádio] não abriu:', item && item.e, why);
        if (fails >= failLimit()) {
            return idle('Não consegui abrir nenhuma live agora. Toque em tocar para tentar de novo.');
        }
        setNow(item && item.g, 'Procurando outra rádio…', false);
        const t = token;
        setTimeout(() => { if (t === token && active) playNext(); }, 500);
    }

    function load(it) {
        const my = ++token;
        destroyPlayer();
        item = it;
        gateMode = null; userPaused = false;
        setMsg('');
        setNow(it.g, 'Sintonizando…', false);
        refreshUI();

        const q = new URLSearchParams({
            autoplay: '1', mute: '1', controls: '0', playsinline: '1', rel: '0',
            modestbranding: '1', iv_load_policy: '3', fs: '0', disablekb: '1', enablejsapi: '1'
        });
        if (/^https?:$/.test(location.protocol)) q.set('origin', location.origin);
        let src;
        if (it.e.startsWith('ch:')) { q.set('channel', it.e.slice(3)); src = 'https://www.youtube.com/embed/live_stream?' + q.toString(); }
        else src = 'https://www.youtube.com/embed/' + it.e + '?' + q.toString();

        const f = document.createElement('iframe');
        f.id = 'radio-iframe-' + (++seq);
        f.src = src;
        f.title = 'Rádio RimkRadio (YouTube)';
        f.allow = 'autoplay; encrypted-media; picture-in-picture';
        f.referrerPolicy = 'strict-origin-when-cross-origin';
        f.setAttribute('frameborder', '0');
        $('radio-frame').appendChild(f);

        const ok = (fn) => (e) => { if (my === token) fn(e); };
        player = new YT.Player(f, {
            events: {
                onReady: ok(() => {
                    safe(() => player.setVolume(prefs.volume));
                    if (soundOn) safe(() => player.unMute());
                    refreshUI();
                }),
                onStateChange: ok((e) => onState(e.data)),
                onError: ok((e) => fail('erro ' + e.data)),
                onAutoplayBlocked: ok(() => { clearTimeout(watchdog); gateMode = 'blocked'; setMsg(''); refreshUI(); })
            }
        });
        clearTimeout(watchdog);
        watchdog = setTimeout(() => { if (my === token) fail('sem resposta em ' + (WATCHDOG_MS / 1000) + 's'); }, WATCHDOG_MS);
    }

    function onState(s) {
        const S = YT.PlayerState;
        if (s === S.PLAYING) {
            clearTimeout(watchdog);
            fails = 0; playing = true; userPaused = false;
            if (gateMode === 'blocked') gateMode = null;
            refreshNow();
            refreshUI();
            setTimeout(refreshNow, 2500);   // o título às vezes demora um pouco para chegar
        } else if (s === S.PAUSED) {
            playing = false;
            refreshUI();
        } else if (s === S.ENDED) {
            playing = false;
            fail('a transmissão terminou');
        }
    }

    function playNext() {
        if (!active) return;
        const it = nextItem();
        if (!it) return idle('Nenhuma live configurada.');
        load(it);
    }

    function whenApiReady(cb) {
        if (window.YT && YT.Player) return cb();
        if (waitingApi) return;
        waitingApi = true;
        let n = 0;
        const t = setInterval(() => {
            if (window.YT && YT.Player) { clearInterval(t); waitingApi = false; cb(); }
            else if (++n > 100) { clearInterval(t); waitingApi = false; if (active) idle('Não consegui carregar o player do YouTube.'); }
        }, 300);
    }

    const saveData = () => !!(navigator.connection && navigator.connection.saveData);

    function start() {
        if (active) return;
        active = true;
        fails = 0;
        if (saveData()) { gateMode = 'idle'; setNow(null, 'Rádio parada', false); setMsg('Economia de dados ativada. Toque em tocar para ouvir.'); refreshUI(); return; }
        whenApiReady(() => { if (active && !player && gateMode !== 'idle') playNext(); });
    }

    function stop() {
        if (!active) return;
        active = false;
        token++;
        destroyPlayer();
        gateMode = null;
        setMsg('');
        refreshUI();
    }

    /* ---------- botões ---------- */
    function onGate() {
        if (gateMode === 'idle') {      // o clique é um gesto da pessoa: já pode tocar com som
            soundOn = true; fails = 0; gateMode = null; setMsg('');
            return whenApiReady(playNext);
        }
        if (!player) return;
        soundOn = true;
        safe(() => { player.unMute(); player.setVolume(prefs.volume || 60); });
        if (prefs.volume === 0) { prefs.volume = 60; savePrefs(); }
        if (gateMode === 'blocked') { gateMode = null; safe(() => player.playVideo()); }
        refreshUI();
    }

    function onToggle() {
        if (!player) { soundOn = true; fails = 0; gateMode = null; setMsg(''); return whenApiReady(playNext); }
        if (playing) { userPaused = true; safe(() => player.pauseVideo()); }
        else if (userPaused && item) { load(item); }          // volta ao "ao vivo" (não ao ponto onde pausou)
        else safe(() => player.playVideo());
    }

    function onMute() {
        if (!player) return;
        if (isMuted() || prefs.volume === 0) {
            if (prefs.volume === 0) { prefs.volume = 60; savePrefs(); }
            soundOn = true; safe(() => { player.unMute(); player.setVolume(prefs.volume); });
        } else { soundOn = false; safe(() => player.mute()); }
        refreshUI();
    }

    function onVolume(e) {
        const v = Math.min(100, Math.max(0, parseInt(e.target.value, 10) || 0));
        prefs.volume = v; savePrefs();
        if (!player) return refreshUI();
        safe(() => player.setVolume(v));
        if (v === 0) { soundOn = false; safe(() => player.mute()); }
        else { soundOn = true; safe(() => player.unMute()); }
        refreshUI();
    }

    function onNext() { if (!active) return; fails = 0; gateMode = null; setMsg(''); whenApiReady(playNext); }

    function setGenre(g) {
        if (g !== 'random' && !has(GENRES, g)) return;
        prefs.genre = g; savePrefs();
        queue = []; fails = 0;
        refreshChips();
        if (active) { gateMode = null; setMsg(''); whenApiReady(playNext); }
    }

    /* ---------- montagem ---------- */
    function buildChips() {
        const box = $('radio-chips');
        box.textContent = '';
        [['random', 'Aleatório']].concat(genreKeys.map((g) => [g, GENRES[g].label])).forEach(([key, label]) => {
            const b = document.createElement('button');
            b.type = 'button'; b.className = 'radio-chip'; b.dataset.genre = key; b.textContent = label;
            b.setAttribute('aria-pressed', 'false');
            b.addEventListener('click', () => setGenre(key));
            box.appendChild(b);
        });
        refreshChips();
    }

    buildChips();
    $('radio-gate').addEventListener('click', onGate);
    $('radio-toggle').addEventListener('click', onToggle);
    $('radio-mute').addEventListener('click', onMute);
    $('radio-vol').addEventListener('input', onVolume);
    $('radio-next').addEventListener('click', onNext);
    setNow(null, 'Sintonizando…', false);
    refreshUI();

    // Dentro de uma sala a rádio some e para (a música da sala é a que importa);
    // ao sair da sala ela volta. Observa a tela da sala em vez de depender do resto do código.
    const home = $('home-view'), room = $('room-view');
    function sync() {
        const inRoom = room && !room.classList.contains('hidden');
        if (home) home.classList.toggle('hidden', inRoom);
        const card = document.querySelector('.site-card');
        if (card) card.style.display = inRoom ? 'none' : '';
        if (inRoom) stop(); else start();
    }
    if (room) new MutationObserver(sync).observe(room, { attributes: true, attributeFilter: ['class'] });
    sync();

    window.RimkRadio = { start, stop, next: onNext, setGenre };
})();
