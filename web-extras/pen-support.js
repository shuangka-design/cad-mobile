// pen-support.js — ปรับปากกา stylus (เช่น HONOR Magic-Pencil 3 / 4s) ให้เหมาะกับงาน CAD
//
// เขียนให้เข้ากับตัวรับ event ของ eframe/egui (web) ที่ CADCraft ใช้:
//   egui ฟัง pointerdown (canvas), pointerup (document), mousemove (document),
//   touchstart (canvas), touchmove/touchend (document), keydown/keyup (canvas)
//
// แถบปุ่มลอย (ลากย้ายได้ที่ ⠿):
//   👆 นิ้ว    : ทำงานปกติ ไม่ยุ่งกับการแตะใดๆ
//   ✍️ ปากกา  : กันฝ่ามือ — นิ้วเดียวบนพื้นที่วาดถูกละเว้น, 2 นิ้วยังซูม/เลื่อนได้
//               ปากกาแตะ = คลิก, ลากปากกา = ลาก (เหมือนเมาส์)
//   🎯 แม่นยำ : กันฝ่ามือเหมือน ✍️ + แตะปากกาแล้วลาก = เลื่อน crosshair ดูจุด snap,
//               ยกปากกา = คลิกจุดนั้น (เหมาะกับการเลือกจุด endpoint/midpoint/intersection)
//   ⏎ / Esc  : ส่งปุ่ม Enter / Escape ให้โปรแกรม (จบ-ทำซ้ำคำสั่ง / ยกเลิก)
// ปุ่มข้างปากกา (ถ้าระบบส่งมาให้แอป) = Enter
// กดปุ่มโหมดค้าง 1.5 วินาที = เปิด/ปิดหน้าต่าง debug ดูค่าที่ปากกาส่งมา
(function () {
  'use strict';

  var MODES = ['finger', 'pen', 'precise'];
  var LABEL = { finger: '👆 นิ้ว', pen: '✍️ ปากกา', precise: '🎯 แม่นยำ' };
  var BARREL_KEY = 'Enter';   // ปุ่มข้างปากกา — เปลี่ยนเป็น 'Escape' ได้
  var PEN_GRACE_MS = 300;     // หลังยกปากกา ยังถือว่าปากกาทำงานอยู่อีกกี่ ms (กัน touch ที่ตามมา)

  var store = window.localStorage;
  var mode = store.getItem('cadPenMode');           // null = ยังไม่เคยเลือก
  var debug = store.getItem('cadPenDebug') === '1';

  var penDown = false, penLastAt = 0, barrelHeld = false, lastBarrelAt = 0;
  var synthesizing = false;
  var touchIds = new Set(), pGesture = false, tGesture = false;

  function curMode() { return mode || 'finger'; }
  function penMode() { return curMode() !== 'finger'; }
  function penActive() { return penDown || (Date.now() - penLastAt) < PEN_GRACE_MS; }
  function isCanvas(t) { return !!t && t.tagName === 'CANVAS'; }
  function canvas() { return document.querySelector('canvas'); }
  function isUi(t) { return !!t && !!t.closest && !!t.closest('#cad-pen-ui'); }
  function block(e) { e.stopImmediatePropagation(); if (e.cancelable) e.preventDefault(); }

  // ------------------------------------------------------------------ แถบปุ่มลอย
  var bar = document.createElement('div');
  bar.id = 'cad-pen-ui';
  Object.assign(bar.style, {
    position: 'fixed', zIndex: '2147483647', display: 'flex', flexDirection: 'column',
    gap: '6px', userSelect: 'none', webkitUserSelect: 'none', touchAction: 'none'
  });
  function mkBtn(action, text) {
    var b = document.createElement('div');
    b.dataset.action = action;
    b.textContent = text;
    Object.assign(b.style, {
      padding: '8px 10px', font: '14px sans-serif', color: '#fff', textAlign: 'center',
      background: 'rgba(30,30,30,0.75)', border: '1px solid #888', borderRadius: '14px',
      minWidth: '40px', touchAction: 'none'
    });
    bar.appendChild(b);
    return b;
  }
  mkBtn('drag', '⠿');
  var modeBtn = mkBtn('mode', LABEL[curMode()]);
  mkBtn('enter', '⏎');
  mkBtn('esc', 'Esc');

  function placeBar(x, y) {
    var w = bar.offsetWidth || 60, h = bar.offsetHeight || 160;
    x = Math.max(0, Math.min(window.innerWidth - w, x));
    y = Math.max(0, Math.min(window.innerHeight - h, y));
    bar.style.left = x + 'px';
    bar.style.top = y + 'px';
  }
  function mount() {
    document.body.appendChild(bar);
    var saved = null;
    try { saved = JSON.parse(store.getItem('cadPenBarPos') || 'null'); } catch (_) {}
    if (saved) placeBar(saved.x, saved.y);
    else placeBar(8, Math.round(window.innerHeight * 0.4));
  }
  if (document.body) mount(); else document.addEventListener('DOMContentLoaded', mount);

  function setMode(m) {
    mode = m;
    store.setItem('cadPenMode', m);
    modeBtn.textContent = LABEL[m];
  }

  var pressTimer = null, longPressed = false, drag = null;
  function onUi(e) {
    var el = e.target.closest('[data-action]');
    var action = el ? el.dataset.action : null;

    if (action === 'drag') {
      if (e.type === 'pointerdown') {
        var r = bar.getBoundingClientRect();
        drag = { dx: e.clientX - r.left, dy: e.clientY - r.top };
        try { el.setPointerCapture(e.pointerId); } catch (_) {}
      } else if (e.type === 'pointermove' && drag) {
        placeBar(e.clientX - drag.dx, e.clientY - drag.dy);
      } else if ((e.type === 'pointerup' || e.type === 'pointercancel') && drag) {
        store.setItem('cadPenBarPos', JSON.stringify({ x: bar.offsetLeft, y: bar.offsetTop }));
        drag = null;
      }
      block(e);
      return;
    }

    if (e.type === 'pointerdown' && action === 'mode') {
      longPressed = false;
      clearTimeout(pressTimer);
      pressTimer = setTimeout(function () { longPressed = true; toggleDebug(); }, 1500);
    } else if (e.type === 'pointerup') {
      clearTimeout(pressTimer);
      if (action === 'mode' && !longPressed) {
        setMode(MODES[(MODES.indexOf(curMode()) + 1) % MODES.length]);
      }
      if (action === 'enter') sendKey('Enter');
      if (action === 'esc') sendKey('Escape');
    } else if (e.type === 'pointercancel') {
      clearTimeout(pressTimer);
    }
    block(e);
  }

  // ------------------------------------------------------------------ ส่งปุ่มคีย์บอร์ด
  function sendKey(key) {
    var c = canvas();
    if (!c) return;
    var ae = document.activeElement;
    if (!ae || ae === document.body || ae === document.documentElement) {
      try { c.focus({ preventScroll: true }); } catch (_) {}
    }
    var code = key === 'Enter' ? 13 : (key === 'Escape' ? 27 : 0);
    synthesizing = true;
    try {
      ['keydown', 'keyup'].forEach(function (type) {
        var ev = new KeyboardEvent(type, { key: key, code: key, bubbles: true, cancelable: true, composed: true });
        try { Object.defineProperty(ev, 'keyCode', { get: function () { return code; } }); } catch (_) {}
        c.dispatchEvent(ev);
      });
    } finally { synthesizing = false; }
  }

  // ------------------------------------------------------------------ จำลองเมาส์ให้ egui
  function synthMouse(kind, src) {
    var c = canvas();
    if (!c) return;
    var o = {
      bubbles: true, cancelable: true, composed: true, view: window,
      clientX: src.clientX, clientY: src.clientY, screenX: src.screenX, screenY: src.screenY
    };
    synthesizing = true;
    try {
      if (kind === 'move') {
        var held = penDown && curMode() === 'pen' ? 1 : 0;
        c.dispatchEvent(new MouseEvent('mousemove', Object.assign({ button: 0, buttons: held }, o)));
      } else if (kind === 'down') {
        c.dispatchEvent(new PointerEvent('pointerdown', Object.assign(
          { pointerId: 1, pointerType: 'mouse', isPrimary: true, button: 0, buttons: 1, pressure: 0.5 }, o)));
      } else if (kind === 'up') {
        c.dispatchEvent(new PointerEvent('pointerup', Object.assign(
          { pointerId: 1, pointerType: 'mouse', isPrimary: true, button: 0, buttons: 0, pressure: 0 }, o)));
      }
    } finally { synthesizing = false; }
  }

  // ------------------------------------------------------------------ ปากกา
  function onPen(e) {
    if (mode === null) setMode('pen');      // เจอปากกาครั้งแรก → เปิดโหมดปากกาอัตโนมัติ
    penLastAt = Date.now();
    if (!penMode()) return;                 // โหมดนิ้ว: ปล่อยปากกาทำงานตามปกติ

    // ปุ่มข้างปากกา
    var barrelNow = (e.buttons & 2) !== 0;
    if (barrelNow && !barrelHeld) sendKey(BARREL_KEY);
    barrelHeld = barrelNow;
    if (barrelNow || e.button === 2) {
      lastBarrelAt = Date.now();
      block(e);
      return;
    }

    if (e.type === 'pointerdown' && e.button === 0) {
      penDown = true;
      synthMouse('move', e);
      if (curMode() === 'pen') synthMouse('down', e);   // ✍️ แตะ = กดเมาส์
    } else if (e.type === 'pointermove') {
      synthMouse('move', e);                            // ลอยเหนือจอ หรือ ลาก
    } else if (e.type === 'pointerup' && penDown) {
      penDown = false;
      synthMouse('move', e);
      if (curMode() === 'precise') synthMouse('down', e); // 🎯 ยกปากกา = คลิก
      synthMouse('up', e);
    } else if (e.type === 'pointercancel') {
      if (penDown && curMode() === 'pen') synthMouse('up', e);
      penDown = false;
    }
    block(e);
  }

  // ------------------------------------------------------------------ นิ้ว / ฝ่ามือ
  function onTouchPointer(e) {
    if (e.type === 'pointerdown') touchIds.add(e.pointerId);
    if (touchIds.size >= 2) pGesture = true;
    var pass = pGesture && !penActive();
    if (e.type === 'pointerup' || e.type === 'pointercancel') {
      touchIds.delete(e.pointerId);
      if (touchIds.size === 0) pGesture = false;
    }
    if (!pass) block(e);
  }

  function onTouch(e) {
    if (synthesizing) return;
    if (isUi(e.target)) { block(e); return; }
    if (!penMode()) return;
    if (e.touches.length >= 2) tGesture = true;
    var passGesture = tGesture;
    if (e.touches.length === 0) tGesture = false;
    if (penActive()) { block(e); return; }   // ระหว่างใช้ปากกา: ทิ้ง touch ทั้งหมด (รวมฝ่ามือ)
    if (!passGesture) block(e);              // นิ้วเดียว = ไม่สนใจ (กันฝ่ามือ)
  }

  function onPointer(e) {
    if (synthesizing) return;
    if (isUi(e.target)) { onUi(e); return; }
    if (debug && e.pointerType !== 'mouse') showDebug(e);
    if (e.pointerType === 'pen') {
      if (isCanvas(e.target) || penDown) onPen(e);
      return;
    }
    if (e.pointerType === 'touch' && penMode()) onTouchPointer(e);
  }

  function onMouse(e) {
    if (synthesizing) return;
    if (isUi(e.target)) { block(e); return; }
    if (e.button === 2 && Date.now() - lastBarrelAt < 800) block(e);
  }

  // ------------------------------------------------------------------ debug
  var dbg = null;
  function showText(t) {
    if (!document.body) return;
    if (!dbg) {
      dbg = document.createElement('div');
      Object.assign(dbg.style, {
        position: 'fixed', right: '8px', bottom: '8px', zIndex: '2147483647',
        background: 'rgba(0,0,0,0.75)', color: '#0f0', font: '12px monospace',
        padding: '6px 8px', whiteSpace: 'pre', pointerEvents: 'none', borderRadius: '6px'
      });
      document.body.appendChild(dbg);
    }
    dbg.textContent = t;
  }
  function toggleDebug() {
    debug = !debug;
    store.setItem('cadPenDebug', debug ? '1' : '0');
    if (debug) showText('debug: เปิด\nแตะ / ลาก / ลอยปากกาเหนือจอ / กดปุ่มข้างปากกา');
    else if (dbg) { dbg.remove(); dbg = null; }
  }
  function showDebug(e) {
    showText([
      'mode    : ' + curMode(),
      'event   : ' + e.type,
      'type    : ' + e.pointerType,
      'buttons : ' + e.buttons + '   button: ' + e.button,
      'pressure: ' + (e.pressure || 0).toFixed(2),
      'tilt    : ' + e.tiltX + ', ' + e.tiltY,
      'hover   : ' + (e.pointerType === 'pen' && e.type === 'pointermove' && e.buttons === 0 ? 'ได้' : '-')
    ].join('\n'));
  }

  // ------------------------------------------------------------------ ติดตั้ง listener
  // capture บน window = ได้ event ก่อน egui เสมอ
  var cap = { capture: true, passive: false };
  ['pointerdown', 'pointermove', 'pointerup', 'pointercancel'].forEach(function (t) {
    window.addEventListener(t, onPointer, cap);
  });
  ['touchstart', 'touchmove', 'touchend', 'touchcancel'].forEach(function (t) {
    window.addEventListener(t, onTouch, cap);
  });
  ['mousedown', 'mouseup', 'click', 'auxclick', 'dblclick'].forEach(function (t) {
    window.addEventListener(t, onMouse, cap);
  });
  window.addEventListener('contextmenu', function (e) {
    if (isUi(e.target) || Date.now() - lastBarrelAt < 800) block(e);
  }, true);
})();
