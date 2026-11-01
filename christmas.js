/* ============================================================
   RimkRadio — TEMA DE NATAL
   Natal com pegada alienígena: OVNIs de gorro, rena e boneco de neve alien, árvores com disco voador.
   Tudo da versão temática vive em christmas.css + este arquivo (+ sons em script.js).
   - Liga/desliga: botão 🎄 no cabeçalho (a escolha fica salva no navegador)
   - ?natal=off  /  ?natal=on  na URL também força (e salva)
   - Para o tema voltar a ficar DESLIGADO por padrão, troque DEFAULT_ON para false
   - Para remover de vez: apague as 2 linhas do index.html que citam "christmas"
   ============================================================ */
(function () {
    'use strict';

    var DEFAULT_ON = true;
    var KEY = 'rimk:christmas';
    var root = document.documentElement;
    var on = DEFAULT_ON;

    try {
        var q = new URLSearchParams(location.search).get('natal');
        if (q === 'on' || q === 'off') localStorage.setItem(KEY, q);
    } catch (e) {}
    try {
        var st = localStorage.getItem(KEY);
        if (st === 'on') on = true; else if (st === 'off') on = false;
    } catch (e) {}

    window.RIMK_CHRISTMAS = on;
    root.classList.toggle('christmas', on);

    /* ---------- peças em SVG (Natal, mas com a pegada alien) ---------- */
    // cabeça de alien verde (usada no Noel do trenó, no espiãozinho e na bola)
    function alienEyes(cx, cy, rx, ry, gap) {
        return '<ellipse cx="' + (cx - gap) + '" cy="' + cy + '" rx="' + rx + '" ry="' + ry + '" fill="#0B1410" transform="rotate(-18 ' + (cx - gap) + ' ' + cy + ')"/>' +
               '<ellipse cx="' + (cx + gap) + '" cy="' + cy + '" rx="' + rx + '" ry="' + ry + '" fill="#0B1410" transform="rotate(18 ' + (cx + gap) + ' ' + cy + ')"/>' +
               '<circle cx="' + (cx - gap - rx * 0.3) + '" cy="' + (cy - ry * 0.35) + '" r="' + (rx * 0.28).toFixed(1) + '" fill="#fff" opacity=".85"/>' +
               '<circle cx="' + (cx + gap - rx * 0.3) + '" cy="' + (cy - ry * 0.35) + '" r="' + (rx * 0.28).toFixed(1) + '" fill="#fff" opacity=".85"/>';
    }

    // trenó puxado por "rena alienígena" (verde, antenas no lugar dos chifres) com Noel verdinho
    function sleigh() {
        return '<svg viewBox="0 0 120 50" aria-hidden="true">' +
            // rena alien
            '<g fill="#3FCB7B"><ellipse cx="22" cy="26" rx="11" ry="6"/><rect x="14" y="28" width="2.5" height="11" rx="1"/><rect x="26" y="28" width="2.5" height="11" rx="1"/>' +
            '<path d="M30 22L38 14L40 18L34 26Z"/><ellipse cx="40" cy="14" rx="5" ry="4.5"/></g>' +
            '<ellipse cx="39" cy="12.6" rx="1.5" ry="2.2" fill="#0B1410" transform="rotate(-20 39 12.6)"/>' +
            '<circle cx="45" cy="15" r="1.9" fill="#FF3D4F"/>' +
            // antenas com bolinhas no lugar dos chifres
            '<path d="M38 10L35 2M42 10L46 3" stroke="#2A9E5C" stroke-width="1.5" fill="none" stroke-linecap="round"/>' +
            '<circle cx="35" cy="2" r="2" fill="#FFD34D"/><circle cx="46" cy="3" r="2" fill="#FF3D4F"/>' +
            // cordas
            '<path d="M32 26Q50 30 64 30" stroke="#FFD34D" stroke-width="1" fill="none"/>' +
            // trenó
            '<path d="M62 20H106C108 28 104 36 96 36H66C62 36 60 32 62 28Z" fill="currentColor"/>' +
            '<path d="M58 42Q60 38 66 38H100Q110 38 112 32" stroke="#FFD34D" stroke-width="2.4" fill="none" stroke-linecap="round"/>' +
            // Papai Noel alien: rosto verde, olhos grandes, gorro
            '<circle cx="82" cy="17" r="6" fill="#8FE388"/>' + alienEyes(82, 17, 1.7, 2.4, 2.5) +
            '<path d="M76 15C77 8 84 6 90 10L88 16Z" fill="#E3263A"/><circle cx="90" cy="10" r="2" fill="#fff"/>' +
            '<rect x="94" y="14" width="10" height="8" rx="1" fill="#2FD27A"/><path d="M99 14V22M94 18H104" stroke="#FFD34D" stroke-width="1.4"/></svg>';
    }

    // disco voador do Noel: gorro na cúpula, alien lá dentro, luzinhas na borda e raio trator largando presentes
    var ufoN = 0;
    function ufo(big) {
        var id = 'xmb' + (ufoN++);
        var h = '<svg viewBox="0 0 110 ' + (big ? 92 : 46) + '" aria-hidden="true">';
        if (big) {
            h += '<defs><linearGradient id="' + id + '" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FFE98A" stop-opacity=".55"/><stop offset="1" stop-color="#7DFFB0" stop-opacity="0"/></linearGradient></defs>' +
                '<path class="xm-beam" d="M42 44L68 44L96 92H14Z" fill="url(#' + id + ')"/>' +
                '<g class="xm-drop"><rect x="46" y="54" width="9" height="8" fill="#E3263A"/><path d="M50.5 54V62M46 58H55" stroke="#FFD34D" stroke-width="1.2"/></g>' +
                '<g class="xm-drop d2"><rect x="62" y="56" width="8" height="7" fill="#2FD27A"/><path d="M66 56V63M62 59.5H70" stroke="#FFD34D" stroke-width="1.1"/></g>';
        }
        h += '<path d="M33 31C33 9 77 9 77 31Z" fill="rgba(180,255,225,.28)" stroke="#9FFFD0" stroke-width="1.2"/>' +
            '<circle cx="55" cy="25" r="7" fill="#5BE08A"/>' + alienEyes(55, 25, 1.8, 2.6, 2.7) +
            '<path d="M48 22C49 13 58 11 64 15L62 22Z" fill="#E3263A"/><circle cx="64" cy="14.5" r="2.3" fill="#fff"/>' +
            '<path d="M51 18L48 11" stroke="#5BE08A" stroke-width="1.3" stroke-linecap="round"/><circle cx="48" cy="10.5" r="1.7" fill="#FFD34D"/>' +
            '<ellipse cx="55" cy="33" rx="52" ry="11" fill="currentColor"/>' +
            '<ellipse cx="55" cy="39" rx="28" ry="5" fill="#7A0F1C"/>' +
            '<g class="xm-rim"><circle cx="14" cy="34" r="2.4" fill="#FFD34D"/><circle cx="30" cy="38" r="2.4" fill="#7DFFB0"/><circle cx="46" cy="41" r="2.4" fill="#FFD34D"/>' +
            '<circle cx="64" cy="41" r="2.4" fill="#7DFFB0"/><circle cx="80" cy="38" r="2.4" fill="#FFD34D"/><circle cx="96" cy="34" r="2.4" fill="#7DFFB0"/></g>' +
            '<path d="M8 31Q55 24 102 31" stroke="#fff" stroke-width="1.4" fill="none" opacity=".55" stroke-dasharray="3 5"/></svg>';
        return h;
    }

    // boneco de neve alienígena: olhões pretos, duas antenas com luz e cachecol natalino
    function snowman() {
        return '<svg viewBox="0 0 60 96" aria-hidden="true">' +
            '<path d="M22 20L16 6M38 20L44 6" stroke="#CDEFE0" stroke-width="1.8" stroke-linecap="round"/>' +
            '<circle cx="16" cy="5" r="3.2" fill="#FF3D4F"/><circle cx="44" cy="5" r="3.2" fill="#FFD34D"/>' +
            '<circle cx="30" cy="68" r="22" fill="#F2F8FF"/><ellipse cx="30" cy="36" rx="17" ry="16" fill="#EAFBF3"/>' +
            alienEyes(30, 35, 4, 6, 7) +
            '<path d="M26 46Q30 48.5 34 46" stroke="#1B1B24" stroke-width="1.3" fill="none" stroke-linecap="round"/>' +
            '<path d="M13 52Q30 62 47 52L47 58Q30 68 13 58Z" fill="#E3263A"/><path d="M40 58L44 74L49 72L46 56Z" fill="#2FD27A"/>' +
            '<path d="M10 66L-2 58M50 66L62 58" stroke="#7A4A22" stroke-width="2" stroke-linecap="round"/>' +
            '<circle cx="30" cy="68" r="2" fill="#E3263A"/><circle cx="30" cy="78" r="2" fill="#2FD27A"/></svg>';
    }

    // árvore com disco voador no topo (no lugar da estrela), planetinhas de enfeite e presentes embaixo
    var treeN = 0;
    function tree() {
        var id = 'xmg' + (treeN++);
        return '<svg viewBox="0 0 120 160" aria-hidden="true">' +
            '<defs><linearGradient id="' + id + '" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2FBF6B"/><stop offset="1" stop-color="#0E6B3A"/></linearGradient></defs>' +
            '<rect x="52" y="124" width="16" height="22" fill="#7A4A22"/>' +
            '<g fill="url(#' + id + ')" stroke="#0A4A28" stroke-width="1.5" stroke-linejoin="round">' +
            '<path d="M60 36L98 80H22Z"/><path d="M60 62L106 110H14Z"/><path d="M60 88L112 132H8Z"/></g>' +
            // OVNI-topo com facho de luz
            '<path class="xm-beam" d="M54 22L66 22L80 44H40Z" fill="#FFE98A" opacity=".35"/>' +
            '<path d="M49 14C49 3 71 3 71 14Z" fill="rgba(180,255,225,.55)" stroke="#9FFFD0" stroke-width="1"/>' +
            '<ellipse cx="60" cy="17" rx="19" ry="5.5" fill="#FF3D4F" stroke="#FF8A96" stroke-width=".8"/>' +
            '<g class="xm-rim"><circle cx="48" cy="17.4" r="1.4" fill="#FFD34D"/><circle cx="60" cy="19.6" r="1.4" fill="#7DFFB0"/><circle cx="72" cy="17.4" r="1.4" fill="#FFD34D"/></g>' +
            // planetinhas
            '<g class="xm-bulbs"><circle cx="46" cy="76" r="4.6" fill="#FF3D4F"/><circle cx="72" cy="66" r="4.6" fill="#FFD34D"/>' +
            '<circle cx="34" cy="104" r="4.6" fill="#4DA6FF"/><circle cx="62" cy="98" r="4.6" fill="#FF3D4F"/><circle cx="88" cy="106" r="4.6" fill="#7DFFB0"/>' +
            '<circle cx="48" cy="124" r="4.6" fill="#FFD34D"/><circle cx="80" cy="126" r="4.6" fill="#4DA6FF"/>' +
            '<ellipse cx="72" cy="66" rx="8" ry="2" fill="none" stroke="#FFF3B0" stroke-width="1" transform="rotate(-20 72 66)"/>' +
            '<ellipse cx="34" cy="104" rx="8" ry="2" fill="none" stroke="#BFE0FF" stroke-width="1" transform="rotate(-20 34 104)"/>' +
            '<ellipse cx="88" cy="106" rx="8" ry="2" fill="none" stroke="#D8FFE8" stroke-width="1" transform="rotate(-20 88 106)"/></g>' +
            // presentes
            '<rect x="4" y="138" width="24" height="20" fill="#2FD27A"/><path d="M16 138V158M4 148H28" stroke="#FFD34D" stroke-width="2.4"/>' +
            '<rect x="92" y="142" width="22" height="16" fill="#E3263A"/><path d="M103 142V158M92 150H114" stroke="#7DFFB0" stroke-width="2.4"/></svg>';
    }

    // alien de gorro espiando por trás da neve (pisca e balança a antena)
    function peeker() {
        return '<svg viewBox="0 0 76 70" aria-hidden="true">' +
            '<path class="xm-ant" d="M38 20L30 4" stroke="#3FCB7B" stroke-width="2" fill="none" stroke-linecap="round"/><circle class="xm-ant-b" cx="29" cy="3.5" r="3.4" fill="#FFD34D"/>' +
            '<ellipse cx="38" cy="46" rx="26" ry="24" fill="#5BE08A"/>' +
            '<g class="xm-blinkeyes">' + alienEyes(38, 44, 6, 8.5, 11) + '</g>' +
            '<path d="M32 58Q38 62 44 58" stroke="#0B1410" stroke-width="1.6" fill="none" stroke-linecap="round"/>' +
            '<path d="M13 34C14 14 30 6 50 10C60 12 62 20 58 26C54 32 56 34 60 36Z" fill="#E3263A"/>' +
            '<rect x="10" y="30" width="54" height="9" rx="4.5" fill="#fff"/><circle cx="58" cy="11" r="6" fill="#fff"/>' +
            '<ellipse cx="8" cy="68" rx="7" ry="5" fill="#4DCB7C"/><ellipse cx="68" cy="68" rx="7" ry="5" fill="#4DCB7C"/></svg>';
    }

    function lights() {
        // fio com ondas suaves e lâmpadas coloridas
        var d = 'M0 2Q50 22 100 4T200 4T300 4T400 4T500 4T600 4T700 4T800 4T900 4T1000 4';
        var h = '<svg viewBox="0 0 1000 26" preserveAspectRatio="none" aria-hidden="true"><path d="' + d + '" fill="none" stroke="currentColor" stroke-width="1.2"/>';
        var i, x, y, n = 20;
        for (i = 0; i < n; i++) {
            x = 25 + i * (950 / (n - 1));
            y = 8 + (i % 2 ? 6 : 12);
            h += '<circle class="b' + (1 + (i % 4)) + '" cx="' + x.toFixed(0) + '" cy="' + y + '" r="4"/>';
        }
        return h + '</svg>';
    }

    // bola de Natal com carinha de alien
    function ornament() {
        return '<svg viewBox="0 0 40 48" aria-hidden="true">' +
            '<rect x="16" y="2" width="8" height="6" rx="1" fill="#FFD34D"/>' +
            '<ellipse cx="20" cy="28" rx="15" ry="16" fill="#3FCB7B" stroke="#9FFFD0" stroke-width="1"/>' +
            alienEyes(20, 27, 3.6, 5.2, 5.5) +
            '<path d="M16 37Q20 40 24 37" stroke="#0B1410" stroke-width="1.3" fill="none" stroke-linecap="round"/>' +
            '<path d="M8 21Q20 15 32 21" stroke="#E3263A" stroke-width="3" fill="none"/>' +
            '<ellipse cx="12" cy="20" rx="2.6" ry="4" fill="#fff" opacity=".35"/></svg>';
    }

    function rnd(a, b) { return a + Math.random() * (b - a); }

    /* ---------- camadas de decoração ---------- */
    function build() {
        var body = document.body;
        if (!body || document.getElementById('xm-back')) return;

        var i, h = '';

        // fundo (atrás de tudo): estrela, neve acumulada, trenós, bonecos de neve, flocos, árvores
        h += '<div class="xm-star"></div><div class="xm-glow"></div><div class="xm-snowbank"></div>';

        // trenós com rena alien + OVNI do Noel (grande, com raio trator) + discos menores de gorro
        [[12, 90, 70, -10, 0.85], [48, 60, 95, -50, 0.55]].forEach(function (s, k) {
            h += '<span class="xm-sleigh' + (k % 2 ? ' rtl' : '') + '" style="--y:' + s[0] + 'vh;--w:' + s[1] + 'px;--dur:' + s[2] + 's;--delay:' + s[3] + 's;opacity:' + s[4] + '">' + sleigh() + '</span>';
        });
        h += '<span class="xm-ufo rtl" style="--y:26vh;--w:110px;--dur:78s;--delay:-24s;opacity:.9">' + ufo(true) + '</span>';
        [[8, 46, 52, -8, .75, 0], [58, 34, 64, -40, .55, 1], [38, 28, 90, -66, .45, 0]].forEach(function (u) {
            h += '<span class="xm-ufo' + (u[5] ? ' rtl' : '') + ' mini" style="--y:' + u[0] + 'vh;--w:' + u[1] + 'px;--dur:' + u[2] + 's;--delay:' + u[3] + 's;opacity:' + u[4] + '">' + ufo(false) + '</span>';
        });

        // cometas (estrelas cadentes) de vez em quando
        [[10, 52, 23, 6], [4, 18, 37, 19], [22, 70, 41, 31]].forEach(function (c) {
            h += '<i class="xm-comet" style="--y:' + c[0] + 'vh;--x:' + c[1] + 'vw;--dur:' + c[2] + 's;--delay:-' + c[3] + 's"></i>';
        });

        [[62, 54, 110, -30], [34, 44, 140, -80], [76, 38, 160, -10]].forEach(function (g) {
            h += '<span class="xm-snowman" style="--y:' + g[0] + 'vh;--w:' + g[1] + 'px;--dur:' + g[2] + 's;--delay:' + g[3] + 's">' + snowman() + '</span>';
        });

        for (i = 0; i < 46; i++) {
            h += '<i class="xm-flake" style="left:' + rnd(0, 100).toFixed(1) + '%;--s:' + rnd(2, 6).toFixed(1) + 'px;--dur:' + rnd(9, 22).toFixed(1) + 's;--delay:-' + rnd(0, 22).toFixed(1) + 's;--dx:' + Math.round(rnd(-80, 80)) + 'px"></i>';
        }

        h += '<span class="xm-tree l">' + tree() + '</span><span class="xm-tree r">' + tree() + '</span>';
        // aliens de gorro espiando de trás da neve
        h += '<span class="xm-peek a">' + peeker() + '</span><span class="xm-peek b">' + peeker() + '</span>';

        var back = document.createElement('div');
        back.id = 'xm-back'; back.className = 'xm-layer xm-back'; back.setAttribute('aria-hidden', 'true');
        back.innerHTML = h;
        body.insertBefore(back, body.firstChild);

        // frente (acima do cabeçalho, sem pegar cliques): pisca-pisca no topo e bola pendurada
        var front = document.createElement('div');
        front.id = 'xm-front'; front.className = 'xm-layer xm-front'; front.setAttribute('aria-hidden', 'true');
        front.innerHTML = '<span class="xm-lights">' + lights() + '</span>' +
            '<span class="xm-sleigh rtl" style="--y:71vh;--w:44px;--dur:84s;--delay:-47s">' + sleigh() + '</span>' +
            '<span class="xm-ufo mini" style="--y:84vh;--w:30px;--dur:70s;--delay:-12s;opacity:.8">' + ufo(false) + '</span>' +
            '<span class="xm-ornament"><span class="xm-ornament-in">' + ornament() + '</span></span>';
        body.appendChild(front);

        // fonte do título (só carrega com o tema ligado)
        if (!document.getElementById('xm-font')) {
            var l = document.createElement('link');
            l.id = 'xm-font'; l.rel = 'stylesheet';
            l.href = 'https://fonts.googleapis.com/css2?family=Mountains+of+Christmas:wght@700&display=swap';
            document.head.appendChild(l);
        }

        // botão 🎄 no cabeçalho
        var grp = document.querySelector('header > .ml-auto');
        if (grp && !document.getElementById('xm-btn')) {
            var b = document.createElement('button');
            b.type = 'button'; b.id = 'xm-btn'; b.className = 'chip';
            b.innerHTML = '<span aria-hidden="true">🎄</span>';
            b.addEventListener('click', function () { set(!on, true); });
            grp.insertBefore(b, grp.firstChild);
        }

        // some com árvores/bola dentro da sala (o layout lá já é cheio)
        var rv = document.getElementById('room-view');
        if (rv && window.MutationObserver) {
            var sync = function () { root.classList.toggle('xm-in-room', !rv.classList.contains('hidden')); };
            new MutationObserver(sync).observe(rv, { attributes: true, attributeFilter: ['class'] });
            sync();
        }

        paint();
    }

    /* ---------- textos temáticos da tela inicial ---------- */
    var swaps = [['.dl-strip span:first-child', 'EMBRULHANDO'], ['.rd-tag', 'HO HO HO']];
    var baseTitle = null;

    function paint() {
        var b = document.getElementById('xm-btn');
        if (b) {
            b.setAttribute('aria-pressed', String(on));
            b.title = on ? 'Tema de Natal ligado (clique para desligar)' : 'Tema de Natal desligado (clique para ligar)';
            b.setAttribute('aria-label', b.title);
        }
        swaps.forEach(function (s) {
            var el = document.querySelector(s[0]);
            if (!el) return;
            if (!el.hasAttribute('data-xm-orig')) el.setAttribute('data-xm-orig', el.textContent);
            el.textContent = on ? s[1] : el.getAttribute('data-xm-orig');
        });
        if (baseTitle === null) baseTitle = document.title.replace(/^🎄\s*/, '');
        document.title = on ? '🎄 ' + baseTitle : baseTitle;
    }

    function set(v, byUser) {
        on = !!v;
        window.RIMK_CHRISTMAS = on;
        root.classList.toggle('christmas', on);
        try { localStorage.setItem(KEY, on ? 'on' : 'off'); } catch (e) {}
        paint();
        try { window.dispatchEvent(new CustomEvent('rimk:christmas', { detail: { on: on, user: !!byUser } })); } catch (e) {}
    }

    window.RimkChristmas = { isOn: function () { return on; }, set: function (v) { set(v, false); }, toggle: function () { set(!on, true); } };

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', build);
    else build();
})();
