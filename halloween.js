/* ============================================================
   RimkRadio — TEMA DE HALLOWEEN
   Tudo da versão temática vive em halloween.css + este arquivo (+ sons em script.js).
   - Liga/desliga: botão 🎃 no cabeçalho (a escolha fica salva no navegador)
   - ?halloween=off  /  ?halloween=on  na URL também força (e salva)
   - Para o tema voltar a ficar DESLIGADO por padrão, troque DEFAULT_ON para false
   - Para remover de vez: apague as 2 linhas do index.html que citam "halloween"
   ============================================================ */
(function () {
    'use strict';

    var DEFAULT_ON = true;
    var KEY = 'rimk:halloween';
    var root = document.documentElement;
    var on = DEFAULT_ON;

    try {
        var q = new URLSearchParams(location.search).get('halloween');
        if (q === 'on' || q === 'off') localStorage.setItem(KEY, q);
    } catch (e) {}
    try {
        var st = localStorage.getItem(KEY);
        if (st === 'on') on = true; else if (st === 'off') on = false;
    } catch (e) {}

    window.RIMK_HALLOWEEN = on;
    root.classList.toggle('halloween', on);

    /* ---------- peças em SVG ---------- */
    function bat() {
        var w = 'M30 11C24 5 14 3 2 8C6 10 8 13 8 17C11 14 14 14 17 18C19 15 22 15 25 20C27 17 29 17 30 21Z';
        return '<svg viewBox="0 0 64 28" fill="currentColor" aria-hidden="true">' +
            '<path class="wl" d="' + w + '"/>' +
            '<g transform="translate(64 0) scale(-1 1)"><path class="wr" d="' + w + '"/></g>' +
            '<ellipse cx="32" cy="14" rx="4" ry="7"/><circle cx="32" cy="8" r="3.2"/>' +
            '<path d="M28.5 6L29.5 1.5L31.5 5ZM35.5 6L34.5 1.5L32.5 5Z"/></svg>';
    }

    function ghost() {
        return '<svg viewBox="0 0 60 80" aria-hidden="true">' +
            '<path d="M30 4C14 4 6 16 6 32V70C6 74 9 74 11 71C14 67 17 67 20 71C23 75 26 75 29 71C32 67 35 67 38 71C41 75 44 75 47 71C50 67 53 67 54 70V32C54 16 46 4 30 4Z" fill="#EDE6FF"/>' +
            '<ellipse cx="22" cy="30" rx="4" ry="6" fill="#0B0714"/><ellipse cx="38" cy="30" rx="4" ry="6" fill="#0B0714"/>' +
            '<ellipse cx="30" cy="46" rx="4.5" ry="7" fill="#0B0714"/></svg>';
    }

    var pumpN = 0;
    function pumpkin() {
        var id = 'hwg' + (pumpN++);
        return '<svg viewBox="0 0 120 112" aria-hidden="true">' +
            '<defs><radialGradient id="' + id + '" cx="50%" cy="40%" r="65%"><stop offset="0" stop-color="#FFA23A"/><stop offset="1" stop-color="#E25A00"/></radialGradient></defs>' +
            '<path d="M56 20C56 11 60 6 67 3L71 10C67 12 65 16 65 23Z" fill="#3F6B1E"/>' +
            '<g fill="url(#' + id + ')" stroke="#9A3E00" stroke-width="2">' +
            '<ellipse cx="36" cy="66" rx="27" ry="39"/><ellipse cx="84" cy="66" rx="27" ry="39"/><ellipse cx="60" cy="66" rx="30" ry="42"/></g>' +
            '<g class="hw-face" fill="#FFE27A">' +
            '<path d="M36 58L50 58L43 43Z"/><path d="M70 58L84 58L77 43Z"/><path d="M56 68L64 68L60 61Z"/>' +
            '<path d="M32 76L41 86L47 77L54 88L60 79L66 88L73 77L79 86L88 76C82 99 38 99 32 76Z"/></g></svg>';
    }

    function cobweb(R) {
        var rays = 6, d = '', i, angs = [];
        for (i = 0; i < rays; i++) angs.push((i * 90 / (rays - 1)) * Math.PI / 180);
        for (i = 0; i < rays; i++) d += 'M0 0L' + (Math.cos(angs[i]) * R).toFixed(1) + ' ' + (Math.sin(angs[i]) * R).toFixed(1);
        [0.2, 0.38, 0.58, 0.8, 1].forEach(function (f) {
            var r = R * f;
            for (var k = 0; k < rays - 1; k++) {
                var a0 = angs[k], a1 = angs[k + 1], am = (a0 + a1) / 2, cr = r * 0.78;
                d += 'M' + (Math.cos(a0) * r).toFixed(1) + ' ' + (Math.sin(a0) * r).toFixed(1) +
                    'Q' + (Math.cos(am) * cr).toFixed(1) + ' ' + (Math.sin(am) * cr).toFixed(1) + ' ' +
                    (Math.cos(a1) * r).toFixed(1) + ' ' + (Math.sin(a1) * r).toFixed(1);
            }
        });
        return '<svg viewBox="0 0 ' + R + ' ' + R + '" aria-hidden="true"><path d="' + d +
            '" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round"/></svg>';
    }

    function spider() {
        var legs = '';
        [[-1, 1], [1, 1]].forEach(function (s) {
            [[10, 18, 2, 10], [11, 22, 0, 24], [11, 26, 1, 36], [10, 29, 4, 44]].forEach(function (l) {
                legs += '<path d="M' + (20 + s[0] * 4) + ' ' + l[1] + 'Q' + (20 + s[0] * l[0]) + ' ' + (l[1] - 8) + ' ' + (20 + s[0] * (l[0] + 8)) + ' ' + (l[1] + 6) + '"/>';
            });
        });
        return '<svg viewBox="0 0 40 44" aria-hidden="true"><g fill="none" stroke="#5B4A80" stroke-width="1.6" stroke-linecap="round">' + legs + '</g>' +
            '<circle cx="20" cy="27" r="7.5" fill="#15101C" stroke="#6B3FB8" stroke-width="1"/><circle cx="20" cy="17" r="4.6" fill="#15101C" stroke="#6B3FB8" stroke-width="1"/>' +
            '<circle cx="18" cy="16.4" r="1.2" fill="#FF7A1A"/><circle cx="22" cy="16.4" r="1.2" fill="#FF7A1A"/>' +
            '<path d="M17 25L20 31L23 25Z" fill="#FF7A1A" opacity=".85"/></svg>';
    }

    function rnd(a, b) { return a + Math.random() * (b - a); }

    /* ---------- camadas de decoração ---------- */
    function build() {
        var body = document.body;
        if (!body || document.getElementById('hw-back')) return;

        var i, h = '';

        // fundo (atrás de tudo): lua, névoa, morcegos, fantasmas, brasas, abóboras
        h += '<div class="hw-moon"></div><div class="hw-fog"></div><div class="hw-fog b"></div>';

        [[10, 46, 36, 0, 0.8], [26, 30, 52, -20, 0.55], [44, 38, 40, -9, 0.6], [62, 24, 58, -30, 0.45],
         [78, 34, 44, -14, 0.7], [18, 22, 66, -41, 0.4]].forEach(function (b, k) {
            h += '<span class="hw-bat' + (k % 2 ? ' rtl' : '') + '" style="--y:' + b[0] + 'vh;--w:' + b[1] + 'px;--dur:' + b[2] + 's;--delay:' + b[3] + 's;opacity:' + b[4] + '">' + bat() + '</span>';
        });

        [[56, 54, 95, -30], [30, 44, 120, -70], [74, 38, 140, -10]].forEach(function (g) {
            h += '<span class="hw-ghost" style="--y:' + g[0] + 'vh;--w:' + g[1] + 'px;--dur:' + g[2] + 's;--delay:' + g[3] + 's">' + ghost() + '</span>';
        });

        for (i = 0; i < 18; i++) {
            h += '<i class="hw-ember" style="left:' + rnd(0, 100).toFixed(1) + '%;--s:' + rnd(2, 5).toFixed(1) + 'px;--dur:' + rnd(9, 19).toFixed(1) + 's;--delay:-' + rnd(0, 18).toFixed(1) + 's;--dx:' + Math.round(rnd(-60, 60)) + 'px"></i>';
        }

        h += '<span class="hw-pump l">' + pumpkin() + '</span><span class="hw-pump r">' + pumpkin() + '</span>';

        var back = document.createElement('div');
        back.id = 'hw-back'; back.className = 'hw-layer hw-back'; back.setAttribute('aria-hidden', 'true');
        back.innerHTML = h;
        body.insertBefore(back, body.firstChild);

        // frente (acima do cabeçalho, sem pegar cliques): teias nos cantos e aranha
        var front = document.createElement('div');
        front.id = 'hw-front'; front.className = 'hw-layer hw-front'; front.setAttribute('aria-hidden', 'true');
        front.innerHTML = '<span class="hw-web tl">' + cobweb(120) + '</span><span class="hw-web tr">' + cobweb(120) + '</span>' +
            '<span class="hw-bat" style="--y:34vh;--w:30px;--dur:58s;--delay:-12s">' + bat() + '</span>' +
            '<span class="hw-bat rtl" style="--y:71vh;--w:24px;--dur:74s;--delay:-47s">' + bat() + '</span>' +
            '<span class="hw-spider"><span class="hw-spider-in">' + spider() + '</span></span>';
        body.appendChild(front);

        // fonte do título (só carrega com o tema ligado)
        if (!document.getElementById('hw-font')) {
            var l = document.createElement('link');
            l.id = 'hw-font'; l.rel = 'stylesheet';
            l.href = 'https://fonts.googleapis.com/css2?family=Creepster&display=swap';
            document.head.appendChild(l);
        }

        // botão 🎃 no cabeçalho
        var grp = document.querySelector('header > .ml-auto');
        if (grp && !document.getElementById('hw-btn')) {
            var b = document.createElement('button');
            b.type = 'button'; b.id = 'hw-btn'; b.className = 'chip';
            b.innerHTML = '<span aria-hidden="true">🎃</span>';
            b.addEventListener('click', function () { set(!on, true); });
            grp.insertBefore(b, grp.firstChild);
        }

        // some com abóboras/aranha dentro da sala (o layout lá já é cheio)
        var rv = document.getElementById('room-view');
        if (rv && window.MutationObserver) {
            var sync = function () { root.classList.toggle('hw-in-room', !rv.classList.contains('hidden')); };
            new MutationObserver(sync).observe(rv, { attributes: true, attributeFilter: ['class'] });
            sync();
        }

        paint();
    }

    /* ---------- textos temáticos da tela inicial ---------- */
    var swaps = [['.dl-strip span:first-child', 'INVOCANDO'], ['.rd-tag', 'CUIDADO']];
    var baseTitle = null;

    function paint() {
        var b = document.getElementById('hw-btn');
        if (b) {
            b.setAttribute('aria-pressed', String(on));
            b.title = on ? 'Tema de Halloween ligado (clique para desligar)' : 'Tema de Halloween desligado (clique para ligar)';
            b.setAttribute('aria-label', b.title);
        }
        swaps.forEach(function (s) {
            var el = document.querySelector(s[0]);
            if (!el) return;
            if (!el.hasAttribute('data-hw-orig')) el.setAttribute('data-hw-orig', el.textContent);
            el.textContent = on ? s[1] : el.getAttribute('data-hw-orig');
        });
        if (baseTitle === null) baseTitle = document.title.replace(/^🎃\s*/, '');
        document.title = on ? '🎃 ' + baseTitle : baseTitle;
    }

    function set(v, byUser) {
        on = !!v;
        window.RIMK_HALLOWEEN = on;
        root.classList.toggle('halloween', on);
        try { localStorage.setItem(KEY, on ? 'on' : 'off'); } catch (e) {}
        paint();
        try { window.dispatchEvent(new CustomEvent('rimk:halloween', { detail: { on: on, user: !!byUser } })); } catch (e) {}
    }

    window.RimkHalloween = { isOn: function () { return on; }, set: function (v) { set(v, false); }, toggle: function () { set(!on, true); } };

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', build);
    else build();
})();
