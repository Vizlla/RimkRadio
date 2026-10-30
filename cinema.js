/* CINEMA (RimkRadio): transmissão de um filme/vídeo local do anfitrião para a sala via WebRTC.

   Como funciona
   - O anfitrião (ou sub-host) escolhe um arquivo do computador. Ele toca num <video> local e o navegador
     captura essa imagem/áudio (video.captureStream()).
   - Cada pessoa da sala abre uma conexão WebRTC direta com o anfitrião e recebe o stream. O arquivo nunca
     sobe para servidor nenhum: o anfitrião é quem "envia" (upload = bitrate x número de espectadores).
   - Play, pause e avanço acontecem no player do anfitrião; todo mundo acompanha, então fica sincronizado.
   - O botão só aparece em salas da categoria "Filmes". Quem tem poderes de anfitrião (o sub-host) também controla
     play/pause/avançar: o comando vai por um DataChannel até o anfitrião, que confere o cargo antes de obedecer.
   - A "sinalização" (troca de SDP) usa o canal Realtime da sala (broadcast). A presença da sala carrega
     o campo "cin" (número > 0 = essa pessoa está transmitindo), assim quem entra depois também conecta.
   - TURN opcional: /turn-config.json (gerado no build a partir de TURN_URLS / TURN_USERNAME / TURN_CREDENTIAL).

   ASSISTIR JUNTO (arquivo local nos dois lados): cada pessoa abre o MESMO arquivo no próprio computador e só a
   sincronia (play / pause / posição) trafega pelo canal da sala. Não passa vídeo pela rede: a qualidade é a do arquivo.
   Só existe em salas da categoria "Filmes".

   Integração: script.js chama open / leave / signal / presence / nonce (veja window.RimkCinema no fim). */
