/* CINEMA (RimkRadio): ASSISTIR JUNTO (arquivo local nos dois lados).

   Cada pessoa abre o MESMO arquivo no próprio computador e só a sincronia (play / pause / posição) trafega
   pelo canal da sala. Não passa vídeo pela rede: a qualidade é a do arquivo. Só existe em salas da categoria "Filmes".

   Mensagens pelo canal da sala (broadcast "cin", todas começam com "ls-"):
     ls-open    alguém abriu um filme (nome, tamanho, duração)            -> os outros escolhem o mesmo arquivo
     ls-ready   "já carreguei o arquivo"                                   -> contador "2/2 com o arquivo"
     ls-st      estado do filme (posição, pausado). Vem de um comando (play/pause/seek) ou de um "batimento"
                a cada 2 s da pessoa de referência; quem recebe corrige o próprio vídeo
     ls-req     "me manda o estado agora" (botão Sincronizar)
     ls-ping / ls-pong   medem o atraso E o desvio de relógio entre cada par de pessoas (estilo NTP)
     ls-unready / ls-end / ls-hello   sair, encerrar para todos, e "quem entrou agora pede o estado"

   Sincronia: toda mensagem de estado leva o relógio de quem enviou (s). Com o desvio medido no ping,
   o receptor sabe há quantos ms a mensagem foi escrita e compensa. Diferença > 0,8 s = pula; entre 0,06 s e 0,8 s =
   acelera/desacelera de forma proporcional (até 10%) até alinhar.

   Integração: script.js chama open / leave / signal / presence / nonce / refresh / active / control (veja window.RimkCinema no fim). */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);

  let ctx = null;                       // { myId, send, isAdmin, category, locked, getUsers, notify, yt }
  let box = null, layer = null, lsBtn = null, lsNew = null, lsGrp = null, lsInput = null, subInput = null;
  let els = {}, pickMode = 'create';    // pickMode: 'create' = abrir um filme novo | 'attach' = escolher o arquivo de um filme já aberto
  let ls = null;                        // sessão atual (ou null)
  let helloSent = false, pend = { sid: '', ids: new Set() };
  let wakeLock = null, quietTimer = null, ytMuted = null;
  let subSize = 'm', loadSeq = 0, lsV = 1, lastAct = 0, overUi = false, menuOpen = false, idleAtDown = false, bound = false;
  try { const ss = localStorage.getItem('cinSubSize'); if (ss === 's' || ss === 'm' || ss === 'l') subSize = ss; } catch (e) {}
  // proporção da imagem (só para quem assiste, cada um tem o seu arquivo): auto = a do próprio filme
  const AR_MODES = { auto: 0, '169': 16 / 9, '43': 4 / 3, '219': 21 / 9, '185': 1.85, fill: -1 };
  let arMode = 'auto', arObs = null;
  try { const am = localStorage.getItem('cinAspect'); if (am && Object.prototype.hasOwnProperty.call(AR_MODES, am)) arMode = am; } catch (e) {}
  try { const sv = parseFloat(localStorage.getItem('cinVol')); if (sv >= 0 && sv <= 1) lsV = sv; } catch (e) {}

  /* ---------- util ---------- */
  const tr = (el, text) => { if (el) el.textContent = text; };
  const notify = (m, t) => { try { ctx && ctx.notify && ctx.notify(m, t || 'info'); } catch (e) {} };
  const me = () => (ctx && ctx.myId && ctx.myId()) || null;
  const users = () => (ctx && ctx.getUsers && ctx.getUsers()) || [];
  const nameOf = (id) => { const u = users().find(x => x.id === id); return u ? u.name : 'Alguém'; };
  const cut = (s, n) => { s = String(s == null ? '' : s); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
  const fmtSize = (b) => { b = Number(b) || 0; if (b >= 1e9) return (b / 1e9).toFixed(2).replace('.', ',') + ' GB'; if (b >= 1e6) return Math.round(b / 1e6) + ' MB'; return Math.round(b / 1e3) + ' KB'; };
  const fmt = (x) => { x = Math.max(0, Math.floor(Number(x) || 0)); const h = Math.floor(x / 3600), m = Math.floor(x % 3600 / 60), sec = x % 60; return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(sec).padStart(2, '0'); };
  const inMovies = () => !ctx || !ctx.category || ctx.category() === 'filmes';
  const isAdminId = (id) => { const u = users().find(x => x.id === id); return !!u && (u.host === true || u.cohost === true); };
  const canCtl = (id) => isAdminId(id) || !(ctx && ctx.locked && ctx.locked());   // anfitrião/sub-host, ou todos se a sala não estiver travada
  const send = (to, p) => { try { ctx.send(Object.assign({ to, from: me() }, p)); } catch (e) { console.error(e); } };
  const lsAll = (p) => send('*', p);
  const vDur = () => { const v = els.video; return v && Number.isFinite(v.duration) ? v.duration : 0; };
  const nowMs = () => performance.now();

  async function keepAwake() {
    try { if (navigator.wakeLock && !wakeLock) { wakeLock = await navigator.wakeLock.request('screen'); wakeLock.addEventListener('release', () => { wakeLock = null; }); } } catch (e) {}
  }
  function releaseAwake() { try { if (wakeLock) wakeLock.release(); } catch (e) {} wakeLock = null; }
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && ls && ls.url) keepAwake(); });

  /* ---------- silencia o YouTube enquanto o filme está aberto ---------- */
  function quietOn() {
    if (quietTimer) return;
    const tick = () => {
      const yt = ctx && ctx.yt && ctx.yt(); if (!yt) return;
      try {
        if (ytMuted === null && typeof yt.isMuted === 'function') ytMuted = yt.isMuted();
        if (typeof yt.mute === 'function') yt.mute();
      } catch (e) {}
    };
    tick(); quietTimer = setInterval(tick, 1200);
  }
  function quietOff() {
    clearInterval(quietTimer); quietTimer = null;
    const yt = ctx && ctx.yt && ctx.yt();
    try { if (yt && ytMuted === false && typeof yt.unMute === 'function') yt.unMute(); } catch (e) {}
    ytMuted = null;
  }

  /* ============================================================
     INTERFACE
     Um único conjunto de controles, por cima do filme, que some sozinho depois de 3 s parado (como num player de verdade).
     Enquanto o filme está aberto, o cabeçalho e a barra de música do site ficam escondidos para não duplicar botões.
     ============================================================ */
  const CSS = `
  body.cin-on #player-head, body.cin-on .player-frame .controls-bar{display:none!important}
  @media (min-width:1024px){
    body.cin-on #room-view .room-col-center > .player-frame{flex:1 1 0;min-height:0}
    body.cin-on #room-view .room-col-center .video-box{aspect-ratio:auto;flex:1 1 0;min-height:0}
    body.cin-on #room-view .room-col-center > .members-panel{flex:0 0 auto}
  }
  .video-box.fs-on.fs-chat-open #cin-layer{right:var(--fs-chat-w)}
  @media (max-width:760px){.video-box.fs-on.fs-chat-open #cin-layer{right:0}}

  #cin-lsgrp{position:absolute;left:10px;bottom:10px;z-index:15;display:flex;gap:8px;flex-wrap:wrap}
  #cin-lstart,#cin-lsnew{display:none;align-items:center;gap:8px;background:rgba(6,9,6,.88);color:var(--blue,#99FF00);border:1px solid var(--blue,#99FF00);border-radius:99px;padding:7px 14px;font:600 13px 'Exo 2',system-ui,sans-serif;cursor:pointer;backdrop-filter:blur(4px);transition:box-shadow .2s,background .2s}
  #cin-lstart.on,#cin-lsnew.on{display:inline-flex}
  #cin-lsnew{color:#C3CBBE;border-color:#3a4636}
  #cin-lstart:hover,#cin-lsnew:hover{background:var(--blue,#99FF00);color:#000;border-color:var(--blue,#99FF00);box-shadow:0 0 18px color-mix(in srgb,var(--blue,#99FF00) 55%,transparent)}

  #cin-layer{position:absolute;inset:0;z-index:20;display:none;background:#000;color:#E8E8E3;font-family:'Exo 2',system-ui,sans-serif;overflow:hidden;user-select:none;-webkit-user-select:none}
  #cin-layer.on{display:block}
  #cin-layer.idle{cursor:none}
  #cin-layer [hidden]{display:none!important}
  #cin-video{position:absolute;inset:0;width:100%;height:100%;max-width:none;object-fit:contain;background:#000}
  #cin-video::cue{background:rgba(0,0,0,.68);color:#fff;font-family:'Exo 2',system-ui,sans-serif;line-height:1.25}

  #cin-layer{--sub-fs:clamp(20px,3.2vh + .9vw,52px)}
  #cin-layer[data-sub="s"]{--sub-fs:clamp(15px,2.2vh + .6vw,38px)}
  #cin-layer[data-sub="l"]{--sub-fs:clamp(27px,4.4vh + 1.2vw,70px)}
  #cin-sub{position:absolute;left:0;right:0;bottom:26px;z-index:2;display:flex;justify-content:center;padding:0 6%;pointer-events:none;transition:bottom .25s}
  #cin-layer:not(.idle) #cin-sub{bottom:104px}
  #cin-sub span{display:inline-block;max-width:100%;padding:2px 12px;border-radius:6px;background:rgba(0,0,0,.62);color:#fff;text-align:center;line-height:1.3;font-weight:600;font-size:var(--sub-fs);text-shadow:0 1px 4px #000;white-space:pre-line}
  #cin-sub:empty{display:none}
  .cin-top,.cin-ui{position:absolute;left:0;right:0;z-index:3;transition:opacity .25s}
  .cin-top{top:0;display:flex;align-items:flex-start;justify-content:space-between;gap:14px;padding:12px 16px 38px;background:linear-gradient(rgba(0,0,0,.78),rgba(0,0,0,0));pointer-events:none}
  .cin-title{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:700;font-size:15px;text-shadow:0 1px 6px #000}
  .cin-chip{flex:0 0 auto;display:inline-flex;align-items:center;gap:7px;font-size:12px;color:#C3CBBE;white-space:nowrap;text-shadow:0 1px 6px #000}
  .cin-chip .led{display:inline-block;width:8px;height:8px;border-radius:50%;background:#6c7766}
  .cin-chip .led.ok{background:var(--blue,#99FF00);box-shadow:0 0 8px var(--blue,#99FF00)}
  .cin-chip .led.adj{background:#FFB020;box-shadow:0 0 8px #FFB020}
  #cin-layer:not(.hasfile) .cin-chip{display:none}

  .cin-ui{bottom:0;padding:44px 14px 10px;background:linear-gradient(rgba(0,0,0,0),rgba(0,0,0,.88));pointer-events:none}
  .cin-ui > *{pointer-events:auto}
  #cin-layer:not(.hasfile) .cin-ui{display:none}
  #cin-layer.idle .cin-top,#cin-layer.idle .cin-ui{opacity:0}
  #cin-layer.idle .cin-ui > *{pointer-events:none}
  .cin-seekrow{display:flex;align-items:center;gap:10px;font-size:12px;color:#C3CBBE;font-variant-numeric:tabular-nums}
  .cin-seekrow span{min-width:38px}
  .cin-seekrow span:last-child{text-align:right}
  .cin-row{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:4px}
  .cin-grp{display:flex;align-items:center;gap:4px;min-width:0}

  .cin-range{-webkit-appearance:none;appearance:none;flex:1 1 auto;min-width:60px;height:5px;border-radius:99px;outline:none;cursor:pointer;margin:0;background:linear-gradient(to right,var(--blue,#99FF00) var(--p,0%),rgba(255,255,255,.22) var(--p,0%))}
  .cin-range::-webkit-slider-thumb{-webkit-appearance:none;width:13px;height:13px;border-radius:50%;border:0;background:var(--blue,#99FF00);box-shadow:0 0 8px var(--blue,#99FF00)}
  .cin-range::-moz-range-thumb{width:13px;height:13px;border-radius:50%;border:0;background:var(--blue,#99FF00);box-shadow:0 0 8px var(--blue,#99FF00)}
  .cin-range:disabled{cursor:default;opacity:.55}
  #cin-vol{flex:0 0 84px;width:84px}
  .cin-b{width:36px;height:36px;display:inline-flex;align-items:center;justify-content:center;border:0;border-radius:8px;background:transparent;color:#E8E8E3;font-size:15px;cursor:pointer;transition:background .15s,color .15s}
  .cin-b:hover,.cin-b:focus-visible,.cin-b.act{background:rgba(255,255,255,.14);color:var(--blue,#99FF00);outline:none}
  .cin-b.pp{width:42px;height:42px;font-size:18px;color:#000;background:var(--blue,#99FF00);border-radius:50%}
  .cin-b.pp:hover{background:#CCFF66;color:#000}
  .cin-b small{font:700 11px 'Exo 2',system-ui,sans-serif;margin-left:2px}

  #cin-menu{position:absolute;right:14px;bottom:86px;z-index:6;min-width:270px;max-width:calc(100% - 28px);padding:6px;border:1px solid rgb(var(--accent-rgb) / .35);border-radius:10px;background:rgba(6,9,6,.97);box-shadow:0 8px 30px rgba(0,0,0,.7)}
  .cin-mi{width:100%;display:flex;align-items:center;gap:10px;padding:9px 10px;border:0;border-radius:7px;background:transparent;color:#E8E8E3;font:600 13px 'Exo 2',system-ui,sans-serif;text-align:left;cursor:pointer}
  .cin-mi i{width:16px;text-align:center;color:#8E9A88}
  .cin-mi:hover,.cin-mi:focus-visible{background:rgb(var(--accent-rgb) / .12);outline:none}
  .cin-mi:hover i{color:var(--blue,#99FF00)}
  .cin-mi.danger,.cin-mi.danger i{color:#FF5C7A}
  .cin-mi.danger:hover{background:rgba(255,56,96,.15)}
  .cin-mrow{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:10px;padding:4px 10px 8px 36px;font-size:12px;color:#C3CBBE}
  .cin-mrow .cin-grp{gap:6px}
  .cin-mrow #cin-subo{min-width:44px;text-align:center;font-variant-numeric:tabular-nums}
  .cin-s{padding:3px 8px;border:1px solid #2a3626;border-radius:6px;background:#0d1210;color:#E8E8E3;font:600 12px 'Exo 2',system-ui,sans-serif;cursor:pointer}
  .cin-s:hover{border-color:var(--blue,#99FF00)}
  .cin-s.act{border-color:var(--blue,#99FF00);background:var(--blue,#99FF00);color:#000}
  .cin-sep{height:1px;margin:5px 4px;background:rgba(255,255,255,.1)}

  #cin-msg{position:absolute;inset:0;z-index:5;display:flex;align-items:center;justify-content:center;padding:18px}
  .cin-card{max-width:440px;padding:22px 26px;border:1px solid rgb(var(--accent-rgb) / .35);border-radius:12px;background:rgba(6,9,6,.94);text-align:center;box-shadow:0 0 30px rgb(var(--accent-rgb) / .08)}
  .cin-ico{font-size:30px;color:var(--blue,#99FF00);margin-bottom:10px;filter:drop-shadow(0 0 10px rgb(var(--accent-rgb) / .5))}
  .cin-card .t{font-weight:700;font-size:16px;color:#fff}
  .cin-card .s{margin-top:6px;font-size:13px;color:#C3CBBE;word-break:break-word}
  .cin-card .s:empty{display:none}
  .cin-card .row{display:flex;flex-wrap:wrap;justify-content:center;gap:10px;margin-top:16px}
  .cin-card .row:empty{display:none}
  .cin-btn{border:0;border-radius:99px;padding:9px 18px;font:700 13px 'Exo 2',system-ui,sans-serif;cursor:pointer;background:var(--blue,#99FF00);color:#000}
  .cin-btn:hover{background:#CCFF66}
  .cin-btn.alt{background:#0d1210;color:#E8E8E3;border:1px solid #2a3626}
  .cin-btn.alt:hover{border-color:var(--blue,#99FF00);background:#0d1210}
  @media (max-width:560px){#cin-vol{display:none}.cin-title{font-size:13px}}
  `;

  const btn = (id, icon, title, cls) => '<button type="button" class="cin-b' + (cls ? ' ' + cls : '') + '" id="' + id + '" title="' + title + '" aria-label="' + title + '"><i class="fa-solid ' + icon + '"></i></button>';

  function injectUI() {
    if (layer && layer.isConnected) return true;
    box = document.querySelector('#room-view .video-box') || document.querySelector('.video-box');
    if (!box) return false;
    if (!$('cin-css')) { const s = document.createElement('style'); s.id = 'cin-css'; s.textContent = CSS; document.head.appendChild(s); }

    layer = document.createElement('div');
    layer.id = 'cin-layer';
    layer.innerHTML =
      '<video id="cin-video" playsinline preload="auto"></video>' +
      '<div id="cin-sub" aria-live="off"></div>' +
      '<div class="cin-top"><span class="cin-title" id="cin-title"></span>' +
        '<span class="cin-chip" id="cin-chip"><i class="led" id="cin-led"></i><span id="cin-chip-t"></span></span></div>' +
      '<div id="cin-msg" hidden><div class="cin-card"><i class="fa-solid fa-film cin-ico" aria-hidden="true"></i>' +
        '<div class="t" id="cin-msg-t"></div><div class="s" id="cin-msg-s"></div>' +
        '<div class="row">' +
          '<button type="button" class="cin-btn" id="cin-pick">Escolher o arquivo</button>' +
          '<button type="button" class="cin-btn" id="cin-resume">Continuar</button>' +
          '<button type="button" class="cin-btn alt" id="cin-new">Abrir outro filme</button>' +
          '<button type="button" class="cin-btn alt" id="cin-later">Agora não</button>' +
        '</div></div></div>' +
      '<div class="cin-ui" id="cin-ui">' +
        '<div class="cin-seekrow"><span id="cin-cur">0:00</span>' +
          '<input type="range" class="cin-range" id="cin-seek" min="0" max="0" step="1" value="0" aria-label="Posição do filme">' +
          '<span id="cin-dur">0:00</span></div>' +
        '<div class="cin-row">' +
          '<div class="cin-grp">' +
            '<button type="button" class="cin-b" id="cin-back" title="Voltar 10 segundos" aria-label="Voltar 10 segundos"><i class="fa-solid fa-rotate-left"></i><small>10</small></button>' +
            btn('cin-pp', 'fa-play', 'Tocar ou pausar para todos', 'pp') +
            '<button type="button" class="cin-b" id="cin-fwd" title="Avançar 10 segundos" aria-label="Avançar 10 segundos"><i class="fa-solid fa-rotate-right"></i><small>10</small></button>' +
            btn('cin-mute', 'fa-volume-high', 'Silenciar') +
            '<input type="range" class="cin-range" id="cin-vol" min="0" max="1" step="0.02" value="1" aria-label="Volume">' +
          '</div>' +
          '<div class="cin-grp">' +
            btn('cin-sync', 'fa-rotate', 'Sincronizar agora com a sala') +
            btn('cin-cc', 'fa-closed-captioning', 'Legenda (só para você)') +
            btn('cin-menubtn', 'fa-ellipsis-vertical', 'Mais opções') +
            btn('cin-fs', 'fa-expand', 'Tela cheia (com o chat)') +
          '</div>' +
        '</div>' +
      '</div>' +
      '<div id="cin-menu" hidden role="menu">' +
        '<button type="button" class="cin-mi" id="cin-m-sub"><i class="fa-solid fa-closed-captioning"></i><span id="cin-m-subt">Carregar legenda (.srt / .vtt)</span></button>' +
        '<div class="cin-mrow" id="cin-m-subrow" hidden><span>Ajuste da legenda</span><span class="cin-grp">' +
          '<button type="button" class="cin-s" id="cin-subm" title="Legenda aparece mais cedo">-0,5s</button><span id="cin-subo">0 s</span>' +
          '<button type="button" class="cin-s" id="cin-subp" title="Legenda aparece mais tarde">+0,5s</button>' +
          '<button type="button" class="cin-s" id="cin-subx" title="Remover a legenda">✕</button></span></div>' +
        '<div class="cin-mrow" id="cin-m-sizerow" hidden><span>Tamanho da legenda</span><span class="cin-grp">' +
          '<button type="button" class="cin-s" id="cin-sz-s" title="Legenda pequena">Pequena</button>' +
          '<button type="button" class="cin-s" id="cin-sz-m" title="Legenda média">Média</button>' +
          '<button type="button" class="cin-s" id="cin-sz-l" title="Legenda grande">Grande</button></span></div>' +
        '<div class="cin-mrow" id="cin-m-arrow"><span>Proporção da tela</span><span class="cin-grp">' +
          '<button type="button" class="cin-s" id="cin-ar-auto" title="Usa a proporção original do filme">Auto</button>' +
          '<button type="button" class="cin-s" id="cin-ar-169" title="Forçar 16:9">16:9</button>' +
          '<button type="button" class="cin-s" id="cin-ar-43" title="Forçar 4:3">4:3</button>' +
          '<button type="button" class="cin-s" id="cin-ar-219" title="Forçar 21:9">21:9</button>' +
          '<button type="button" class="cin-s" id="cin-ar-fill" title="Preencher a tela (corta as bordas)">Preencher</button></span></div>' +
        '<div class="cin-sep"></div>' +
        '<button type="button" class="cin-mi" id="cin-m-swap"><i class="fa-solid fa-file-video"></i><span>Trocar meu arquivo</span></button>' +
        '<button type="button" class="cin-mi" id="cin-m-new"><i class="fa-solid fa-clapperboard"></i><span>Abrir outro filme para a sala</span></button>' +
        '<div class="cin-sep"></div>' +
        '<button type="button" class="cin-mi" id="cin-m-leave"><i class="fa-solid fa-right-from-bracket"></i><span>Sair (só para mim)</span></button>' +
        '<button type="button" class="cin-mi danger" id="cin-m-end"><i class="fa-solid fa-power-off"></i><span>Encerrar para todos</span></button>' +
      '</div>';

    lsBtn = document.createElement('button');
    lsBtn.id = 'cin-lstart'; lsBtn.type = 'button';
    lsBtn.innerHTML = '<i class="fa-solid fa-clapperboard" aria-hidden="true"></i><span>Assistir filme junto</span>';
    lsNew = document.createElement('button');
    lsNew.id = 'cin-lsnew'; lsNew.type = 'button';
    lsNew.innerHTML = '<i class="fa-solid fa-plus" aria-hidden="true"></i><span>Abrir outro filme</span>';
    lsGrp = document.createElement('div');
    lsGrp.id = 'cin-lsgrp';
    lsGrp.appendChild(lsBtn); lsGrp.appendChild(lsNew);
    lsInput = document.createElement('input');
    lsInput.type = 'file'; lsInput.accept = 'video/*,.mkv,.mp4,.m4v,.webm,.mov'; lsInput.hidden = true;
    subInput = document.createElement('input');
    subInput.type = 'file'; subInput.accept = '.srt,.vtt,text/vtt,application/x-subrip,text/plain'; subInput.hidden = true;

    box.appendChild(layer); box.appendChild(lsGrp); box.appendChild(lsInput); box.appendChild(subInput);

    const ids = ['video', 'sub', 'title', 'chip', 'led', 'chip-t', 'msg', 'msg-t', 'msg-s', 'pick', 'resume', 'new', 'later', 'ui', 'cur', 'dur', 'seek', 'back', 'pp', 'fwd', 'mute', 'vol', 'sync', 'cc', 'menubtn', 'fs', 'menu', 'm-sub', 'm-subt', 'm-subrow', 'm-sizerow', 'sz-s', 'sz-m', 'sz-l', 'ar-auto', 'ar-169', 'ar-43', 'ar-219', 'ar-fill', 'subm', 'subo', 'subp', 'subx', 'm-swap', 'm-new', 'm-leave', 'm-end'];
    els = {};
    ids.forEach(k => { els[k.replace(/-(\w)/g, (m, c) => c.toUpperCase())] = $('cin-' + k); });
    bind();
    return true;
  }

  const paint = (inp) => { if (!inp) return; const mx = Number(inp.max) || 1; inp.style.setProperty('--p', Math.min(100, Math.max(0, Number(inp.value) / mx * 100)) + '%'); };
  const poke = () => { lastAct = nowMs(); if (layer) layer.classList.remove('idle'); };

  function bind() {
    // abrir
    lsBtn.addEventListener('click', () => { pickMode = ls && !ls.url ? 'attach' : 'create'; lsInput.click(); });
    lsNew.addEventListener('click', () => { pickMode = 'create'; lsInput.click(); });
    lsInput.addEventListener('change', () => {
      const f = lsInput.files && lsInput.files[0]; lsInput.value = '';
      if (!f) return;
      if (pickMode === 'attach' && ls) lsAttach(f); else lsCreate(f);
    });
    els.pick.addEventListener('click', () => { pickMode = 'attach'; lsInput.click(); });
    els.new.addEventListener('click', () => { pickMode = 'create'; lsInput.click(); });
    els.later.addEventListener('click', lsLeave);
    els.resume.addEventListener('click', () => { if (!ls) return; ls.blocked = false; lsMsg(''); lsSync(true); });

    // controles
    els.pp.addEventListener('click', () => lsCmd('toggle'));
    els.back.addEventListener('click', () => lsCmd('back'));
    els.fwd.addEventListener('click', () => lsCmd('fwd'));
    els.seek.addEventListener('input', () => { if (ls) ls.drag = true; paint(els.seek); tr(els.cur, fmt(Number(els.seek.value))); });
    els.seek.addEventListener('change', () => { if (ls) ls.drag = false; lsCmd('seek', Number(els.seek.value)); });
    els.mute.addEventListener('click', () => { els.video.muted = !els.video.muted; lsVolUi(); });
    els.vol.addEventListener('input', () => {
      lsV = Number(els.vol.value) || 0; els.video.muted = false; els.video.volume = lsV; lsVolUi();
      try { localStorage.setItem('cinVol', String(lsV)); } catch (e) {}
    });
    els.sync.addEventListener('click', lsResync);
    els.cc.addEventListener('click', () => { if (ls && ls.subs) toggleMenu(); else if (ls && ls.url) subInput.click(); });
    els.fs.addEventListener('click', toggleFs);
    els.menubtn.addEventListener('click', toggleMenu);

    // menu
    els.mSub.addEventListener('click', () => { closeMenu(); if (ls && ls.url) subInput.click(); });
    subInput.addEventListener('change', () => { const f = subInput.files && subInput.files[0]; subInput.value = ''; if (f) lsSubLoad(f); });
    ['s', 'm', 'l'].forEach(k => els['sz' + k.toUpperCase()].addEventListener('click', () => setSubSize(k)));
    layer.dataset.sub = subSize;
    Object.keys(AR_MODES).forEach(k => els['ar' + (k === 'auto' || k === 'fill' ? k[0].toUpperCase() + k.slice(1) : k)].addEventListener('click', () => setAspect(k)));
    ['loadedmetadata', 'loadeddata', 'resize', 'emptied'].forEach(ev => els.video.addEventListener(ev, fitVideo));
    window.addEventListener('resize', fitVideo);
    document.addEventListener('fullscreenchange', () => { fitVideo(); setTimeout(fitVideo, 150); });
    if (window.ResizeObserver) { arObs = new ResizeObserver(fitVideo); arObs.observe(layer); }
    setAspect(arMode, true);
    els.subm.addEventListener('click', () => lsSubShift(-0.5));
    els.subp.addEventListener('click', () => lsSubShift(0.5));
    els.subx.addEventListener('click', () => { lsSubClear(); lsUi(); notify('Legenda removida.', 'info'); });
    els.mSwap.addEventListener('click', () => { closeMenu(); pickMode = 'attach'; lsInput.click(); });
    els.mNew.addEventListener('click', () => { closeMenu(); pickMode = 'create'; lsInput.click(); });
    els.mLeave.addEventListener('click', () => { closeMenu(); lsLeave(); });
    els.mEnd.addEventListener('click', () => { closeMenu(); lsEnd(); });

    // clicar no filme = pausar/continuar (no celular, o primeiro toque só mostra os controles)
    els.video.addEventListener('click', () => { if (idleAtDown) { idleAtDown = false; return; } if (ls && ls.url) lsCmd('toggle'); });
    layer.addEventListener('pointerdown', () => { idleAtDown = layer.classList.contains('idle'); poke(); });
    layer.addEventListener('pointermove', poke);
    els.ui.addEventListener('pointerenter', () => { overUi = true; });
    els.ui.addEventListener('pointerleave', () => { overUi = false; });

    // eventos do <video>
    ['play', 'pause', 'ended', 'seeked', 'loadedmetadata', 'durationchange'].forEach(ev => els.video.addEventListener(ev, () => lsUi()));
    els.video.addEventListener('pause', onNativeToggle);
    els.video.addEventListener('play', onNativeToggle);

    if (bound) return; bound = true;
    document.addEventListener('pointerdown', (e) => { if (menuOpen && els.menu && !els.menu.contains(e.target) && !els.menubtn.contains(e.target) && !els.cc.contains(e.target)) closeMenu(); });
    document.addEventListener('fullscreenchange', () => lsUi());
    document.addEventListener('keydown', onKey);
  }

  // pausou/continuou por fora dos nossos botões (tecla de mídia do teclado/fone): vira comando para a sala
  function onNativeToggle(e) {
    if (!ls || !ls.url || !ls.rem || ls.blocked) return;
    const v = els.video;
    if (v.ended || v.seeking || nowMs() - ls.lastCmdAt < 900) return;
    if (e.type === 'pause' && !ls.rem.p) { if (canCtl(me())) lsCmd('pause'); else lsSync(true); }
    else if (e.type === 'play' && ls.rem.p) { if (canCtl(me())) lsCmd('play'); else lsSync(true); }
  }

  function onKey(e) {
    if (!ls || !ls.url || !layer || !layer.classList.contains('on')) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const t = e.target;
    if (t && t.closest && t.closest('input:not(.cin-range),textarea,select,[contenteditable="true"]')) return;
    const k = e.key;
    if (k === ' ' || k === 'k' || k === 'K') { if (t && t.tagName === 'BUTTON') return; e.preventDefault(); lsCmd('toggle'); }
    else if (k === 'ArrowRight') { e.preventDefault(); lsCmd('fwd'); }
    else if (k === 'ArrowLeft') { e.preventDefault(); lsCmd('back'); }
    else if (k === 'f' || k === 'F') { e.preventDefault(); toggleFs(); }
    else if (k === 'm' || k === 'M') { e.preventDefault(); els.video.muted = !els.video.muted; lsVolUi(); }
    else return;
    poke();
  }

  function toggleFs() {
    if (window.toggleStageFullscreen) return window.toggleStageFullscreen();     // tela cheia COM o chat (fullscreen.js)
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else if (layer && layer.requestFullscreen) layer.requestFullscreen().catch(() => {});
  }
  function closeMenu() { menuOpen = false; if (els.menu) els.menu.hidden = true; if (els.menubtn) els.menubtn.classList.remove('act'); }
  function toggleMenu() { if (menuOpen) return closeMenu(); menuOpen = true; els.menu.hidden = false; els.menubtn.classList.add('act'); lsUi(); poke(); }

  function lsMsg(kind, a, b) {
    if (!els.msg) return;
    els.msg.hidden = !kind;
    els.pick.hidden = kind !== 'pick'; els.later.hidden = kind !== 'pick'; els.resume.hidden = kind !== 'resume';
    els.new.hidden = !(kind === 'pick' && canCtl(me()));
    const row = els.msg.querySelector('.row'); if (row) row.hidden = kind !== 'pick' && kind !== 'resume';
    tr(els.msgT, a || ''); tr(els.msgS, b || '');
  }
  function lsMsgPick() {
    if (!ls) return;
    lsMsg('pick', nameOf(ls.owner) + ' abriu um filme', cut(ls.name, 90) + ' (' + fmtSize(ls.size) + '). Escolha o MESMO arquivo no seu computador para assistir junto.');
  }

  function lsVolUi() {
    const v = els.video; if (!v || !els.mute) return;
    const m = v.muted || lsV === 0;
    els.mute.innerHTML = '<i class="fa-solid ' + (m ? 'fa-volume-xmark' : 'fa-volume-high') + '"></i>';
    els.vol.value = String(m ? 0 : lsV); paint(els.vol);
  }

  function layerShow() {
    layer.classList.add('on');
    document.body.classList.add('cin-on');
    poke(); quietOn(); keepAwake();
  }
  function resetVideo() {
    const v = els.video; if (!v) return;
    try { v.pause(); } catch (e) {}
    try { v.querySelectorAll('track').forEach(t => t.remove()); } catch (e) {}
    v.removeAttribute('src'); try { v.load(); } catch (e) {}
    try { v.playbackRate = 1; } catch (e) {}
  }
  function layerHide() {
    if (!layer) return;
    closeMenu();
    layer.classList.remove('on', 'hasfile', 'idle');
    resetVideo();
    lsMsg('');
    if (document.fullscreenElement && document.fullscreenElement === layer) document.exitFullscreen().catch(() => {});
    document.body.classList.remove('cin-on');
    try { document.dispatchEvent(new Event('cinema-end')); } catch (e) {}
    quietOff(); releaseAwake();
  }

  function refreshButton() {
    if (!injectUI()) return;
    if (ls && !inMovies()) { lsClose(true); notify('O "Assistir junto" só funciona em salas de Filmes.', 'info'); return; }
    let on = false, label = 'Assistir filme junto';
    if (inMovies() && !(ls && ls.url)) {
      if (ls) { on = true; label = 'Escolher o arquivo: ' + cut(ls.name, 26); }
      else if (canCtl(me())) on = true;
    }
    lsBtn.classList.toggle('on', on);
    tr(lsBtn.querySelector('span'), label);
    lsNew.classList.toggle('on', on && !!ls && canCtl(me()));      // há um filme aberto na sala que eu ainda não carreguei: posso abrir outro
  }

  /* ============================================================
     SESSÃO
     ============================================================ */
  // referência = quem manda os batimentos: o dono da sessão se ele estiver na sala com o arquivo; senão o menor id entre quem tem o arquivo
  function lsRef() {
    if (!ls) return null;
    const ids = new Set(users().map(u => u.id));
    const pool = Array.from(ls.ready).filter(id => ids.has(id) && canCtl(id));
    if (!pool.length) return null;
    return pool.includes(ls.owner) ? ls.owner : pool.sort()[0];
  }
  const isRef = () => !!ls && lsRef() === me();

  function lsNow() {
    if (ls && ls.url) { const v = els.video; return { tt: v.currentTime || 0, p: !!(v.paused || v.ended) }; }
    const r = ls && ls.rem;
    if (!r) return { tt: 0, p: true };
    return { tt: r.tt + (r.p ? 0 : (nowMs() - r.at) / 1000), p: r.p };
  }

  /* relógio: cada ping/pong dá (ida+volta) e o desvio entre o relógio da outra pessoa e o meu.
     A amostra de MENOR ida+volta é a mais confiável (menos fila de rede), então é a usada. */
  function clkSample(id, rtt, off) {
    let c = ls.clk.get(id); if (!c) { c = []; ls.clk.set(id, c); }
    c.push({ rtt, off }); if (c.length > 8) c.shift();
  }
  function clkBest(id) {
    const c = ls && ls.clk.get(id); if (!c || !c.length) return null;
    let b = c[0]; for (const x of c) if (x.rtt < b.rtt) b = x; return b;
  }
  // segundos desde que a mensagem foi escrita (s = relógio de quem enviou)
  function transit(id, s) {
    const b = clkBest(id);
    if (!b || !Number.isFinite(s)) return 0.12;
    return Math.min(2.5, Math.max(0, (nowMs() - (s - b.off)) / 1000));
  }

  function lsStart() {
    clearInterval(ls.tick); clearInterval(ls.hb); clearInterval(ls.pg);
    ls.tick = setInterval(lsTick, 500);
    ls.hb = setInterval(lsBeat, 2000);
    ls.pg = setInterval(lsPingAll, 6000);
    [300, 900, 1800].forEach(ms => setTimeout(lsPingAll, ms));   // rajada inicial: já mede o relógio de todo mundo
  }

  async function lsLoad(file, sess) {
    const seq = ++loadSeq, v = els.video;
    resetVideo();
    const url = URL.createObjectURL(file);
    return new Promise((resolve) => {
      let fin = false;
      const t = setTimeout(() => fail(), 20000);
      const cleanup = () => { clearTimeout(t); v.removeEventListener('loadedmetadata', ok); v.removeEventListener('error', fail); };
      function fail() {
        if (fin) return; fin = true; cleanup();
        try { URL.revokeObjectURL(url); } catch (e) {}
        if (seq === loadSeq && ls === sess) {
          try { v.removeAttribute('src'); v.load(); } catch (e) {}
          notify('Não consegui abrir esse arquivo. O navegador toca MP4 (H.264 + AAC) e WebM; converta MKV/HEVC/AC3 antes.', 'error');
        }
        resolve(false);
      }
      function ok() {
        if (fin) return; fin = true; cleanup();
        if (seq !== loadSeq || ls !== sess) { try { URL.revokeObjectURL(url); } catch (e) {} resolve(false); return; }   // outra escolha passou na frente / sessão acabou
        sess.url = url; sess.ready.add(me());
        resolve(true);
      }
      v.addEventListener('loadedmetadata', ok); v.addEventListener('error', fail);
      v.muted = false; v.volume = lsV; v.playbackRate = 1; v.src = url;
    });
  }

  const newSession = (o) => Object.assign({ url: null, ready: new Set(), clk: new Map(), rem: null, lastCmdAt: 0, drag: false, dismissed: false, blocked: false, drift: 0, subs: null, subOff: 0 }, o);

  // abre um filme NOVO (sempre uma sessão nova: nada do filme anterior sobra)
  async function lsCreate(file) {
    if (!ctx) return;
    if (!inMovies()) return notify('O "Assistir junto" só existe em salas da categoria Filmes.', 'error');
    if (!canCtl(me())) return notify('Os anfitriões travaram os controles da sala.', 'error');
    injectUI();
    lsDrop();                                  // derruba a sessão anterior por completo (timers, arquivo, legenda)
    try { const yt = ctx.yt && ctx.yt(); if (yt && yt.pauseVideo) yt.pauseVideo(); } catch (e) {}
    const sid = Math.random().toString(36).slice(2, 10);
    const sess = ls = newSession({ sid, owner: me(), name: cut(file.name, 160), size: file.size, d: 0 });
    layerShow();
    lsMsg('load', 'Carregando o arquivo…', cut(file.name, 90));
    if (!(await lsLoad(file, sess))) { if (ls === sess) lsClose(true); return; }
    sess.d = vDur();
    sess.rem = { tt: 0, p: true, at: nowMs(), self: true };
    lsMsg(''); lsStart(); lsUi(); lsVolUi();
    lsAll({ t: 'ls-open', sid, name: sess.name, size: sess.size, d: sess.d, tt: 0, p: true, s: nowMs() });
    lsAll({ t: 'ls-ready', sid });
    refreshButton();
    notify('Sessão aberta. Peça para a outra pessoa escolher o MESMO arquivo e depois é só dar play.', 'success');
  }

  // escolhe/troca o MEU arquivo de um filme que já está aberto na sala
  async function lsAttach(file) {
    if (!ls) return;
    const s = ls;
    if (file.size !== s.size && !confirm('Esse arquivo tem tamanho diferente do filme aberto por ' + nameOf(s.owner) + ' (' + fmtSize(file.size) + ' contra ' + fmtSize(s.size) + ').\nSe não for exatamente o mesmo arquivo, a sincronia pode ficar errada. Usar mesmo assim?')) return;
    clearInterval(s.tick); clearInterval(s.hb); clearInterval(s.pg); s.tick = s.hb = s.pg = null;
    if (s.url) { try { URL.revokeObjectURL(s.url); } catch (e) {} s.url = null; }
    lsSubClear();
    s.ready.delete(me());
    layerShow();
    lsMsg('load', 'Carregando o arquivo…', cut(file.name, 90));
    if (!(await lsLoad(file, s))) { if (ls === s) lsMsgPick(); return; }
    if (ls !== s) return;
    s.dismissed = false; s.blocked = false;
    const d = vDur();
    if (s.d && d && Math.abs(d - s.d) > 2) notify('A duração desse arquivo é diferente da do filme aberto. A sincronia pode ficar errada.', 'error');
    lsMsg(''); lsStart(); lsUi(); lsVolUi();
    lsAll({ t: 'ls-ready', sid: s.sid });
    lsSync(true);
    refreshButton();
  }

  // para tudo da sessão atual SEM fechar o player (usado ao abrir outro filme ou quando chega um filme novo)
  function lsDrop() {
    const s = ls; if (!s) return;
    clearInterval(s.tick); clearInterval(s.hb); clearInterval(s.pg); s.tick = s.hb = s.pg = null;
    ++loadSeq;                                  // cancela qualquer carregamento em andamento
    lsSubClear();
    if (s.url) { try { URL.revokeObjectURL(s.url); } catch (e) {} s.url = null; }
    ls = null;
    resetVideo();
  }
  function lsUnload() {
    if (!ls) return;
    const s = ls;
    clearInterval(s.tick); clearInterval(s.hb); clearInterval(s.pg); s.tick = s.hb = s.pg = null;
    ++loadSeq;
    lsSubClear();
    if (s.url) { try { URL.revokeObjectURL(s.url); } catch (e) {} s.url = null; }
    layerHide();
  }
  // sair só para mim: a sessão continua para os outros
  function lsLeave() {
    if (!ls) return;
    lsAll({ t: 'ls-unready', sid: ls.sid });
    lsUnload();
    ls.ready.delete(me()); ls.dismissed = true;
    refreshButton();
  }
  function lsEnd() {
    if (!ls || !canCtl(me())) return;
    lsAll({ t: 'ls-end', sid: ls.sid });
    lsClose(true);
    notify('Sessão encerrada para todos.', 'info');
  }
  function lsClose() {
    if (!ls) return;
    lsUnload(); ls = null;
    refreshButton();
  }

  /* ---------- sincronia ---------- */
  function lsSync(force) {
    if (!ls || !ls.url || !ls.rem) return;
    if (!force && isRef()) return;                 // a referência não se corrige: ela é quem manda
    const v = els.video, r = ls.rem;
    if (v.readyState < 1) return;
    const dur = vDur() || 1e9, playing = !r.p;
    const exp = Math.min(Math.max(0, r.tt + (playing ? (nowMs() - r.at) / 1000 : 0)), dur);
    const diff = (v.currentTime || 0) - exp;      // > 0: estou adiantado
    ls.drift = diff;
    if (!playing) {
      if (v.playbackRate !== 1) v.playbackRate = 1;
      if (!v.paused) v.pause();
      if (Math.abs(diff) > 0.08 && !v.seeking) { try { v.currentTime = exp; } catch (e) {} }
      return;
    }
    if (!v.seeking && v.readyState >= 3) {
      const ad = Math.abs(diff);
      if (ad > (force ? 0.25 : 0.8)) { try { v.currentTime = Math.min(exp + (r.self ? 0 : 0.15), dur); } catch (e) {} v.playbackRate = 1; }
      else if (ad > 0.06) v.playbackRate = 1 - Math.max(-0.1, Math.min(0.1, diff * 0.5));   // adiantado: desacelera; atrasado: acelera
      else if (v.playbackRate !== 1) v.playbackRate = 1;
    }
    if (v.paused && !v.ended && !ls.blocked) {
      const s = ls;
      v.play().catch(() => { if (ls === s) { s.blocked = true; lsMsg('resume', 'O navegador bloqueou o play automático.', 'Clique para continuar o filme.'); } });
    }
  }

  function lsTick() {
    if (!ls || !ls.url) return;
    lsSync(false); lsUi();
    // some sozinho: filme tocando, mouse parado, menu fechado
    if (layer && !menuOpen && !overUi && !els.video.paused && nowMs() - lastAct > 3000) layer.classList.add('idle');
    else if (els.video.paused) layer.classList.remove('idle');
  }

  function lsBeat() {
    if (!ls || !ls.url || !isRef()) return;
    const n = lsNow();
    lsAll({ t: 'ls-st', sid: ls.sid, hb: 1, tt: n.tt, p: n.p, d: vDur(), s: nowMs() });
  }

  function lsPingAll() {
    if (!ls) return;
    users().forEach(u => { if (u.id !== me()) send(u.id, { t: 'ls-ping', c: nowMs() }); });
  }

  // botão "Sincronizar": pede o estado atual da referência e se alinha na hora
  function lsResync() {
    if (!ls || !ls.url) return;
    const r = lsRef();
    if (!r) return notify('Ninguém com o arquivo aberto para servir de referência.', 'info');
    if (r === me()) return notify('Você é a referência da sincronia: os outros é que se ajustam a você.', 'info');
    send(r, { t: 'ls-req', sid: ls.sid });
    lsSync(true);
    notify('Sincronizando com ' + nameOf(r) + '…', 'info');
  }

  // comando de quem pode controlar (botões, clique no filme, teclado, botão do site)
  function lsCmd(k, t) {
    if (!ls || !ls.url) return false;
    if (!canCtl(me())) { notify('Os anfitriões travaram os controles da sala.', 'info'); return true; }
    const v = els.video, dur = vDur() || 1e9, cur = v.currentTime || 0;
    let p = !!(v.paused || v.ended), tt = cur;
    if (k === 'toggle') p = !p;
    else if (k === 'play') p = false;
    else if (k === 'pause') p = true;
    else if (k === 'fwd') tt = cur + 10;
    else if (k === 'back') tt = cur - 10;
    else if (k === 'seek') tt = Number(t) || 0;
    else return true;
    tt = Math.min(Math.max(0, tt), dur);
    if (!p && v.ended) tt = 0;
    ls.rem = { tt, p, at: nowMs(), self: true };
    ls.lastCmdAt = nowMs(); ls.blocked = false; lsMsg('');
    lsSync(true);
    lsAll({ t: 'ls-st', sid: ls.sid, tt, p, d: vDur(), s: nowMs() });
    lsUi(); poke();
    return true;
  }

  function lsUi() {
    if (!layer || !ls) return;
    const v = els.video, has = !!ls.url, ctl = canCtl(me()), d = vDur() || ls.d || 0;
    layer.classList.toggle('hasfile', has);
    tr(els.title, ls.name);
    els.fs.innerHTML = '<i class="fa-solid ' + (document.fullscreenElement ? 'fa-compress' : 'fa-expand') + '"></i>';
    if (!has) return;
    const cur = v.currentTime || 0;
    els.back.hidden = els.pp.hidden = els.fwd.hidden = !ctl;
    els.seek.disabled = !ctl;
    els.mNew.hidden = !ctl; els.mEnd.hidden = !ctl;
    tr(els.dur, d ? fmt(d) : '--:--');
    if (!ls.drag) { els.seek.max = String(Math.floor(d) || 0); els.seek.value = String(Math.floor(cur)); tr(els.cur, fmt(cur)); paint(els.seek); }
    els.pp.innerHTML = '<i class="fa-solid ' + (v.paused || v.ended ? 'fa-play' : 'fa-pause') + '"></i>';
    lsVolUi();
    // menu
    els.mSubrow.hidden = !ls.subs; els.mSizerow.hidden = !ls.subs;
    ['s', 'm', 'l'].forEach(k => els['sz' + k.toUpperCase()].classList.toggle('act', subSize === k));
    tr(els.mSubt, ls.subs ? 'Trocar legenda' : 'Carregar legenda (.srt / .vtt)');
    tr(els.subo, ((ls.subOff || 0) > 0 ? '+' : '') + String(ls.subOff || 0).replace('.', ',') + ' s');
    els.cc.classList.toggle('act', !!ls.subs);
    // status
    const ids = new Set(users().map(u => u.id)); let n = 0; ls.ready.forEach(id => { if (ids.has(id)) n++; });
    let st, cls = '';
    if (isRef()) { st = 'você é a referência'; cls = 'ok'; }
    else if (!ls.rem) st = 'aguardando';
    else if (Math.abs(ls.drift) < 0.2) { st = 'sincronizado'; cls = 'ok'; }
    else { st = 'ajustando (' + Math.abs(ls.drift).toFixed(1).replace('.', ',') + ' s)'; cls = 'adj'; }
    els.led.className = 'led ' + cls;
    tr(els.chipT, n + '/' + users().length + ' com o arquivo · ' + st);
  }

  /* ---------- legenda local (.srt / .vtt): cada pessoa carrega a sua; o filme já está sincronizado, então ela acompanha ---------- */
  const subTime = (a) => {
    const m = /^(?:(\d+):)?(\d{1,2}):(\d{2})[,.](\d{1,3})$/.exec(String(a).trim());
    return m ? (+(m[1] || 0)) * 3600 + (+m[2]) * 60 + (+m[3]) + Number((m[4] + '00').slice(0, 3)) / 1000 : null;
  };
  const vttTime = (x) => {
    let t = Math.round(Math.max(0, x) * 1000); const ms = t % 1000; t = (t - ms) / 1000;
    const sec = t % 60; t = (t - sec) / 60; const min = t % 60, h = (t - min) / 60;
    const z = (n, w) => String(n).padStart(w, '0');
    return z(h, 2) + ':' + z(min, 2) + ':' + z(sec, 2) + '.' + z(ms, 3);
  };
  function parseSubs(text) {
    const cues = [];
    String(text).replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').split(/\n{2,}/).forEach(block => {
      const lines = block.split('\n'), i = lines.findIndex(l => l.includes('-->'));
      if (i < 0) return;
      const parts = lines[i].split('-->');
      const a = subTime(parts[0]), b = subTime(String(parts[1]).trim().split(/\s+/)[0]);
      if (a == null || b == null) return;
      const t = lines.slice(i + 1).join('\n').replace(/\{\\[^}]*\}/g, '').replace(/<(?!\/?[ibu]>)[^>]*>/gi, '').replace(/&(?!(amp|lt|gt|nbsp);)/g, '&amp;').trim();
      if (t) cues.push({ s: a, e: b, t });
    });
    return cues;
  }
  // Encaixa a imagem na tela respeitando a proporção (nunca esticada). Em "auto" usa a proporção real do arquivo;
  // nas outras, a escolhida (corrige arquivos com proporção errada no cabeçalho). "Preencher" cobre a tela cortando as bordas.
  function fitVideo() {
    const v = els && els.video; if (!v || !layer) return;
    const W = layer.clientWidth, H = layer.clientHeight, vw = v.videoWidth, vh = v.videoHeight;
    const st = v.style, m = AR_MODES[arMode];
    if (!W || !H || !vw || !vh) { st.cssText = ''; return; }
    if (m < 0) { st.cssText = 'left:0;top:0;width:100%;height:100%;object-fit:cover'; return; }
    const r = m > 0 ? m : vw / vh;
    let w = W, h = W / r;
    if (h > H) { h = H; w = H * r; }
    st.cssText = 'left:' + ((W - w) / 2).toFixed(2) + 'px;top:' + ((H - h) / 2).toFixed(2) + 'px;width:' + w.toFixed(2) + 'px;height:' + h.toFixed(2) + 'px;object-fit:fill';
  }
  function setAspect(k, silent) {
    if (!Object.prototype.hasOwnProperty.call(AR_MODES, k)) k = 'auto';
    arMode = k;
    if (!silent) { try { localStorage.setItem('cinAspect', k); } catch (e) {} }
    Object.keys(AR_MODES).forEach(x => { const b = els['ar' + (x === 'auto' || x === 'fill' ? x[0].toUpperCase() + x.slice(1) : x)]; if (b) b.classList.toggle('act', x === k); });
    fitVideo();
  }

  function setSubSize(k) {
    subSize = k; if (layer) layer.dataset.sub = k;
    try { localStorage.setItem('cinSubSize', k); } catch (e) {}
    lsUi();
  }
  function subShow(track) {
    if (!els.sub) return;
    els.sub.textContent = '';
    let cues; try { cues = track && track.activeCues ? Array.from(track.activeCues) : []; } catch (e) { cues = []; }
    cues.forEach(c => {
      const sp = document.createElement('span');
      try { sp.appendChild(c.getCueAsHTML()); } catch (e) { sp.textContent = c.text; }
      els.sub.appendChild(sp);
    });
  }
  function lsSubDrop() {
    if (els.sub) els.sub.textContent = '';
    if (!ls) return;
    if (ls.subEl) { try { ls.subEl.remove(); } catch (e) {} ls.subEl = null; }
    if (ls.subUrl) { try { URL.revokeObjectURL(ls.subUrl); } catch (e) {} ls.subUrl = null; }
  }
  function lsSubClear() { if (!ls) return; lsSubDrop(); ls.subs = null; ls.subOff = 0; }
  function lsSubApply() {
    if (!ls || !ls.subs || !els.video) return;
    const off = ls.subOff || 0;
    let out = 'WEBVTT\n\n';
    ls.subs.forEach(c => { const a = c.s + off, b = c.e + off; if (b > 0) out += vttTime(a) + ' --> ' + vttTime(b) + '\n' + c.t + '\n\n'; });
    lsSubDrop();
    const url = URL.createObjectURL(new Blob([out], { type: 'text/vtt' }));
    const el = document.createElement('track');
    el.kind = 'subtitles'; el.label = 'Legenda'; el.srclang = 'pt'; el.default = true; el.src = url;
    els.video.appendChild(el);
    ls.subUrl = url; ls.subEl = el;
    // a legenda é desenhada por nós (#cin-sub), acima dos controles; o desenho nativo do navegador fica desligado
    try {
      for (const t of els.video.textTracks) t.mode = (el.track && t === el.track) ? 'hidden' : 'disabled';
      if (el.track) { el.track.addEventListener('cuechange', () => subShow(el.track)); }
    } catch (e) {}
  }
  function lsSubShift(d) {
    if (!ls || !ls.subs) return;
    ls.subOff = Math.round(((ls.subOff || 0) + d) * 10) / 10;
    lsSubApply(); lsUi();
  }
  async function lsSubLoad(file) {
    if (!ls || !ls.url) return;
    if (/\.(ass|ssa|sub|idx)$/i.test(file.name)) return notify('Esse formato de legenda não é suportado. Use .srt ou .vtt (dá para converter .ass/.ssa em sites como subtitletools).', 'error');
    if (file.size > 5e6) return notify('Esse arquivo de legenda é grande demais (máx. 5 MB). Confira se é mesmo uma legenda .srt ou .vtt.', 'error');
    let buf;
    try { buf = await file.arrayBuffer(); } catch (e) { return notify('Não consegui ler o arquivo de legenda.', 'error'); }
    let text;
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(buf); }          // a maioria está em UTF-8
    catch (e) { try { text = new TextDecoder('windows-1252').decode(buf); } catch (x) { text = new TextDecoder().decode(buf); } }   // .srt antigo em ANSI: acentos corretos
    const cues = parseSubs(text);
    if (!ls || !ls.url) return;
    if (!cues.length) return notify('Não encontrei falas nesse arquivo. Use uma legenda .srt ou .vtt.', 'error');
    ls.subs = cues; ls.subOff = 0;
    lsSubApply(); lsUi();
    notify('Legenda carregada (' + cues.length + ' falas). Só você vê essa legenda; cada pessoa carrega a sua.', 'success');
  }

  /* ---------- mensagens ---------- */
  function lsOnSignal(p) {
    if (!inMovies()) return;
    const sid = typeof p.sid === 'string' ? p.sid.slice(0, 24) : '';
    switch (p.t) {
      case 'ls-hello': {
        if (!ls) return;
        if (ls.url) send(p.from, { t: 'ls-ready', sid: ls.sid });
        if (isRef()) { const n = lsNow(); send(p.from, { t: 'ls-open', sid: ls.sid, name: ls.name, size: ls.size, d: ls.d, tt: n.tt, p: n.p, hello: 1, s: nowMs() }); }
        return;
      }
      case 'ls-open': {
        const size = Number(p.size), d = Number(p.d);
        if (!sid || !Number.isFinite(size) || size <= 0 || !canCtl(p.from)) return;
        const rem = Number.isFinite(p.tt) ? { tt: Math.max(0, p.tt), p: p.p !== false, at: nowMs() - transit(p.from, p.s) * 1000 } : null;
        if (ls && ls.sid === sid) {
          if (nowMs() - ls.lastCmdAt < 1500) return;   // resposta atrasada logo depois de um comando meu: ignora
          if (rem && ls.url && !isRef()) { ls.rem = rem; lsSync(true); } else if (rem && !ls.url) ls.rem = rem;
          return;
        }
        // filme NOVO: derruba o anterior por completo (arquivo, legenda, timers) antes de montar a sessão nova
        lsDrop();
        ls = newSession({ sid, owner: p.from, name: cut(String(p.name || 'filme').replace(/[\u0000-\u001f]/g, ''), 160), size, d: Number.isFinite(d) ? d : 0, rem });
        if (pend.sid === sid) pend.ids.forEach(id => ls.ready.add(id));
        injectUI();
        if (!p.hello) notify(nameOf(p.from) + ' abriu o filme "' + ls.name + '". Escolha o mesmo arquivo para assistir junto.', 'info');
        layerShow();
        lsMsgPick();
        lsUi();
        refreshButton();
        return;
      }
      case 'ls-ready': {
        if (!sid) return;
        if (!ls || ls.sid !== sid) { if (pend.sid !== sid) pend = { sid, ids: new Set() }; pend.ids.add(p.from); return; }
        ls.ready.add(p.from);
        send(p.from, { t: 'ls-ping', c: nowMs() });
        return;
      }
      case 'ls-unready': { if (ls && ls.sid === sid) ls.ready.delete(p.from); return; }
      case 'ls-end': {
        if (!ls || ls.sid !== sid || !canCtl(p.from)) return;
        lsClose(true);
        notify(nameOf(p.from) + ' encerrou o "Assistir junto".', 'info');
        return;
      }
      case 'ls-st': {
        if (!ls || ls.sid !== sid || !canCtl(p.from) || !Number.isFinite(p.tt)) return;
        if (Number.isFinite(p.d) && p.d > 0) ls.d = p.d;
        if (p.hb && nowMs() - ls.lastCmdAt < 1500) return;   // batimento atrasado logo depois de um comando meu: ignora
        ls.rem = { tt: Math.max(0, p.tt), p: !!p.p, at: nowMs() - transit(p.from, p.s) * 1000 };
        if (ls.url && (!p.hb || !isRef())) lsSync(!p.hb);
        return;
      }
      case 'ls-req': {
        if (!ls || ls.sid !== sid || !ls.url || !isRef()) return;
        const n = lsNow();
        send(p.from, { t: 'ls-st', sid: ls.sid, tt: n.tt, p: n.p, d: vDur(), s: nowMs() });
        return;
      }
      case 'ls-ping': { if (ls && p.to === me() && Number.isFinite(p.c)) send(p.from, { t: 'ls-pong', c: p.c, s: nowMs() }); return; }
      case 'ls-pong': {
        if (!ls || !Number.isFinite(p.c) || !Number.isFinite(p.s)) return;
        const t1 = nowMs(), rtt = t1 - p.c;
        if (rtt >= 0 && rtt < 3000) clkSample(p.from, rtt, p.s + rtt / 2 - t1);   // off = relógio dele - meu relógio
        return;
      }
    }
  }

  function lsPresence() {
    if (helloSent) return;
    helloSent = true;
    const c = ctx;
    setTimeout(() => { if (ctx === c && inMovies()) lsAll({ t: 'ls-hello' }); }, 1500);   // quem entra agora pergunta se já existe sessão
  }

  function onSignal(p) {
    if (!ctx || !p || typeof p !== 'object' || typeof p.from !== 'string') return;
    if (typeof p.t !== 'string' || !p.t.startsWith('ls-')) return;      // mensagens da antiga "transmissão" são ignoradas
    if (p.from === me() || (p.to !== '*' && p.to !== me())) return;
    lsOnSignal(p);
  }
  function onPresence() {
    if (!ctx) return;
    refreshButton(); lsPresence(); lsUi();
  }

  function leave() {
    if (ls) { try { if (ctx && ls.url) lsAll({ t: 'ls-unready', sid: ls.sid }); } catch (e) {} lsUnload(); ls = null; }
    helloSent = false; pend = { sid: '', ids: new Set() };
    ctx = null;
    if (lsBtn) lsBtn.classList.remove('on');
    if (lsNew) lsNew.classList.remove('on');
  }

  window.RimkCinema = {
    open(c) { leave(); ctx = c; injectUI(); refreshButton(); },
    leave,
    signal: onSignal,
    presence: onPresence,
    refresh: () => { if (ctx) { refreshButton(); lsUi(); } },
    nonce: () => 0,                                  // (antes: número da transmissão; agora não existe transmissão)
    active: () => !!(ls && ls.url),
    control: (k) => lsCmd(k)                         // botão grande de play / próximo / anterior do site, quando o filme está aberto
  };
})();
