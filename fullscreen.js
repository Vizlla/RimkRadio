/* Tela cheia do player COM o chat.
   O botão de tela cheia do YouTube só amplia o vídeo (o chat some), então usamos o nosso:
   a caixa do vídeo vira a tela cheia e o painel do chat é levado para dentro dela, ao lado do vídeo.
   Um botão (balãozinho) esconde / mostra o chat; ao sair, o chat volta para o lugar de sempre.
   Se o aparelho não deixa abrir tela cheia (ex.: iPhone), usa uma "tela cheia falsa" cobrindo a janela. */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const box = () => document.querySelector('#room-view .video-box');
  const panel = () => document.querySelector('#room-view .chat-panel') || document.querySelector('#fs-chat-slot .chat-panel');
  let home = null, chatOpen = null, obs = null;

  const active = () => { const b = box(); return !!b && b.classList.contains('fs-on'); };
  const nativeEl = () => document.fullscreenElement || document.webkitFullscreenElement || null;

  function toBottom() { const m = $('chat-messages'); if (m) m.scrollTop = m.scrollHeight; }

  function setChat(open) {
    chatOpen = open;
    const b = box(); if (!b) return;
    b.classList.toggle('fs-chat-open', open);
    const btn = $('fs-chat-btn');
    if (btn) {
      btn.setAttribute('aria-pressed', String(open));
      const t = open ? 'Esconder o chat' : 'Mostrar o chat';
      btn.title = t; btn.setAttribute('aria-label', t);
      const ic = btn.querySelector('i');
      if (ic) ic.className = open ? 'fa-solid fa-chevron-right' : 'fa-regular fa-comments';
    }
    if (open) { const d = $('fs-chat-dot'); if (d) d.classList.add('hidden'); toBottom(); }
  }

  function activate() {
    const b = box(), p = panel(), slot = $('fs-chat-slot');
    if (!b || active()) return;
    b.classList.add('fs-on');
    if (p && slot && !slot.contains(p)) {
      home = document.createComment('chat-home');
      p.parentNode.insertBefore(home, p);
      slot.appendChild(p);
    }
    setChat(chatOpen === null ? window.innerWidth >= 900 : chatOpen);
    // mensagem nova com o chat escondido → bolinha no botão
    const msgs = $('chat-messages');
    if (msgs && 'MutationObserver' in window) {
      obs = new MutationObserver(() => {
        if (active() && !box().classList.contains('fs-chat-open')) { const d = $('fs-chat-dot'); if (d) d.classList.remove('hidden'); }
      });
      obs.observe(msgs, { childList: true });
    }
  }

  function deactivate() {
    const b = box();
    if (obs) { obs.disconnect(); obs = null; }
    const p = document.querySelector('#fs-chat-slot .chat-panel');
    if (p && home && home.parentNode) { home.parentNode.insertBefore(p, home); }
    if (home) { home.remove(); home = null; }
    if (b) b.classList.remove('fs-on', 'fs-fake', 'fs-chat-open');
    if ($('fs-chat-dot')) $('fs-chat-dot').classList.add('hidden');
    toBottom();
  }

  async function enter() {
    const b = box(); if (!b || active()) return;
    let ok = false;
    try {
      if (b.requestFullscreen) { await b.requestFullscreen(); ok = true; }
      else if (b.webkitRequestFullscreen) { b.webkitRequestFullscreen(); ok = true; }
    } catch (e) {}
    if (!ok) b.classList.add('fs-fake');
    activate();
  }

  function exit() {
    if (!active()) return;
    const b = box();
    if (nativeEl() === b) { (document.exitFullscreen || document.webkitExitFullscreen).call(document); }
    else deactivate();
  }

  const onFsChange = () => { const b = box(); if (b && active() && !b.classList.contains('fs-fake') && nativeEl() !== b) deactivate(); };
  document.addEventListener('fullscreenchange', onFsChange);
  document.addEventListener('webkitfullscreenchange', onFsChange);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && active() && box().classList.contains('fs-fake')) exit(); });

  window.toggleStageFullscreen = () => (active() ? exit() : enter());
  window.toggleFsChat = () => { if (active()) setChat(!box().classList.contains('fs-chat-open')); };
  window.RimkStage = { exit, active };
})();
