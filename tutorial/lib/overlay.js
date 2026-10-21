// The studio overlay: everything drawn on top of the app for the viewer —
// cursor, click ripples, keystroke chips, chapter lower thirds, title/end
// cards, spotlights — plus stand-ins for browser UI that headless Chromium
// never paints (native <select> lists, prompt/confirm/alert, colour pickers,
// file pickers, the download bubble).
//
// installStudio() runs in the page (as an init script) and must stay
// self-contained. It mounts a shadow root on <html>, outside React's #root,
// with pointer-events: none, so it can never intercept or restyle the app.
// It also swaps window.prompt/confirm/alert for scripted versions: answers
// come from window.__studioDialogs.queue (filled by the recorder before the
// click that opens the dialog) and every call is logged so the recorder can
// replay it on screen.

export function installStudio() {
    // Dialog scripting first: an init script can run before <html> exists,
    // and the app must never reach a real (unpainted, blocking) dialog.
    if (!window.__studioDialogs) {
        const dialogs = { queue: [], log: [] };
        window.__studioDialogs = dialogs;
        const scripted = (type) => (message, defaultValue) => {
            const answer = dialogs.queue.shift() || {};
            dialogs.log.push({ type, message: String(message ?? ''), defaultValue: defaultValue ?? null, answer, at: Date.now() });
            if (type === 'prompt') return answer.cancel ? null : (answer.text ?? defaultValue ?? '');
            if (type === 'confirm') return !answer.cancel;
            return undefined;
        };
        window.prompt = scripted('prompt');
        window.confirm = scripted('confirm');
        window.alert = scripted('alert');
    }
    if (window.__studio) return;
    if (!document.documentElement) {
        // too early: mount the moment the document element appears
        const wait = new MutationObserver(() => {
            if (!document.documentElement) return;
            wait.disconnect();
            installStudio();
        });
        wait.observe(document, { childList: true });
        return;
    }

    const host = document.createElement('div');
    host.id = '__studio';
    host.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483647;';
    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML = `<style>
        :host { all: initial; }
        * { box-sizing: border-box; }
        .layer { position: fixed; inset: 0; pointer-events: none; font-family: Inter, 'Segoe UI', system-ui, sans-serif; }
        .cursor { position: fixed; left: -100px; top: -100px; width: 28px; height: 28px; z-index: 50;
            transform-origin: 3px 3px; transition: transform 90ms ease-out; filter: drop-shadow(0 1.5px 2px rgba(0,0,0,.35)); }
        .cursor svg { position: absolute; left: 0; top: 0; overflow: visible; }
        .cursor.down { transform: scale(.9); }
        .press { position: fixed; width: 34px; height: 34px; margin: -17px 0 0 -17px; border-radius: 50%;
            background: rgba(37,99,235,.22); border: 2px solid rgba(37,99,235,.55); opacity: 0; transition: opacity 120ms; z-index: 49; }
        .press.on { opacity: 1; }
        .ripple { position: fixed; width: 18px; height: 18px; margin: -9px 0 0 -9px; border-radius: 50%;
            border: 2.5px solid rgba(37,99,235,.85); animation: rip .5s ease-out forwards; z-index: 48; }
        @keyframes rip { from { transform: scale(.6); opacity: .95; } to { transform: scale(3.1); opacity: 0; } }
        .keys { position: fixed; left: 50%; bottom: 34px; transform: translateX(-50%) translateY(8px); display: flex; gap: 8px;
            align-items: center; padding: 10px 14px; border-radius: 14px; background: rgba(15,23,42,.88); color: #fff;
            box-shadow: 0 10px 30px rgba(0,0,0,.25); opacity: 0; transition: opacity .18s, transform .18s; z-index: 40; }
        .keys.on { opacity: 1; transform: translateX(-50%) translateY(0); }
        .key { min-width: 34px; padding: 5px 10px; border-radius: 8px; background: #1e293b; border: 1px solid #475569;
            border-bottom-width: 3px; font-size: 17px; font-weight: 600; text-align: center; letter-spacing: .01em; }
        .plus { color: #94a3b8; font-size: 16px; font-weight: 600; }
        .keys .label { font-size: 15px; color: #cbd5e1; margin-left: 4px; }
        .third { position: fixed; left: 28px; bottom: 30px; display: flex; align-items: stretch; background: rgba(255,255,255,.97);
            border-radius: 12px; box-shadow: 0 12px 34px rgba(15,23,42,.22), 0 0 0 1px rgba(15,23,42,.06); overflow: hidden;
            opacity: 0; transform: translateX(-18px); transition: opacity .35s ease, transform .35s ease; z-index: 30; }
        .third.on { opacity: 1; transform: none; }
        .third .bar { width: 6px; background: #2563eb; }
        .third .txt { padding: 11px 20px 12px 16px; }
        .third .kick { font-size: 12px; font-weight: 700; letter-spacing: .09em; text-transform: uppercase; color: #64748b; }
        .third .ttl { font-size: 21px; font-weight: 700; color: #0f172a; margin-top: 2px; letter-spacing: -.01em; }
        .card { position: fixed; inset: 0; display: flex; align-items: center; justify-content: center; opacity: 0;
            transition: opacity .7s ease; z-index: 60; color: #fff;
            background: radial-gradient(1200px 600px at 20% 10%, rgba(37,99,235,.35), transparent 60%),
                        radial-gradient(900px 500px at 90% 90%, rgba(99,102,241,.25), transparent 60%), #0b1220; }
        .card.on { opacity: 1; }
        .card .grid { position: absolute; inset: 0; opacity: .12;
            background-image: linear-gradient(rgba(148,163,184,.5) 1px, transparent 1px), linear-gradient(90deg, rgba(148,163,184,.5) 1px, transparent 1px);
            background-size: 48px 48px; mask-image: radial-gradient(ellipse at center, black 30%, transparent 75%); }
        .card .inner { position: relative; max-width: 1040px; padding: 0 64px; text-align: left; width: 100%; }
        .brand { display: flex; align-items: center; gap: 12px; font-size: 19px; font-weight: 600; color: #cbd5e1; margin-bottom: 44px; }
        .brand svg { width: 38px; height: 38px; }
        .card .kick { font-size: 16px; font-weight: 700; letter-spacing: .14em; text-transform: uppercase; color: #93c5fd; margin-bottom: 18px; }
        .card h1 { font-size: 64px; line-height: 1.04; margin: 0 0 22px; letter-spacing: -.025em; font-weight: 800; }
        .card p { font-size: 24px; line-height: 1.45; color: #cbd5e1; margin: 0; max-width: 900px; }
        .card .foot { margin-top: 46px; display: flex; gap: 12px; flex-wrap: wrap; }
        .card .chip { font-size: 15px; color: #e2e8f0; background: rgba(148,163,184,.14); border: 1px solid rgba(148,163,184,.25);
            padding: 7px 13px; border-radius: 999px; }
        .spot { position: fixed; border-radius: 10px; border: 2.5px solid #3b82f6; box-shadow: 0 0 0 9999px rgba(15,23,42,.38);
            opacity: 0; transition: opacity .3s ease, left .35s ease, top .35s ease, width .35s ease, height .35s ease; z-index: 20; }
        .spot.on { opacity: 1; }
        .spotlabel { position: fixed; max-width: 420px; background: #1d4ed8; color: #fff; font-size: 16px; font-weight: 600;
            padding: 8px 13px; border-radius: 9px; box-shadow: 0 8px 24px rgba(15,23,42,.3); opacity: 0; transition: opacity .3s; z-index: 21; }
        .spotlabel.on { opacity: 1; }
        .dropdown { position: fixed; background: #fff; border: 1px solid #a3a3a3; box-shadow: 0 4px 14px rgba(0,0,0,.18);
            font: 15px/1.2 system-ui, 'Segoe UI', sans-serif; color: #111; overflow: hidden; z-index: 45; padding: 2px 0; border-radius: 2px; }
        .dropdown .opt { padding: 4px 9px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .dropdown .grp { padding: 4px 6px; font-weight: 700; color: #555; }
        .dropdown .opt.ingrp { padding-left: 20px; }
        .dropdown .opt.hi { background: #1967d2; color: #fff; }
        .dropdown .opt.dis { color: #9ca3af; }
        .dialog { position: fixed; top: 18px; left: 50%; transform: translateX(-50%) translateY(-6px); width: 450px; background: #fff;
            color: #1f1f1f; border-radius: 12px; box-shadow: 0 12px 40px rgba(0,0,0,.28), 0 0 0 1px rgba(0,0,0,.06); padding: 20px 22px 18px;
            font: 15px/1.45 system-ui, 'Segoe UI', sans-serif; opacity: 0; transition: opacity .18s, transform .18s; z-index: 55; }
        .dialog.on { opacity: 1; transform: translateX(-50%) translateY(0); }
        .dialog .origin { font-size: 15px; font-weight: 600; margin-bottom: 10px; }
        .dialog .msg { white-space: pre-wrap; margin-bottom: 14px; }
        .dialog .field { border: 2px solid #0b57d0; border-radius: 6px; padding: 7px 10px; min-height: 38px; font-size: 15px; margin-bottom: 16px; }
        .dialog .caret { display: inline-block; width: 1px; height: 17px; background: #111; vertical-align: -3px; margin-left: 1px; animation: blink 1s steps(1) infinite; }
        @keyframes blink { 50% { opacity: 0; } }
        .dialog .btns { display: flex; justify-content: flex-end; gap: 10px; }
        .dialog .btn { padding: 8px 18px; border-radius: 999px; font-size: 14px; font-weight: 600; border: 1px solid #c4c7c5; color: #0b57d0; background: #fff; }
        .dialog .btn.primary { background: #0b57d0; color: #fff; border-color: #0b57d0; }
        .toast { position: fixed; top: 14px; right: 18px; width: 360px; background: #fff; border-radius: 12px; padding: 14px 16px;
            box-shadow: 0 12px 34px rgba(0,0,0,.22), 0 0 0 1px rgba(0,0,0,.06); display: flex; gap: 12px; align-items: center;
            font: 14px/1.35 system-ui, 'Segoe UI', sans-serif; color: #1f1f1f; opacity: 0; transform: translateY(-6px);
            transition: opacity .2s, transform .2s; z-index: 46; }
        .toast.on { opacity: 1; transform: none; }
        .toast .ico { width: 36px; height: 36px; border-radius: 8px; background: #e8f0fe; display: flex; align-items: center; justify-content: center; flex: none; }
        .toast .name { font-weight: 600; word-break: break-all; }
        .toast .sub { color: #5f6368; font-size: 13px; }
        .palette { position: fixed; background: #fff; border-radius: 10px; padding: 10px; display: grid; grid-template-columns: repeat(6, 26px);
            gap: 8px; box-shadow: 0 10px 30px rgba(0,0,0,.22), 0 0 0 1px rgba(0,0,0,.08); opacity: 0; transition: opacity .15s; z-index: 45; }
        .palette.on { opacity: 1; }
        .palette .sw { width: 26px; height: 26px; border-radius: 6px; box-shadow: inset 0 0 0 1px rgba(0,0,0,.15); }
        .palette .sw.hi { outline: 2.5px solid #2563eb; outline-offset: 2px; }
        .picker { position: fixed; left: 50%; top: 50%; transform: translate(-50%,-50%); width: 560px; background: #fff; border-radius: 12px;
            box-shadow: 0 20px 60px rgba(0,0,0,.35); font: 14px/1.4 system-ui, 'Segoe UI', sans-serif; color: #1f1f1f; opacity: 0;
            transition: opacity .2s; z-index: 55; overflow: hidden; }
        .picker.on { opacity: 1; }
        .picker .hd { padding: 14px 18px; font-weight: 600; border-bottom: 1px solid #e5e7eb; }
        .picker .row { display: flex; gap: 10px; align-items: center; padding: 9px 18px; }
        .picker .row.hi { background: #e8f0fe; }
        .picker .ft { display: flex; justify-content: flex-end; gap: 10px; padding: 12px 18px; border-top: 1px solid #e5e7eb; }
    </style>
    <div class="layer" id="layer"></div>`;
    document.documentElement.appendChild(host);
    const layer = root.getElementById('layer');
    const el = (cls, html = '') => { const d = document.createElement('div'); d.className = cls; d.innerHTML = html; layer.appendChild(d); return d; };

    // ---- cursor ---------------------------------------------------------
    const SHAPES = {
        arrow: '<svg width="28" height="28" viewBox="0 0 28 28"><path d="M3 2.5v19.2l4.9-4.6 3.2 7.4 3.4-1.5-3.2-7.2 6.8-.3z" fill="#111" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>',
        pointer: '<svg width="28" height="28" viewBox="0 0 28 28"><g transform="translate(-6 -1)"><path d="M14.6 3.8c-1.1 0-2 .9-2 2v9.4l-1.3-1.4c-.8-.9-2.2-.9-3-.1-.8.8-.9 2-.2 2.9l4.6 6.2c1 1.3 2.5 2.1 4.1 2.1h4.4c2.8 0 5-2.2 5-5v-5.4c0-1.1-.9-2-2-2-.4 0-.8.1-1.1.3-.2-.9-1-1.6-2-1.6-.5 0-.9.2-1.3.4-.3-.8-1-1.3-1.9-1.3-.4 0-.8.1-1.1.3V5.8c0-1.1-.9-2-2-2z" fill="#fff" stroke="#111" stroke-width="1.4" stroke-linejoin="round"/></g></svg>',
        text: '<svg width="28" height="28" viewBox="0 0 28 28"><g transform="translate(-10 -12)"><path d="M14 3h3l1 1 1-1h3M18 4v20M14 25h3l1-1 1 1h3" fill="none" stroke="#fff" stroke-width="3.6" stroke-linecap="round"/><path d="M14 3h3l1 1 1-1h3M18 4v20M14 25h3l1-1 1 1h3" fill="none" stroke="#111" stroke-width="1.6" stroke-linecap="round"/></g></svg>',
        crosshair: '<svg width="28" height="28" viewBox="0 0 28 28"><g transform="translate(-14 -14)"><path d="M14 2v24M2 14h24" stroke="#fff" stroke-width="3.6"/><path d="M14 2v24M2 14h24" stroke="#111" stroke-width="1.6"/></g></svg>',
        grab: '<svg width="28" height="28" viewBox="0 0 28 28"><g transform="translate(-14 -12)"><path d="M9 13V8.5a1.7 1.7 0 013.4 0V12V6.5a1.7 1.7 0 013.4 0V12V7.5a1.7 1.7 0 013.4 0V13V10a1.7 1.7 0 013.4 0v7c0 4-2.8 7-6.8 7h-1.6c-2.2 0-3.8-1-5-2.8L5.6 16.6a1.6 1.6 0 012.5-2z" fill="#fff" stroke="#111" stroke-width="1.4" stroke-linejoin="round"/></g></svg>',
        grabbing: '<svg width="28" height="28" viewBox="0 0 28 28"><g transform="translate(-14 -12)"><path d="M8 13.5c0-1 .8-1.8 1.8-1.8s1.7.8 1.7 1.8v-1a1.7 1.7 0 013.4 0v.5a1.7 1.7 0 013.4 0v.6a1.7 1.7 0 013.4 0V18c0 3.6-2.6 6-6.4 6h-1.4c-2.2 0-3.6-.8-4.8-2.6L6.5 18c-.6-1 .2-2.3 1.5-2.1z" fill="#fff" stroke="#111" stroke-width="1.4" stroke-linejoin="round"/></g></svg>',
        move: '<svg width="28" height="28" viewBox="0 0 28 28"><g transform="translate(-14 -14)"><path d="M14 2l3.5 4h-2.5v6h6v-2.5l4 3.5-4 3.5v-2.5h-6v6h2.5l-3.5 4-3.5-4h2.5v-6h-6v2.5l-4-3.5 4-3.5v2.5h6v-6h-2.5z" fill="#111" stroke="#fff" stroke-width="1.3" stroke-linejoin="round"/></g></svg>',
    };
    const cursor = el('cursor', SHAPES.arrow);
    let shape = 'arrow';
    const press = el('press');
    const cssToShape = (c, target) => {
        if (/pointer/.test(c)) return 'pointer';
        if (/grabbing/.test(c)) return 'grabbing';
        if (/grab/.test(c)) return 'grab';
        if (/crosshair|cell/.test(c)) return 'crosshair';
        if (/move|all-scroll/.test(c)) return 'move';
        if (/text/.test(c)) return 'text';
        if (c === 'auto' && target && target.closest && target.closest('input:not([type=checkbox]):not([type=radio]):not([type=range]):not([type=color]),textarea,[contenteditable=true]')) return 'text';
        return 'arrow';
    };
    const setShape = (next) => {
        if (next === shape) return;
        shape = next;
        cursor.innerHTML = SHAPES[next] || SHAPES.arrow;
    };
    let pos = { x: -100, y: -100 };
    let locked = null; // a shape forced while a stand-in (dropdown, dialog) is open

    const studio = {
        move(x, y) {
            pos = { x, y };
            cursor.style.left = x + 'px';
            cursor.style.top = y + 'px';
            press.style.left = x + 'px';
            press.style.top = y + 'px';
            if (locked) { setShape(locked); return; }
            const target = document.elementFromPoint(x, y);
            if (target) setShape(cssToShape(getComputedStyle(target).cursor, target));
        },
        lockShape(name) { locked = name; if (name) setShape(name); else this.move(pos.x, pos.y); },
        down() { cursor.classList.add('down'); press.classList.add('on'); },
        up() { cursor.classList.remove('down'); press.classList.remove('on'); },
        ripple(x = pos.x, y = pos.y) {
            const r = el('ripple');
            r.style.left = x + 'px';
            r.style.top = y + 'px';
            setTimeout(() => r.remove(), 600);
        },
        hideCursor() { cursor.style.display = 'none'; },
        showCursor() { cursor.style.display = ''; },
        get pos() { return pos; },

        // ---- keystroke chips -------------------------------------------
        _keys: null, _keysTimer: 0,
        keys(parts, label = '') {
            if (!this._keys) this._keys = el('keys');
            const k = this._keys;
            k.innerHTML = parts.map(p => p === '+' ? '<span class="plus">+</span>' : `<span class="key">${p}</span>`).join('')
                + (label ? `<span class="label">${label}</span>` : '');
            k.classList.add('on');
            clearTimeout(this._keysTimer);
            this._keysTimer = setTimeout(() => k.classList.remove('on'), 1500);
        },

        // ---- chapter lower third ---------------------------------------
        lowerThird(kicker, title, ms = 3600) {
            const t = el('third', `<div class="bar"></div><div class="txt"><div class="kick"></div><div class="ttl"></div></div>`);
            t.querySelector('.kick').textContent = kicker;
            t.querySelector('.ttl').textContent = title;
            requestAnimationFrame(() => requestAnimationFrame(() => t.classList.add('on')));
            setTimeout(() => { t.classList.remove('on'); setTimeout(() => t.remove(), 500); }, ms);
        },

        // ---- full-screen cards -----------------------------------------
        _card: null,
        card({ kicker = '', title = '', subtitle = '', chips = [] }) {
            this.cardOut(0);
            const c = el('card', `<div class="grid"></div><div class="inner">
                <div class="brand"><svg viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="#2563eb"/><g transform="translate(4 4)" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83z"/><path d="M2 12a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 12"/><path d="M2 17a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 17"/></g></svg>PDF Architect · Tutorials</div>
                <div class="kick"></div><h1></h1><p></p><div class="foot"></div></div>`);
            c.querySelector('.kick').textContent = kicker;
            c.querySelector('h1').textContent = title;
            c.querySelector('p').textContent = subtitle;
            c.querySelector('.foot').innerHTML = chips.map(x => `<span class="chip"></span>`).join('');
            c.querySelectorAll('.chip').forEach((n, i) => { n.textContent = chips[i]; });
            this._card = c;
            requestAnimationFrame(() => requestAnimationFrame(() => c.classList.add('on')));
        },
        cardOut(ms = 700) {
            const c = this._card;
            if (!c) return;
            this._card = null;
            c.style.transitionDuration = ms + 'ms';
            c.classList.remove('on');
            setTimeout(() => c.remove(), ms + 50);
        },

        // ---- spotlight ---------------------------------------------------
        _spot: null, _spotLabel: null,
        spotlight(rect, label = '', pad = 8) {
            if (!this._spot) { this._spot = el('spot'); this._spotLabel = el('spotlabel'); }
            const s = this._spot;
            Object.assign(s.style, { left: rect.x - pad + 'px', top: rect.y - pad + 'px', width: rect.width + pad * 2 + 'px', height: rect.height + pad * 2 + 'px' });
            s.classList.add('on');
            const l = this._spotLabel;
            if (label) {
                l.textContent = label;
                l.style.visibility = 'hidden';
                l.classList.add('on');
                const lw = l.offsetWidth, lh = l.offsetHeight;
                const below = rect.y + rect.height + pad + 12 + lh < innerHeight;
                const top = below ? rect.y + rect.height + pad + 12 : rect.y - pad - 12 - lh;
                const left = Math.max(12, Math.min(innerWidth - lw - 12, rect.x + rect.width / 2 - lw / 2));
                Object.assign(l.style, { left: left + 'px', top: top + 'px', visibility: '' });
            } else l.classList.remove('on');
        },
        spotlightOff() { this._spot?.classList.remove('on'); this._spotLabel?.classList.remove('on'); },

        // ---- native <select> stand-in -------------------------------------
        _dd: null,
        dropdown(rect, items, highlight) {
            this.dropdownClose();
            const d = el('dropdown');
            items.forEach((it, i) => {
                const o = document.createElement('div');
                o.className = it.group ? 'grp' : `opt${it.inGroup ? ' ingrp' : ''}${it.disabled ? ' dis' : ''}`;
                o.textContent = it.label;
                o.dataset.i = i;
                d.appendChild(o);
            });
            const rowH = 23, maxRows = 14;
            const height = Math.min(items.length, maxRows) * rowH + 4;
            const below = rect.y + rect.height + height < innerHeight - 8;
            Object.assign(d.style, {
                left: rect.x + 'px', minWidth: rect.width + 'px', maxHeight: height + 'px', overflowY: 'hidden',
                top: (below ? rect.y + rect.height : rect.y - height) + 'px',
            });
            this._dd = d;
            this.dropdownHighlight(highlight);
            return this.dropdownRects();
        },
        dropdownRects() {
            return [...(this._dd?.children || [])].map(o => { const r = o.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; });
        },
        dropdownHighlight(i) {
            if (!this._dd) return;
            [...this._dd.children].forEach((o, k) => o.classList.toggle('hi', k === i));
            const o = this._dd.children[i];
            if (o) {
                const top = o.offsetTop, bottom = top + o.offsetHeight;
                if (bottom > this._dd.scrollTop + this._dd.clientHeight) this._dd.scrollTop = bottom - this._dd.clientHeight + 2;
                if (top < this._dd.scrollTop) this._dd.scrollTop = top - 2;
            }
        },
        dropdownClose() { this._dd?.remove(); this._dd = null; },

        // ---- prompt / confirm / alert stand-in ----------------------------
        _dlg: null,
        dialog({ type, message, text = '' }) {
            this.dialogClose(true);
            const d = el('dialog', `<div class="origin"></div><div class="msg"></div>
                ${type === 'prompt' ? '<div class="field"><span class="val"></span><span class="caret"></span></div>' : ''}
                <div class="btns">${type === 'alert' ? '' : '<div class="btn" data-b="cancel">Cancel</div>'}<div class="btn primary" data-b="ok">OK</div></div>`);
            d.querySelector('.origin').textContent = `${location.host} says`;
            d.querySelector('.msg').textContent = message;
            if (type === 'prompt') d.querySelector('.val').textContent = text;
            this._dlg = d;
            requestAnimationFrame(() => requestAnimationFrame(() => d.classList.add('on')));
            const r = d.querySelector('[data-b="ok"]').getBoundingClientRect();
            return { x: r.x, y: r.y, width: r.width, height: r.height };
        },
        dialogText(text) { const v = this._dlg?.querySelector('.val'); if (v) v.textContent = text; },
        dialogOkRect() {
            const b = this._dlg?.querySelector('[data-b="ok"]');
            if (!b) return null;
            const r = b.getBoundingClientRect();
            return { x: r.x, y: r.y, width: r.width, height: r.height };
        },
        dialogClose(now = false) {
            const d = this._dlg;
            if (!d) return;
            this._dlg = null;
            if (now) { d.remove(); return; }
            d.classList.remove('on');
            setTimeout(() => d.remove(), 250);
        },

        // ---- colour palette stand-in ----------------------------------------
        _pal: null,
        palette(rect, colors, hi = -1) {
            this.paletteClose();
            const p = el('palette', colors.map((c, i) => `<div class="sw${i === hi ? ' hi' : ''}" style="background:${c}"></div>`).join(''));
            const below = rect.y + rect.height + 120 < innerHeight;
            Object.assign(p.style, { left: Math.min(rect.x, innerWidth - 240) + 'px', top: (below ? rect.y + rect.height + 6 : rect.y - 6 - 120) + 'px' });
            this._pal = p;
            requestAnimationFrame(() => p.classList.add('on'));
            return [...p.children].map(n => { const r = n.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; });
        },
        paletteRects() { return [...(this._pal?.children || [])].map(n => { const r = n.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; }); },
        paletteHighlight(i) { [...(this._pal?.children || [])].forEach((n, k) => n.classList.toggle('hi', k === i)); },
        paletteClose() { this._pal?.remove(); this._pal = null; },

        // ---- file picker stand-in -------------------------------------------
        _pick: null,
        filePicker(files, title = 'Open') {
            this.filePickerClose();
            const p = el('picker', `<div class="hd"></div>${files.map(f => `<div class="row"><span>📄</span><span class="nm"></span></div>`).join('')}
                <div class="ft"><div class="btn" style="padding:7px 16px;border:1px solid #c4c7c5;border-radius:999px;color:#0b57d0">Cancel</div>
                <div class="btn primary" style="padding:7px 18px;border-radius:999px;background:#0b57d0;color:#fff">Open</div></div>`);
            p.querySelector('.hd').textContent = title;
            p.querySelectorAll('.nm').forEach((n, i) => { n.textContent = files[i]; });
            this._pick = p;
            requestAnimationFrame(() => p.classList.add('on'));
            const rows = [...p.querySelectorAll('.row')].map(n => { const r = n.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; });
            const ob = p.querySelector('.ft .primary').getBoundingClientRect();
            return { rows, open: { x: ob.x, y: ob.y, width: ob.width, height: ob.height } };
        },
        filePickerHighlight(i) { [...(this._pick?.querySelectorAll('.row') || [])].forEach((n, k) => n.classList.toggle('hi', k === i)); },
        filePickerClose() { const p = this._pick; if (!p) return; this._pick = null; p.classList.remove('on'); setTimeout(() => p.remove(), 220); },

        // ---- download bubble ------------------------------------------------
        toast(name, sub = 'Download complete', ms = 3200) {
            const t = el('toast', `<div class="ico"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#1967d2" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v11M7 10l5 5 5-5M5 20h14"/></svg></div><div><div class="name"></div><div class="sub"></div></div>`);
            t.querySelector('.name').textContent = name;
            t.querySelector('.sub').textContent = sub;
            requestAnimationFrame(() => requestAnimationFrame(() => t.classList.add('on')));
            setTimeout(() => { t.classList.remove('on'); setTimeout(() => t.remove(), 300); }, ms);
        },
    };
    window.__studio = studio;

    // The drawn cursor follows the real pointer: Playwright's mouse produces
    // trusted events, and a window capture listener sees them before the app.
    window.addEventListener('mousemove', e => studio.move(e.clientX, e.clientY), true);
    window.addEventListener('mousedown', e => { studio.move(e.clientX, e.clientY); studio.down(); studio.ripple(e.clientX, e.clientY); }, true);
    window.addEventListener('mouseup', () => studio.up(), true);
}