(function () {
  'use strict';
  const MAX_VIEWERS = 4;                 // máximo de espectadores além do anfitrião (5 pessoas no total)
  const QUALITIES = [
    { key: '480', label: '480p · ~1,2 Mbps', h: 480, bps: 1200000 },
    { key: '720', label: '720p · ~3 Mbps', h: 720, bps: 3000000 },
    { key: '1080', label: '1080p · ~5 Mbps', h: 1080, bps: 5000000 },
    { key: 'max', label: 'Original · ~8 Mbps', h: 0, bps: 8000000 }
  ];
  const DEFAULT_Q = '720';   // padrão estável; 1080p só se o upload e a CPU do anfitrião aguentarem
  const MAX_SDP = 40000;
  const $ = (id) => document.getElementById(id);

  let ctx = null;                        // { myId, send, retrack, isAdmin, getUsers, notify, yt }
  let box = null, layer = null, startBtn = null, fileInput = null;
  let els = {};
  let iceServers = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun.cloudflare.com:3478'] }];
  let iceLoaded = false;

  // anfitrião (quem transmite)
  let host = null;                       // { video, stream, nonce, peers: Map(uid -> {pc, last}), url, timer, q }
  let myNonce = 0;
  // espectador
  let watch = null;                      // { id, n, pc, retry, timers, stream }
  let quietTimer = null, ytMuted = null, wakeLock = null;
  let ls = null, lsBtn = null, lsInput = null, helloSent = false;   // assistir junto (arquivo local)
  let lsV = 1, pend = { sid: '', ids: new Set() }, subInput = null;

  /* ---------- util ---------- */
  const tr = (el, text) => { if (el) el.textContent = text; };
  const notify = (m, t) => { try { ctx && ctx.notify && ctx.notify(m, t || 'info'); } catch (e) {} };
  const me = () => (ctx && ctx.myId && ctx.myId()) || null;
  const users = () => (ctx && ctx.getUsers && ctx.getUsers()) || [];
  const nameOf = (id) => { const u = users().find(x => x.id === id); return u ? u.name : 'Alguém'; };
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  async function loadIce() {
    if (iceLoaded) return; iceLoaded = true;
    try {
      const r = await fetch('/turn-config.json', { cache: 'no-store' });
      if (!r.ok) return;
      const j = await r.json();
      const extra = [];
      if (Array.isArray(j.iceServers)) extra.push(...j.iceServers.filter(s => s && s.urls));
      else if (j.urls) extra.push({ urls: j.urls, username: j.username, credential: j.credential });
      if (extra.length) iceServers = iceServers.concat(extra);
    } catch (e) { /* sem TURN: só STUN */ }
  }

  function gatherDone(pc, ms) {
    return new Promise((res) => {
      if (pc.iceGatheringState === 'complete') return res();
      const t = setTimeout(done, ms || 3500);
      function done() { clearTimeout(t); pc.removeEventListener('icegatheringstatechange', chk); res(); }
      function chk() { if (pc.iceGatheringState === 'complete') done(); }
      pc.addEventListener('icegatheringstatechange', chk);
    });
  }

  // áudio do filme em estéreo e com bitrate decente (o padrão do Opus no WebRTC é mono/baixo)
  function tuneOpus(sdp) {
    return String(sdp).replace(/a=fmtp:(\d+) ([^\r\n]*)/g, (line, pt, params) => {
      const rtp = new RegExp('a=rtpmap:' + pt + ' opus/48000', 'i');
      if (!rtp.test(sdp)) return line;
      let p = params.replace(/(stereo|sprop-stereo|maxaveragebitrate)=[^;]*;?/g, '').replace(/;+$/, '');
      p += (p ? ';' : '') + 'stereo=1;sprop-stereo=1;maxaveragebitrate=192000';
      return 'a=fmtp:' + pt + ' ' + p;
    });
  }
  // dica de bitrate para o Chrome começar mais alto (por padrão ele sobe devagar e o início fica borrado/travado)
  function tuneVideoSdp(sdp, startKbps, minKbps) {
    const pts = []; String(sdp).replace(/a=rtpmap:(\d+) (VP8|VP9|H264|AV1)\/90000/gi, (m, pt) => { pts.push(pt); return m; });
    let out = String(sdp);
    pts.forEach(pt => {
      const hint = 'x-google-start-bitrate=' + startKbps + ';x-google-min-bitrate=' + minKbps;
      const re = new RegExp('a=fmtp:' + pt + ' ([^\\r\\n]*)');
      if (re.test(out)) out = out.replace(re, (m, p) => /x-google-start-bitrate/.test(p) ? m : 'a=fmtp:' + pt + ' ' + p + ';' + hint);
      else out = out.replace(new RegExp('(a=rtpmap:' + pt + ' [^\\r\\n]*\\r?\\n)'), '$1a=fmtp:' + pt + ' ' + hint + '\r\n');
    });
    return out;
  }
  const validSdp = (s) => typeof s === 'string' && s.length > 20 && s.length < MAX_SDP && s.startsWith('v=0');

  const send = (to, p) => { try { ctx.send(Object.assign({ to, from: me() }, p)); } catch (e) { console.error(e); } };

  async function keepAwake() {
    try { if (navigator.wakeLock && !wakeLock) { wakeLock = await navigator.wakeLock.request('screen'); wakeLock.addEventListener('release', () => { wakeLock = null; }); } } catch (e) {}
  }
  function releaseAwake() { try { if (wakeLock) wakeLock.release(); } catch (e) {} wakeLock = null; }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && (host || watch)) keepAwake();
    else if (document.visibilityState === 'hidden' && host) notify('Mantenha esta aba visível enquanto transmite: em segundo plano o navegador pode fazer o filme travar para todos.', 'info');
  });

  /* ---------- silencia o YouTube enquanto o cinema está ligado ---------- */
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
     ============================================================ */
  const CSS = `
  #cin-start{position:absolute;right:10px;bottom:10px;z-index:15;display:none;align-items:center;gap:8px;background:rgba(6,9,6,.88);color:var(--blue,#99FF00);border:1px solid var(--blue,#99FF00);border-radius:99px;padding:7px 14px;font:600 13px 'Exo 2',system-ui,sans-serif;cursor:pointer;backdrop-filter:blur(4px);transition:box-shadow .2s,background .2s}
  #cin-start.on{display:inline-flex}
  #cin-start:hover{background:var(--blue,#99FF00);color:#000;box-shadow:0 0 18px color-mix(in srgb,var(--blue,#99FF00) 55%,transparent)}
  #cin-start[disabled]{opacity:.55;cursor:not-allowed;background:rgba(6,9,6,.88);color:#8E9A88;border-color:#3a4636;box-shadow:none}
  #cin-layer{position:absolute;inset:0;z-index:20;display:none;flex-direction:column;background:#000;color:#E8E8E3;font-family:'Exo 2',system-ui,sans-serif}
  #cin-layer.on{display:flex}
  #cin-layer{overflow:hidden}
  #cin-layer video{flex:1 1 0%;height:0;min-height:0;width:100%;max-width:none;background:#000;object-fit:contain}
  body.cin-on #like-btn,body.cin-on #dislike-btn{visibility:hidden}
  .cin-bar{flex:0 0 auto;display:flex;flex-wrap:wrap;align-items:center;gap:8px 12px;padding:6px 10px;background:#060906;font-size:12px;line-height:1.2}
  .cin-bar[hidden]{display:none}
  .cin-bar .grow{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#C3CBBE}
  .cin-bar select,.cin-bar button{background:#0d1210;color:#E8E8E3;border:1px solid #2a3626;border-radius:6px;padding:4px 8px;font:inherit;cursor:pointer}
  .cin-bar button:hover,.cin-bar select:hover{border-color:var(--blue,#99FF00)}
  .cin-bar .stop{border-color:#FF3860;color:#FF3860}.cin-bar .stop:hover{background:#FF3860;color:#000}
  .cin-bar input[type=range]{width:90px;accent-color:var(--blue,#99FF00)}
  .cin-bar .ctl{display:flex;align-items:center;gap:6px;flex:1 1 100%}
  .cin-bar .ctl[hidden]{display:none}
  .cin-bar .ctl input[type=range]{flex:1 1 auto;width:auto;min-width:80px}
  .cin-bar .time{font-variant-numeric:tabular-nums;color:#C3CBBE;white-space:nowrap}
  .cin-bar .dot{display:inline-block;width:8px;height:8px;border-radius:50%;background:#FF3860;margin-right:6px;box-shadow:0 0 8px #FF3860;animation:cinpulse 1.4s ease-in-out infinite}
  @keyframes cinpulse{50%{opacity:.35}}
  #cin-msg{position:absolute;left:0;right:0;top:0;bottom:44px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;text-align:center;padding:16px;pointer-events:none;color:#C3CBBE;font-size:14px;text-shadow:0 1px 6px #000}
  #cin-msg[hidden]{display:none}
  #cin-lstart{position:absolute;left:10px;bottom:10px;z-index:15;display:none;align-items:center;gap:8px;background:rgba(6,9,6,.88);color:var(--blue,#99FF00);border:1px solid var(--blue,#99FF00);border-radius:99px;padding:7px 14px;font:600 13px 'Exo 2',system-ui,sans-serif;cursor:pointer;backdrop-filter:blur(4px);transition:box-shadow .2s,background .2s}
  #cin-lstart.on{display:inline-flex}
  #cin-lstart:hover{background:var(--blue,#99FF00);color:#000;box-shadow:0 0 18px color-mix(in srgb,var(--blue,#99FF00) 55%,transparent)}
  #cin-lsmsg{position:absolute;inset:0;z-index:3;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;text-align:center;padding:20px;color:#C3CBBE;font-size:14px;text-shadow:0 1px 6px #000;pointer-events:none}
  #cin-lsmsg[hidden]{display:none}
  #cin-lsmsg .row{display:flex;flex-wrap:wrap;justify-content:center;gap:10px}
  #cin-lsmsg button{pointer-events:auto;border:0;border-radius:99px;padding:10px 20px;font:700 14px 'Exo 2',system-ui,sans-serif;cursor:pointer;background:var(--blue,#99FF00);color:#000}
  #cin-lsmsg button.alt{background:#0d1210;color:#E8E8E3;border:1px solid #2a3626}
  #cin-lsmsg button[hidden]{display:none}
  #cin-layer video::cue{background:rgba(0,0,0,.68);color:#fff;font-family:'Exo 2',system-ui,sans-serif;line-height:1.25}
  .cin-bar .subgrp{display:inline-flex;align-items:center;gap:6px}
  .cin-bar .subgrp[hidden]{display:none}
  #cin-msg button{pointer-events:auto;background:var(--blue,#99FF00);color:#000;border:0;border-radius:99px;padding:10px 20px;font:700 14px 'Exo 2',system-ui,sans-serif;cursor:pointer}
  `;

  function injectUI() {
    if (layer && layer.isConnected) return true;
    box = document.querySelector('#room-view .video-box') || document.querySelector('.video-box');
    if (!box) return false;
    if (!$('cin-css')) { const s = document.createElement('style'); s.id = 'cin-css'; s.textContent = CSS; document.head.appendChild(s); }

    startBtn = document.createElement('button');
    startBtn.id = 'cin-start'; startBtn.type = 'button';
    startBtn.innerHTML = '<i class="fa-solid fa-clapperboard" aria-hidden="true"></i><span>Transmitir filme</span>';
    startBtn.addEventListener('click', () => { if (startBtn.disabled) return; pickFile(); });

    fileInput = document.createElement('input');
    fileInput.type = 'file'; fileInput.accept = 'video/*,.mkv,.mp4,.m4v,.webm,.mov'; fileInput.hidden = true;
    fileInput.addEventListener('change', () => { const f = fileInput.files && fileInput.files[0]; fileInput.value = ''; if (f) startHost(f); });

    layer = document.createElement('div');
    layer.id = 'cin-layer';
    layer.innerHTML =
      '<div class="cin-bar" id="cin-hostbar" hidden>' +
        '<span class="grow"><span class="dot"></span><b>Transmitindo</b> · <span id="cin-file"></span></span>' +
        '<span id="cin-stat"></span>' +
        '<select id="cin-voice" title="Reforço da voz (canal central de filmes 5.1)"><option value="1">Voz normal</option><option value="1.6" selected>Voz reforçada</option><option value="2.2">Voz muito reforçada</option></select>' +
        '<select id="cin-codec" title="Codec do vídeo: H.264 costuma usar a placa de vídeo e pesa menos no computador"><option value="h264" selected>H.264 (leve)</option><option value="auto">Codec automático</option></select>' +
        '<select id="cin-q" title="Qualidade da transmissão"></select>' +
        '<button type="button" id="cin-swap" title="Trocar de filme">Trocar arquivo</button>' +
        '<button type="button" id="cin-stop" class="stop">Parar</button>' +
      '</div>' +
      '<video id="cin-video" playsinline></video>' +
      '<div id="cin-msg" hidden><span id="cin-msg-t"></span><button type="button" id="cin-sound" hidden>Ativar o som</button></div>' +
      '<div class="cin-bar" id="cin-guestbar" hidden>' +
        '<span class="ctl" id="cin-ctl" hidden>' +
          '<button type="button" id="cin-back" title="Voltar 10 segundos">-10s</button>' +
          '<button type="button" id="cin-pp" title="Pausar ou continuar o filme para todos"><i class="fa-solid fa-pause"></i></button>' +
          '<button type="button" id="cin-fwd" title="Avançar 10 segundos">+10s</button>' +
          '<input type="range" id="cin-seek" min="0" max="0" step="1" value="0" aria-label="Posição do filme">' +
        '</span>' +
        '<span class="grow" id="cin-gstat"></span>' +
        '<span class="time" id="cin-time"></span>' +
        '<button type="button" id="cin-mute" title="Silenciar"><i class="fa-solid fa-volume-high"></i></button>' +
        '<input type="range" id="cin-vol" min="0" max="3" step="0.05" value="1" aria-label="Volume (até 300%)" title="Volume (até 300%)">' +
        '<span class="time" id="cin-volp" style="min-width:38px;text-align:right"></span>' +
        '<button type="button" id="cin-fs" title="Tela cheia"><i class="fa-solid fa-expand"></i></button>' +
      '</div>';
    layer.insertAdjacentHTML('beforeend',
      '<div class="cin-bar" id="cin-lsbar" hidden>' +
        '<span class="ctl" id="cin-lsctl" hidden>' +
          '<button type="button" id="cin-lsback" title="Voltar 10 segundos">-10s</button>' +
          '<button type="button" id="cin-lspp" title="Pausar ou continuar para todos"><i class="fa-solid fa-play"></i></button>' +
          '<button type="button" id="cin-lsfwd" title="Avançar 10 segundos">+10s</button>' +
          '<input type="range" id="cin-lsseek" min="0" max="0" step="1" value="0" aria-label="Posição do filme">' +
        '</span>' +
        '<span class="grow" id="cin-lsstat"></span>' +
        '<span class="time" id="cin-lstime"></span>' +
        '<button type="button" id="cin-lsmute" title="Silenciar"><i class="fa-solid fa-volume-high"></i></button>' +
        '<input type="range" id="cin-lsvol" min="0" max="1" step="0.02" value="1" aria-label="Volume">' +
        '<button type="button" id="cin-lssub" title="Carregar legenda (.srt ou .vtt) só para você"><i class="fa-solid fa-closed-captioning"></i> Legenda</button>' +
        '<span class="subgrp" id="cin-lssubgrp" hidden>' +
          '<button type="button" id="cin-lssubm" title="Legenda aparece mais cedo (-0,5 s)">-0,5s</button>' +
          '<span class="time" id="cin-lssubo"></span>' +
          '<button type="button" id="cin-lssubp" title="Legenda aparece mais tarde (+0,5 s)">+0,5s</button>' +
          '<button type="button" id="cin-lssubx" title="Remover a legenda">✕</button>' +
        '</span>' +
        '<button type="button" id="cin-lsswap" title="Escolher outro arquivo só para você">Trocar meu arquivo</button>' +
        '<button type="button" id="cin-lsfs" title="Tela cheia"><i class="fa-solid fa-expand"></i></button>' +
        '<button type="button" id="cin-lsstop" title="Sair só para você">Sair</button>' +
        '<button type="button" id="cin-lsend" class="stop" title="Encerrar a sessão para todo mundo" hidden>Encerrar para todos</button>' +
      '</div>' +
      '<div id="cin-lsmsg" hidden><span id="cin-lsmsg-t"></span>' +
        '<span class="row"><button type="button" id="cin-lspick">Escolher o arquivo</button>' +
        '<button type="button" id="cin-lslater" class="alt">Agora não</button>' +
        '<button type="button" id="cin-lsresume">Continuar</button></span></div>');

    lsBtn = document.createElement('button');
    lsBtn.id = 'cin-lstart'; lsBtn.type = 'button';
    lsBtn.innerHTML = '<i class="fa-solid fa-user-group" aria-hidden="true"></i><span>Assistir junto (arquivo local)</span>';
    lsInput = document.createElement('input');
    lsInput.type = 'file'; lsInput.accept = 'video/*,.mkv,.mp4,.m4v,.webm,.mov'; lsInput.hidden = true;
    subInput = document.createElement('input');
    subInput.type = 'file'; subInput.accept = '.srt,.vtt,text/vtt,application/x-subrip,text/plain'; subInput.hidden = true;

    box.appendChild(layer); box.appendChild(startBtn); box.appendChild(fileInput); box.appendChild(lsBtn); box.appendChild(lsInput); box.appendChild(subInput);

    els = { video: $('cin-video'), hostbar: $('cin-hostbar'), guestbar: $('cin-guestbar'), file: $('cin-file'), stat: $('cin-stat'),
      q: $('cin-q'), voice: $('cin-voice'), codec: $('cin-codec'), ctl: $('cin-ctl'), pp: $('cin-pp'), seek: $('cin-seek'), time: $('cin-time'), msg: $('cin-msg'), msgT: $('cin-msg-t'), sound: $('cin-sound'), gstat: $('cin-gstat'), mute: $('cin-mute'), vol: $('cin-vol'), volp: $('cin-volp') };
    Object.assign(els, { lsbar: $('cin-lsbar'), lsctl: $('cin-lsctl'), lspp: $('cin-lspp'), lsseek: $('cin-lsseek'), lsstat: $('cin-lsstat'),
      lstime: $('cin-lstime'), lsmute: $('cin-lsmute'), lsvol: $('cin-lsvol'), lsend: $('cin-lsend'), lsmsg: $('cin-lsmsg'), lsmsgT: $('cin-lsmsg-t'),
      lspick: $('cin-lspick'), lslater: $('cin-lslater'), lsresume: $('cin-lsresume') });
    lsBind();
    QUALITIES.forEach(q => { const o = document.createElement('option'); o.value = q.key; o.textContent = q.label; els.q.appendChild(o); });
    els.q.value = DEFAULT_Q;
    els.q.addEventListener('change', applyQuality);
    els.voice.addEventListener('change', () => setVoice());
    // trocar o codec exige nova conexão: muda o número da transmissão e todo mundo reconecta sozinho
    els.codec.addEventListener('change', () => {
      if (!host) return;
      host.peers.forEach(p => { try { p.pc.close(); } catch (e) {} }); host.peers.clear();
      host.nonce = myNonce = (Math.floor(Math.random() * 2e9) + 1);
      try { ctx.retrack(); } catch (e) {}
      hostUi();
    });
    $('cin-stop').addEventListener('click', () => { stopHost(); notify('Transmissão encerrada.', 'info'); });
    $('cin-swap').addEventListener('click', pickFile);
    els.sound.addEventListener('click', () => { muted = false; resumeAudio(); els.video.play().catch(() => {}); els.sound.hidden = true; showMsg(''); applyGain(); syncVolUi(); });
    layer.addEventListener('pointerdown', () => { if (aud && aud.ac.state === 'suspended') resumeAudio(); });
    els.pp.addEventListener('click', () => cmd(watch && watch.st && !watch.st.p ? 'pause' : 'play'));
    $('cin-back').addEventListener('click', () => cmd('seek', Math.max(0, curT() - 10)));
    $('cin-fwd').addEventListener('click', () => cmd('seek', curT() + 10));
    els.seek.addEventListener('input', () => { if (watch) watch.drag = true; tr(els.time, fmt(Number(els.seek.value)) + ' / ' + fmt(watch && watch.st ? watch.st.d : 0)); });
    els.seek.addEventListener('change', () => { if (watch) watch.drag = false; cmd('seek', Number(els.seek.value)); });
    els.vol.addEventListener('input', () => { vol = Number(els.vol.value); muted = false; applyGain(); syncVolUi(); try { localStorage.setItem('cinVol', String(vol)); } catch (e) {} });
    els.mute.addEventListener('click', () => { muted = !muted; applyGain(); syncVolUi(); });
    $('cin-fs').addEventListener('click', () => {
      const d = document;
      if (d.fullscreenElement) d.exitFullscreen().catch(() => {});
      else if (layer.requestFullscreen) layer.requestFullscreen().catch(() => {});
    });
    return true;
  }
  /* ---------- volume do espectador ----------
     O áudio passa por um Web Audio (ganho até 300% + compressor para não estourar), porque o volume
     máximo do <video> (100%) fica baixo quando o filme foi gravado baixinho. O <video> fica mudo e só mostra a imagem. */
  let vol = 1, muted = false, aud = null;
  try { const sv = parseFloat(localStorage.getItem('cinVol')); if (sv >= 0 && sv <= 3) vol = sv; } catch (e) {}
  function applyGain() {
    if (aud) aud.gain.gain.value = muted ? 0 : vol;
    else if (els.video) { els.video.volume = Math.min(1, vol); els.video.muted = muted; }   // sem Web Audio: volume normal do <video>
  }
  function resumeAudio() { try { if (aud && aud.ac.state === 'suspended') aud.ac.resume().catch(() => {}); } catch (e) {} }
  function teardownAudio() {
    const a = aud; aud = null;
    if (a) { try { a.src.disconnect(); a.gain.disconnect(); a.comp.disconnect(); a.ac.close(); } catch (e) {} }
  }
  function setupAudio(stream) {
    teardownAudio();
    const tracks = stream.getAudioTracks();
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!tracks.length || !AC) { els.video.muted = muted; els.video.volume = Math.min(1, vol); return false; }
    try {
      const ac = new AC();
      const src = ac.createMediaStreamSource(new MediaStream(tracks));
      const gain = ac.createGain();
      const comp = ac.createDynamicsCompressor();
      comp.threshold.value = -8; comp.knee.value = 12; comp.ratio.value = 10; comp.attack.value = 0.003; comp.release.value = 0.25;
      src.connect(gain); gain.connect(comp); comp.connect(ac.destination);
      aud = { ac, src, gain, comp };
      els.video.muted = true;
      applyGain();
      ac.resume().catch(() => {});
      setTimeout(() => { if (aud && aud.ac === ac && ac.state !== 'running') showMsg('', true); }, 600);   // navegador bloqueou o som: pede um clique
      ac.onstatechange = () => { if (aud && aud.ac === ac && ac.state === 'running') { els.sound.hidden = true; if (els.video.videoWidth > 0) showMsg(''); } };
      return true;
    } catch (e) { console.error(e); aud = null; els.video.muted = muted; els.video.volume = Math.min(1, vol); return false; }
  }
  function syncVolUi() {
    const m = muted || vol === 0;
    els.mute.innerHTML = '<i class="fa-solid ' + (m ? 'fa-volume-xmark' : 'fa-volume-high') + '"></i>';
    els.vol.value = String(vol);
    tr(els.volp, Math.round((muted ? 0 : vol) * 100) + '%');
  }
  function showMsg(t, soundBtn) {
    if (!els.msg) return;
    els.msg.hidden = !t && !soundBtn;
    tr(els.msgT, t || '');
    els.sound.hidden = !soundBtn;
  }
  function refreshButton() {
    if (!injectUI()) return;
    const streamer = users().find(u => u.cin > 0 && u.id !== me());
    const inMovies = !ctx || !ctx.category || ctx.category() === 'filmes';
    const canStart = inMovies && !!(ctx && ctx.isAdmin && ctx.isAdmin());
    startBtn.classList.toggle('on', canStart && !host);
    startBtn.disabled = !!streamer;
    startBtn.classList.toggle('on', canStart && !host);
    const span = startBtn.querySelector('span');
    tr(span, streamer ? (streamer.name + ' está transmitindo') : 'Transmitir filme');
    lsButton();
  }
  function layerShow(role) {
    layer.classList.add('on');
    els.hostbar.hidden = role !== 'host';
    if (els.lsbar) els.lsbar.hidden = !(role === 'local' && ls && ls.url);
    els.guestbar.hidden = role !== 'guest';
    els.video.controls = role === 'host';
    document.body.classList.add('cin-on');
    quietOn(); keepAwake();
  }
  function layerHide() {
    if (!layer) return;
    layer.classList.remove('on');
    try { els.video.pause(); } catch (e) {}
    els.video.removeAttribute('src'); els.video.srcObject = null; try { els.video.load(); } catch (e) {}
    try { els.video.playbackRate = 1; } catch (e) {}
    if (els.lsbar) els.lsbar.hidden = true;
    if (els.lsmsg) els.lsmsg.hidden = true;
    showMsg('');
    if (document.fullscreenElement && layer.contains(document.fullscreenElement)) document.exitFullscreen().catch(() => {});
    document.body.classList.remove('cin-on');
    try { document.dispatchEvent(new Event('cinema-end')); } catch (e) {}
    quietOff(); releaseAwake();
  }

  /* ============================================================
     ANFITRIÃO
     ============================================================ */
  function pickFile() { if (injectUI() && fileInput) fileInput.click(); }

  function qualityNow() { return QUALITIES.find(q => q.key === (els.q && els.q.value)) || QUALITIES.find(q => q.key === DEFAULT_Q); }

  /* Áudio do anfitrião: o filme passa por um Web Audio que mistura 5.1 (e outros) para ESTÉREO de verdade.
     Sem isso, a captura do <video> manda só alguns canais e a fala (canal central) some: "ouço tudo menos as vozes". */
  let hostAud = null;
  function hostAudio(v) {
    if (hostAud && hostAud.v === v) return hostAud;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    try {
      const ac = new AC();
      const src = ac.createMediaElementSource(v);
      const mix = ac.createGain();
      mix.channelCount = 2; mix.channelCountMode = 'explicit'; mix.channelInterpretation = 'speakers';
      // mistura manual (canais: 0 FL, 1 FR, 2 centro/voz, 3 LFE, 4-5 traseiros, 6-7 laterais), com reforço da voz
      const split = ac.createChannelSplitter(8);
      src.connect(split);
      const L = ac.createGain(), R = ac.createGain();
      const tap = (from, to, g) => { const n = ac.createGain(); n.gain.value = g; split.connect(n, from); n.connect(to); return n; };
      tap(0, L, 1); tap(1, R, 1);
      const cL = tap(2, L, 0), cR = tap(2, R, 0);
      tap(4, L, 0.6); tap(5, R, 0.6); tap(6, L, 0.6); tap(7, R, 0.6);
      const monoFix = tap(0, R, 0);   // arquivo mono: copia o canal esquerdo para o direito
      const merger = ac.createChannelMerger(2);
      L.connect(merger, 0, 0); R.connect(merger, 0, 1);
      merger.connect(mix);
      const meters = []; for (let c = 0; c < 8; c++) { const an = ac.createAnalyser(); an.fftSize = 512; split.connect(an, c); meters.push(an); }
      const comp = ac.createDynamicsCompressor();
      comp.threshold.value = -6; comp.knee.value = 10; comp.ratio.value = 6; comp.attack.value = 0.003; comp.release.value = 0.2;
      const dest = ac.createMediaStreamDestination();
      dest.channelCount = 2;
      src.connect(mix); mix.connect(ac.destination);   // o anfitrião ouve normalmente
      mix.connect(comp); comp.connect(dest);           // o que vai para a sala (sem estourar)
      hostAud = { v, ac, dest, cL, cR, monoFix, meters, seen: new Array(8).fill(false), monoHits: 0 };
      setVoice(hostAud);
      return hostAud;
    } catch (e) { console.error(e); return null; }
  }

  const VOICE = { '1': 1, '1.6': 1.6, '2.2': 2.2 };
  function setVoice(a) {
    a = a || hostAud; if (!a) return;
    const k = (VOICE[(els.voice && els.voice.value) || '1.6'] || 1.6) * 0.7071;
    a.cL.gain.value = k; a.cR.gain.value = k;
  }
  // olha os canais do filme: mostra ao anfitrião se há canal de voz (centro) e corrige arquivo mono
  function audioProbe() {
    const a = hostAud; if (!a || !host) return '';
    const buf = new Float32Array(512);
    const rms = a.meters.map(an => { an.getFloatTimeDomainData(buf); let t = 0; for (let i = 0; i < buf.length; i++) t += buf[i] * buf[i]; return Math.sqrt(t / buf.length); });
    rms.forEach((r, i) => { if (r > 2e-4) a.seen[i] = true; });
    if (rms[0] > 1e-3 && rms[1] < 1e-5) a.monoHits++; else if (rms[1] > 1e-3) a.monoHits = 0;
    a.monoFix.gain.value = a.monoHits >= 3 ? 1 : 0;
    const surround = a.seen[2] || a.seen[4] || a.seen[5] || a.seen[6] || a.seen[7];
    if (!a.seen.some(Boolean)) return 'áudio: aguardando som';
    if (a.monoHits >= 3) return 'áudio: mono';
    return surround ? ('áudio: surround · voz (centro) ' + (a.seen[2] ? 'ok' : 'sem sinal')) : 'áudio: estéreo';
  }

  async function startHost(file) {
    if (!ctx || !ctx.isAdmin()) return;
    if (ls && ls.url) return notify('Saia do "Assistir junto" antes de transmitir um filme.', 'error');
    if (ls) lsClose(true);
    if (users().some(u => u.cin > 0 && u.id !== me())) return notify('Outra pessoa já está transmitindo nesta sala.', 'error');
    if (!window.RTCPeerConnection) return notify('Este navegador não suporta WebRTC.', 'error');
    injectUI();
    const probe = els.video;
    if (!(probe.captureStream || probe.mozCaptureStream)) return notify('Este navegador não consegue transmitir vídeo local. Use o Chrome, Edge ou Firefox no computador.', 'error');
    await loadIce();
    if (host) stopHost(true);
    // pausa a música da sala (o anfitrião manda o pause para todo mundo)
    try { const yt = ctx.yt && ctx.yt(); if (yt && yt.pauseVideo) yt.pauseVideo(); } catch (e) {}

    layerShow('host');
    showMsg('Carregando o arquivo...');
    const url = URL.createObjectURL(file);
    const v = els.video;
    v.muted = false; v.volume = 1; v.src = url;
    tr(els.file, file.name);
    try {
      await new Promise((ok, bad) => {
        const t = setTimeout(() => bad(new Error('timeout')), 20000);
        v.onloadedmetadata = () => { clearTimeout(t); ok(); };
        v.onerror = () => { clearTimeout(t); bad(new Error('erro')); };
      });
    } catch (e) {
      URL.revokeObjectURL(url); layerHide();
      return notify('Não consegui abrir esse arquivo. O navegador toca MP4 (H.264 + AAC) e WebM; converta MKV/HEVC/AC3 antes.', 'error');
    }
    v.onerror = null; v.onloadedmetadata = null;
    // captureStream só entrega as trilhas depois que a mídia começa a decodificar
    let stream;
    try {
      const ha = hostAudio(v);
      if (ha) { ha.ac.resume().catch(() => {}); if (!v.__cinResume) { v.__cinResume = true; v.addEventListener('play', () => { try { hostAud && hostAud.ac.resume(); } catch (e) {} }); } }
      const cap = v.captureStream ? v.captureStream() : v.mozCaptureStream();
      await v.play().catch(() => {});
      for (let i = 0; i < 40 && !cap.getVideoTracks().length; i++) await sleep(100);
      stream = new MediaStream(cap.getVideoTracks());
      if (ha) ha.dest.stream.getAudioTracks().forEach(t => stream.addTrack(t.clone()));
      else cap.getAudioTracks().forEach(t => stream.addTrack(t));
      v.pause(); v.currentTime = 0;
    } catch (e) { console.error(e); }
    if (!stream || !stream.getVideoTracks().length) {
      URL.revokeObjectURL(url); layerHide();
      return notify('Não consegui capturar o vídeo (codec não suportado pelo navegador?). Converta para MP4 H.264 + AAC.', 'error');
    }
    stream.getVideoTracks().forEach(t => { try { t.contentHint = 'motion'; } catch (e) {} });
    showMsg('');

    myNonce = (Math.floor(Math.random() * 2e9) + 1);
    host = { video: v, stream, url, nonce: myNonce, peers: new Map(), timer: null, prev: new Map(), prevAt: 0 };
    host.timer = setInterval(hostStats, 2000);
    host.push = setInterval(hostPush, 1000);
    ctx.retrack();                 // publica "cin" na presença: a sala toda começa a conectar
    refreshButton(); hostUi();
    notify('Transmissão pronta. Aperte play quando todos entrarem.', 'success');
  }

  function stopHost(silent) {
    if (!host) return;
    const h = host; host = null; myNonce = 0;
    clearInterval(h.timer); clearInterval(h.push);
    h.peers.forEach(p => { try { p.pc.close(); } catch (e) {} });
    try { h.stream.getTracks().forEach(t => t.stop()); } catch (e) {}
    try { URL.revokeObjectURL(h.url); } catch (e) {}
    layerHide();
    if (!silent) { try { ctx.retrack(); } catch (e) {} }
    refreshButton();
  }

  function hostUi() {
    if (!host) return;
    let ok = 0; host.peers.forEach(p => { if (p.pc.connectionState === 'connected') ok++; });
    const n = Math.max(0, users().length - 1);
    const t = ok + '/' + n + ' conectados';
    const ap = audioProbe();
    const dg = host.diag || '';
    tr(els.stat, t + (host.mbps ? ' · ↑ ' + host.mbps.toFixed(1).replace('.', ',') + ' Mbps' : '') + (dg ? ' ·' + dg : '') + (ap ? ' · ' + ap : ''));
  }

  async function hostStats() {
    if (!host) return;
    let bytes = 0; const now = performance.now(); const cur = new Map();
    const d = { fps: 99, cpu: false, bw: false, loss: 0, rtt: 0 };
    for (const [uid, p] of host.peers) {
      if (p.pc.connectionState !== 'connected') continue;
      try {
        const rep = await p.pc.getStats();
        let b = 0;
        rep.forEach(r => {
          if (r.type === 'outbound-rtp' && !r.isRemote) {
            b += (r.bytesSent || 0);
            if (r.kind === 'video') {
              if (Number.isFinite(r.framesPerSecond)) d.fps = Math.min(d.fps, r.framesPerSecond);
              if (r.qualityLimitationReason === 'cpu') d.cpu = true;
              else if (r.qualityLimitationReason === 'bandwidth') d.bw = true;
            }
          } else if (r.type === 'remote-inbound-rtp' && r.kind === 'video') {
            if (Number.isFinite(r.fractionLost)) d.loss = Math.max(d.loss, r.fractionLost);
            if (Number.isFinite(r.roundTripTime)) d.rtt = Math.max(d.rtt, r.roundTripTime);
          }
        });
        cur.set(uid, b);
        if (host.prev.has(uid)) bytes += Math.max(0, b - host.prev.get(uid));
      } catch (e) {}
    }
    if (host && host.prevAt) host.mbps = (bytes * 8) / ((now - host.prevAt) / 1000) / 1e6;
    if (host) {
      host.prev = cur; host.prevAt = now;
      host.diag = (d.fps < 99 ? Math.round(d.fps) + ' fps' : '') + (cur.size ? ' · perda ' + Math.round(d.loss * 100) + '%' : '') + (d.cpu ? ' · ⚠ CPU no limite' : (d.bw && d.loss > 0.03) ? ' · ⚠ rede no limite' : '');
      // limite sustentado (~6 s): baixa a qualidade um degrau sozinho (nunca sobe sozinho)
      host.strain = (d.cpu || d.loss > 0.08 || (d.bw && d.loss > 0.03)) ? host.strain + 1 : 0;   // 'bw' sozinho é normal na subida inicial
      if (host.strain >= 3) {
        host.strain = 0;
        const i = QUALITIES.findIndex(q => q.key === els.q.value);
        if (i > 0) {
          els.q.value = QUALITIES[i - 1].key; applyQuality();
          notify('Reduzi a qualidade para ' + QUALITIES[i - 1].label.split(' ·')[0] + ' porque ' + (d.cpu ? 'o computador' : 'a conexão') + ' não estava aguentando.', 'info');
        }
      }
      hostUi();
    }
  }

  function applyQuality() {
    if (!host) return;
    host.peers.forEach(p => tuneSenders(p.pc));
  }
  function tuneSenders(pc) {
    const q = qualityNow();
    const vh = (host && host.video && host.video.videoHeight) || 0;
    pc.getSenders().forEach(s => {
      if (!s.track) return;
      try {
        const prm = s.getParameters();
        if (!prm.encodings || !prm.encodings.length) prm.encodings = [{}];
        if (s.track.kind === 'video') {
          prm.encodings[0].maxBitrate = q.bps;
          prm.encodings[0].scaleResolutionDownBy = (q.h && vh > q.h) ? vh / q.h : 1;
          prm.encodings[0].maxFramerate = 30;
          prm.degradationPreference = 'balanced';   // sob aperto, reduz resolução E fps aos poucos (maintain-resolution fazia o vídeo engasgar)
        } else prm.encodings[0].maxBitrate = 192000;
        s.setParameters(prm).catch(() => {});
      } catch (e) {}
    });
  }

  async function hostOnJoin(from) {
    if (!host || !users().some(u => u.id === from)) return;
    const old = host.peers.get(from);
    if (!old) {
      let live = 0; host.peers.forEach(p => { if (p.pc.connectionState !== 'closed' && p.pc.connectionState !== 'failed') live++; });
      if (live >= MAX_VIEWERS) return send(from, { t: 'full', n: host.nonce });
    } else { try { old.pc.close(); } catch (e) {} }
    const h = host;
    const pc = new RTCPeerConnection({ iceServers });
    const peer = { pc };
    h.peers.set(from, peer);
    h.stream.getTracks().forEach(t => pc.addTrack(t, h.stream));
    if (els.codec && els.codec.value === 'h264') {
      try {
        const caps = (RTCRtpSender.getCapabilities('video') || {}).codecs || [];
        const h264 = caps.filter(c => /h264/i.test(c.mimeType)), rest = caps.filter(c => !/h264/i.test(c.mimeType));
        if (h264.length) pc.getTransceivers().forEach(t => { if (t.sender.track && t.sender.track.kind === 'video') t.setCodecPreferences(h264.concat(rest)); });
      } catch (e) { console.warn('codec', e); }
    }
    peer.dc = pc.createDataChannel('cin');
    peer.dc.onmessage = (e) => hostOnCmd(from, e.data);
    peer.dc.onopen = hostPush;
    pc.onconnectionstatechange = () => {
      const st = pc.connectionState;
      if (st === 'connected') {
        tuneSenders(pc);
        // vídeo pausado não emite frame novo: força um para o espectador novo não ficar com tela preta
        try { if (h.video.paused) { const c = h.video.currentTime; h.video.currentTime = c > 0.05 ? c - 0.04 : c + 0.04; } } catch (e) {}
      }
      if (st === 'failed' || st === 'closed') { if (h.peers.get(from) === peer) h.peers.delete(from); try { pc.close(); } catch (e) {} }
      hostUi();
    };
    try {
      const offer = await pc.createOffer();
      offer.sdp = tuneVideoSdp(tuneOpus(offer.sdp), 1500, 500);
      await pc.setLocalDescription(offer);
      await gatherDone(pc);
      if (host !== h || h.peers.get(from) !== peer) return;
      send(from, { t: 'offer', n: h.nonce, sdp: pc.localDescription.sdp });
    } catch (e) { console.error(e); try { pc.close(); } catch (x) {} }
  }

  async function hostOnAnswer(from, sdp) {
    if (!host) return;
    const peer = host.peers.get(from);
    if (!peer || peer.pc.signalingState !== 'have-local-offer' || !validSdp(sdp)) return;
    try { await peer.pc.setRemoteDescription({ type: 'answer', sdp: tuneOpus(sdp) }); } catch (e) { console.error(e); }
  }

  /* ============================================================
     ESPECTADOR
     ============================================================ */
  function stopWatch(silent) {
    if (!watch) return;
    const w = watch; watch = null;
    w.timers.forEach(clearTimeout); clearInterval(w.tick); clearInterval(w.wd);
    try { w.pc && w.pc.close(); } catch (e) {}
    teardownAudio(); layerHide(); if (els.ctl) els.ctl.hidden = true; tr(els.time, '');
    if (!silent) notify('A transmissão terminou.', 'info');
  }

  function startWatch(id, n) {
    if (host) return;
    if (ls) lsClose(true);
    if (watch) stopWatch(true);
    injectUI();
    watch = { id, n, pc: null, tries: 0, timers: [], got: false, st: null, dc: null, drag: false, tick: setInterval(updateCtl, 500) };
    layerShow('guest');
    els.video.muted = true; applyGain(); syncVolUi();
    showMsg('Conectando à transmissão de ' + nameOf(id) + '...');
    tr(els.gstat, nameOf(id) + ' está transmitindo');
    loadIce().then(() => { if (watch && watch.id === id && watch.n === n) askJoin(); });
  }

  function askJoin() {
    if (!watch) return;
    const w = watch;
    send(w.id, { t: 'join', n: w.n });
    // sem oferta em 9 s: pede de novo (o anfitrião pode ainda estar carregando)
    w.timers.push(setTimeout(() => { if (watch === w && !w.pc) { w.tries++; askJoin(); } }, 9000));
  }

  function retryLater(w) {
    if (watch !== w) return;
    try { w.pc && w.pc.close(); } catch (e) {} w.pc = null; w.got = false; w.dc = null;
    showMsg('Reconectando...');
    const wait = Math.min(1500 * (++w.tries), 12000);
    w.timers.push(setTimeout(() => { if (watch === w) askJoin(); }, wait));
  }

  async function guestOnOffer(from, n, sdp) {
    const w = watch;
    if (!w || from !== w.id || n !== w.n || !validSdp(sdp)) return;
    if (w.pc) { try { w.pc.close(); } catch (e) {} }
    w.dc = null;
    const pc = new RTCPeerConnection({ iceServers });
    w.pc = pc;
    pc.ondatachannel = (ev) => { w.dc = ev.channel; ev.channel.onmessage = (e) => guestOnState(w, e.data); };
    pc.ontrack = (ev) => {
      let st = ev.streams && ev.streams[0];
      if (!st) { st = w.stream || new MediaStream(); st.addTrack(ev.track); }
      w.stream = st;
      try { ev.receiver.jitterBufferTarget = 1200; } catch (e) {}
      try { ev.receiver.playoutDelayHint = 1.2; } catch (e) {}
      if (els.video.srcObject !== st) {
        els.video.srcObject = st;
        els.video.muted = true;   // a imagem toca no <video>; o som sai pelo Web Audio (setupAudio)
        els.video.play().catch(() => {});
      }
      if (ev.track.kind === 'audio') setupAudio(st);
    };
    pc.onconnectionstatechange = () => {
      if (watch !== w || w.pc !== pc) return;
      const st = pc.connectionState;
      if (st === 'connected') { w.tries = 0; w.got = true; showMsg(''); waitFrames(w); clearInterval(w.wd); w.wd = setInterval(() => guestWatchdog(w), 2000); }
      else if (st === 'failed') retryLater(w);
      else if (st === 'disconnected') w.timers.push(setTimeout(() => { if (watch === w && w.pc === pc && pc.connectionState !== 'connected') retryLater(w); }, 6000));
    };
    try {
      await pc.setRemoteDescription({ type: 'offer', sdp: tuneOpus(sdp) });
      const ans = await pc.createAnswer();
      ans.sdp = tuneOpus(ans.sdp);
      await pc.setLocalDescription(ans);
      await gatherDone(pc);
      if (watch !== w || w.pc !== pc) return;
      send(w.id, { t: 'answer', n: w.n, sdp: pc.localDescription.sdp });
      // se não conectar em 15 s, tenta de novo
      w.timers.push(setTimeout(() => { if (watch === w && w.pc === pc && pc.connectionState !== 'connected') retryLater(w); }, 15000));
    } catch (e) { console.error(e); retryLater(w); }
  }

  // vigia a imagem: se o vídeo parar de decodificar enquanto o filme toca (áudio segue), reconecta sozinho
  async function guestWatchdog(w) {
    if (watch !== w || !w.pc || w.pc.connectionState !== 'connected') return;
    try {
      const rep = await w.pc.getStats();
      let fd = 0, fps = 0, lost = 0, recv = 0, h = 0;
      rep.forEach(r => { if (r.type === 'inbound-rtp' && r.kind === 'video') { fd = r.framesDecoded || 0; fps = r.framesPerSecond || 0; lost = r.packetsLost || 0; recv = r.packetsReceived || 0; h = r.frameHeight || 0; } });
      const playing = !!(w.st && !w.st.p);
      if (fd !== w.lastFd) { w.lastFd = fd; w.stall = 0; } else if (playing && fd > 0) w.stall = (w.stall || 0) + 1;
      const pl = (lost + recv) ? Math.round(lost / (lost + recv) * 100) : 0;
      if (playing && h) tr(els.gstat, (h ? h + 'p' : '') + (fps ? ' · ' + Math.round(fps) + ' fps' : '') + (pl ? ' · perda ' + pl + '%' : ''));
      else tr(els.gstat, nameOf(w.id) + ' está transmitindo');
      if (w.stall >= 4) { w.stall = 0; showMsg('Imagem parou. Reconectando...'); retryLater(w); }
    } catch (e) {}
  }

  // enquanto o anfitrião estiver pausado desde o começo, ainda não chega imagem: explica o motivo
  function waitFrames(w) {
    const v = els.video;
    const chk = () => {
      if (watch !== w) return;
      if (v.videoWidth > 0) { if (els.sound.hidden) showMsg(''); return; }
      showMsg('Conectado! Aguardando o anfitrião dar play no filme...');
      w.timers.push(setTimeout(chk, 1000));
    };
    chk();
  }

  /* ---------- controle remoto (sub-host) ---------- */
  const fmt = (x) => { x = Math.max(0, Math.floor(Number(x) || 0)); const h = Math.floor(x / 3600), m = Math.floor(x % 3600 / 60), sec = x % 60; return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(sec).padStart(2, '0'); };
  const isAdminId = (id) => { const u = users().find(x => x.id === id); return !!u && (u.host === true || u.cohost === true); };
  const curT = () => { const w = watch; if (!w || !w.st) return 0; return w.st.t + (w.st.p ? 0 : (performance.now() - w.st.at) / 1000); };
  function cmd(k, t) {
    const w = watch;
    if (!w || !w.dc || w.dc.readyState !== 'open' || !isAdminId(me())) return;
    try { w.dc.send(JSON.stringify({ k, t: Number.isFinite(t) ? t : 0 })); } catch (e) {}
  }
  function updateCtl() {
    if (!els.ctl) return;
    const w = watch;
    els.ctl.hidden = !(w && isAdminId(me()));
    if (!w || !w.st) { tr(els.time, ''); return; }
    const d = w.st.d || 0, t = Math.min(curT(), d || curT());
    tr(els.time, fmt(t) + (d ? ' / ' + fmt(d) : ''));
    els.pp.innerHTML = '<i class="fa-solid ' + (w.st.p ? 'fa-play' : 'fa-pause') + '"></i>';
    syncMainBtn(w.st.p);
    els.pp.title = w.st.p ? 'Continuar o filme para todos' : 'Pausar o filme para todos';
    if (!w.drag) { els.seek.max = String(Math.floor(d)); els.seek.value = String(Math.floor(t)); }
  }
  function syncMainBtn(paused) {
    const b = $('play-pause-btn');
    if (b) b.innerHTML = '<i class="fa-solid ' + (paused ? 'fa-play ml-1' : 'fa-pause') + '"></i>';
  }
  function control(k) {
    if (ls && ls.url) return lsCmd(k);
    if (host) {
      const v = host.video;
      try {
        if (k === 'toggle') { if (v.paused) v.play().catch(() => {}); else v.pause(); }
        else v.currentTime = Math.max(0, Math.min(v.currentTime + (k === 'fwd' ? 10 : -10), Number.isFinite(v.duration) ? v.duration : 1e9));
      } catch (e) {}
      setTimeout(hostPush, 150); return true;
    }
    if (watch) {
      if (!isAdminId(me())) { notify('Só quem tem poderes de anfitrião controla o filme.', 'info'); return true; }
      if (k === 'toggle') cmd(watch.st && !watch.st.p ? 'pause' : 'play');
      else cmd('seek', Math.max(0, curT() + (k === 'fwd' ? 10 : -10)));
      return true;
    }
    return false;
  }
  function hostPush() {
    if (!host) return;
    const v = host.video;
    syncMainBtn(v.paused || v.ended);
    hostUi();
    const m = JSON.stringify({ k: 'st', t: v.currentTime || 0, d: Number.isFinite(v.duration) ? v.duration : 0, p: v.paused || v.ended });
    host.peers.forEach(p => { try { if (p.dc && p.dc.readyState === 'open') p.dc.send(m); } catch (e) {} });
  }
  function hostOnCmd(from, raw) {
    if (!host || typeof raw !== 'string' || raw.length > 200 || !isAdminId(from)) return;
    let c; try { c = JSON.parse(raw); } catch (e) { return; }
    const v = host.video;
    try {
      if (c.k === 'play') v.play().catch(() => {});
      else if (c.k === 'pause') v.pause();
      else if (c.k === 'seek' && Number.isFinite(c.t)) v.currentTime = Math.min(Math.max(0, c.t), Number.isFinite(v.duration) ? v.duration : c.t);
      else return;
    } catch (e) { return; }
    setTimeout(hostPush, 150);
  }
  function guestOnState(w, raw) {
    if (watch !== w || typeof raw !== 'string' || raw.length > 200) return;
    let m; try { m = JSON.parse(raw); } catch (e) { return; }
    if (!m || m.k !== 'st' || !Number.isFinite(m.t)) return;
    w.st = { t: m.t, d: Number.isFinite(m.d) ? m.d : 0, p: !!m.p, at: performance.now() };
    updateCtl();
  }

  /* ============================================================
     ENTRADA / SAÍDA / PRESENÇA
     ============================================================ */
  function onSignal(p) {
    if (!ctx || !p || typeof p !== 'object' || typeof p.from !== 'string') return;
    if (typeof p.t === 'string' && p.t.startsWith('ls-')) {
      if (p.from === me() || (p.to !== '*' && p.to !== me())) return;
      return lsOnSignal(p);
    }
    if (p.to !== me()) return;
    if (p.t === 'join') return hostOnJoin(p.from);
    if (p.t === 'answer') return hostOnAnswer(p.from, p.sdp);
    if (p.t === 'offer') return guestOnOffer(p.from, p.n, p.sdp);
    if (p.t === 'full' && watch && p.from === watch.id) {
      watch.timers.forEach(clearTimeout); watch.timers = [];
      showMsg('A transmissão está lotada (máx. ' + (MAX_VIEWERS + 1) + ' pessoas, contando o anfitrião).');
    }
  }

  function onPresence() {
    if (!ctx) return;
    refreshButton(); updateCtl(); lsPresence();
    if (host) {
      // quem saiu da sala não precisa mais de conexão
      const ids = new Set(users().map(u => u.id));
      host.peers.forEach((p, uid) => { if (!ids.has(uid)) { try { p.pc.close(); } catch (e) {} host.peers.delete(uid); } });
      hostUi();
      return;
    }
    if (ls && ls.url) return;
    const s = users().find(u => u.cin > 0 && u.id !== me());
    if (!s) { if (watch) stopWatch(); return; }
    if (!watch || watch.id !== s.id || watch.n !== s.cin) startWatch(s.id, s.cin);
  }

  /* ============================================================
     ASSISTIR JUNTO (arquivo local nos dois lados)
     Cada pessoa abre o MESMO arquivo no próprio computador. Pelo canal da sala só vão mensagens pequenas:
       ls-open   alguém abriu um filme (nome, tamanho, duração)         -> os outros escolhem o mesmo arquivo
       ls-ready  "já carreguei o arquivo"                               -> contador "2/2 com o arquivo"
       ls-st     estado do filme (posição, pausado). Vem de um comando (play/pause/seek) ou de um "batimento"
                 a cada 2 s do aparelho de referência; quem recebe corrige o próprio vídeo
       ls-ping / ls-pong  mede a latência até a referência (compensa o atraso da mensagem)
       ls-unready / ls-end / ls-hello  sair, encerrar para todos, e "quem entrou agora pede o estado"
     Correção de sincronia: diferença > 1,2 s = pula; entre 0,12 s e 1,2 s = acelera/desacelera 6% até alinhar.
     ============================================================ */
  const cut = (s, n) => { s = String(s == null ? '' : s); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
  const fmtSize = (b) => { b = Number(b) || 0; if (b >= 1e9) return (b / 1e9).toFixed(2).replace('.', ',') + ' GB'; if (b >= 1e6) return Math.round(b / 1e6) + ' MB'; return Math.round(b / 1e3) + ' KB'; };
  const inMovies = () => !ctx || !ctx.category || ctx.category() === 'filmes';
  const canCtl = (id) => isAdminId(id) || !(ctx && ctx.locked && ctx.locked());   // anfitrião/sub-host, ou todos se a sala não estiver travada
  const lsAll = (p) => { try { ctx.send(Object.assign({ to: '*', from: me() }, p)); } catch (e) { console.error(e); } };
  const vDur = () => { const v = els.video; return v && Number.isFinite(v.duration) ? v.duration : 0; };

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
    return { tt: r.tt + (r.p ? 0 : (performance.now() - r.at) / 1000), p: r.p };
  }

  function lsMsg(text, mode) {
    if (!els.lsmsg) return;
    els.lsmsg.hidden = !text;
    tr(els.lsmsgT, text || '');
    els.lspick.hidden = mode !== 'pick'; els.lslater.hidden = mode !== 'pick'; els.lsresume.hidden = mode !== 'resume';
  }

  function lsVolUi() {
    const v = els.video; if (!v || !els.lsmute) return;
    const m = v.muted || lsV === 0;
    els.lsmute.innerHTML = '<i class="fa-solid ' + (m ? 'fa-volume-xmark' : 'fa-volume-high') + '"></i>';
    els.lsvol.value = String(v.muted ? 0 : lsV);
  }

  function lsBind() {
    lsInput.addEventListener('change', () => {
      const f = lsInput.files && lsInput.files[0]; lsInput.value = '';
      if (!f) return;
      if (ls) lsAttach(f); else lsCreate(f);
    });
    lsBtn.addEventListener('click', () => { if (!lsBtn.disabled) lsInput.click(); });
    els.lspick.addEventListener('click', () => lsInput.click());
    els.lslater.addEventListener('click', lsLeave);
    els.lsresume.addEventListener('click', () => { if (!ls) return; ls.blocked = false; lsMsg(''); lsSync(true); });
    els.lspp.addEventListener('click', () => lsCmd('toggle'));
    $('cin-lsback').addEventListener('click', () => lsCmd('back'));
    $('cin-lsfwd').addEventListener('click', () => lsCmd('fwd'));
    els.lsseek.addEventListener('input', () => { if (ls) ls.drag = true; tr(els.lstime, fmt(Number(els.lsseek.value)) + ' / ' + fmt(vDur())); });
    els.lsseek.addEventListener('change', () => { if (ls) ls.drag = false; lsCmd('seek', Number(els.lsseek.value)); });
    els.lsmute.addEventListener('click', () => { els.video.muted = !els.video.muted; lsVolUi(); });
    els.lsvol.addEventListener('input', () => { lsV = Number(els.lsvol.value) || 0; els.video.muted = false; els.video.volume = lsV; lsVolUi(); });
    $('cin-lsswap').addEventListener('click', () => lsInput.click());
    $('cin-lsfs').addEventListener('click', () => {
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
      else if (layer.requestFullscreen) layer.requestFullscreen().catch(() => {});
    });
    $('cin-lsstop').addEventListener('click', lsLeave);
    els.lsend.addEventListener('click', lsEnd);
    $('cin-lssub').addEventListener('click', () => { if (ls && ls.url) subInput.click(); });
    subInput.addEventListener('change', () => { const f = subInput.files && subInput.files[0]; subInput.value = ''; if (f) lsSubLoad(f); });
    $('cin-lssubm').addEventListener('click', () => lsSubShift(-0.5));
    $('cin-lssubp').addEventListener('click', () => lsSubShift(0.5));
    $('cin-lssubx').addEventListener('click', () => { lsSubClear(); notify('Legenda removida.', 'info'); });
    els.video.addEventListener('click', () => { if (ls && ls.url) lsCmd('toggle'); });   // clicar no filme = pausar/continuar (só no modo local)
  }

  /* ---------- abrir / entrar ---------- */
  async function lsLoad(file) {
    const v = els.video;
    try { v.pause(); } catch (e) {}
    const url = URL.createObjectURL(file);
    v.muted = false; v.volume = lsV; v.playbackRate = 1; v.src = url;
    try {
      await new Promise((ok, bad) => {
        const t = setTimeout(() => bad(new Error('timeout')), 20000);
        v.onloadedmetadata = () => { clearTimeout(t); ok(); };
        v.onerror = () => { clearTimeout(t); bad(new Error('erro')); };
      });
    } catch (e) {
      URL.revokeObjectURL(url);
      try { v.removeAttribute('src'); v.load(); } catch (x) {}
      notify('Não consegui abrir esse arquivo. O navegador toca MP4 (H.264 + AAC) e WebM; converta MKV/HEVC/AC3 antes.', 'error');
      return false;
    }
    v.onerror = null; v.onloadedmetadata = null;
    if (!ls) { URL.revokeObjectURL(url); try { v.removeAttribute('src'); v.load(); } catch (e) {} return false; }   // a sessão acabou enquanto carregava
    ls.url = url; ls.ready.add(me());
    return true;
  }

  function lsStart() {
    clearInterval(ls.tick); clearInterval(ls.hb); clearInterval(ls.pg);
    ls.tick = setInterval(lsTick, 500);
    ls.hb = setInterval(lsBeat, 2000);
    ls.pg = setInterval(lsPing, 8000);
    setTimeout(lsPing, 600);
  }

  async function lsCreate(file) {
    if (!ctx) return;
    if (!inMovies()) return notify('O "Assistir junto" só existe em salas da categoria Filmes.', 'error');
    if (!canCtl(me())) return notify('Os anfitriões travaram os controles da sala.', 'error');
    if (host || watch || users().some(u => u.cin > 0)) return notify('Há uma transmissão de filme em andamento nesta sala.', 'error');
    injectUI();
    try { const yt = ctx.yt && ctx.yt(); if (yt && yt.pauseVideo) yt.pauseVideo(); } catch (e) {}
    const sid = Math.random().toString(36).slice(2, 10);
    ls = { sid, owner: me(), name: cut(file.name, 160), size: file.size, d: 0, url: null, ready: new Set(), rem: null, lat: 0, lastCmdAt: 0, drag: false, dismissed: false, blocked: false, drift: 0 };
    layerShow('local');
    lsMsg('Carregando o arquivo...');
    if (!(await lsLoad(file))) { lsClose(true); return; }
    ls.d = vDur();
    ls.rem = { tt: 0, p: true, at: performance.now(), self: true };
    layerShow('local'); lsMsg(''); lsStart(); lsUi(); lsVolUi();
    lsAll({ t: 'ls-open', sid, name: ls.name, size: ls.size, d: ls.d, tt: 0, p: true });
    lsAll({ t: 'ls-ready', sid });
    refreshButton();
    notify('Sessão aberta. Peça para a outra pessoa escolher o MESMO arquivo e depois é só dar play.', 'success');
  }

  async function lsAttach(file) {
    if (!ls) return;
    if (file.size !== ls.size && !confirm('Esse arquivo tem tamanho diferente do filme aberto por ' + nameOf(ls.owner) + ' (' + fmtSize(file.size) + ' contra ' + fmtSize(ls.size) + ').\nSe não for exatamente o mesmo arquivo, a sincronia pode ficar errada. Usar mesmo assim?')) return;
    const s = ls;
    if (s.url) { try { URL.revokeObjectURL(s.url); } catch (e) {} s.url = null; }
    lsSubClear();
    layerShow('local'); lsMsg('Carregando o arquivo...');
    if (!(await lsLoad(file))) { if (ls === s) { lsMsg(nameOf(s.owner) + ' abriu "' + s.name + '". Escolha o mesmo arquivo.', 'pick'); } return; }
    if (ls !== s) return;
    s.dismissed = false; s.blocked = false;
    const d = vDur();
    if (s.d && d && Math.abs(d - s.d) > 2) notify('A duração desse arquivo é diferente da do filme aberto. A sincronia pode ficar errada.', 'error');
    layerShow('local'); lsMsg(''); lsStart(); lsUi(); lsVolUi();
    lsAll({ t: 'ls-ready', sid: s.sid });
    lsSync(true);
    refreshButton();
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
  function lsUnload() {
    if (!ls) return;
    clearInterval(ls.tick); clearInterval(ls.hb); clearInterval(ls.pg); ls.tick = ls.hb = ls.pg = null;
    if (ls.url) { try { URL.revokeObjectURL(ls.url); } catch (e) {} ls.url = null; }
    lsSubClear();
    layerHide();
  }
  function lsClose(silent) {
    if (!ls) return;
    lsUnload(); ls = null;
    refreshButton();
  }

  /* ---------- sincronia ---------- */
  function lsSync(force) {
    if (!ls || !ls.url || !ls.rem) return;
    if (!force && isRef()) return;                // a referência não se corrige: ela é quem manda
    const v = els.video, r = ls.rem;
    if (v.readyState < 1) return;
    const lat = r.self ? 0 : ls.lat, lead = (r.self || r.p) ? 0 : 0.25;
    const dur = vDur() || 1e9;
    const exp = Math.min(Math.max(0, r.tt + (r.p ? 0 : (performance.now() - r.at) / 1000 + lat)), dur);
    const diff = v.currentTime - exp;
    ls.drift = diff;
    if (r.p) {
      if (v.playbackRate !== 1) v.playbackRate = 1;
      if (!v.paused) v.pause();
      if (Math.abs(diff) > 0.05) { try { v.currentTime = exp; } catch (e) {} }
      return;
    }
    if (Math.abs(diff) > (force ? 0.3 : 1.2)) { try { v.currentTime = Math.min(exp + lead, dur); } catch (e) {} if (v.playbackRate !== 1) v.playbackRate = 1; }
    else if (Math.abs(diff) > 0.12) v.playbackRate = diff > 0 ? 0.94 : 1.06;      // adiantado: desacelera; atrasado: acelera
    else if (v.playbackRate !== 1 && Math.abs(diff) < 0.04) v.playbackRate = 1;
    if (v.paused && !v.ended && !ls.blocked) {
      const s = ls;
      v.play().catch(() => { if (ls === s) { s.blocked = true; lsMsg('O navegador bloqueou o play automático. Clique para continuar.', 'resume'); } });
    }
  }

  function lsTick() { if (!ls || !ls.url) return; lsSync(false); lsUi(); }

  function lsBeat() {
    if (!ls || !ls.url || !isRef()) return;
    const n = lsNow();
    lsAll({ t: 'ls-st', sid: ls.sid, hb: 1, tt: n.tt, p: n.p, d: vDur() });
  }

  function lsPing() {
    if (!ls || !ls.url) return;
    const r = lsRef(); if (!r || r === me()) return;
    send(r, { t: 'ls-ping', c: performance.now() });
  }

  // comando de quem pode controlar (botões, clique no filme, botão grande de play do site)
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
    ls.rem = { tt, p, at: performance.now(), self: true };
    ls.lastCmdAt = performance.now(); ls.blocked = false; lsMsg('');
    lsSync(true);
    lsAll({ t: 'ls-st', sid: ls.sid, tt, p, d: vDur() });
    lsUi();
    return true;
  }

  function lsUi() {
    if (!ls || !ls.url || !els.lsbar) return;
    const v = els.video, ctl = canCtl(me()), d = vDur() || ls.d || 0;
    els.lsbar.hidden = false;
    els.lsctl.hidden = !ctl; els.lsend.hidden = !ctl;
    const sg = $('cin-lssubgrp'); if (sg) { sg.hidden = !ls.subs; tr($('cin-lssubo'), ((ls.subOff || 0) > 0 ? '+' : '') + String(ls.subOff || 0).replace('.', ',') + ' s'); }
    tr(els.lstime, fmt(v.currentTime) + (d ? ' / ' + fmt(d) : ''));
    els.lspp.innerHTML = '<i class="fa-solid ' + (v.paused || v.ended ? 'fa-play' : 'fa-pause') + '"></i>';
    syncMainBtn(!!(v.paused || v.ended));
    if (!ls.drag) { els.lsseek.max = String(Math.floor(d)); els.lsseek.value = String(Math.floor(v.currentTime)); }
    const ids = new Set(users().map(u => u.id)); let n = 0; ls.ready.forEach(id => { if (ids.has(id)) n++; });
    let sy;
    if (isRef()) sy = 'você é a referência da sincronia';
    else if (!ls.rem) sy = 'aguardando';
    else sy = Math.abs(ls.drift) < 0.15 ? 'sincronizado' : 'ajustando (' + Math.abs(ls.drift).toFixed(1).replace('.', ',') + ' s)';
    tr(els.lsstat, 'Assistindo junto · ' + cut(ls.name, 40) + ' · ' + n + '/' + users().length + ' com o arquivo · ' + sy);
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
  function lsSubDrop() {
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
    try { for (const t of els.video.textTracks) t.mode = (el.track && t === el.track) ? 'showing' : 'disabled'; } catch (e) {}
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
        if (isRef()) { const n = lsNow(); send(p.from, { t: 'ls-open', sid: ls.sid, name: ls.name, size: ls.size, d: ls.d, tt: n.tt, p: n.p, hello: 1 }); }
        return;
      }
      case 'ls-open': {
        const size = Number(p.size), d = Number(p.d);
        if (!sid || !Number.isFinite(size) || size <= 0 || !canCtl(p.from) || host || watch) return;
        const rem = Number.isFinite(p.tt) ? { tt: Math.max(0, p.tt), p: p.p !== false, at: performance.now() } : null;
        if (ls && ls.sid === sid) {
          if (performance.now() - ls.lastCmdAt < 1500) return;   // resposta atrasada logo depois de um comando meu: ignora
          if (rem && ls.url && !isRef()) { ls.rem = rem; lsSync(true); } else if (rem && !ls.url) ls.rem = rem;
          return;
        }
        if (ls) lsClose(true);
        ls = { sid, owner: p.from, name: cut(String(p.name || 'filme').replace(/[\u0000-\u001f]/g, ''), 160), size, d: Number.isFinite(d) ? d : 0, url: null, ready: new Set(), rem, lat: 0, lastCmdAt: 0, drag: false, dismissed: false, blocked: false, drift: 0 };
        if (pend.sid === sid) pend.ids.forEach(id => ls.ready.add(id));
        injectUI();
        if (!p.hello) notify(nameOf(p.from) + ' abriu o filme "' + ls.name + '". Escolha o mesmo arquivo para assistir junto.', 'info');
        layerShow('local');
        lsMsg(nameOf(p.from) + ' abriu "' + ls.name + '" (' + fmtSize(ls.size) + '). Escolha o mesmo arquivo no seu computador para assistir junto.', 'pick');
        refreshButton();
        return;
      }
      case 'ls-ready': {
        if (!sid) return;
        if (!ls || ls.sid !== sid) { if (pend.sid !== sid) pend = { sid, ids: new Set() }; pend.ids.add(p.from); return; }
        ls.ready.add(p.from);
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
        if (p.hb && performance.now() - ls.lastCmdAt < 1500) return;   // batimento atrasado logo depois de um comando meu: ignora
        ls.rem = { tt: Math.max(0, p.tt), p: !!p.p, at: performance.now() };
        if (ls.url && (!p.hb || !isRef())) lsSync(!p.hb);
        return;
      }
      case 'ls-ping': { if (ls && ls.url && p.to === me() && Number.isFinite(p.c)) send(p.from, { t: 'ls-pong', c: p.c }); return; }
      case 'ls-pong': {
        if (!ls || !Number.isFinite(p.c)) return;
        const rtt = performance.now() - p.c;
        if (rtt >= 0 && rtt < 4000) ls.lat = Math.min(1.5, ls.lat ? ls.lat * 0.6 + (rtt / 2000) * 0.4 : rtt / 2000);
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

  function lsButton() {
    if (!lsBtn) return;
    if (ls && !inMovies()) { lsClose(true); notify('O "Assistir junto" só funciona em salas de Filmes.', 'info'); return; }
    let on = false, label = 'Assistir junto (arquivo local)';
    if (inMovies() && !host && !watch && !(ls && ls.url)) {
      if (ls) { on = true; label = 'Escolher o arquivo: ' + cut(ls.name, 28); }
      else if (canCtl(me()) && !users().some(u => u.cin > 0)) on = true;
    }
    lsBtn.classList.toggle('on', on);
    tr(lsBtn.querySelector('span'), label);
  }

  window.RimkCinema = {
    open(c) { leave(); ctx = c; injectUI(); loadIce(); refreshButton(); },
    leave,
    signal: onSignal,
    presence: onPresence,
    refresh: () => { if (ctx) refreshButton(); },
    nonce: () => myNonce,
    active: () => !!(host || watch || (ls && ls.url)),
    control
  };
  function leave() {
    if (host) stopHost(true);
    if (watch) stopWatch(true);
    if (ls) { lsUnload(); ls = null; }
    helloSent = false; pend = { sid: '', ids: new Set() };
    ctx = null; myNonce = 0;
    if (startBtn) startBtn.classList.remove('on');
    if (lsBtn) lsBtn.classList.remove('on');
  }
})();
