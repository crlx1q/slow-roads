/* slow-roads mod layer v0.3.0
 * The cluster and the infotainment display are rendered INSIDE the game's 3d
 * scene (canvas -> texture -> plane welded to the car body), not as a flat DOM
 * overlay. Docs: docs/MODS.md, changelog: docs/CHANGELOG.md
 */
(function () {
	"use strict";

	/* -------------------------------------------- 0. three.js devtools bridge
	 * three.js dispatches an "observe" event on window.__THREE_DEVTOOLS__ for
	 * every Scene and WebGLRenderer it creates. This file is loaded in <head>,
	 * before the game bundle, so the hook is always installed first.
	 */
	var SCENES = [];
	var RENDERERS = [];
	try {
		var prevHook = window.__THREE_DEVTOOLS__;
		var hook = prevHook && prevHook.addEventListener ? prevHook : new EventTarget();
		hook.addEventListener("observe", function (e) {
			var d = e && e.detail;
			if (!d) return;
			if (d.isScene) { if (SCENES.indexOf(d) < 0) SCENES.push(d); }
			else if (d.render && d.domElement && d.setSize) { if (RENDERERS.indexOf(d) < 0) RENDERERS.push(d); }
		});
		window.__THREE_DEVTOOLS__ = hook;
	} catch (e) {}

	/* --------------------------------------------------- 1. config and state */

	var VER = "0.3.0";
	var DEF = { sound: true, cluster: true, screen: true, mode: "3d", debug: false, saveEndpoint: "" };
	var CFG = Object.assign({}, DEF, window.SR_MOD_CONFIG || {});
	var LS = window.localStorage;
	var K_STATE = "sr-mod:state";
	var K_RELOADED = "sr-mod:reloaded";
	var K_EP = "sr-mod:endpoint";
	var ENDPOINT = String(CFG.saveEndpoint || LS.getItem(K_EP) || "").replace(/\/+$/, "");
	var MI2KM = 1.609344;
	var FONT = '"ShareTech","Share Tech Mono","Jura",ui-monospace,monospace';
	var DEF_LAYOUT = {
		cluster: { x: 50, y: 72, w: 30, rx: 6, ry: 0 },
		screen: { x: 77, y: 80, w: 20, rx: 8, ry: -18 }
	};

	function clone(o) { return JSON.parse(JSON.stringify(o)); }

	var state = {
		v: 3,
		updatedAt: 0,
		odoBase: 0,
		odoKm: 0,
		tripKm: 0,
		driveSec: 0,
		calib: 3.6,
		mode: CFG.mode === "dom" ? "dom" : "3d",
		ui: { cluster: CFG.cluster !== false, screen: CFG.screen !== false },
		place: { cluster: null, screen: null },
		layout: clone(DEF_LAYOUT),
		game: {}
	};

	var telem = { kph: 0, has: false, src: "none", auto: false, accel: 0, override: null };
	var sig = { left: false, right: false, phase: false };
	var edit = { on: false, sel: "cluster", drag: null };
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
	function toast(msg) {
		var box = byId("sr-toasts");
		if (!box) { log(msg); return; }
		var t = elm("div", "sr-toast", String(msg));
		box.appendChild(t);
		setTimeout(function () { t.classList.add("sr-toast-out"); }, 2600);
		setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 3100);
	}

	/* ---------------------------------------------------------- 2. junk clean */

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

	/* --------------------------------------------------------------- 3. saves */

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
		["odoBase", "odoKm", "tripKm", "driveSec", "updatedAt", "calib"].forEach(function (k) {
			if (typeof s[k] === "number" && isFinite(s[k])) state[k] = s[k];
		});
		if (s.mode === "dom" || s.mode === "3d") state.mode = s.mode;
		if (s.ui) {
			state.ui.cluster = s.ui.cluster !== false;
			state.ui.screen = s.ui.screen !== false;
		}
		if (s.place) {
			["cluster", "screen"].forEach(function (k) {
				var p = s.place[k];
				if (p && p.pos && p.quat && typeof p.scale === "number") state.place[k] = p;
			});
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

	/* ----------------------------------------------------------- 4. telemetry */

	var dom = { speedNode: null, speedUnit: "kph", distNode: null, distUnit: "mi", lastDist: null, scanAt: 0, autoAt: 0 };
	var motion = { p0: null, p1: null, ups: 0 };

	function numericNodes(root, limit) {
		var out = [];
		if (!root) return out;
		var w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
		var n;
		while ((n = w.nextNode())) {
			var t = (n.nodeValue || "").trim();
			if (/^\d{1,5}(\.\d+)?$/.test(t)) {
				out.push(n);
				if (out.length >= limit) break;
			}
		}
		return out;
	}

	function findUnitEl(rx) {
		var all = document.querySelectorAll("div, span, p, b, i, em, label");
		for (var i = 0; i < all.length; i++) {
			var el = all[i];
			if (el.children.length) continue;
			if (el.closest && el.closest("#sr-hud")) continue;
			var t = (el.textContent || "").trim().toLowerCase();
			if (t.length > 0 && t.length < 14 && rx.test(t)) return el;
		}
		return null;
	}

	/* the game puts the number and its unit in neighbouring nodes, so anchor on
	 * the unit label and take the closest number around it */
	function nodeNearUnit(unitEl, wantDecimal) {
		var p = unitEl;
		for (var lvl = 0; lvl < 3 && p; lvl++) {
			p = p.parentElement;
			if (!p) break;
			var list = numericNodes(p, 8);
			var pick = null;
			for (var i = 0; i < list.length; i++) {
				var t = list[i].nodeValue.trim();
				if (wantDecimal && t.indexOf(".") >= 0) { pick = list[i]; break; }
				if (!pick) pick = list[i];
			}
			if (pick) return pick;
		}
		return null;
	}

	function scanDom() {
		var su = findUnitEl(/^(mph|kph|km\/h|kmh)$/);
		if (su) {
			dom.speedUnit = /mph/.test((su.textContent || "").toLowerCase()) ? "mph" : "kph";
			dom.speedNode = nodeNearUnit(su, true);
		}
		var du = findUnitEl(/^(miles?|mi|km|kilometers?|kilometres?)$/);
		if (du) {
			var u = (du.textContent || "").trim().toLowerCase();
			dom.distUnit = u.charAt(0) === "m" ? "mi" : "km";
			dom.distNode = nodeNearUnit(du, false);
		}
		log("dom bind", dom.speedUnit, !!dom.speedNode, dom.distUnit, !!dom.distNode);
	}

	function nodeNumber(n) {
		if (!n || !n.parentElement) return null;
		var v = parseFloat(n.nodeValue);
		return isFinite(v) ? v : null;
	}

	function domSpeedKph() {
		var v = nodeNumber(dom.speedNode);
		return v == null ? null : (dom.speedUnit === "mph" ? v * MI2KM : v);
	}

	function domDistKm() {
		var v = nodeNumber(dom.distNode);
		return v == null ? null : (dom.distUnit === "mi" ? v * MI2KM : v);
	}

	function scanAuto() {
		if (!document.body) return;
		var m = /autodrive\s*(on|off)/i.exec(document.body.innerText || "");
		if (m) telem.auto = m[1].toLowerCase() === "on";
	}

	/* the interior camera rides with the car, so the motion of its world
	 * position is a clean speed signal. state.calib turns world units/s into
	 * km/h and is auto-tuned against the game hud whenever it can be read. */
	function worldSpeed(dt) {
		var T = three.T, ref = three.camera;
		if (!T || !T.Vector3 || !ref || dt <= 0) return null;
		if (!motion.p0) {
			motion.p0 = new T.Vector3();
			motion.p1 = new T.Vector3();
			ref.getWorldPosition(motion.p0);
			return null;
		}
		ref.getWorldPosition(motion.p1);
		var d = motion.p1.distanceTo(motion.p0);
		motion.p0.copy(motion.p1);
		if (!isFinite(d) || d > 1e4) return null;
		motion.ups = motion.ups * 0.82 + (d / dt) * 0.18;
		return motion.ups;
	}

	function readTelemetry(dt, now) {
		if (now - dom.scanAt > 2000 && (!dom.speedNode || !dom.distNode)) { dom.scanAt = now; scanDom(); }
		if (now - dom.autoAt > 1200) { dom.autoAt = now; scanAuto(); }

		var dk = domSpeedKph();
		var ups = worldSpeed(dt);
		var kph = null;

		if (telem.override != null) { kph = telem.override; telem.src = "manual"; }
		else if (ups != null && state.calib > 0) { kph = ups * state.calib; telem.src = "world"; }
		else if (dk != null) { kph = dk; telem.src = "hud"; }

		if (dk != null && dk > 8 && ups != null && ups > 0.2) {
			var c = dk / ups;
			if (isFinite(c) && c > 0.05 && c < 500) state.calib = state.calib > 0 ? state.calib * 0.92 + c * 0.08 : c;
		}

		var prev = telem.kph;
		telem.has = kph != null;
		telem.kph = kph == null ? 0 : clamp(kph, 0, 400);
		if (dt > 0) telem.accel = telem.accel * 0.85 + ((telem.kph - prev) / dt) * 0.15;

		var dist = domDistKm();
		if (dist != null) {
			if (dom.lastDist != null && dist < dom.lastDist - 0.3) state.odoBase += dom.lastDist;
			dom.lastDist = dist;
			state.tripKm = dist;
			state.odoKm = state.odoBase + dist;
		} else if (telem.kph > 0.5 && dt > 0) {
			var km = telem.kph * dt / 3600;
			state.tripKm += km;
			state.odoKm += km;
		}
		if (telem.kph > 0.5 && dt > 0) state.driveSec += dt;
	}

	/* ------------------------------------------------------------ 5. painters */

	function odoParts(km) {
		var s = pad(Math.max(0, Math.floor(km)), 5).slice(-6);
		var i = 0;
		while (i < s.length - 1 && s.charAt(i) === "0") i++;
		return { dim: s.slice(0, i), lit: s.slice(i) };
	}
	function hhmm(d) { return pad(d.getHours(), 2) + ":" + pad(d.getMinutes(), 2); }
	function dmy(d) { return pad(d.getDate(), 2) + "." + pad(d.getMonth() + 1, 2) + "." + d.getFullYear(); }
	function dur(sec) {
		sec = Math.max(0, Math.floor(sec));
		var h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60);
		return h ? h + "h " + m + "m" : m + "m";
	}

	function rr(c, x, y, w, h, r) {
		c.beginPath();
		c.moveTo(x + r, y);
		c.arcTo(x + w, y, x + w, y + h, r);
		c.arcTo(x + w, y + h, x, y + h, r);
		c.arcTo(x, y + h, x, y, r);
		c.arcTo(x, y, x + w, y, r);
		c.closePath();
	}

	function setFont(c, size, weight) { c.font = (weight || 400) + " " + size + "px " + FONT; }

	function spaced(c, text, x, y, sp, align) {
		text = String(text);
		var widths = [], total = 0, i;
		for (i = 0; i < text.length; i++) {
			var w = c.measureText(text.charAt(i)).width;
			widths.push(w);
			total += w + sp;
		}
		total -= sp;
		var cx = align === "center" ? x - total / 2 : (align === "right" ? x - total : x);
		var old = c.textAlign;
		c.textAlign = "left";
		for (i = 0; i < text.length; i++) { c.fillText(text.charAt(i), cx, y); cx += widths[i] + sp; }
		c.textAlign = old;
	}

	function gauge(c, cx, cy, r, w, stroke, from, to) {
		c.beginPath();
		c.arc(cx, cy, r, from, to);
		c.lineWidth = w;
		c.lineCap = "round";
		c.strokeStyle = stroke;
		c.stroke();
	}

	function tri(c, x, y, s, dir, fill) {
		c.beginPath();
		if (dir < 0) { c.moveTo(x + s, y - s); c.lineTo(x + s, y + s); c.lineTo(x - s, y); }
		else { c.moveTo(x - s, y - s); c.lineTo(x - s, y + s); c.lineTo(x + s, y); }
		c.closePath();
		c.fillStyle = fill;
		c.fill();
	}

	var A0 = Math.PI * 0.75, A1 = Math.PI * 2.25;

	/* 1024 x 320 -- copy of the stock slow roads cluster */
	function drawCluster(c, W, H) {
		c.clearRect(0, 0, W, H);
		rr(c, 6, 6, W - 12, H - 12, 30);
		c.fillStyle = "rgba(4,7,10,0.62)";
		c.fill();
		c.lineWidth = 2;
		c.strokeStyle = "rgba(255,255,255,0.10)";
		c.stroke();

		var f = telem.has ? clamp(telem.kph / 160, 0, 1) : 0;
		var pw = telem.has ? clamp(0.06 + telem.accel / 20 + f * 0.4, 0, 1) : 0;
		var cy = 164, r = 110;

		gauge(c, 196, cy, r, 16, "rgba(255,255,255,0.11)", A0, A1);
		if (f > 0.002) gauge(c, 196, cy, r, 16, "#45c8f0", A0, A0 + (A1 - A0) * f);
		c.textAlign = "center";
		c.textBaseline = "middle";
		setFont(c, 104, 500);
		c.fillStyle = "#eaf7fc";
		c.fillText(telem.has ? String(Math.round(telem.kph)) : "--", 196, cy - 8);
		setFont(c, 26, 400);
		c.fillStyle = "rgba(234,247,252,0.55)";
		spaced(c, "KPH", 196, cy + 66, 7, "center");

		gauge(c, 828, cy, r, 16, "rgba(255,255,255,0.11)", A0, A1);
		if (pw > 0.002) {
			var g = c.createLinearGradient(828 - r, cy + r, 828 + r, cy - r);
			g.addColorStop(0, "#49d96b");
			g.addColorStop(1, "#e6dc4b");
			gauge(c, 828, cy, r, 16, g, A0, A0 + (A1 - A0) * pw);
		}
		setFont(c, 64, 400);
		c.fillStyle = "rgba(255,196,86,0.95)";
		c.fillText("\u26a1", 828, cy);

		var mx = W / 2;
		var gr = c.createLinearGradient(mx, 34, mx, 92);
		gr.addColorStop(0, "rgba(255,255,255,0.85)");
		gr.addColorStop(1, "rgba(255,255,255,0.10)");
		c.fillStyle = gr;
		c.fillRect(mx - 2, 34, 4, 58);

		var o = odoParts(state.odoKm);
		setFont(c, 58, 500);
		var wd = c.measureText(o.dim).width, wl = c.measureText(o.lit).width;
		setFont(c, 26, 400);
		var wk = c.measureText("KM").width + 12;
		var ox = mx - (wd + wl + wk) / 2;
		c.textAlign = "left";
		setFont(c, 58, 500);
		c.fillStyle = "rgba(234,247,252,0.18)";
		c.fillText(o.dim, ox, 142);
		c.fillStyle = "#eaf7fc";
		c.fillText(o.lit, ox + wd, 142);
		setFont(c, 26, 400);
		c.fillStyle = "rgba(234,247,252,0.45)";
		c.fillText("KM", ox + wd + wl + 12, 152);

		setFont(c, 24, 400);
		c.fillStyle = telem.auto ? "#8fe8a8" : "rgba(234,247,252,0.20)";
		spaced(c, "\u25cf CRUISE", mx, 196, 5, "center");

		setFont(c, 30, 400);
		c.fillStyle = "rgba(234,247,252,0.58)";
		spaced(c, hhmm(new Date()), mx, 244, 4, "center");

		setFont(c, 22, 400);
		c.fillStyle = "rgba(234,247,252,0.42)";
		spaced(c, "RWD \u25d1", W - 44, 286, 5, "right");
		setFont(c, 20, 400);
		c.fillStyle = "rgba(234,247,252,0.28)";
		c.textAlign = "left";
		c.fillText(telem.src, 44, 286);

		var onL = sig.left && sig.phase, onR = sig.right && sig.phase;
		tri(c, 66, cy, 26, -1, onL ? "#2fdd6e" : "rgba(47,221,110,0.10)");
		tri(c, W - 66, cy, 26, 1, onR ? "#2fdd6e" : "rgba(47,221,110,0.10)");
	}

	/* 1024 x 640 -- centre console display, li/carplay style */
	function drawScreen(c, W, H) {
		c.clearRect(0, 0, W, H);
		rr(c, 4, 4, W - 8, H - 8, 34);
		c.fillStyle = "rgba(2,4,7,0.88)";
		c.fill();
		c.lineWidth = 2;
		c.strokeStyle = "rgba(255,255,255,0.13)";
		c.stroke();

		var d = new Date();
		c.textBaseline = "middle";
		c.textAlign = "left";
		setFont(c, 36, 500);
		c.fillStyle = "rgba(232,244,250,0.85)";
		c.fillText(hhmm(d), 44, 60);
		c.textAlign = "center";
		setFont(c, 28, 400);
		c.fillStyle = "rgba(232,244,250,0.45)";
		c.fillText(dmy(d), W / 2, 60);
		c.textAlign = "right";
		setFont(c, 24, 400);
		c.fillText("LTE \u2586", W - 44, 60);

		var cy = 104, ch = 400, cw = 298, gap = 20, x0 = 36, i;
		for (i = 0; i < 3; i++) {
			rr(c, x0 + i * (cw + gap), cy, cw, ch, 24);
			c.fillStyle = "rgba(255,255,255,0.05)";
			c.fill();
			c.lineWidth = 1.5;
			c.strokeStyle = "rgba(255,255,255,0.07)";
			c.stroke();
		}

		/* navigation */
		var nx = x0;
		rr(c, nx + 18, cy + 18, cw - 36, 224, 18);
		c.fillStyle = "#0c1a22";
		c.fill();
		c.save();
		rr(c, nx + 18, cy + 18, cw - 36, 224, 18);
		c.clip();
		c.strokeStyle = "rgba(69,200,240,0.35)";
		c.lineWidth = 5;
		c.beginPath();
		c.moveTo(nx + 10, cy + 232);
		c.bezierCurveTo(nx + 120, cy + 190, nx + 150, cy + 120, nx + cw - 6, cy + 34);
		c.stroke();
		c.strokeStyle = "rgba(255,255,255,0.07)";
		c.lineWidth = 2;
		for (i = 1; i < 4; i++) {
			c.beginPath();
			c.moveTo(nx + 18, cy + 18 + i * 56);
			c.lineTo(nx + cw - 18, cy + 18 + i * 56);
			c.stroke();
		}
		c.restore();
		c.fillStyle = "#45c8f0";
		c.beginPath();
		c.arc(nx + 96, cy + 200, 9, 0, Math.PI * 2);
		c.fill();
		c.strokeStyle = "rgba(69,200,240,0.35)";
		c.lineWidth = 3;
		c.beginPath();
		c.arc(nx + 96, cy + 200, 18, 0, Math.PI * 2);
		c.stroke();
		c.textAlign = "left";
		setFont(c, 30, 500);
		c.fillStyle = "rgba(232,244,250,0.8)";
		c.fillText("NAVI", nx + 24, cy + 292);
		setFont(c, 24, 400);
		c.fillStyle = "rgba(232,244,250,0.4)";
		c.fillText("endless road", nx + 24, cy + 332);
		c.fillText("no destination", nx + 24, cy + 368);

		/* drive */
		var dx = x0 + cw + gap, mid = dx + cw / 2;
		var bx = mid - 48, by = cy + 26;
		rr(c, bx, by, 96, 164, 28);
		c.fillStyle = "rgba(255,255,255,0.06)";
		c.fill();
		c.lineWidth = 2;
		c.strokeStyle = "rgba(255,255,255,0.18)";
		c.stroke();
		var lamps = [
			[bx + 16, by + 16, sig.left], [bx + 80, by + 16, sig.right],
			[bx - 4, by + 82, sig.left], [bx + 100, by + 82, sig.right],
			[bx + 16, by + 148, sig.left], [bx + 80, by + 148, sig.right]
		];
		for (i = 0; i < lamps.length; i++) {
			var on = lamps[i][2] && sig.phase;
			c.beginPath();
			c.arc(lamps[i][0], lamps[i][1], 7, 0, Math.PI * 2);
			c.fillStyle = on ? "#ffb02a" : "rgba(255,176,42,0.14)";
			c.fill();
		}
		c.textAlign = "center";
		setFont(c, 96, 500);
		c.fillStyle = "#eaf7fc";
		c.fillText(telem.has ? String(Math.round(telem.kph)) : "--", mid, cy + 272);
		setFont(c, 26, 400);
		c.fillStyle = "rgba(232,244,250,0.45)";
		spaced(c, "KM/H", mid, cy + 324, 6, "center");
		var gw = 64;
		rr(c, mid - gw / 2, cy + 344, gw, 42, 12);
		c.fillStyle = telem.auto ? "rgba(143,232,168,0.18)" : "rgba(255,255,255,0.07)";
		c.fill();
		setFont(c, 28, 500);
		c.fillStyle = telem.auto ? "#8fe8a8" : "rgba(232,244,250,0.75)";
		c.fillText(telem.auto ? "A" : "D", mid, cy + 366);

		/* media and climate */
		var sx = x0 + 2 * (cw + gap);
		c.textAlign = "left";
		setFont(c, 30, 500);
		c.fillStyle = "rgba(232,244,250,0.8)";
		c.fillText("no media", sx + 24, cy + 56);
		setFont(c, 24, 400);
		c.fillStyle = "rgba(232,244,250,0.4)";
		c.fillText("slow roads fm", sx + 24, cy + 96);
		rr(c, sx + 24, cy + 124, cw - 48, 6, 3);
		c.fillStyle = "rgba(255,255,255,0.10)";
		c.fill();
		rr(c, sx + 24, cy + 124, (cw - 48) * 0.22, 6, 3);
		c.fillStyle = "rgba(69,200,240,0.55)";
		c.fill();
		c.textAlign = "center";
		setFont(c, 38, 400);
		c.fillStyle = "rgba(232,244,250,0.6)";
		c.fillText("\u23ee   \u23f5   \u23ed", sx + cw / 2, cy + 186);
		c.textAlign = "left";
		setFont(c, 26, 400);
		c.fillStyle = "rgba(232,244,250,0.5)";
		c.fillText("A/C  auto", sx + 24, cy + 262);
		c.fillText("21.5\u00b0", sx + 24, cy + 302);
		c.fillText("fan  \u2589\u2589\u2589\u2591\u2591", sx + 24, cy + 342);
		setFont(c, 22, 400);
		c.fillStyle = "rgba(232,244,250,0.32)";
		c.fillText(ENDPOINT ? "cloud save" : "local save", sx + 24, cy + 378);

		/* dock and trip stats */
		c.textAlign = "left";
		setFont(c, 30, 400);
		c.fillStyle = "rgba(232,244,250,0.35)";
		c.fillText("\u2302   \u266a   \u260e   \u2699", 44, 574);
		c.textAlign = "right";
		setFont(c, 26, 400);
		c.fillStyle = "rgba(232,244,250,0.55)";
		c.fillText("TRIP " + state.tripKm.toFixed(1) + " km   \u00b7   ODO " + Math.floor(state.odoKm) + " km   \u00b7   " + dur(state.driveSec), W - 44, 574);
	}

	/* ----------------------------------------------------------- 6. 3d bridge */

	var PANELS = { cluster: null, screen: null };
	var three = { T: null, scene: null, camera: null, renderer: null, ready: false, tries: 0, probeAt: 0 };

	/* the real THREE namespace, straight out of the webpack module cache */
	function harvestTHREE() {
		try {
			var key = Object.keys(window).filter(function (k) { return /^webpackJsonp/.test(k); })[0];
			var arr = key ? window[key] : null;
			if (!arr || typeof arr.push !== "function") return null;
			var req = null;
			arr.push([["sr-mod-chunk"], { "sr-mod-probe": function (m, e, r) { req = r; } }, [["sr-mod-probe"]]]);
			var cache = req && req.c;
			for (var id in cache) {
				var ex = cache[id] && cache[id].exports;
				if (ex && ex.REVISION && ex.Mesh && ex.Vector3 && ex.Raycaster) return ex;
			}
		} catch (e) { log("webpack probe failed", e); }
		return null;
	}

	/* fallback: rebuild the few classes we need from live scene objects */
	function harvestFromScene(sc) {
		var mesh = null, texCtor = null;
		try {
			sc.traverse(function (o) {
				if (!o.isMesh || !o.geometry || !o.material) return;
				var m = Array.isArray(o.material) ? o.material[0] : o.material;
				if (!mesh && o.geometry.attributes && o.geometry.attributes.position) mesh = o;
				if (!texCtor && m && m.map) texCtor = m.map.constructor;
			});
		} catch (e) {}
		if (!mesh || !texCtor) return null;
		var mat = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
		return {
			__harvested: true,
			Mesh: mesh.constructor,
			Vector3: mesh.position.constructor,
			Quaternion: mesh.quaternion.constructor,
			BufferGeometry: mesh.geometry.constructor,
			BufferAttribute: mesh.geometry.attributes.position.constructor,
			Texture: texCtor,
			Material: mat.constructor,
			DoubleSide: 2
		};
	}

	function planeGeo(T, w, h) {
		if (!T.__harvested) {
			var G = T.PlaneGeometry || T.PlaneBufferGeometry;
			return new G(w, h);
		}
		var g = new T.BufferGeometry();
		var x = w / 2, y = h / 2;
		g.setAttribute("position", new T.BufferAttribute(new Float32Array([
			-x, -y, 0, x, -y, 0, x, y, 0, -x, -y, 0, x, y, 0, -x, y, 0
		]), 3));
		g.setAttribute("uv", new T.BufferAttribute(new Float32Array([
			0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1
		]), 2));
		if (g.computeVertexNormals) g.computeVertexNormals();
		return g;
	}

	function make3d(which) {
		var T = three.T, p = PANELS[which];
		if (!T || !p || p.mesh) return !!(p && p.mesh);
		var tex;
		if (T.CanvasTexture) tex = new T.CanvasTexture(p.canvas);
		else { tex = new T.Texture(p.canvas); tex.needsUpdate = true; }
		if (T.SRGBColorSpace && "colorSpace" in tex) tex.colorSpace = T.SRGBColorSpace;
		else if (T.sRGBEncoding !== undefined && "encoding" in tex) tex.encoding = T.sRGBEncoding;
		tex.anisotropy = 4;
		var params = { map: tex, transparent: true, depthTest: false, depthWrite: false, toneMapped: false, side: T.DoubleSide };
		var mat;
		if (T.MeshBasicMaterial) mat = new T.MeshBasicMaterial(params);
		else {
			mat = new T.Material(params);
			if (mat.emissive) {
				mat.emissiveMap = tex;
				mat.emissive.setRGB(1, 1, 1);
				if (mat.color) mat.color.setRGB(0, 0, 0);
			}
		}
		var mesh = new T.Mesh(planeGeo(T, 1, p.canvas.height / p.canvas.width), mat);
		mesh.frustumCulled = false;
		mesh.renderOrder = 990 + (which === "screen" ? 1 : 0);
		mesh.name = "sr-" + which;
		mesh.__srPanel = which;
		p.tex = tex;
		p.mesh = mesh;
		return true;
	}

	function pathOf(obj, root) {
		var p = [], o = obj;
		while (o && o !== root) {
			var par = o.parent;
			if (!par) return null;
			p.unshift(par.children.indexOf(o));
			o = par;
		}
		return o === root ? p : null;
	}

	function atPath(root, path) {
		var o = root;
		for (var i = 0; i < path.length; i++) {
			if (!o || !o.children) return null;
			o = o.children[path[i]];
		}
		return o || null;
	}

	function savePlace(which) {
		var p = PANELS[which];
		if (!p || !p.mesh || !p.mesh.parent || !three.scene) return;
		var path = pathOf(p.mesh.parent, three.scene);
		if (!path) return;
		state.place[which] = {
			path: path,
			name: p.mesh.parent.name || "",
			pos: p.mesh.position.toArray(),
			quat: p.mesh.quaternion.toArray(),
			scale: p.mesh.scale.x
		};
		saveLocal();
	}

	function applyPlace(which) {
		var p = PANELS[which], sp = state.place[which];
		if (!p || !p.mesh || !sp || !sp.path) return false;
		var anchor = atPath(three.scene, sp.path);
		if (!anchor) return false;
		if (sp.name && anchor.name && anchor.name !== sp.name) return false;
		anchor.add(p.mesh);
		p.mesh.position.fromArray(sp.pos);
		p.mesh.quaternion.fromArray(sp.quat);
		p.mesh.scale.setScalar(sp.scale);
		log("place restored", which, sp.name);
		return true;
	}

	/* shoot a ray from the driver's eyes at the dash and weld the panel onto
	 * whatever surface it lands on -- that is what keeps it on the car */
	function autoPlace(which) {
		var T = three.T, cam = three.camera, sc = three.scene, p = PANELS[which];
		if (!T || !T.Raycaster || !cam || !sc || !p || !p.mesh) return false;
		var spec = which === "cluster" ? { down: 19, side: 0, fill: 0.30 } : { down: 15, side: 24, fill: 0.17 };
		var q = new T.Quaternion(); cam.getWorldQuaternion(q);
		var eye = new T.Vector3(); cam.getWorldPosition(eye);
		var fwd = new T.Vector3(0, 0, -1).applyQuaternion(q);
		var right = new T.Vector3(1, 0, 0).applyQuaternion(q);
		var up = new T.Vector3(0, 1, 0).applyQuaternion(q);
		var dir = fwd.clone()
			.add(up.clone().multiplyScalar(-Math.tan(spec.down * Math.PI / 180)))
			.add(right.clone().multiplyScalar(Math.tan(spec.side * Math.PI / 180)))
			.normalize();
		var hits = [];
		try { hits = new T.Raycaster(eye, dir).intersectObjects(sc.children, true) || []; } catch (e) { hits = []; }
		var hit = null;
		for (var i = 0; i < hits.length; i++) {
			var o = hits[i].object;
			if (!o || o.__srPanel || o.visible === false) continue;
			if (/glass|window|shield|mirror/i.test(o.name || "")) continue;
			hit = hits[i];
			break;
		}
		var dist = hit ? hit.distance : 1;
		if (!isFinite(dist) || dist <= 0) dist = 1;
		var anchor = hit ? hit.object : (cam.parent || sc);
		var point = hit ? hit.point.clone() : eye.clone().add(dir.clone().multiplyScalar(dist));
		point.add(eye.clone().sub(point).normalize().multiplyScalar(dist * 0.012));
		anchor.updateWorldMatrix(true, false);
		anchor.add(p.mesh);
		p.mesh.position.copy(anchor.worldToLocal(point.clone()));
		var fov = (cam.fov || 55) * Math.PI / 180;
		var aspect = cam.aspect || (window.innerWidth / Math.max(1, window.innerHeight));
		var visW = 2 * dist * Math.tan(fov / 2) * aspect;
		var as = new T.Vector3(); anchor.getWorldScale(as);
		var k = (Math.abs(as.x) + Math.abs(as.y) + Math.abs(as.z)) / 3 || 1;
		p.mesh.scale.setScalar((visW * spec.fill) / k);
		p.mesh.lookAt(eye);
		savePlace(which);
		log("welded", which, "to", anchor.name || anchor.type, "dist", dist.toFixed(3));
		return true;
	}

	function nudge(which, dx, dy, dz, dScale, dPitch, dYaw) {
		var p = PANELS[which], T = three.T;
		if (!p || !p.mesh || !p.mesh.parent || !T) return;
		var step = p.mesh.scale.x * 0.035;
		if (dx || dy || dz) {
			var v = new T.Vector3(dx * step, dy * step, dz * step).applyQuaternion(p.mesh.quaternion);
			p.mesh.position.add(v);
		}
		if (dScale) p.mesh.scale.multiplyScalar(dScale > 0 ? 1.06 : 1 / 1.06);
		if (dPitch || dYaw) {
			var a = 3 * Math.PI / 180, q = new T.Quaternion();
			if (dYaw) { q.setFromAxisAngle(new T.Vector3(0, 1, 0), dYaw * a); p.mesh.quaternion.multiply(q); }
			if (dPitch) { q.setFromAxisAngle(new T.Vector3(1, 0, 0), dPitch * a); p.mesh.quaternion.multiply(q); }
		}
		savePlace(which);
	}

	function pickScene() {
		var best = null, bestN = -1;
		for (var i = 0; i < SCENES.length; i++) {
			var n = 0;
			try { SCENES[i].traverse(function () { n++; }); } catch (e) { n = 0; }
			if (n > bestN) { bestN = n; best = SCENES[i]; }
		}
		return bestN > 3 ? best : null;
	}

	function patchRenderers() {
		for (var i = 0; i < RENDERERS.length; i++) {
			var r = RENDERERS[i];
			if (r.__srPatched) continue;
			r.__srPatched = true;
			three.renderer = r;
			var orig = r.render;
			r.render = function (sc, cam) {
				if (cam && (cam.isPerspectiveCamera || cam.fov) && sc && sc.children && sc.children.length > 2) {
					three.scene = sc;
					three.camera = cam;
				}
				return orig.apply(this, arguments);
			};
		}
	}

	function findCamera(sc) {
		var cam = null;
		try { sc.traverse(function (o) { if (!cam && o.isPerspectiveCamera) cam = o; }); } catch (e) {}
		return cam;
	}

	function setup3d(now) {
		if (three.ready || state.mode !== "3d") return;
		if (now - three.probeAt < 400) return;
		three.probeAt = now;
		patchRenderers();
		if (!three.scene) three.scene = pickScene();
		if (!three.scene) return;
		if (!three.camera) three.camera = findCamera(three.scene);
		if (!three.camera) return;
		if (!three.T) three.T = harvestTHREE() || harvestFromScene(three.scene);
		if (!three.T) return;
		try {
			if (!make3d("cluster") || !make3d("screen")) return;
		} catch (e) {
			log("mesh build failed", e);
			three.tries += 10;
			if (three.tries > 40) setMode("dom");
			return;
		}
		var ok = 0;
		if (applyPlace("cluster") || autoPlace("cluster")) ok++;
		if (applyPlace("screen") || autoPlace("screen")) ok++;
		if (!ok) {
			three.tries++;
			if (three.tries > 40) { setMode("dom"); toast("3d scene unreachable \u00b7 overlay mode"); }
			return;
		}
		three.ready = true;
		applyVis();
		toast("cluster mounted in the cabin \u00b7 F3 to adjust");
	}

	/* ------------------------------------------------------- 7. hud surface */

	function buildHud() {
		hud = elm("div");
		hud.id = "sr-hud";
		hud.innerHTML =
			'<div id="sr-cluster" class="sr-panel" data-sr-panel="cluster"></div>' +
			'<div id="sr-screen" class="sr-panel" data-sr-panel="screen"></div>' +
			'<div id="sr-toasts"></div>';
		document.body.appendChild(hud);
		["cluster", "screen"].forEach(function (k) {
			var cv = document.createElement("canvas");
			cv.width = 1024;
			cv.height = k === "cluster" ? 320 : 640;
			cv.className = "sr-canvas";
			byId("sr-" + k).appendChild(cv);
			PANELS[k] = { canvas: cv, ctx: cv.getContext("2d"), tex: null, mesh: null, at: 0 };
		});
		applyLayout();
		applyVis();
	}

	function applyLayout() {
		if (!hud) return;
		["cluster", "screen"].forEach(function (k) {
			var el = byId("sr-" + k), L = state.layout[k];
			if (!el || !L) return;
			el.style.left = L.x + "%";
			el.style.top = L.y + "%";
			el.style.width = L.w + "vw";
			el.style.transform = "translate(-50%,-50%) perspective(1200px) rotateX(" + L.rx + "deg) rotateY(" + L.ry + "deg)";
		});
	}

	function applyVis() {
		if (hud) {
			hud.classList.toggle("sr-3d", state.mode === "3d" && three.ready);
			["cluster", "screen"].forEach(function (k) {
				var el = byId("sr-" + k);
				if (el) el.classList.toggle("sr-off", !state.ui[k]);
			});
		}
		["cluster", "screen"].forEach(function (k) {
			var p = PANELS[k];
			if (p && p.mesh) p.mesh.visible = !!state.ui[k];
		});
	}

	function setMode(m) {
		state.mode = m === "dom" ? "dom" : "3d";
		if (state.mode === "dom") {
			["cluster", "screen"].forEach(function (k) {
				var p = PANELS[k];
				if (p && p.mesh && p.mesh.parent) p.mesh.parent.remove(p.mesh);
			});
			three.ready = false;
		} else {
			three.tries = 0;
		}
		applyLayout();
		applyVis();
		saveLocal();
		toast(state.mode === "3d" ? "in-car mode" : "overlay mode");
	}

	function paint(now) {
		["cluster", "screen"].forEach(function (k) {
			var p = PANELS[k];
			if (!p || !state.ui[k]) return;
			var iv = k === "cluster" ? 45 : 110;
			if (now - p.at < iv) return;
			p.at = now;
			if (k === "cluster") drawCluster(p.ctx, p.canvas.width, p.canvas.height);
			else drawScreen(p.ctx, p.canvas.width, p.canvas.height);
			if (p.tex) p.tex.needsUpdate = true;
		});
	}

	var lastT = 0, saveAt = 0, remoteAt = 0;
	function loop(ts) {
		requestAnimationFrame(loop);
		var now = ts || performance.now();
		var dt = lastT ? Math.min(0.25, (now - lastT) / 1000) : 0;
		lastT = now;
		setup3d(now);
		readTelemetry(dt, now);
		paint(now);
		if (now - saveAt > 5000) { saveAt = now; saveLocal(); }
		if (ENDPOINT && now - remoteAt > 20000) { remoteAt = now; remotePut(); }
	}

	/* --------------------------------------------------- 8. signals and keys */

	var actx = null;
	function beep(freq) {
		if (!CFG.sound) return;
		try {
			actx = actx || new (window.AudioContext || window.webkitAudioContext)();
			var o = actx.createOscillator(), g = actx.createGain();
			o.type = "sine";
			o.frequency.value = freq;
			g.gain.value = 0.03;
			o.connect(g);
			g.connect(actx.destination);
			o.start();
			o.stop(actx.currentTime + 0.05);
		} catch (e) {}
	}

	function sigTick() {
		if (!sig.left && !sig.right) { sig.phase = false; return; }
		sig.phase = !sig.phase;
		beep(sig.phase ? 760 : 660);
	}

	/* the game itself toggles autodrive on "z"; send it a synthetic press that
	 * our own capture handler lets through */
	function pressAutodrive() {
		["keydown", "keyup"].forEach(function (type) {
			var ev = new KeyboardEvent(type, { key: "z", code: "KeyZ", bubbles: true, cancelable: true });
			try {
				ev.__sr = true;
				Object.defineProperty(ev, "keyCode", { get: function () { return 90; } });
				Object.defineProperty(ev, "which", { get: function () { return 90; } });
			} catch (e) {}
			document.dispatchEvent(ev);
		});
		setTimeout(scanAuto, 300);
		return true;
	}

	function sceneTree(root, maxDepth, limit) {
		var out = [], n = 0;
		(function walk(o, d, prefix) {
			if (!o || n >= limit || d > maxDepth) return;
			n++;
			out.push(prefix + (o.name || "(" + o.type + ")") + (o.isMesh ? " [mesh]" : "") + (o.isCamera ? " [cam]" : "") + " {" + (o.children ? o.children.length : 0) + "}");
			var ch = o.children || [];
			for (var i = 0; i < ch.length && n < limit; i++) walk(ch[i], d + 1, prefix + "  ");
		})(root, 0, "");
		return out.join("\n");
	}

	function debugScan() {
		var info = {
			version: VER,
			mode: state.mode,
			ready3d: three.ready,
			three: three.T ? (three.T.REVISION || "harvested") : null,
			scenes: SCENES.length,
			renderers: RENDERERS.length,
			camera: three.camera ? {
				name: three.camera.name,
				fov: three.camera.fov,
				parent: three.camera.parent ? (three.camera.parent.name || three.camera.parent.type) : null
			} : null,
			telemetry: { kph: Math.round(telem.kph), src: telem.src, auto: telem.auto, calib: state.calib },
			dom: { speed: !!dom.speedNode, speedUnit: dom.speedUnit, dist: !!dom.distNode, distUnit: dom.distUnit },
			place: state.place,
			odoKm: state.odoKm,
			tripKm: state.tripKm
		};
		console.log("[sr-mod] scan", info);
		if (three.scene) console.log("[sr-mod] scene\n" + sceneTree(three.scene, 3, 90));
		toast("scan printed to the console");
		return info;
	}

	function setEdit(on) {
		edit.on = !!on;
		if (hud) hud.classList.toggle("sr-editing", edit.on);
		["cluster", "screen"].forEach(function (k) {
			var el = byId("sr-" + k);
			if (el) el.classList.toggle("sr-sel", edit.on && edit.sel === k);
		});
		if (edit.on) toast("edit " + edit.sel + " \u00b7 arrows move \u00b7 -/= size \u00b7 [ ] turn \u00b7 ; ' tilt \u00b7 , . depth \u00b7 Tab switch \u00b7 Esc done");
		else {
			savePlace("cluster");
			savePlace("screen");
			saveLocal();
			toast("position saved");
		}
	}

	var HOT = { z: 1, x: 1, F2: 1, F3: 1, F4: 1, F6: 1, F7: 1, F8: 1, F9: 1 };
	var EDITKEYS = { ArrowUp: 1, ArrowDown: 1, ArrowLeft: 1, ArrowRight: 1, Tab: 1, Escape: 1, "[": 1, "]": 1, ";": 1, "'": 1, "-": 1, "=": 1, "+": 1, ",": 1, ".": 1 };

	function editKey(k, shift) {
		var big = shift ? 3 : 1;
		var w = edit.sel;
		if (k === "Tab") { edit.sel = w === "cluster" ? "screen" : "cluster"; setEdit(true); return; }
		if (k === "Escape") { setEdit(false); return; }
		if (state.mode === "3d" && three.ready) {
			if (k === "ArrowLeft") nudge(w, -big, 0, 0, 0, 0, 0);
			else if (k === "ArrowRight") nudge(w, big, 0, 0, 0, 0, 0);
			else if (k === "ArrowUp") nudge(w, 0, big, 0, 0, 0, 0);
			else if (k === "ArrowDown") nudge(w, 0, -big, 0, 0, 0, 0);
			else if (k === ",") nudge(w, 0, 0, -big, 0, 0, 0);
			else if (k === ".") nudge(w, 0, 0, big, 0, 0, 0);
			else if (k === "-") nudge(w, 0, 0, 0, -1, 0, 0);
			else if (k === "=" || k === "+") nudge(w, 0, 0, 0, 1, 0, 0);
			else if (k === "[") nudge(w, 0, 0, 0, 0, 0, -1);
			else if (k === "]") nudge(w, 0, 0, 0, 0, 0, 1);
			else if (k === ";") nudge(w, 0, 0, 0, 0, -1, 0);
			else if (k === "'") nudge(w, 0, 0, 0, 0, 1, 0);
			return;
		}
		var L = state.layout[w];
		if (k === "ArrowLeft") L.x = clamp(L.x - 0.5 * big, 0, 100);
		else if (k === "ArrowRight") L.x = clamp(L.x + 0.5 * big, 0, 100);
		else if (k === "ArrowUp") L.y = clamp(L.y - 0.5 * big, 0, 100);
		else if (k === "ArrowDown") L.y = clamp(L.y + 0.5 * big, 0, 100);
		else if (k === "-") L.w = clamp(L.w - 0.8, 5, 70);
		else if (k === "=" || k === "+") L.w = clamp(L.w + 0.8, 5, 70);
		else if (k === "[") L.ry = clamp(L.ry - 2, -60, 60);
		else if (k === "]") L.ry = clamp(L.ry + 2, -60, 60);
		else if (k === ";") L.rx = clamp(L.rx - 2, -60, 60);
		else if (k === "'") L.rx = clamp(L.rx + 2, -60, 60);
		applyLayout();
		saveLocal();
	}

	function onKeyDown(e) {
		if (e.__sr || e.ctrlKey || e.metaKey) return;
		var t = e.target;
		if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
		var k = e.key;
		var low = typeof k === "string" ? k.toLowerCase() : "";
		var isEdit = edit.on && EDITKEYS[k];
		if (!HOT[k] && !HOT[low] && !isEdit) return;
		e.preventDefault();
		e.stopImmediatePropagation();
		if (isEdit) { editKey(k, e.shiftKey); return; }
		if (low === "z") { sig.left = !sig.left; sig.phase = true; beep(660); }
		else if (low === "x") { sig.right = !sig.right; sig.phase = true; beep(760); }
		else if (k === "F2") { state.ui.cluster = !state.ui.cluster; applyVis(); saveLocal(); }
		else if (k === "F4") { state.ui.screen = !state.ui.screen; applyVis(); saveLocal(); }
		else if (k === "F3") setEdit(!edit.on);
		else if (k === "F6") {
			if (state.mode === "3d" && three.ready) { autoPlace("cluster"); autoPlace("screen"); toast("re-mounted on the dash"); }
			else { state.layout = clone(DEF_LAYOUT); applyLayout(); saveLocal(); toast("layout reset"); }
		}
		else if (k === "F7") { pressAutodrive(); toast("autodrive toggle sent"); }
		else if (k === "F8") debugScan();
		else if (k === "F9") setMode(state.mode === "3d" ? "dom" : "3d");
	}

	function onKeyUp(e) {
		if (e.__sr || e.ctrlKey || e.metaKey) return;
		var k = e.key;
		var low = typeof k === "string" ? k.toLowerCase() : "";
		if (HOT[k] || HOT[low] || (edit.on && EDITKEYS[k])) {
			e.preventDefault();
			e.stopImmediatePropagation();
		}
	}

	function bindKeys() {
		window.addEventListener("keydown", onKeyDown, true);
		window.addEventListener("keyup", onKeyUp, true);
	}

	/* ------------------------------------------------------------- 9. public */

	window.SRMOD = {
		version: VER,
		cfg: CFG,
		state: state,
		three: three,
		panels: PANELS,
		telemetry: function () { return { kph: telem.kph, src: telem.src, auto: telem.auto, calib: state.calib }; },
		setTelemetry: function (kph) { telem.override = kph == null ? null : Number(kph); },
		setCalib: function (v) { state.calib = Number(v) || 3.6; saveLocal(); },
		setEndpoint: function (url) {
			ENDPOINT = String(url || "").replace(/\/+$/, "");
			try { LS.setItem(K_EP, ENDPOINT); } catch (e) {}
			toast(ENDPOINT ? "server saves on" : "server saves off");
		},
		save: {
			now: remotePut,
			pull: bootSync,
			export: exportSave,
			wipe: function () { LS.removeItem(K_STATE); location.reload(); }
		},
		mode: setMode,
		place: {
			redo: function () { autoPlace("cluster"); autoPlace("screen"); },
			get: function () { return clone(state.place); },
			reset: function () {
				["cluster", "screen"].forEach(function (k) {
					var p = PANELS[k];
					if (p && p.mesh && p.mesh.parent) p.mesh.parent.remove(p.mesh);
				});
				state.place = { cluster: null, screen: null };
				three.ready = false;
				three.tries = 0;
				saveLocal();
			}
		},
		layout: {
			edit: function (on) { setEdit(on !== false); },
			get: function () { return clone(state.layout); },
			reset: function () { state.layout = clone(DEF_LAYOUT); applyLayout(); saveLocal(); }
		},
		toggleCluster: function () { state.ui.cluster = !state.ui.cluster; applyVis(); saveLocal(); },
		toggleScreen: function () { state.ui.screen = !state.ui.screen; applyVis(); saveLocal(); },
		autodrive: pressAutodrive,
		killJunk: killJunk,
		scan: debugScan
	};

	/* --------------------------------------------------------------- 10. init */

	function init() {
		if (window.__SR_MOD__) return;
		window.__SR_MOD__ = VER;
		if (state.odoBase < state.odoKm) state.odoBase = state.odoKm;
		buildHud();
		killJunk();
		watchJunk();
		bindKeys();
		setInterval(sigTick, 430);
		window.addEventListener("beforeunload", saveLocal);
		requestAnimationFrame(loop);
		log("ready", VER);
	}

	bootSync();
	onReady(init);
})();
