/* ============================================================
   RimkRadio — REAÇÕES NA SALA (foguete, tomate, fogo, vaia, palmas)
   - Botão "carinha" nos controles do player (e na aba da tela cheia) abre o menu de reações.
   - O efeito aparece por cima do vídeo para TODOS da sala (broadcast "emote" do Supabase)
     e o som é sintetizado com Web Audio (mesmo motor de sons do site, sem arquivos de áudio).
   - Visual: SVGs próprios + os mascotes do site (Rimk / Zunk), animados com Web Animations API.
   - Respeita "prefers-reduced-motion" (só um ícone que aparece e some) e o botão de mute do site.
   - Estilos: emotes.css.   Integração com a sala: script.js (procure por RimkEmotes).
   ============================================================ */
(function () {
    'use strict';

    var KINDS = {
        rocket: { label: 'Foguete', say: 'lançou um foguete' },
        tomato: { label: 'Tomate', say: 'jogou um tomate' },
        fire:   { label: 'Fogo',   say: 'botou fogo' },
        boo:    { label: 'Vaia',   say: 'vaiou' },
        clap:   { label: 'Palmas', say: 'aplaudiu' }
    };
    var ORDER = ['rocket', 'tomato', 'fire', 'boo', 'clap'];
    var MAX_ACTIVE = 12;       // efeitos ao mesmo tempo (o resto é ignorado, protege contra spam)
    var COOLDOWN = 600;        // ms entre duas reações enviadas por mim
    var PER_USER = 350;        // ms mínimos entre reações recebidas da mesma pessoa

    var cfg = { send: null, sound: null, user: null };
    var box = null, fx = null, feed = null, pop = null, openBtn = null;
    var active = 0, lastSent = 0, lastFrom = {};
    var reduce = false;
    try { reduce = !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches); } catch (e) {}

    /* ---------- utilitários ---------- */
    function rnd(a, b) { return a + Math.random() * (b - a); }
    function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
    function el(tag, cls, html) { var e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }
    function anim(node, frames, opts) {
        try { return node.animate(frames, Object.assign({ fill: 'forwards', easing: 'ease-out' }, opts)); } catch (e) { return null; }
    }
    function px(n) { return n.toFixed(1) + 'px'; }

    /* ---------- peças em SVG (sem gradientes com id: várias cópias na tela convivem bem) ---------- */
    var ROCKET_SVG =
        '<svg viewBox="0 0 48 100" aria-hidden="true" focusable="false">' +
        '<g class="em-fl"><path d="M15 76C17 96 22 106 24 112C26 106 31 96 33 76Z" fill="#FF8A1F"/><path d="M19 76C20 90 23 98 24 102C25 98 28 90 29 76Z" fill="#FFF2A8"/></g>' +
        '<path d="M13 56L1 84L16 76Z" fill="#7DD800"/><path d="M35 56L47 84L32 76Z" fill="#7DD800"/>' +
        '<path d="M24 1C37 14 39 42 36 76H12C9 42 11 14 24 1Z" fill="#E8E8E3"/>' +
        '<path d="M24 1C37 14 39 42 36 76H28C31 44 30 16 24 1Z" fill="#C3CBBE"/>' +
        '<rect x="12.6" y="58" width="22.8" height="6" fill="#99FF00"/>' +
        '<circle cx="24" cy="33" r="8.6" fill="#050605" stroke="#99FF00" stroke-width="2.6"/>' +
        '<ellipse cx="24" cy="34.5" rx="5.3" ry="6" fill="#99FF00"/>' +
        '<ellipse cx="21.6" cy="33.5" rx="1.5" ry="2.1" fill="#050605" transform="rotate(-18 21.6 33.5)"/>' +
        '<ellipse cx="26.4" cy="33.5" rx="1.5" ry="2.1" fill="#050605" transform="rotate(18 26.4 33.5)"/>' +
        '<rect x="16" y="76" width="16" height="5" rx="1.5" fill="#46540F"/></svg>';

    var TOMATO_SVG =
        '<svg viewBox="0 0 64 64" aria-hidden="true" focusable="false">' +
        '<ellipse cx="32" cy="37" rx="27" ry="24" fill="#E5322D"/>' +
        '<path d="M6 41Q32 68 58 41Q52 61 32 61Q12 61 6 41Z" fill="#9E1B1B" opacity=".55"/>' +
        '<ellipse cx="21" cy="27" rx="9" ry="5" fill="#FF8478" opacity=".75" transform="rotate(-28 21 27)"/>' +
        '<path d="M32 19L36 26L44 22L40 29L48 33L39 33L32 40L25 33L16 33L24 29L20 22L28 26Z" fill="#4CB100"/>' +
        '<rect x="30" y="8" width="4" height="12" rx="2" fill="#3A8A00"/></svg>';

    var FLAME_SVG =
        '<svg viewBox="0 0 100 120" aria-hidden="true" focusable="false" preserveAspectRatio="none">' +
        '<path d="M50 2C55 22 82 38 86 70C90 100 70 118 50 118C30 118 10 100 14 70C17 52 28 44 34 28C38 40 44 36 50 2Z" fill="#FF3B14"/>' +
        '<path d="M50 32C54 48 72 58 74 80C76 100 64 116 50 116C36 116 24 100 26 80C28 66 38 60 42 48C45 56 48 50 50 32Z" fill="#FF9A1F"/>' +
        '<path d="M50 66C53 76 62 82 62 94C62 106 56 114 50 114C44 114 38 106 38 94C38 84 46 80 50 66Z" fill="#FFF0A0"/></svg>';

    // mancha de tomate: contorno irregular novo a cada arremesso + sementes e pingos escorrendo
    function splatSVG() {
        var n = 18, cx = 100, cy = 100, p = [], i, a, r;
        for (i = 0; i < n; i++) {
            a = (i / n) * Math.PI * 2 + rnd(-.08, .08);
            r = (i % 2) ? rnd(36, 58) : rnd(66, 94);
            p.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
        }
        var mid = function (u, v) { return ((u[0] + v[0]) / 2).toFixed(1) + ' ' + ((u[1] + v[1]) / 2).toFixed(1); };
        var d = 'M' + mid(p[n - 1], p[0]);
        for (i = 0; i < n; i++) d += 'Q' + p[i][0].toFixed(1) + ' ' + p[i][1].toFixed(1) + ' ' + mid(p[i], p[(i + 1) % n]);
        d += 'Z';
        var s = '<svg viewBox="0 0 200 280" aria-hidden="true" focusable="false" overflow="visible">';
        // pingos que escorrem (animados depois)
        [[-34, 52], [8, 64], [42, 48]].forEach(function (o) {
            var w = rnd(8, 13), len = rnd(46, 92);
            s += '<rect class="em-drip" x="' + (cx + o[0] - w / 2).toFixed(1) + '" y="' + (cy + o[1] - 8) + '" width="' + w.toFixed(1) + '" height="' + len.toFixed(1) + '" rx="' + (w / 2).toFixed(1) + '" fill="#D62828"/>' +
                '<circle class="em-drip" cx="' + (cx + o[0]).toFixed(1) + '" cy="' + (cy + o[1] + len - 10).toFixed(1) + '" r="' + (w * .8).toFixed(1) + '" fill="#D62828"/>';
        });
        s += '<path d="' + d + '" fill="#D62828"/>';
        s += '<path d="' + d + '" fill="#FF5A4F" opacity=".4" transform="translate(-8 -8) scale(.82) translate(22 22)"/>';
        for (i = 0; i < 6; i++) {
            a = rnd(0, Math.PI * 2); r = rnd(8, 55);
            s += '<ellipse cx="' + (cx + Math.cos(a) * r).toFixed(1) + '" cy="' + (cy + Math.sin(a) * r).toFixed(1) + '" rx="4.5" ry="2.6" fill="#FFD36B" transform="rotate(' + Math.round(rnd(0, 180)) + ' ' + (cx + Math.cos(a) * r).toFixed(1) + ' ' + (cy + Math.sin(a) * r).toFixed(1) + ')"/>';
        }
        for (i = 0; i < 7; i++) {
            a = rnd(0, Math.PI * 2); r = rnd(100, 128);
            s += '<circle cx="' + (cx + Math.cos(a) * r).toFixed(1) + '" cy="' + (cy + Math.sin(a) * r).toFixed(1) + '" r="' + rnd(3, 8).toFixed(1) + '" fill="#D62828"/>';
        }
        return s + '</svg>';
    }

    var ICONS = {
        rocket: ROCKET_SVG,
        tomato: TOMATO_SVG,
        fire: FLAME_SVG,
        boo: '<img src="zunk-dislike.png" alt="" draggable="false">',
        clap: '<img src="rimk-like.png" alt="" draggable="false">'
    };

    /* ============================================================
       SONS — sintetizados (Web Audio) com as ferramentas do sfx (script.js: sfx.raw)
       h = { tone, hiss, bell, master, echo }
       ============================================================ */
    var SND = {
        // decolagem: ignição + rumor que sobe + "voz" alienígena, estoura em faíscas no fim (1,3 s)
        rocket: function (c, h) {
            var t = c.currentTime + 0.02, lp = c.createBiquadFilter();
            lp.type = 'lowpass'; lp.frequency.setValueAtTime(500, t); lp.frequency.exponentialRampToValueAtTime(2600, t + 1.25); lp.connect(h.master);
            h.hiss(c, { t: t, dur: 1.45, peak: 0.11, f0: 280, f1: 2300, Q: 0.7, type: 'lowpass', attack: 0.18, wet: 0.2 });
            h.tone(c, { type: 'sawtooth', f0: 62, f1: 440, t: t, dur: 1.3, peak: 0.05, attack: 0.12, dest: lp });
            h.tone(c, { type: 'square', f0: 90, f1: 330, t: t, dur: 1.3, peak: 0.02, attack: 0.12, dest: lp });
            h.tone(c, { type: 'sine', f0: 440, f1: 1760, t: t + 0.02, dur: 0.16, peak: 0.05, attack: 0.01, wet: 0.5 });
            var tb = t + 1.28;
            h.hiss(c, { t: tb, dur: 0.3, peak: 0.09, f0: 5200, f1: 1400, Q: 0.6, type: 'bandpass', attack: 0.004, wet: 0.5 });
            [1568, 2093, 2637, 3136, 2349].forEach(function (f, i) { h.bell(c, { f: f, t: tb + 0.02 + i * 0.055, peak: 0.035, dur: 0.5, wet: 0.6 }); });
        },
        // tomate: "fuuush" do arremesso, impacto úmido (splat) + pingos
        tomato: function (c, h) {
            var t = c.currentTime + 0.02, ti = t + 0.56;
            h.hiss(c, { t: t, dur: 0.5, peak: 0.07, f0: 450, f1: 1900, Q: 1.1, type: 'bandpass', attack: 0.2 });
            h.hiss(c, { t: ti, dur: 0.24, peak: 0.2, f0: 2200, f1: 260, Q: 0.7, type: 'lowpass', attack: 0.004, wet: 0.1 });
            h.tone(c, { type: 'sine', f0: 190, f1: 52, t: ti, dur: 0.22, peak: 0.16, attack: 0.004 });
            var lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 800; lp.connect(h.master);
            var sq = h.tone(c, { type: 'sawtooth', f0: 280, f1: 80, t: ti + 0.01, dur: 0.26, peak: 0.06, attack: 0.006, dest: lp });
            var lfo = c.createOscillator(), lg = c.createGain();
            lfo.frequency.value = 38; lg.gain.value = 45; lfo.connect(lg); lg.connect(sq.frequency); lfo.start(ti); lfo.stop(ti + 0.3);
            [0.22, 0.31, 0.43].forEach(function (d, i) {
                h.tone(c, { type: 'sine', f0: 420 + i * 90, f1: 900 + i * 120, t: ti + d, dur: 0.07, peak: 0.035, attack: 0.004 });
            });
        },
        // fogo: "vuuum" de chama acendendo + rumor grave + estalinhos aleatórios (2,6 s)
        fire: function (c, h) {
            var t = c.currentTime + 0.02, i;
            h.hiss(c, { t: t, dur: 0.9, peak: 0.2, f0: 220, f1: 2800, Q: 0.6, type: 'lowpass', attack: 0.3, wet: 0.15 });
            h.hiss(c, { t: t + 0.15, dur: 2.5, peak: 0.1, f0: 160, f1: 240, Q: 0.5, type: 'lowpass', attack: 0.5 });
            h.tone(c, { type: 'sawtooth', f0: 55, f1: 80, t: t, dur: 1.4, peak: 0.035, attack: 0.3 });
            for (i = 0; i < 24; i++) {
                h.hiss(c, { t: t + 0.25 + rnd(0, 2.2), dur: rnd(0.02, 0.06), peak: rnd(0.05, 0.13), f0: rnd(2200, 6500), Q: 2, type: 'bandpass', attack: 0.002 });
            }
        },
        // vaia: coro de "buuuu" (4 vozes graves com formante de "u", descendo) + "wuomp" no fim
        boo: function (c, h) {
            var t = c.currentTime + 0.02;
            [112, 124, 98, 139].forEach(function (f, i) {
                var s = t + i * 0.05, dur = 1.55 - i * 0.05;
                var o = c.createOscillator(); o.type = 'sawtooth';
                o.frequency.setValueAtTime(f, s);
                o.frequency.linearRampToValueAtTime(f * 1.05, s + 0.25);
                o.frequency.exponentialRampToValueAtTime(f * 0.76, s + dur);
                var lfo = c.createOscillator(), lg = c.createGain();
                lfo.frequency.value = 5 + i * 0.4; lg.gain.value = 2.4; lfo.connect(lg); lg.connect(o.frequency);
                var g = c.createGain();
                g.gain.setValueAtTime(0.0001, s);
                g.gain.exponentialRampToValueAtTime(0.05, s + 0.28);
                g.gain.setValueAtTime(0.05, s + dur * 0.55);
                g.gain.exponentialRampToValueAtTime(0.0001, s + dur);
                var f1 = c.createBiquadFilter(), f2 = c.createBiquadFilter(), g2 = c.createGain();
                f1.type = f2.type = 'bandpass'; f1.frequency.value = 320; f1.Q.value = 5; f2.frequency.value = 820; f2.Q.value = 7; g2.gain.value = 0.55;
                o.connect(f1); o.connect(f2); f2.connect(g2);
                f1.connect(g); g2.connect(g); g.connect(h.master);
                if (h.echo) { var w = c.createGain(); w.gain.value = 0.35; g.connect(w); w.connect(h.echo); }
                o.start(s); o.stop(s + dur + 0.05); lfo.start(s); lfo.stop(s + dur + 0.05);
            });
            h.hiss(c, { t: t, dur: 1.4, peak: 0.02, f0: 700, f1: 400, Q: 1, type: 'bandpass', attack: 0.3 });
            h.tone(c, { type: 'sine', f0: 120, f1: 52, t: t + 0.95, dur: 0.55, peak: 0.07, attack: 0.02 });
        },
        // palmas: muitas palminhas de ruído, mais densas no meio (1,5 s)
        clap: function (c, h) {
            var t = c.currentTime + 0.02, i, x, env;
            for (i = 0; i < 34; i++) {
                x = rnd(0, 1.4); env = Math.sin(Math.PI * Math.min(1, x / 1.4)) * 0.8 + 0.2;
                h.hiss(c, { t: t + x, dur: rnd(0.035, 0.07), peak: 0.12 * env, f0: rnd(1400, 3200), Q: 1.4, type: 'bandpass', attack: 0.002, wet: 0.25 });
            }
        }
    };

    /* ============================================================
       EFEITOS VISUAIS — cada um recebe a "camada" (div) e o tamanho do palco e devolve a duração (ms)
       ============================================================ */
    function sparks(layer, x, y, n, colors, o) {
        o = o || {};
        n = reduce ? 0 : n;
        for (var i = 0; i < n; i++) {
            var d = el('i', 'em-p'), sz = rnd(o.sMin || 3, o.sMax || 7), a = rnd(o.a0 == null ? 0 : o.a0, o.a1 == null ? Math.PI * 2 : o.a1), dist = rnd(o.min || 30, o.max || 120), c = colors[i % colors.length];
            d.style.cssText = 'left:' + px(x) + ';top:' + px(y) + ';width:' + px(sz) + ';height:' + px(sz) + ';background:' + c + ';box-shadow:0 0 ' + px(sz * 2) + ' ' + c + ';';
            layer.appendChild(d);
            var dx = Math.cos(a) * dist, dy = Math.sin(a) * dist + (o.fall || 0);
            anim(d, [
                { transform: 'translate(-50%,-50%) translate(0,0) scale(1)', opacity: 1 },
                { transform: 'translate(-50%,-50%) translate(' + px(dx) + ',' + px(dy) + ') scale(.2)', opacity: 0 }
            ], { duration: rnd(500, 1000) * (o.slow || 1), easing: 'cubic-bezier(.1,.7,.3,1)' });
        }
    }

    // anel de choque: SVG (o site zera border-radius em tudo, então um círculo precisa ser desenhado)
    function ring(layer, x, y, size, color) {
        var r = el('div', 'em-ring', '<svg viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="50" r="46" fill="none" stroke="' + color + '" stroke-width="4"/></svg>');
        r.style.cssText = 'left:' + px(x) + ';top:' + px(y) + ';filter:drop-shadow(0 0 8px ' + color + ');';
        layer.appendChild(r);
        anim(r, [
            { transform: 'translate(-50%,-50%) scale(.1)', opacity: .95 },
            { transform: 'translate(-50%,-50%) scale(' + (size / 40).toFixed(2) + ')', opacity: 0 }
        ], { duration: 650 });
    }

    function shake(power) {
        if (reduce) return;
        var t = document.getElementById('youtube-player') || fx;
        if (!t) return;
        var k = power || 4;
        anim(t, [
            { transform: 'translate(0,0)' },
            { transform: 'translate(' + (-k) + 'px,' + (k * .7) + 'px)' },
            { transform: 'translate(' + k + 'px,' + (-k * .6) + 'px)' },
            { transform: 'translate(' + (-k * .6) + 'px,' + (-k * .4) + 'px)' },
            { transform: 'translate(0,0)' }
        ], { duration: 280, fill: 'none', easing: 'linear' });
    }

    // mascotes do site (Zunk = vaia, Rimk = palmas) subindo do rodapé
    function mascots(layer, W, H, src, n, hop) {
        var s = clamp(H * 0.24, 56, 118), i;
        for (i = 0; i < n; i++) {
            var m = el('div', 'em-mascot'), x = (i + .5) / n * W + rnd(-W * .04, W * .04), delay = i * 110 + rnd(0, 120), rot = rnd(-9, 9);
            m.innerHTML = '<img src="' + src + '" alt="" draggable="false">';
            m.style.cssText = 'left:' + px(x - s / 2) + ';top:' + px(H - s * .85) + ';width:' + px(s) + ';';
            layer.appendChild(m);
            anim(m, [
                { transform: 'translateY(' + px(s * 1.1) + ') scale(.6) rotate(0deg)', opacity: 0 },
                { transform: 'translateY(' + px(-s * .12) + ') scale(1.1) rotate(' + rot + 'deg)', opacity: 1, offset: .2 },
                { transform: 'translateY(0) scale(1) rotate(' + (-rot) + 'deg)', offset: .32 },
                { transform: 'translateY(' + px(hop ? -s * .22 : 0) + ') rotate(' + rot + 'deg)', offset: .48 },
                { transform: 'translateY(0) rotate(' + (-rot) + 'deg)', offset: .62 },
                { transform: 'translateY(' + px(hop ? -s * .18 : 0) + ') rotate(' + rot + 'deg)', offset: .76, opacity: 1 },
                { transform: 'translateY(' + px(s * 1.1) + ') scale(.8) rotate(0deg)', opacity: 0 }
            ], { duration: 2300, delay: delay, easing: 'ease-in-out' });
        }
    }

    var FX = {
        // sobe tremendo, solta fumaça e explode em faíscas verdes
        rocket: function (layer, W, H) {
            var w = clamp(H * 0.15, 34, 66), h = w * (100 / 48), x = rnd(W * .15, W * .85), yEnd = rnd(H * .2, H * .4), FLIGHT = 1300;
            var r = el('div', 'em-rocket', ROCKET_SVG);
            r.style.cssText = 'left:' + px(x - w / 2) + ';top:0;width:' + px(w) + ';height:' + px(h) + ';';
            layer.appendChild(r);
            var tilt = rnd(-9, 9);
            var a = anim(r, [
                { transform: 'translateY(' + px(H + 4) + ') rotate(0deg)' },
                { transform: 'translateY(' + px(H * .6) + ') rotate(' + tilt + 'deg)', offset: .35 },
                { transform: 'translateY(' + px(yEnd) + ') rotate(' + (-tilt * .6) + 'deg)' }
            ], { duration: FLIGHT, easing: 'cubic-bezier(.45,.05,.7,.9)' });
            var fr = fx.getBoundingClientRect(), puffs = null;
            if (!reduce) {
                puffs = setInterval(function () {
                    if (!r.isConnected) return;
                    var b = r.getBoundingClientRect(), p = el('i', 'em-puff'), sz = rnd(9, 18), warm = Math.random() < .35;
                    p.style.cssText = 'left:' + px(b.left - fr.left + b.width / 2 + rnd(-4, 4)) + ';top:' + px(b.bottom - fr.top - h * .12) + ';width:' + px(sz) + ';height:' + px(sz) + ';background:' + (warm ? 'rgba(153,255,0,.5)' : 'rgba(232,232,227,.45)') + ';';
                    layer.appendChild(p);
                    anim(p, [
                        { transform: 'translate(-50%,-50%) scale(.5)', opacity: .8 },
                        { transform: 'translate(-50%,-50%) translateY(' + px(rnd(18, 40)) + ') scale(2.4)', opacity: 0 }
                    ], { duration: rnd(500, 800) });
                }, 40);
            }
            setTimeout(function () {
                if (puffs) clearInterval(puffs);
                var b = r.getBoundingClientRect(), cx = b.left - fr.left + b.width / 2, cy = b.top - fr.top + b.height * .35;
                r.remove();
                ring(layer, cx, cy, clamp(H * .5, 120, 260), '#99FF00');
                sparks(layer, cx, cy, 30, ['#99FF00', '#E8E8E3', '#CCFF66', '#FFE27A'], { min: 40, max: clamp(H * .42, 80, 190), fall: 24, sMin: 4, sMax: 9, slow: 1.3 });
                sparks(layer, cx, cy, 10, ['#E8E8E3'], { min: 20, max: 80, sMin: 2, sMax: 4, slow: 1.6, fall: 40 });
            }, FLIGHT);
            return FLIGHT + 1300;
        },

        // voa girando em arco, espatifa no vídeo e a mancha escorre
        tomato: function (layer, W, H) {
            var s = clamp(H * 0.12, 32, 62), FLIGHT = 560;
            var sx = rnd(W * .1, W * .9), sy = H + s, tx = rnd(W * .22, W * .78), ty = rnd(H * .22, H * .58);
            var mx = (sx + tx) / 2, my = Math.min(sy, ty) - rnd(H * .1, H * .22);
            var t = el('div', 'em-tomato', TOMATO_SVG);
            t.style.cssText = 'left:0;top:0;width:' + px(s) + ';height:' + px(s) + ';';
            layer.appendChild(t);
            anim(t, [
                { transform: 'translate(' + px(sx - s / 2) + ',' + px(sy) + ') scale(.7) rotate(0deg)', offset: 0, easing: 'ease-out' },
                { transform: 'translate(' + px(mx - s / 2) + ',' + px(my) + ') scale(1) rotate(300deg)', offset: .45, easing: 'ease-in' },
                { transform: 'translate(' + px(tx - s / 2) + ',' + px(ty - s / 2) + ') scale(1.2) rotate(640deg)', offset: 1 }
            ], { duration: FLIGHT, easing: 'linear' });
            setTimeout(function () {
                t.remove();
                shake(clamp(H * .014, 3, 7));
                var big = clamp(Math.min(W, H) * (.34 + rnd(0, .1)), 90, 230);
                var sp = el('div', 'em-splat', splatSVG());
                sp.style.cssText = 'left:' + px(tx - big / 2) + ';top:' + px(ty - big / 2) + ';width:' + px(big) + ';height:' + px(big * 1.4) + ';transform:rotate(' + Math.round(rnd(-25, 25)) + 'deg);';
                layer.appendChild(sp);
                sparks(layer, tx, ty, 22, ['#D62828', '#E5322D', '#FF5A4F', '#FFD36B'], { min: 30, max: clamp(big * .9, 60, 190), fall: 50, sMin: 3, sMax: 9 });
                if (reduce) { anim(sp, [{ opacity: 0 }, { opacity: 1, offset: .15 }, { opacity: 1, offset: .8 }, { opacity: 0 }], { duration: 2400 }); return; }
                anim(sp, [
                    { opacity: 0, scale: '.3' },
                    { opacity: 1, scale: '1.12', offset: .12 },
                    { opacity: 1, scale: '1', offset: .22 },
                    { opacity: 1, scale: '1', offset: .85 },
                    { opacity: 0, scale: '1.02' }
                ], { duration: 3700, easing: 'ease-out' });
                [].forEach.call(sp.querySelectorAll('.em-drip'), function (d, i) {
                    d.style.transformBox = 'fill-box'; d.style.transformOrigin = '50% 0';
                    anim(d, [{ transform: 'scaleY(.05)' }, { transform: 'scaleY(1)' }], { duration: rnd(1500, 2600), delay: 350 + i * 130, easing: 'cubic-bezier(.3,.1,.5,1)' });
                });
            }, FLIGHT);
            return FLIGHT + 3800;
        },

        // parede de chamas no rodapé, brilho quente e brasas subindo
        fire: function (layer, W, H) {
            var glow = el('div', 'em-fireglow'), i;
            layer.appendChild(glow);
            anim(glow, [{ opacity: 0 }, { opacity: 1, offset: .18 }, { opacity: .85, offset: .7 }, { opacity: 0 }], { duration: 3100, easing: 'ease-in-out' });
            if (reduce) return 3200;
            var n = Math.max(6, Math.round(W / 75));
            for (i = 0; i < n; i++) {
                var w = (W / n) * rnd(1.25, 1.8), h = w * 1.2, x = (i + .5) / n * W + rnd(-12, 12), s = Math.min(rnd(.9, 1.7), (H * .5) / h);
                var f = el('div', 'em-flame', FLAME_SVG);
                f.style.cssText = 'left:' + px(x - w / 2) + ';width:' + px(w) + ';height:' + px(h) + ';';
                layer.appendChild(f);
                anim(f, [
                    { transform: 'scaleY(.05) scaleX(.6)', opacity: 0 },
                    { transform: 'scaleY(' + s.toFixed(2) + ') scaleX(1)', opacity: 1, offset: .22 },
                    { transform: 'scaleY(' + (s * .82).toFixed(2) + ') scaleX(1.06) skewX(5deg)', opacity: 1, offset: .44 },
                    { transform: 'scaleY(' + (s * 1.05).toFixed(2) + ') scaleX(.94) skewX(-5deg)', opacity: 1, offset: .66 },
                    { transform: 'scaleY(' + (s * .9).toFixed(2) + ') scaleX(1) skewX(3deg)', opacity: 1, offset: .82 },
                    { transform: 'scaleY(.12) scaleX(.5)', opacity: 0 }
                ], { duration: rnd(2300, 2900), delay: rnd(0, 350), easing: 'ease-in-out', fill: 'both' });
            }
            for (i = 0; i < 24; i++) {
                var e = el('i', 'em-ember'), ez = rnd(2.5, 6), ex = rnd(0, W);
                e.style.cssText = 'left:' + px(ex) + ';top:' + px(H - 6) + ';width:' + px(ez) + ';height:' + px(ez) + ';';
                layer.appendChild(e);
                anim(e, [
                    { transform: 'translate(0,0)', opacity: 0 },
                    { transform: 'translate(' + px(rnd(-18, 18)) + ',' + px(-H * .25) + ')', opacity: 1, offset: .25 },
                    { transform: 'translate(' + px(rnd(-45, 45)) + ',' + px(-rnd(H * .45, H * .9)) + ')', opacity: 0 }
                ], { duration: rnd(1300, 2300), delay: rnd(0, 1200), easing: 'ease-out' });
            }
            return 3600;
        },

        // "BUUUUU" ondulando + mascotes Zunk de polegar pra baixo + vinheta vermelha
        boo: function (layer, W, H) {
            var vig = el('div', 'em-redvig');
            layer.appendChild(vig);
            anim(vig, [{ opacity: 0 }, { opacity: 1, offset: .15 }, { opacity: .8, offset: .7 }, { opacity: 0 }], { duration: 2600, easing: 'ease-in-out' });
            var txt = el('div', 'em-boo'), word = 'BUUUUU', i;
            txt.style.fontSize = px(clamp(Math.min(H * .22, W * .13), 32, 110));
            for (i = 0; i < word.length; i++) txt.appendChild(el('span', '', word[i]));
            layer.appendChild(txt);
            anim(txt, [
                { opacity: 0, transform: 'translateX(-50%) scale(.4)' },
                { opacity: 1, transform: 'translateX(-50%) scale(1.12)', offset: .14 },
                { opacity: 1, transform: 'translateX(-50%) scale(1)', offset: .22 },
                { opacity: 1, transform: 'translateX(-50%) scale(1)', offset: .8 },
                { opacity: 0, transform: 'translateX(-50%) scale(.9) translateY(10px)' }
            ], { duration: 2700 });
            if (!reduce) [].forEach.call(txt.children, function (sp, k) {
                anim(sp, [
                    { transform: 'translateY(0) rotate(-4deg)' },
                    { transform: 'translateY(' + px(-H * .03) + ') rotate(4deg)' }
                ], { duration: 420, iterations: 6, direction: 'alternate', delay: k * 70, easing: 'ease-in-out', fill: 'both' });
            });
            if (!reduce) mascots(layer, W, H, 'zunk-dislike.png', clamp(Math.round(W / 220), 3, 5), false);
            return 2800;
        },

        // mascotes Rimk pulando + confete neon
        clap: function (layer, W, H) {
            if (!reduce) mascots(layer, W, H, 'rimk-like.png', clamp(Math.round(W / 220), 3, 5), true);
            else { var m = el('div', 'em-mascot'); m.innerHTML = '<img src="rimk-like.png" alt="" draggable="false">'; m.style.cssText = 'left:50%;bottom:8%;width:' + px(clamp(H * .24, 56, 118)) + ';margin-left:-' + px(clamp(H * .24, 56, 118) / 2) + ';'; layer.appendChild(m); anim(m, [{ opacity: 0 }, { opacity: 1, offset: .15 }, { opacity: 1, offset: .8 }, { opacity: 0 }], { duration: 1800 }); }
            if (!reduce) {
                var cols = ['#99FF00', '#E8E8E3', '#CCFF66', '#FFD84D'], i;
                for (i = 0; i < 42; i++) {
                    var c = el('i', 'em-conf'), x = rnd(W * .05, W * .95), up = rnd(H * .4, H * .9), w = rnd(5, 9);
                    c.style.cssText = 'left:' + px(x) + ';top:' + px(H) + ';width:' + px(w) + ';height:' + px(w * rnd(.45, 1)) + ';background:' + cols[i % cols.length] + ';';
                    layer.appendChild(c);
                    var dx = rnd(-60, 60), r = rnd(180, 720) * (Math.random() < .5 ? -1 : 1);
                    anim(c, [
                        { transform: 'translate(0,0) rotate(0deg)', opacity: 1 },
                        { transform: 'translate(' + px(dx) + ',' + px(-up) + ') rotate(' + (r * .5) + 'deg)', opacity: 1, offset: .45, easing: 'cubic-bezier(.3,0,.6,1)' },
                        { transform: 'translate(' + px(dx * 1.6) + ',' + px(24) + ') rotate(' + r + 'deg)', opacity: 0 }
                    ], { duration: rnd(1400, 2200), delay: rnd(0, 450), easing: 'cubic-bezier(.1,.7,.3,1)' });
                }
            }
            return 2800;
        }
    };

    /* ---------- aviso "Fulano jogou um tomate" (canto do vídeo) ---------- */
    function chip(kind, by) {
        if (!feed) return;
        var c = el('div', 'em-chip'), b = el('b', '', ''), n = el('span', 'em-chip-name', '');
        n.textContent = String(by || 'Alguém').slice(0, 24);
        b.textContent = ' ' + KINDS[kind].say;
        c.appendChild(el('span', 'em-chip-ico', ICONS[kind])); c.appendChild(n); c.appendChild(b);
        feed.appendChild(c);
        while (feed.children.length > 3) feed.firstChild.remove();
        anim(c, [{ opacity: 0, transform: 'translateX(-14px)' }, { opacity: 1, transform: 'none', offset: .1 }, { opacity: 1, offset: .85 }, { opacity: 0 }], { duration: 3000, easing: 'ease-out' });
        setTimeout(function () { c.remove(); }, 3050);
    }

    /* ============================================================
       API
       ============================================================ */
    function ensureStage() {
        if (fx && fx.isConnected) return true;
        box = document.querySelector('.video-box');
        if (!box) return false;
        fx = el('div', 'em-fx'); fx.setAttribute('aria-hidden', 'true');
        feed = el('div', 'em-feed'); fx.appendChild(feed);
        box.appendChild(fx);
        return true;
    }

    // mostra o efeito (e toca o som) — usada tanto para a minha reação quanto para a dos outros
    function play(kind, by) {
        if (!KINDS[kind] || !FX[kind] || !ensureStage()) return;
        if (document.hidden) return;
        if (active >= MAX_ACTIVE) return;
        var W = fx.clientWidth, H = fx.clientHeight;
        if (W < 80 || H < 80) return;          // palco escondido (sem vídeo / aba fechada)
        var layer = el('div', 'em-layer');
        fx.appendChild(layer); active++;
        var dur = 2500;
        try { dur = FX[kind](layer, W, H) || dur; } catch (e) { console.error(e); }
        setTimeout(function () { layer.remove(); active--; }, dur + 100);
        chip(kind, by);
        try { if (cfg.sound && SND[kind]) cfg.sound(SND[kind]); } catch (e) {}
    }

    // reação de outra pessoa da sala (chega pelo canal em tempo real)
    function receive(kind, by) {
        if (!KINDS[kind]) return;
        var now = Date.now(), k = String(by || '?');
        if (lastFrom[k] && now - lastFrom[k] < PER_USER) return;
        lastFrom[k] = now;
        play(kind, by);
    }

    // minha reação: toca aqui e manda para a sala
    function send(kind) {
        if (!KINDS[kind]) return false;
        var now = Date.now();
        if (now - lastSent < COOLDOWN) return false;
        lastSent = now;
        play(kind, (cfg.user && cfg.user()) || 'Você');
        try { if (cfg.send) cfg.send(kind); } catch (e) {}
        return true;
    }

    /* ---------- menu de reações ---------- */
    function buildPop() {
        if (pop) return;
        pop = el('div', 'em-pop');
        pop.setAttribute('role', 'group'); pop.setAttribute('aria-label', 'Reações da sala');
        ORDER.forEach(function (k) {
            var b = el('button', 'em-opt');
            b.type = 'button'; b.setAttribute('data-k', k); b.title = KINDS[k].label; b.setAttribute('aria-label', KINDS[k].label);
            b.innerHTML = '<span class="em-opt-ico">' + ICONS[k] + '</span><span class="em-opt-cap">' + KINDS[k].label + '</span>';
            b.addEventListener('click', function () {
                if (send(k)) { b.classList.remove('is-hit'); void b.offsetWidth; b.classList.add('is-hit'); }
            });
            pop.appendChild(b);
        });
        (box || document.body).appendChild(pop);
    }
    function closePop() {
        if (!pop) return;
        pop.classList.remove('is-open');
        if (openBtn) { openBtn.setAttribute('aria-expanded', 'false'); openBtn.classList.remove('is-on'); }
        openBtn = null;
    }
    function openPop(btn) {
        ensureStage(); buildPop();
        // o menu vive dentro do palco (assim aparece também na tela cheia)
        if (box && pop.parentNode !== box) box.appendChild(pop);
        var r = btn.getBoundingClientRect();
        pop.style.visibility = 'hidden'; pop.classList.add('is-open');
        var w = pop.offsetWidth, h = pop.offsetHeight;
        var left = clamp(r.left + r.width / 2 - w / 2, 8, Math.max(8, window.innerWidth - w - 8));
        var top = r.top - h - 8; if (top < 8) top = Math.min(window.innerHeight - h - 8, r.bottom + 8);
        pop.style.left = px(left); pop.style.top = px(top); pop.style.visibility = '';
        openBtn = btn; btn.setAttribute('aria-expanded', 'true'); btn.classList.add('is-on');
    }
    function toggle(btn) { if (pop && pop.classList.contains('is-open') && openBtn === btn) closePop(); else { closePop(); openPop(btn); } }

    function init(o) {
        if (o) cfg = { send: o.send || null, sound: o.sound || null, user: o.user || null };
        ensureStage();
        ['emote-btn', 'fs-emote-btn'].forEach(function (id) {
            var b = document.getElementById(id);
            if (!b || b.__em) return; b.__em = true;
            b.addEventListener('click', function (e) { e.stopPropagation(); toggle(b); });
        });
        document.addEventListener('pointerdown', function (e) {
            if (!pop || !pop.classList.contains('is-open')) return;
            if (pop.contains(e.target) || (openBtn && openBtn.contains(e.target))) return;
            closePop();
        }, true);
        document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && pop && pop.classList.contains('is-open')) { var b = openBtn; closePop(); if (b) b.focus(); } });
        window.addEventListener('resize', closePop);
    }

    window.RimkEmotes = { init: init, play: play, receive: receive, send: send, kinds: ORDER.slice() };
})();
