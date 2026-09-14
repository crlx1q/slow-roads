/* slow-roads mod layer v0.2.0
 * In-cabin cluster + center screen, local/server saves, turn signals, junk removal.
 * Docs: docs/MODS.md
 */
(function () {
	"use strict";

	var VER = "0.2.0";
	var DEF = {
		sound: true,
		cluster: true,
		screen: true,
		blend: true,
		debug: false,
		saveEndpoint: ""
	};
	var CFG = Object.assign({}, DEF, window.SR_MOD_CONFIG || {});
	var LS = window.localStorage;
	var K_STATE = "sr-mod:state";
	var K_RELOADED = "sr-mod:reloaded";
	var K_EP = "sr-mod:endpoint";
	var ENDPOINT = String(CFG.saveEndpoint || LS.getItem(K_EP) || "").replace(/\/+$/, "");
	var MI2KM = 1.609344;

	/* default in-cabin placement (percent of viewport); tune live with F3 */
	var DEF_LAYOUT = {
		cluster: { x: 50, y: 70, w: 26, rx: 6, ry: 0 },
		screen: { x: 76, y: 80, w: 16, rx: 8, ry: -18 }
	};

	function clone(o) { return JSON.parse(JSON.stringify(o)); }

	var state = {
		v: 2,
		updatedAt: 0,
		odoKm: 0,
		tripKm: 0,
		driveSec: 0,
		ui: { cluster: CFG.cluster !== false, screen: CFG.screen !== false },
		layout: clone(DEF_LAYOUT),
		game: {}
	};
	var telem = { kph: 0, has: false, unit: "kph", source: "none", override: null, auto: false };
	var sig = { left: false, right: false, phase: false };
	var edit = { on: false, sel: null, drag: null };
	var hud = null;
	var arcLen = { speed: 0, pwr: 0 };

	function byId(id) { return document.getElementById(id); }
	function pad(n, w) { n = String(n); while (n.length < w) n = "0" + n; return n; }
	function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
	function log() { if (CFG.debug) console.log.apply(console, ["[sr-mod]"].concat([].slice.call(arguments))); }
	function onReady(fn) {
		if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", fn);
		else fn();
	}
	function elm(tag, cls, html) {
		var e = document.createElement(tag);
		if (cls) e.className = cls;
		if (html != null) e.innerHTML = html;
		return e;
	}

	/* ---------------------------------------------------------------- 1. junk */

	var JUNK_HREF = /(ko-?fi|patreon|discord|paypal|buymeacoffee|twitter\.com|x\.com|reddit\.com|instagram\.com|youtube\.com|tiktok)/i;
	var JUNK_CLS = /(kofi|donate|patreon|discord|social)/i;
	var JUNK_TEXT = /^(donate|support us|support me|support|discord|ko-?fi|patreon|tip jar|buy me a coffee)$/i;

	function hideNode(node) {
		var t = node, i = 0;
		while (t && i < 2 && t.parentElement && t.parentElement.children.length === 1) { t = t.parentElement; i++; }
		if (t && t.style) { t.setAttribute("data-sr-hidden", "1"); t.style.setProperty("display", "none", "important"); }
	}

	function killJunk() {
		var list = document.querySelectorAll("a[href], img[src], div[class], span[class], button");
		for (var i = 0; i < list.length; i++) {
			var n = list[i];
			if (n.closest && n.closest("#sr-hud")) continue;
			var href = n.getAttribute("href") || "";
			var src = n.getAttribute("src") || "";
			var cn = n.className;
			var cls = String(cn && cn.baseVal != null ? cn.baseVal : (cn || ""));
			var txt = (n.textContent || "").trim();
			if (JUNK_HREF.test(href) || JUNK_HREF.test(src) || JUNK_CLS.test(cls) || (txt.length < 24 && JUNK_TEXT.test(txt))) hideNode(n);
		}
	}

	function watchJunk() {
		var t = null;
		var mo = new MutationObserver(function () { clearTimeout(t); t = setTimeout(killJunk, 300); });
		mo.observe(document.documentElement, { childList: true, subtree: true });
	}

	/* ---------------------------------------------------------------- 2. save */

	function snapshotGameLS() {
		var out = {};
		for (var i = 0; i < LS.length; i++) {
			var k = LS.key(i);
			if (!k || k.indexOf("sr-mod:") === 0) continue;
			var v = LS.getItem(k);
			if (v != null && v.length < 200000) out[k] = v;
		}
		return out;
	}

	function applyGameLS(g) {
		if (!g) return;
		Object.keys(g).forEach(function (k) { try { LS.setItem(k, g[k]); } catch (e) {} });
	}

	function saveLocal() {
		state.game = snapshotGameLS();
		state.updatedAt = Date.now();
		try { LS.setItem(K_STATE, JSON.stringify(state)); } catch (e) {}
	}

	function loadLocal() {
		try { var raw = LS.getItem(K_STATE); return raw ? JSON.parse(raw) : null; } catch (e) { return null; }
	}

	function mergeState(s) {
		if (!s || typeof s !== "object") return;
		if (typeof s.odoKm === "number") state.odoKm = s.odoKm;
		if (typeof s.tripKm === "number") state.tripKm = s.tripKm;
		if (typeof s.driveSec === "number") state.driveSec = s.driveSec;
		if (typeof s.updatedAt === "number") state.updatedAt = s.updatedAt;
		if (s.ui) {
			state.ui.cluster = s.ui.cluster !== false;
			state.ui.screen = s.ui.screen !== false;
		}
		if (s.layout) {
			["cluster", "screen"].forEach(function (k) {
				if (!s.layout[k]) return;
				Object.keys(DEF_LAYOUT[k]).forEach(function (p) {
					if (typeof s.layout[k][p] === "number") state.layout[k][p] = s.layout[k][p];
				});
			});
		}
	}

	function remoteGet() {
		if (!ENDPOINT) return Promise.resolve(null);
		return fetch(ENDPOINT + "/state", { method: "GET" })
			.then(function (r) { return r.ok ? r.json() : null; })
			.catch(function () { return null; });
	}

	function remotePut() {
		saveLocal();
		if (!ENDPOINT) return Promise.resolve(false);
		return fetch(ENDPOINT + "/state", {
			method: "PUT",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(state)
		}).then(function (r) { return r.ok; }).catch(function () { return false; });
	}

	function bootSync() {
		mergeState(loadLocal());
		if (!ENDPOINT) return;
		remoteGet().then(function (rem) {
			if (!rem || typeof rem !== "object") return;
			if ((rem.updatedAt || 0) <= (state.updatedAt || 0)) return;
			mergeState(rem);
			applyGameLS(rem.game);
			try { LS.setItem(K_STATE, JSON.stringify(rem)); } catch (e) {}
			if (!sessionStorage.getItem(K_RELOADED)) {
				sessionStorage.setItem(K_RELOADED, "1");
				location.reload();
			}
		});
	}

	function exportSave() {
		saveLocal();
		var blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
		var a = document.createElement("a");
		a.href = URL.createObjectURL(blob);
		a.download = "slow-roads-save.json";
		a.click();
		setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
	}

	/* ----------------------------------------------------------- 3. telemetry */

	var speedNode = null;
	var scanAt = 0;
	var autoAt = 0;

	function scanSpeed() {
		if (!document.body) return null;
		var w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null);
		var n;
		while ((n = w.nextNode())) {
			var t = (n.nodeValue || "").trim();
			if (!/^\d{1,3}(\.\d+)?$/.test(t)) continue;
			var p = n.parentElement;
			if (!p || (p.closest && p.closest("#sr-hud"))) continue;
			var ctx = ((p.parentElement || p).textContent || "").toLowerCase();
			var unit = null;
			if (ctx.indexOf("mph") >= 0) unit = "mph";
			else if (ctx.indexOf("kph") >= 0 || ctx.indexOf("km/h") >= 0) unit = "kph";
			if (!unit) continue;
			speedNode = n;
			telem.unit = unit;
			telem.source = "dom:" + unit;
			log("speed source", unit, p);
			return n;
		}
		return null;
	}

	function scanAuto() {
		if (!document.body) return;
		var s = document.body.innerText || "";
		var m = /autodrive\s*(on|off)/i.exec(s);
		if (m) telem.auto = m[1].toLowerCase() === "on";
		else if (/autodrive/i.test(s) === false) telem.auto = telem.auto && false;
	}

	function readTelemetry(dt, now) {
		var raw = null;
		if (telem.override != null) {
			raw = telem.override;
			telem.unit = "kph";
			telem.source = "manual";
		} else if (speedNode && speedNode.parentElement) {
			var v = parseFloat(speedNode.nodeValue);
			if (isFinite(v)) raw = v;
		}
		if (raw == null && now - scanAt > 1500) {
			scanAt = now;
			if (scanSpeed()) {
				var v2 = parseFloat(speedNode.nodeValue);
				if (isFinite(v2)) raw = v2;
			}
		}
		if (now - autoAt > 1200) { autoAt = now; scanAuto(); }
		telem.has = raw != null;
		telem.kph = raw == null ? 0 : (telem.unit === "mph" ? raw * MI2KM : raw);
		if (telem.kph > 0.5 && dt > 0) {
			var km = telem.kph * dt / 3600;
			state.tripKm += km;
			state.odoKm += km;
			state.driveSec += dt;
		}
	}

	/* ----------------------------------------------------------------- 4. hud */

	var ARC = "M22 98 A 54 54 0 1 1 98 98";

	function clusterHtml() {
		return '<div class="sr-arrow sr-arrow-l"></div>' +
			'<div class="sr-cl-main">' +
			'<div class="sr-g"><svg class="sr-gauge" viewBox="0 0 120 120"><path class="sr-arc-bg" d="' + ARC + '"/><path id="sr-arc-speed" class="sr-arc sr-arc-speed" d="' + ARC + '"/></svg>' +
			'<div class="sr-g-txt"><b id="sr-speed">--</b><i>KPH</i></div></div>' +
			'<div class="sr-cl-mid"><div class="sr-tick"></div>' +
			'<div class="sr-odo"><span id="sr-odo-dim">000</span><em id="sr-odo-lit">00</em><i>KM</i></div>' +
			'<div class="sr-cruise" id="sr-cruise">&#9210; CRUISE</div>' +
			'<div class="sr-clock" id="sr-clock">--:--</div></div>' +
			'<div class="sr-g"><svg class="sr-gauge" viewBox="0 0 120 120"><defs><linearGradient id="srPwr" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stop-color="#49d96b"/><stop offset="1" stop-color="#e6dc4b"/></linearGradient></defs>' +
			'<path class="sr-arc-bg" d="' + ARC + '"/><path id="sr-arc-pwr" class="sr-arc sr-arc-pwr" d="' + ARC + '"/></svg>' +
			'<div class="sr-g-txt sr-g-ico">&#9889;</div></div>' +
			'</div>' +
			'<div class="sr-tags"><span>RWD</span><span>&#9681;</span></div>' +
			'<div class="sr-arrow sr-arrow-r"></div>';
	}

	function carHtml() {
		return '<div class="sr-car">' +
			'<i class="sr-cl sr-cl-fl"></i><i class="sr-cl sr-cl-fr"></i>' +
			'<i class="sr-cl sr-cl-sl"></i><i class="sr-cl sr-cl-sr"></i>' +
			'<i class="sr-cl sr-cl-rl"></i><i class="sr-cl sr-cl-rr"></i>' +
			'</div>';
	}

	function screenHtml() {
		return '<div class="sr-scr-top"><span id="sr-scr-time">--:--</span><span id="sr-scr-date"></span><span class="sr-net">LTE &#9636;</span></div>' +
			'<div class="sr-scr-body">' +
			'<div class="sr-card sr-card-nav"><div class="sr-map"><i class="sr-road"></i><i class="sr-dot"></i></div>' +
			'<div class="sr-card-b"><b>NAVI</b><span id="sr-nav-sub">no route</span></div></div>' +
			'<div class="sr-card sr-card-drv">' + carHtml() +
			'<div class="sr-drvinfo"><b id="sr-scr-speed">--</b><span>km/h</span><em class="sr-gear">D</em></div></div>' +
			'<div class="sr-card sr-card-med"><div class="sr-card-b"><b>no media</b><span>slow roads fm</span></div>' +
			'<div class="sr-media">&#9198; &#9205; &#9197;</div>' +
			'<div class="sr-clim"><span>21.5&deg;</span><span>A/C</span></div></div>' +
			'</div>' +
			'<div class="sr-scr-bot"><span class="sr-dock">&#8962; &#9834; &#9743; &#9906; &#9881;</span>' +
			'<span class="sr-stats"><i>TRIP</i> <b id="sr-trip">0.0</b> <i>ODO</i> <b id="sr-odo2">0</b> <i>TIME</i> <b id="sr-time2">0m</b></span>' +
			'<span id="sr-scr-sync">local save</span></div>';
	}

	function buildHud() {
		hud = elm("div");
		hud.id = "sr-hud";
		if (CFG.blend) hud.classList.add("sr-blend");
		hud.innerHTML =
			'<div class="sr-lamp sr-lamp-f"></div><div class="sr-lamp sr-lamp-r"></div>' +
			'<div class="sr-lamp sr-lamp-sl"></div><div class="sr-lamp sr-lamp-sr"></div>' +
			'<div id="sr-cluster" class="sr-panel sr-cluster" data-sr-panel="cluster">' + clusterHtml() + '</div>' +
			'<div id="sr-screen" class="sr-panel sr-screen" data-sr-panel="screen">' + screenHtml() + '</div>' +
			'<div id="sr-toasts"></div>';
		document.body.appendChild(hud);
		[["speed", byId("sr-arc-speed")], ["pwr", byId("sr-arc-pwr")]].forEach(function (pair) {
			var n = pair[1];
			if (!n || !n.getTotalLength) return;
			var L = n.getTotalLength();
			arcLen[pair[0]] = L;
			n.style.strokeDasharray = String(L);
			n.style.strokeDashoffset = String(L);
		});
	}

	function applyLayout() {
		["cluster", "screen"].forEach(function (k) {
			var n = byId("sr-" + k);
			if (!n) return;
			var L = state.layout[k];
			var w = L.w / 100 * window.innerWidth;
			n.style.left = L.x + "%";
			n.style.top = L.y + "%";
			n.style.width = w + "px";
			n.style.fontSize = Math.max(6, w * (k === "cluster" ? 0.052 : 0.042)) + "px";
			n.style.transform = "translate(-50%,-50%) perspective(1200px) rotateX(" + L.rx + "deg) rotateY(" + L.ry + "deg)";
		});
	}

	function applyVis() {
		var c = byId("sr-cluster"), s = byId("sr-screen");
		if (c) c.classList.toggle("sr-off", !state.ui.cluster);
		if (s) s.classList.toggle("sr-off", !state.ui.screen);
	}

	function toast(msg) {
		var box = byId("sr-toasts");
		if (!box) return;
		var t = elm("div", "sr-toast", String(msg));
		box.appendChild(t);
		setTimeout(function () { t.classList.add("sr-toast-out"); }, 2600);
		setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 3100);
	}

	/* -------------------------------------------------------------- 5. render */

	function odoParts(km) {
		var s = pad(Math.floor(Math.max(0, km)), 5);
		var i = 0;
		while (i < s.length - 1 && s.charAt(i) === "0") i++;
		return { dim: s.slice(0, i), lit: s.slice(i) };
	}
	function hhmm(d) { return pad(d.getHours(), 2) + ":" + pad(d.getMinutes(), 2); }
	function dmy(d) { return pad(d.getDate(), 2) + "." + pad(d.getMonth() + 1, 2) + "." + d.getFullYear(); }
	function txt(id, v) { var n = byId(id); if (n && n.textContent !== v) n.textContent = v; }
	function dur(sec) {
		var h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60);
		return h > 0 ? h + "h " + m + "m" : m + "m";
	}

	var lastText = 0;

	function renderFrame(now) {
		var f = telem.has ? clamp(telem.kph / 160, 0, 1) : 0;
		var a = byId("sr-arc-speed");
		if (a) a.style.strokeDashoffset = String(arcLen.speed * (1 - f));
		var p = byId("sr-arc-pwr");
		if (p) p.style.strokeDashoffset = String(arcLen.pwr * (1 - (telem.has ? clamp(f * 0.85 + 0.06, 0, 1) : 0)));
		if (now - lastText < 120) return;
		lastText = now;
		var d = new Date();
		var kph = telem.has ? String(Math.round(telem.kph)) : "--";
		txt("sr-speed", kph);
		txt("sr-scr-speed", kph);
		var o = odoParts(state.odoKm);
		txt("sr-odo-dim", o.dim);
		txt("sr-odo-lit", o.lit);
		txt("sr-clock", hhmm(d));
		txt("sr-scr-time", hhmm(d));
		txt("sr-scr-date", dmy(d));
		txt("sr-trip", state.tripKm.toFixed(1));
		txt("sr-odo2", String(Math.floor(state.odoKm)));
		txt("sr-time2", dur(state.driveSec));
		txt("sr-scr-sync", ENDPOINT ? "server save" : "local save");
		txt("sr-nav-sub", telem.has ? "trip " + state.tripKm.toFixed(1) + " km" : "no signal");
		var c = byId("sr-cruise");
		if (c) c.classList.toggle("sr-on", !!telem.auto);
	}

	var lastT = 0;
	function loop(ts) {
		var now = ts || performance.now();
		var dt = lastT ? Math.min(0.25, (now - lastT) / 1000) : 0;
		lastT = now;
		readTelemetry(dt, now);
		renderFrame(now);
		requestAnimationFrame(loop);
	}

	/* ------------------------------------------------------------- 6. signals */

	var actx = null, sigTimer = null;

	function beep(hi) {
		if (!CFG.sound) return;
		try {
			actx = actx || new (window.AudioContext || window.webkitAudioContext)();
			var o = actx.createOscillator(), g = actx.createGain();
			o.type = "square";
			o.frequency.value = hi ? 760 : 660;
			g.gain.value = 0.03;
			o.connect(g);
			g.connect(actx.destination);
			o.start();
			o.stop(actx.currentTime + 0.035);
		} catch (e) {}
	}

	function sigTick() {
		sig.phase = !sig.phase;
		hud.classList.toggle("sr-blink", sig.phase);
		beep(sig.phase);
	}

	function applySig() {
		hud.classList.toggle("sr-l", sig.left);
		hud.classList.toggle("sr-r", sig.right);
		var on = sig.left || sig.right;
		if (on && !sigTimer) {
			sig.phase = false;
			sigTick();
			sigTimer = setInterval(sigTick, 430);
		} else if (!on && sigTimer) {
			clearInterval(sigTimer);
			sigTimer = null;
			sig.phase = false;
			hud.classList.remove("sr-blink");
		}
	}

	/* ---------------------------------------------------------- 7. edit layout */

	function setEdit(on) {
		edit.on = on;
		edit.drag = null;
		hud.classList.toggle("sr-editing", on);
		if (on) toast("layout: drag panel \u00b7 wheel = size \u00b7 shift+wheel = yaw \u00b7 alt+wheel = tilt \u00b7 F3 = save");
		else { saveLocal(); remotePut(); toast("layout saved"); }
	}

	function panelOf(target) {
		return target && target.closest ? target.closest("[data-sr-panel]") : null;
	}

	function bindEdit() {
		hud.addEventListener("mousedown", function (e) {
			if (!edit.on) return;
			var p = panelOf(e.target);
			if (!p) return;
			edit.sel = p.getAttribute("data-sr-panel");
			edit.drag = { x: e.clientX, y: e.clientY, lx: state.layout[edit.sel].x, ly: state.layout[edit.sel].y };
			e.preventDefault();
			e.stopPropagation();
		}, true);

		window.addEventListener("mousemove", function (e) {
			if (!edit.on || !edit.drag) return;
			var L = state.layout[edit.sel];
			L.x = clamp(edit.drag.lx + (e.clientX - edit.drag.x) / window.innerWidth * 100, 2, 98);
			L.y = clamp(edit.drag.ly + (e.clientY - edit.drag.y) / window.innerHeight * 100, 2, 98);
			applyLayout();
		}, true);

		window.addEventListener("mouseup", function () {
			if (edit.drag) { edit.drag = null; saveLocal(); }
		}, true);

		hud.addEventListener("wheel", function (e) {
			if (!edit.on) return;
			var p = panelOf(e.target);
			if (!p) return;
			var L = state.layout[p.getAttribute("data-sr-panel")];
			var d = e.deltaY > 0 ? -1 : 1;
			if (e.shiftKey) L.ry = clamp(L.ry + d * 2, -60, 60);
			else if (e.altKey) L.rx = clamp(L.rx + d * 2, -60, 60);
			else L.w = clamp(L.w + d * 0.8, 5, 70);
			applyLayout();
			e.preventDefault();
			e.stopPropagation();
		}, { capture: true, passive: false });
	}

	/* ---------------------------------------------------------------- 8. keys */

	function clickAutodrive() {
		var list = document.querySelectorAll("button, [role=button], label, .setting, div, span");
		for (var i = 0; i < list.length; i++) {
			var n = list[i];
			if (n.closest && n.closest("#sr-hud")) continue;
			var t = (n.textContent || "").trim().toLowerCase();
			if (t.length > 2 && t.length < 22 && /auto\s?drive|self\s?driv/.test(t) && n.offsetParent) {
				n.click();
				toast("autodrive toggle clicked");
				return true;
			}
		}
		toast("autodrive control not found");
		return false;
	}

	function bindKeys() {
		window.addEventListener("keydown", function (e) {
			if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
			var tg = e.target;
			var tag = (tg && tg.tagName ? tg.tagName : "").toLowerCase();
			if (tag === "input" || tag === "textarea" || tag === "select" || (tg && tg.isContentEditable)) return;
			var k = (e.key || "").toLowerCase();
			var used = true;
			if (k === "z") { sig.left = !sig.left; applySig(); }
			else if (k === "x") { sig.right = !sig.right; applySig(); }
			else if (k === "f2") { state.ui.cluster = !state.ui.cluster; applyVis(); saveLocal(); }
			else if (k === "f4") { state.ui.screen = !state.ui.screen; applyVis(); saveLocal(); }
			else if (k === "f3") { setEdit(!edit.on); }
			else if (k === "f7") { clickAutodrive(); }
			else if (k === "f8") { debugScan(); }
			else if (k === "escape" && edit.on) { setEdit(false); }
			else used = false;
			if (used) {
				e.preventDefault();
				e.stopImmediatePropagation();
			}
		}, true);

		window.addEventListener("keyup", function (e) {
			var k = (e.key || "").toLowerCase();
			if (k === "z" || k === "x") { e.preventDefault(); e.stopImmediatePropagation(); }
		}, true);
	}

	function debugScan() {
		var out = { version: VER, telemetry: telem, layout: state.layout, endpoint: ENDPOINT || null, globals: [], links: [] };
		try {
			Object.keys(window).forEach(function (k) {
				if (/speed|velocity|kph|mph|odo|throttle|gear|vehicle|camera|scene|seed|drive/i.test(k)) out.globals.push(k);
			});
		} catch (e) {}
		var links = document.querySelectorAll("a[href]");
		for (var i = 0; i < links.length; i++) out.links.push(links[i].getAttribute("href"));
		console.log("[sr-mod] scan", out);
		console.log("[sr-mod] speed node", speedNode ? speedNode.parentElement : null);
		toast("scan printed to console");
		return out;
	}

	/* ----------------------------------------------------------------- 9. api */

	window.SRMOD = {
		version: VER,
		cfg: CFG,
		state: state,
		telemetry: telem,
		signals: sig,
		setTelemetry: function (v) { telem.override = v == null ? null : Number(v); },
		setEndpoint: function (u) { LS.setItem(K_EP, String(u || "").replace(/\/+$/, "")); location.reload(); },
		save: {
			now: remotePut,
			pull: remoteGet,
			export: exportSave,
			wipe: function () { LS.removeItem(K_STATE); toast("mod save wiped"); }
		},
		layout: {
			edit: function () { setEdit(!edit.on); },
			get: function () { return clone(state.layout); },
			set: function (l) { mergeState({ layout: l }); applyLayout(); saveLocal(); },
			reset: function () { state.layout = clone(DEF_LAYOUT); applyLayout(); saveLocal(); toast("layout reset"); }
		},
		toggleCluster: function () { state.ui.cluster = !state.ui.cluster; applyVis(); saveLocal(); },
		toggleScreen: function () { state.ui.screen = !state.ui.screen; applyVis(); saveLocal(); },
		autodrive: clickAutodrive,
		killJunk: killJunk,
		scan: debugScan
	};

	/* ---------------------------------------------------------------- 10. init */

	function init() {
		buildHud();
		applyLayout();
		applyVis();
		bindEdit();
		bindKeys();
		killJunk();
		watchJunk();
		window.addEventListener("resize", applyLayout);
		requestAnimationFrame(loop);
		setInterval(saveLocal, 5000);
		if (ENDPOINT) setInterval(remotePut, 20000);
		window.addEventListener("beforeunload", function () {
			saveLocal();
			if (ENDPOINT && navigator.sendBeacon) {
				try {
					navigator.sendBeacon(ENDPOINT + "/state", new Blob([JSON.stringify(state)], { type: "application/json" }));
				} catch (e) {}
			}
		});
		log("ready", VER);
	}

	bootSync();
	onReady(init);
})();
