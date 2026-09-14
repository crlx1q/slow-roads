/*! slow-roads mod layer v0.1.0
 *  1) hides donate/social junk  2) local+remote save of all params
 *  3) original-style instrument cluster  4) Li-style center screen
 *  5) Z/X turn signals (front / side / rear)
 *  Loaded from index.html <head>, before the game bundle. No dependencies.
 */
(function () {
	"use strict";

	var VER = "0.1.0";
	var LS = window.localStorage;
	var DEF = { sound: true, cluster: true, screen: true, maxKph: 160, debug: false, saveEndpoint: "" };
	var CFG = DEF;
	try { CFG = Object.assign({}, DEF, window.SR_MOD_CONFIG || {}); } catch (e) {}
	var ENDPOINT = "";
	try { ENDPOINT = String(CFG.saveEndpoint || LS.getItem("sr-mod:endpoint") || "").replace(/\/+$/, ""); } catch (e) {}
	var K_STATE = "sr-mod:state";
	var K_RELOADED = "sr-mod:reloaded";

	var state = {
		v: 1,
		updatedAt: 0,
		odoKm: 0,
		tripKm: 0,
		driveSec: 0,
		ui: { cluster: CFG.cluster !== false, screen: CFG.screen !== false },
		game: {}
	};
	var telem = { speed: 0, hasSpeed: false, accel: 0, source: "none", override: undefined };
	var sig = { left: false, right: false, phase: false };

	/* ---------------- helpers ---------------- */
	function el(tag, cls, html) {
		var e = document.createElement(tag);
		if (cls) e.className = cls;
		if (html != null) e.innerHTML = html;
		return e;
	}
	function byId(id) { return document.getElementById(id); }
	function pad(n, w) { var s = String(Math.max(0, Math.floor(n))); while (s.length < w) s = "0" + s; return s; }
	function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
	function log() { if (CFG.debug && window.console) console.log.apply(console, ["[sr-mod]"].concat([].slice.call(arguments))); }
	function onReady(fn) {
		if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", fn);
		else fn();
	}

	/* ---------------- 1. junk removal ---------------- */
	var JUNK_HREF = /(ko-?fi|patreon|discord|paypal|buymeacoffee|twitter\.com|x\.com|reddit\.com|instagram\.com|youtube\.com|tiktok)/i;
	var JUNK_TEXT = /^(donate|support us|support me|support|discord|ko-?fi|patreon|tip jar|buy me a coffee)$/i;
	var junkHits = 0;

	function hideNode(n) {
		var t = n;
		for (var i = 0; i < 2; i++) {
			var p = t.parentElement;
			if (p && p !== document.body && p.id !== "root" && p.children.length === 1) t = p;
			else break;
		}
		if (t.getAttribute && t.getAttribute("data-sr-hidden")) return;
		if (t.setAttribute) t.setAttribute("data-sr-hidden", "1");
		if (t.style) t.style.setProperty("display", "none", "important");
		junkHits++;
	}

	function killJunk() {
		var nodes = document.querySelectorAll("a[href], img[src], div[class], span[class], button");
		for (var i = 0; i < nodes.length; i++) {
			var n = nodes[i];
			if (n.closest && n.closest("#sr-hud")) continue;
			var href = n.getAttribute("href");
			var src = n.getAttribute("src");
			var cls = typeof n.className === "string" ? n.className : "";
			var txt = n.children.length === 0 ? (n.textContent || "").trim() : "";
			var bad =
				(href && JUNK_HREF.test(href)) ||
				(src && /ico_kofi/i.test(src)) ||
				/(kofi|ko-fi|donate|patreon|discord|social)/i.test(cls) ||
				(txt && txt.length < 24 && JUNK_TEXT.test(txt));
			if (bad) hideNode(n);
		}
		log("junk hidden:", junkHits);
	}

	function watchJunk() {
		var t = null;
		function schedule() { if (t) return; t = setTimeout(function () { t = null; killJunk(); }, 300); }
		schedule();
		try {
			new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true });
		} catch (e) {}
	}

	/* ---------------- 2. save / sync ---------------- */
	function snapshotGameLS() {
		var o = {};
		try {
			for (var i = 0; i < LS.length; i++) {
				var k = LS.key(i);
				if (k && k.indexOf("sr-mod:") !== 0) o[k] = LS.getItem(k);
			}
		} catch (e) {}
		return o;
	}
	function applyGameLS(map) {
		if (!map) return;
		Object.keys(map).forEach(function (k) { try { LS.setItem(k, map[k]); } catch (e) {} });
	}
	function saveLocal() {
		state.updatedAt = Date.now();
		state.game = snapshotGameLS();
		try { LS.setItem(K_STATE, JSON.stringify(state)); } catch (e) {}
	}
	function loadLocal() {
		try {
			var raw = LS.getItem(K_STATE);
			if (!raw) return;
			var s = JSON.parse(raw);
			if (!s || !s.v) return;
			state.odoKm = +s.odoKm || 0;
			state.tripKm = +s.tripKm || 0;
			state.driveSec = +s.driveSec || 0;
			state.updatedAt = +s.updatedAt || 0;
			if (s.ui) state.ui = { cluster: s.ui.cluster !== false, screen: s.ui.screen !== false };
			state.game = s.game || {};
		} catch (e) {}
	}
	function remoteGet() {
		if (!ENDPOINT) return Promise.resolve(null);
		return fetch(ENDPOINT + "/state", { headers: { accept: "application/json" } })
			.then(function (r) { return r.ok ? r.json() : null; })
			.catch(function () { return null; });
	}
	function remotePut() {
		if (!ENDPOINT) return Promise.resolve(false);
		saveLocal();
		return fetch(ENDPOINT + "/state", {
			method: "PUT",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(state)
		}).then(function (r) { return r.ok; }).catch(function () { return false; });
	}
	function bootSync() {
		loadLocal();
		if (!ENDPOINT) return;
		remoteGet().then(function (rs) {
			if (!rs || !rs.updatedAt) { remotePut(); return; }
			if (rs.updatedAt > (state.updatedAt || 0) + 1000) {
				state.odoKm = +rs.odoKm || 0;
				state.tripKm = +rs.tripKm || 0;
				state.driveSec = +rs.driveSec || 0;
				state.updatedAt = +rs.updatedAt || 0;
				if (rs.ui) state.ui = { cluster: rs.ui.cluster !== false, screen: rs.ui.screen !== false };
				state.game = rs.game || {};
				applyGameLS(state.game);
				try { LS.setItem(K_STATE, JSON.stringify(state)); } catch (e) {}
				var done = false;
				try { done = !!sessionStorage.getItem(K_RELOADED); } catch (e) {}
				if (!done) {
					try { sessionStorage.setItem(K_RELOADED, "1"); } catch (e) {}
					toast("Save restored from server, reloading...");
					setTimeout(function () { location.reload(); }, 700);
				}
			} else {
				remotePut();
			}
		});
	}
	function exportSave() {
		saveLocal();
		try {
			var a = document.createElement("a");
			a.href = URL.createObjectURL(new Blob([JSON.stringify(state, null, 2)], { type: "application/json" }));
			a.download = "slow-roads-save.json";
			a.click();
		} catch (e) {}
	}

	/* ---------------- 3. telemetry ---------------- */
	var speedEl = null, lastScan = 0;
	function scanSpeedEl() {
		var root = byId("root") || document.body;
		var all = root.querySelectorAll("div, span, p");
		for (var i = 0; i < all.length; i++) {
			var n = all[i];
			if (n.closest && n.closest("#sr-hud")) continue;
			if (n.children.length) continue;
			var t = (n.textContent || "").trim();
			if (!t || t.length > 12) continue;
			if (/^\d{1,3}(\.\d)?$/.test(t)) {
				var p = n.parentElement;
				if (p && /kph|mph|km\/?h/i.test(p.textContent || "")) return n;
			} else if (/^\d{1,3}(\.\d)?\s*(kph|mph|km\/?h)$/i.test(t)) {
				return n;
			}
		}
		return null;
	}
	function readTelemetry(dt) {
		var v = null;
		if (typeof telem.override === "number") {
			v = telem.override;
			telem.source = "api";
		} else {
			var detached = !speedEl || !speedEl.parentNode;
			if (detached && Date.now() - lastScan > 2000) { lastScan = Date.now(); speedEl = scanSpeedEl(); }
			if (speedEl && speedEl.parentNode) {
				var m = (speedEl.textContent || "").match(/\d{1,3}(\.\d)?/);
				if (m) { v = parseFloat(m[0]); telem.source = "hud"; }
			}
		}
		if (v == null || isNaN(v)) { telem.hasSpeed = false; return; }
		var prev = telem.speed;
		telem.hasSpeed = true;
		telem.speed = v;
		telem.accel = dt > 0 ? (v - prev) / dt : 0;
		var km = (v / 3600) * dt;
		state.odoKm += km;
		state.tripKm += km;
		if (v > 1) state.driveSec += dt;
	}

	/* ---------------- 4. HUD ---------------- */
	var ARC = "M22 98 A 54 54 0 1 1 98 98";
	var arcLen = { speed: 1, pwr: 1 };

	function buildHud() {
		if (byId("sr-hud")) return;
		var hud = el("div");
		hud.id = "sr-hud";

		["fl", "fr", "sl", "sr", "rl", "rr"].forEach(function (k) {
			hud.appendChild(el("div", "sr-lamp sr-lamp-" + k));
		});

		var c = el("div", "sr-cluster");
		c.id = "sr-cluster";
		c.innerHTML =
			'<div class="sr-arrow sr-arrow-l"></div>' +
			'<div class="sr-gauge">' +
			'<svg viewBox="0 0 120 120"><path class="sr-arc-bg" d="' + ARC + '"/>' +
			'<path class="sr-arc-speed" id="sr-arc-speed" d="' + ARC + '"/></svg>' +
			'<div class="sr-gauge-txt"><b id="sr-speed">--</b><i>KPH</i></div></div>' +
			'<div class="sr-mid"><div class="sr-odo"><span id="sr-odo-dim">000</span><b id="sr-odo-lit">00</b><i>KM</i></div>' +
			'<div class="sr-cruise" id="sr-cruise">CRUISE</div>' +
			'<div class="sr-clock" id="sr-clock">--:--</div></div>' +
			'<div class="sr-gauge">' +
			'<svg viewBox="0 0 120 120"><defs><linearGradient id="srPwr" x1="0" y1="1" x2="1" y2="0">' +
			'<stop offset="0" stop-color="#49d96b"/><stop offset="1" stop-color="#e6dc4b"/></linearGradient></defs>' +
			'<path class="sr-arc-bg" d="' + ARC + '"/>' +
			'<path class="sr-arc-pwr" id="sr-arc-pwr" d="' + ARC + '"/></svg>' +
			'<div class="sr-gauge-txt sr-pwr">\u26a1</div></div>' +
			'<div class="sr-tags"><span>RWD</span><span class="sr-beam">\u25d1</span></div>' +
			'<div class="sr-arrow sr-arrow-r"></div>';
		hud.appendChild(c);

		var s = el("div", "sr-screen");
		s.id = "sr-screen";
		s.innerHTML =
			'<div class="sr-scr-top"><span id="sr-scr-time">--:--</span>' +
			'<span id="sr-scr-date"></span><span class="sr-scr-dim">--\u00b0C</span></div>' +
			'<div class="sr-scr-body">' +
			'<div class="sr-scr-col"><b id="sr-scr-speed">--</b><i>km/h</i><span class="sr-gear">D</span></div>' +
			'<div class="sr-car"><div class="sr-car-body"></div>' +
			'<span class="sr-cl sr-cl-fl"></span><span class="sr-cl sr-cl-fr"></span>' +
			'<span class="sr-cl sr-cl-sl"></span><span class="sr-cl sr-cl-sr"></span>' +
			'<span class="sr-cl sr-cl-rl"></span><span class="sr-cl sr-cl-rr"></span></div>' +
			'<div class="sr-scr-col sr-scr-stats">' +
			'<div>TRIP <b id="sr-trip">0.0</b> km</div>' +
			'<div>ODO <b id="sr-odo2">0</b> km</div>' +
			'<div>TIME <b id="sr-time2">0m</b></div></div></div>' +
			'<div class="sr-scr-bottom"><span class="sr-scr-dim">\u23ee \u23ef \u23ed no media</span>' +
			'<span class="sr-scr-dim" id="sr-scr-sync">local save</span></div>';
		hud.appendChild(s);

		hud.appendChild(el("div", "sr-toasts")).id = "sr-toasts";
		(document.body || document.documentElement).appendChild(hud);

		try {
			var a = byId("sr-arc-speed"), b = byId("sr-arc-pwr");
			arcLen.speed = a.getTotalLength();
			arcLen.pwr = b.getTotalLength();
			a.style.strokeDasharray = arcLen.speed;
			b.style.strokeDasharray = arcLen.pwr;
			a.style.strokeDashoffset = arcLen.speed;
			b.style.strokeDashoffset = arcLen.pwr;
		} catch (e) {}

		applyVis();
	}

	function applyVis() {
		var c = byId("sr-cluster"), s = byId("sr-screen");
		if (c) c.classList.toggle("sr-off", !state.ui.cluster);
		if (s) s.classList.toggle("sr-off", !state.ui.screen);
	}
	function toggleVis(which) {
		state.ui[which] = !state.ui[which];
		applyVis();
		saveLocal();
		toast((which === "cluster" ? "Cluster " : "Center screen ") + (state.ui[which] ? "on" : "off"));
	}
	function toast(msg) {
		var box = byId("sr-toasts");
		if (!box) return;
		var t = el("div", "sr-toast", String(msg));
		box.appendChild(t);
		setTimeout(function () { t.classList.add("sr-toast-out"); }, 2600);
		setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 3400);
	}

	function odoParts(km) {
		var s = pad(km, 5), i = 0;
		while (i < s.length - 1 && s.charAt(i) === "0") i++;
		return [s.slice(0, i), s.slice(i)];
	}
	function hhmm(d) { return pad(d.getHours(), 2) + ":" + pad(d.getMinutes(), 2); }

	var lastText = 0;
	function renderFrame(dt) {
		var frac = clamp(telem.speed / (CFG.maxKph || 160), 0, 1);
		var a = byId("sr-arc-speed"), b = byId("sr-arc-pwr");
		if (a) a.style.strokeDashoffset = arcLen.speed * (1 - (telem.hasSpeed ? frac : 0));
		if (b) {
			var p = clamp(0.5 + telem.accel / 30, 0, 1);
			b.style.strokeDashoffset = arcLen.pwr * (1 - (telem.hasSpeed ? p : 0));
		}
		if (Date.now() - lastText < 120) return;
		lastText = Date.now();

		var sp = telem.hasSpeed ? String(Math.round(telem.speed)) : "--";
		var o = odoParts(state.odoKm);
		var d = new Date();
		set("sr-speed", sp);
		set("sr-scr-speed", sp);
		set("sr-odo-dim", o[0]);
		set("sr-odo-lit", o[1]);
		set("sr-clock", hhmm(d));
		set("sr-scr-time", hhmm(d));
		set("sr-scr-date", d.toLocaleDateString());
		set("sr-trip", state.tripKm.toFixed(1));
		set("sr-odo2", Math.floor(state.odoKm));
		set("sr-time2", state.driveSec >= 3600
			? Math.floor(state.driveSec / 3600) + "h " + Math.floor((state.driveSec % 3600) / 60) + "m"
			: Math.floor(state.driveSec / 60) + "m");
		set("sr-scr-sync", ENDPOINT ? "server save" : "local save");
	}
	function set(id, val) { var n = byId(id); if (n && n.textContent !== val) n.textContent = val; }

	function startLoop() {
		var last = performance.now();
		function step(t) {
			var dt = Math.min(0.25, (t - last) / 1000);
			last = t;
			readTelemetry(dt);
			renderFrame(dt);
			requestAnimationFrame(step);
		}
		requestAnimationFrame(step);
	}

	/* ---------------- 5. turn signals ---------------- */
	var sigTimer = null, actx = null;
	function beep(freq) {
		if (!CFG.sound) return;
		try {
			actx = actx || new (window.AudioContext || window.webkitAudioContext)();
			var o = actx.createOscillator(), g = actx.createGain();
			o.type = "square";
			o.frequency.value = freq;
			g.gain.value = 0.03;
			o.connect(g);
			g.connect(actx.destination);
			o.start();
			g.gain.exponentialRampToValueAtTime(0.0001, actx.currentTime + 0.06);
			o.stop(actx.currentTime + 0.08);
		} catch (e) {}
	}
	function sigTick() {
		sig.phase = !sig.phase;
		document.body.classList.toggle("sr-sig-on", sig.phase);
		if (sig.phase) beep(sig.left && sig.right ? 760 : 660);
	}
	function applySig() {
		document.body.classList.toggle("sr-sig-left", !!sig.left);
		document.body.classList.toggle("sr-sig-right", !!sig.right);
		var active = sig.left || sig.right;
		if (active && !sigTimer) {
			sig.phase = false;
			sigTick();
			sigTimer = setInterval(sigTick, 430);
		} else if (!active && sigTimer) {
			clearInterval(sigTimer);
			sigTimer = null;
			sig.phase = false;
			document.body.classList.remove("sr-sig-on");
		}
	}

	/* ---------------- keys ---------------- */
	function bindKeys() {
		window.addEventListener("keydown", function (e) {
			if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
			var tg = e.target;
			if (tg && tg.tagName && /^(input|textarea|select)$/i.test(tg.tagName)) return;
			var k = (e.key || "").toLowerCase();
			if (k === "z") { sig.left = !sig.left; applySig(); }
			else if (k === "x") { sig.right = !sig.right; applySig(); }
			else if (e.key === "F2") { toggleVis("cluster"); e.preventDefault(); }
			else if (e.key === "F4") { toggleVis("screen"); e.preventDefault(); }
			else if (e.key === "F8") { debugScan(); e.preventDefault(); }
		}, true);
	}

	/* ---------------- debug ---------------- */
	function debugScan() {
		var out = { version: VER, endpoint: ENDPOINT || null, telemetry: { speed: telem.speed, source: telem.source }, junkHidden: junkHits, globals: [], links: [] };
		var keys = [];
		try { keys = Object.keys(window); } catch (e) {}
		for (var i = 0; i < keys.length; i++) {
			var k = keys[i];
			if (/^(SR|sr-|on|webkit|moz)/.test(k)) continue;
			var v;
			try { v = window[k]; } catch (e) { continue; }
			if (!v || typeof v !== "object") continue;
			var inner;
			try { inner = Object.keys(v).slice(0, 80); } catch (e) { continue; }
			var hit = inner.filter(function (p) { return /speed|velocity|kph|odo|throttle|gear|vehicle|camera|scene|seed/i.test(p); });
			if (hit.length) out.globals.push({ key: k, matched: hit.slice(0, 12) });
		}
		var as = document.querySelectorAll("a[href]");
		for (var j = 0; j < as.length; j++) out.links.push(as[j].getAttribute("href"));
		if (window.console) console.log("[sr-mod] scan", out);
		toast("Debug info printed to console (F12)");
		return out;
	}

	/* ---------------- public api ---------------- */
	window.SRMOD = {
		version: VER,
		cfg: CFG,
		state: state,
		telemetry: telem,
		signals: sig,
		setTelemetry: function (kph) { telem.override = typeof kph === "number" ? kph : undefined; },
		setEndpoint: function (url) {
			try { LS.setItem("sr-mod:endpoint", String(url || "")); } catch (e) {}
			location.reload();
		},
		save: {
			now: function () { return remotePut(); },
			pull: remoteGet,
			export: exportSave,
			wipe: function () { try { LS.removeItem(K_STATE); } catch (e) {} toast("Mod save wiped"); }
		},
		toggleCluster: function () { toggleVis("cluster"); },
		toggleScreen: function () { toggleVis("screen"); },
		killJunk: killJunk,
		scan: debugScan
	};

	/* ---------------- init ---------------- */
	function init() {
		buildHud();
		watchJunk();
		bindKeys();
		startLoop();
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
		log("ready", VER, "endpoint:", ENDPOINT || "(local only)");
	}

	bootSync();
	onReady(init);
})();
