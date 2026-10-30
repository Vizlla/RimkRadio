/* Painéis redimensionáveis do RimkRadio.
   PC (>=1024px): arraste a barra entre playlist | vídeo | chat e a barra entre o vídeo e "Membros".
   Celular/tablet: arraste a barra embaixo da playlist e embaixo do chat.
   Duplo clique numa barra volta ao padrão; o botão "Layout" no cabeçalho restaura tudo.
   Os tamanhos ficam salvos neste navegador (localStorage). */
(function () {
  'use strict';
  var KEY = 'rk-layout-v1', DESK = 1024;
  var rv, colPl, colCe, colCh, plPanel, chPanel, members, player, handles = {}, st = {};

  function load() { try { st = JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) { st = {}; } }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(st)); } catch (e) {} }
  var clamp = function (v, a, b) { return Math.max(a, Math.min(b, v)); };
  var isDesk = function () { return window.innerWidth >= DESK; };
  var num = function (v) { return typeof v === 'number' && isFinite(v) ? v : null; };

  function apply() {
    var d = rv.style;
    var c1 = num(st.w1), c3 = num(st.w3);
    if (c1 !== null || c3 !== null) {
      var a = c1 !== null ? c1 : colPl.getBoundingClientRect().width, b = c3 !== null ? c3 : colCh.getBoundingClientRect().width;
      d.setProperty('--rv-cols', 'minmax(160px,' + Math.round(a) + 'px) minmax(0,1fr) minmax(200px,' + Math.round(b) + 'px)');
      rv.classList.add('rv-custom');
    } else { rv.classList.remove('rv-custom'); d.removeProperty('--rv-cols'); }
    if (num(st.mh) !== null) { d.setProperty('--rv-mh', Math.round(st.mh) + 'px'); rv.classList.add('rv-mh-custom'); }
    else { rv.classList.remove('rv-mh-custom'); d.removeProperty('--rv-mh'); }
    if (num(st.plh) !== null) { d.setProperty('--rv-plh', Math.round(st.plh) + 'px'); rv.classList.add('rv-pl-custom'); }
    else { rv.classList.remove('rv-pl-custom'); d.removeProperty('--rv-plh'); }
    if (num(st.chh) !== null) { d.setProperty('--rv-chh', Math.round(st.chh) + 'px'); rv.classList.add('rv-ch-custom'); }
    else { rv.classList.remove('rv-ch-custom'); d.removeProperty('--rv-chh'); }
    place();
  }

  function mk(id, cls, label, orient) {
    var h = document.createElement('div');
    h.className = 'rv-handle ' + cls; h.id = id; h.tabIndex = 0;
    h.setAttribute('role', 'separator'); h.setAttribute('aria-orientation', orient); h.setAttribute('aria-label', label); h.title = label + ' (duplo clique: restaurar)';
    rv.appendChild(h); handles[id.replace('rv-', '')] = h; return h;
  }

  function place() {
    if (!rv || rv.classList.contains('hidden')) return;
    var R = rv.getBoundingClientRect(), r = function (e) { return e.getBoundingClientRect(); };
    var set = function (h, l, t, w, hh) { h.style.left = l + 'px'; h.style.top = t + 'px'; if (w != null) h.style.width = w + 'px'; if (hh != null) h.style.height = hh + 'px'; };
    if (isDesk()) {
      var a = r(colPl), b = r(colCe), c = r(colCh);
      set(handles.c1, (a.right + b.left) / 2 - R.left - 7, a.top - R.top, null, a.height);
      set(handles.c2, (b.right + c.left) / 2 - R.left - 7, c.top - R.top, null, c.height);
      var m = r(members), p = r(player);
      set(handles.mh, b.left - R.left, (p.bottom + m.top) / 2 - R.top - 7, b.width, null);
    } else {
      var pl = r(plPanel), ch = r(chPanel);
      set(handles.pl, pl.left - R.left, pl.bottom - R.top - 7, pl.width, null);
      set(handles.ch, ch.left - R.left, ch.bottom - R.top - 7, ch.width, null);
    }
  }

  function drag(h, axis, onMove) {
    h.addEventListener('pointerdown', function (e) {
      if (e.button != null && e.button !== 0) return;
      e.preventDefault();
      var x0 = e.clientX, y0 = e.clientY, ctx = onMove.start();
      h.setPointerCapture && h.setPointerCapture(e.pointerId);
      h.classList.add('is-drag'); document.body.classList.add('rv-dragging', 'rv-dragging-' + axis);
      var mv = function (ev) { onMove.move(ctx, ev.clientX - x0, ev.clientY - y0); apply(); };
      var up = function () {
        h.removeEventListener('pointermove', mv); h.removeEventListener('pointerup', up); h.removeEventListener('pointercancel', up);
        h.classList.remove('is-drag'); document.body.classList.remove('rv-dragging', 'rv-dragging-' + axis); save(); place();
      };
      h.addEventListener('pointermove', mv); h.addEventListener('pointerup', up); h.addEventListener('pointercancel', up);
    });
    h.addEventListener('keydown', function (e) {
      var step = e.shiftKey ? 48 : 16, dx = 0, dy = 0;
      if (axis === 'col') { if (e.key === 'ArrowLeft') dx = -step; else if (e.key === 'ArrowRight') dx = step; else return; }
      else { if (e.key === 'ArrowUp') dy = -step; else if (e.key === 'ArrowDown') dy = step; else return; }
      e.preventDefault(); var ctx = onMove.start(); onMove.move(ctx, dx, dy); apply(); save();
    });
  }

  function build() {
    rv = document.getElementById('room-view'); if (!rv) return false;
    colPl = rv.querySelector('.room-col-playlist'); colCe = rv.querySelector('.room-col-center'); colCh = rv.querySelector('.room-col-chat');
    plPanel = rv.querySelector('.playlist-panel'); chPanel = rv.querySelector('.chat-panel');
    members = rv.querySelector('.members-panel'); player = rv.querySelector('.player-frame');
    if (!(colPl && colCe && colCh && plPanel && chPanel && members && player)) return false;
    if (getComputedStyle(rv).position === 'static') rv.style.position = 'relative';
    load();

    mk('rv-c1', 'rv-col rv-desk', 'Largura da playlist', 'vertical');
    mk('rv-c2', 'rv-col rv-desk', 'Largura do chat', 'vertical');
    mk('rv-mh', 'rv-row rv-desk', 'Altura de Membros da sessão', 'horizontal');
    mk('rv-pl', 'rv-row rv-mob', 'Altura da playlist', 'horizontal');
    mk('rv-ch', 'rv-row rv-mob', 'Altura do chat', 'horizontal');

    var total = function () { return rv.getBoundingClientRect().width; };
    drag(handles.c1, 'col', {
      start: function () { return { w: colPl.getBoundingClientRect().width, o: colCh.getBoundingClientRect().width }; },
      move: function (c, dx) { st.w1 = clamp(c.w + dx, 180, total() - c.o - 360 - 32); if (st.w3 == null) st.w3 = c.o; }
    });
    drag(handles.c2, 'col', {
      start: function () { return { w: colCh.getBoundingClientRect().width, o: colPl.getBoundingClientRect().width }; },
      move: function (c, dx) { st.w3 = clamp(c.w - dx, 220, total() - c.o - 360 - 32); if (st.w1 == null) st.w1 = c.o; }
    });
    drag(handles.mh, 'row', {
      start: function () { return { h: members.getBoundingClientRect().height, max: colCe.getBoundingClientRect().height - 150 }; },
      move: function (c, dx, dy) { st.mh = clamp(c.h - dy, 80, Math.max(120, c.max)); }
    });
    drag(handles.pl, 'row', {
      start: function () { return { h: plPanel.getBoundingClientRect().height }; },
      move: function (c, dx, dy) { st.plh = clamp(c.h + dy, 160, window.innerHeight * 1.6); }
    });
    drag(handles.ch, 'row', {
      start: function () { return { h: chPanel.getBoundingClientRect().height }; },
      move: function (c, dx, dy) { st.chh = clamp(c.h + dy, 200, window.innerHeight * 1.6); }
    });

    var reset = function (keys) { keys.forEach(function (k) { delete st[k]; }); save(); apply(); };
    handles.c1.addEventListener('dblclick', function () { reset(['w1', 'w3']); });
    handles.c2.addEventListener('dblclick', function () { reset(['w1', 'w3']); });
    handles.mh.addEventListener('dblclick', function () { reset(['mh']); });
    handles.pl.addEventListener('dblclick', function () { reset(['plh']); });
    handles.ch.addEventListener('dblclick', function () { reset(['chh']); });

    // botão "Layout" no cabeçalho da sala: restaura todos os tamanhos
    var info = document.getElementById('room-header-info');
    if (info && !document.getElementById('rv-reset')) {
      var b = document.createElement('button');
      b.type = 'button'; b.id = 'rv-reset'; b.className = 'chip hover:border-nyellow transition';
      b.title = 'Restaurar o tamanho de todos os painéis'; b.setAttribute('aria-label', 'Restaurar o tamanho de todos os painéis');
      b.innerHTML = '<i class="fa-solid fa-table-columns text-xs"></i><span class="hidden sm:inline">Layout</span>';
      b.addEventListener('click', function () { st = {}; save(); apply(); });
      var leave = info.querySelector('button[onclick*="leaveRoom"]');
      info.insertBefore(b, leave || null);
    }

    var again = function () { requestAnimationFrame(place); };
    if (window.ResizeObserver) { var ro = new ResizeObserver(again); [rv, colPl, colCe, colCh, plPanel, chPanel, members, player].forEach(function (e) { ro.observe(e); }); }
    window.addEventListener('resize', again);
    new MutationObserver(again).observe(rv, { attributes: true, attributeFilter: ['class'] });
    apply();
    return true;
  }

  function init() { if (!build()) return; }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
