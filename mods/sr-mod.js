/* slow-roads mod layer v0.4.0
 * The cluster is painted onto the dash binnacle inside the game's three.js
 * scene with additive blending, the way the stock readout looks, and the
 * centre display carries a real YouTube player warped onto its 3d quad.
 * Docs: docs/MODS.md
 */
(function () {
	"use strict";

	/* ------------------------------------------- 0. three.js devtools bridge */
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

	var VER = "0.4.0";
	var DEF = {
		sound: true, cluster: true, screen: true, media: true,
		mode: "3d", debug: false, saveEndpoint: "", video: "jfKfPfyJRdk"
	};
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
		v: 4,
		updatedAt: 0,
		odoBase: 0,
		odoKm: 0,
		tripKm: 0,
		driveSec: 0,
		calib: 3.6,
		mode: CFG.mode === "dom" ? "dom" : "3d",
		depth: true,
		hudDim: false,
		ui: { cluster: CFG.cluster !== false, screen: CFG.screen !== false, media: CFG.media !== false },
		media: { id: String(CFG.video || "jfKfPfyJRdk"), sound: true },
		place: { cluster: null, screen: null },
		layout: clone(DEF_LAYOUT),
		game: {}
	};

	var telem = { kph: 0, has: false, at: 0, src: "none", auto: false, accel: 0, override: null };
	var sig = { left: false, right: false, phase: false };
	var edit = { on: false, sel: "cluster" };
	var hud = null;

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

	var JUNK_HREF = /(ko-?fi|patreon|discord|paypal|buymeacoffee|twitter\.com|x\.com|reddit\.com|instagram\.com|youtube\.com\/(?:c|channel|user)|tiktok)/i;
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
			if (n.closest && (n.closest("#sr-hud") || n.closest("#sr-css3d"))) continue;
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
		if (typeof s.depth === "boolean") state.depth = s.depth;
		if (typeof s.hudDim === "boolean") state.hudDim = s.hudDim;
		if (s.ui) {
			state.ui.cluster = s.ui.cluster !== false;
			state.ui.screen = s.ui.screen !== false;
			state.ui.media = s.ui.media !== false;
		}
		if (s.media) {
			if (typeof s.media.id === "string" && s.media.id) state.media.id = s.media.id;
			if (typeof s.media.sound === "boolean") state.media.sound = s.media.sound;
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

	/* ----------------------------------------------------------- 4. telemetry
	 * v0.3.0 cached the text nodes of the game hud, and react kept replacing
	 * them, so the cluster went blank and showed "--". Now the hud text is
	 * re-parsed from scratch five times a second, which cannot go stale.
	 */

	var RX_SPEED = /(-?\d+(?:[.,]\d+)?)\s*(mph|kph|km\/h|kmh|miles per hour|kilometers per hour|kilometres per hour)/i;
	var RX_DIST = /(-?\d+(?:[.,]\d+)?)\s*(miles?|mi|km|kilometers?|kilometres?)\b/i;
	var RX_AUTO = /autodrive\s*(on|off)/i;

	var dom = { at: 0, speed: null, dist: null, unit: "kph", lastDist: null, hudEls: [], hudAt: 0 };
	var motion = { p0: null, p1: null, ups: 0 };

	function num(s) {
		var v = parseFloat(String(s).replace(",", "."));
		return isFinite(v) ? v : null;
	}

	function readDom(now) {
		if (now - dom.at < 200) return;
		dom.at = now;
		var txt = "";
		try { txt = document.body ? (document.body.innerText || "") : ""; } catch (e) {}
		if (!txt) return;
		dom.speed = null;
		dom.dist = null;
		var rest = txt;
		var sp = RX_SPEED.exec(txt);
		if (sp) {
			var v = num(sp[1]);
			var mph = /^(mph|miles)/i.test(sp[2]);
			dom.unit = mph ? "mph" : "kph";
			if (v != null) dom.speed = mph ? v * MI2KM : v;
			rest = txt.slice(0, sp.index) + " " + txt.slice(sp.index + sp[0].length);
		}
		var ds = RX_DIST.exec(rest);
		if (ds) {
			var d = num(ds[1]);
			if (d != null) dom.dist = /^mi/i.test(ds[2]) ? d * MI2KM : d;
		}
		var a = RX_AUTO.exec(txt);
		if (a) telem.auto = a[1].toLowerCase() === "on";
	}

	/* the interior camera rides with the car, so the motion of its world
	 * position is a clean speed signal; state.calib turns world units per
	 * second into km/h and is tuned against the game hud while driving */
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
		motion.ups = motion.ups * 0.8 + (d / dt) * 0.2;
		return motion.ups;
	}

	function readTelemetry(dt, now) {
		readDom(now);
		var dk = dom.speed;
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
		if (kph == null) {
			if (now - telem.at > 1500) { telem.has = false; telem.src = "none"; }
		} else {
			telem.has = true;
			telem.at = now;
			telem.kph = clamp(kph, 0, 400);
			if (dt > 0) telem.accel = telem.accel * 0.85 + ((telem.kph - prev) / dt) * 0.15;
		}

		var dist = dom.dist;
		if (dist != null) {
			if (dom.lastDist != null && dist < dom.lastDist - 0.3) state.odoBase += dom.lastDist;
			dom.lastDist = dist;
			state.tripKm = dist;
			state.odoKm = state.odoBase + dist;
		} else if (telem.has && telem.kph > 0.5 && dt > 0) {
			var km = telem.kph * dt / 3600;
			state.tripKm += km;
			state.odoKm += km;
		}
		if (telem.has && telem.kph > 0.5 && dt > 0) state.driveSec += dt;
	}

	/* the stock hud duplicates our cluster, so it can be faded out while its
	 * text stays in the dom for parsing (opacity does not hide innerText) */
	function hudTargets() {
		var out = [];
		var all = document.querySelectorAll("div, span, p, label");
		for (var i = 0; i < all.length; i++) {
			var el = all[i];
			if (el.children.length) continue;
			if (el.closest && (el.closest("#sr-hud") || el.closest("#sr-css3d"))) continue;
			var t = (el.textContent || "").trim().toLowerCase();
			if (!t || t.length > 22) continue;
			if (!/^(mph|kph|km\/h|kmh|miles?|mi|km|kilometers per hour|kilometres per hour|miles per hour|kilometers?|kilometres?)$/.test(t)) continue;
			var box = el;
			for (var k = 0; k < 2 && box.parentElement && box.parentElement !== document.body; k++) box = box.parentElement;
			if (out.indexOf(box) < 0) out.push(box);
		}
		return out;
	}

	function applyHudDim() {
		if (state.hudDim && (!dom.hudEls.length || Date.now() - dom.hudAt > 4000)) {
			dom.hudEls = hudTargets();
			dom.hudAt = Date.now();
		}
		dom.hudEls.forEach(function (el) {
			if (!el || !el.style) return;
			el.style.transition = "opacity .3s ease";
			el.style.opacity = state.hudDim ? "0.06" : "";
		});
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

	/* 1024 x 320, drawn light-on-black: the panel is added to the dash with
	 * additive blending, so black stays invisible and only the readout glows,
	 * exactly how the stock cluster sits in the binnacle */
	function drawCluster(c, W, H) {
		c.clearRect(0, 0, W, H);

		var fresh = telem.has;
		var f = fresh ? clamp(telem.kph / 160, 0, 1) : 0;
		var pw = fresh ? clamp(0.06 + telem.accel / 20 + f * 0.4, 0, 1) : 0;
		var cy = 158, r = 104;

		gauge(c, 198, cy, r, 13, "rgba(190,225,240,0.13)", A0, A1);
		if (f > 0.002) gauge(c, 198, cy, r, 13, "#45c8f0", A0, A0 + (A1 - A0) * f);
		c.textAlign = "center";
		c.textBaseline = "middle";
		setFont(c, 96, 500);
		c.fillStyle = "#e8f6fc";
		c.fillText(fresh ? String(Math.round(telem.kph)) : "--", 198, cy - 6);
		setFont(c, 26, 400);
		c.fillStyle = "rgba(232,246,252,0.5)";
		spaced(c, "KPH", 198, cy + 62, 7, "center");

		gauge(c, 826, cy, r, 13, "rgba(190,225,240,0.13)", A0, A1);
		if (pw > 0.002) {
			var g = c.createLinearGradient(826 - r, cy + r, 826 + r, cy - r);
			g.addColorStop(0, "#49d96b");
			g.addColorStop(1, "#e6dc4b");
			gauge(c, 826, cy, r, 13, g, A0, A0 + (A1 - A0) * pw);
		}
		setFont(c, 58, 400);
		c.fillStyle = "rgba(255,196,86,0.9)";
		c.fillText("\u26a1", 826, cy);

		var mx = W / 2;
		var gr = c.createLinearGradient(mx, 26, mx, 86);
		gr.addColorStop(0, "rgba(235,248,253,0.9)");
		gr.addColorStop(1, "rgba(235,248,253,0.05)");
		c.fillStyle = gr;
		c.fillRect(mx - 2, 26, 4, 60);

		var o = odoParts(state.odoKm);
		setFont(c, 56, 500);
		var wd = c.measureText(o.dim).width, wl = c.measureText(o.lit).width;
		setFont(c, 24, 400);
		var wk = c.measureText("KM").width + 12;
		var ox = mx - (wd + wl + wk) / 2;
		c.textAlign = "left";
		setFont(c, 56, 500);
		c.fillStyle = "rgba(232,246,252,0.16)";
		c.fillText(o.dim, ox, 136);
		c.fillStyle = "#e8f6fc";
		c.fillText(o.lit, ox + wd, 136);
		setFont(c, 24, 400);
		c.fillStyle = "rgba(232,246,252,0.42)";
		c.fillText("KM", ox + wd + wl + 12, 146);

		setFont(c, 23, 400);
		c.fillStyle = telem.auto ? "#8fe8a8" : "rgba(232,246,252,0.16)";
		spaced(c, "\u25cf CRUISE", mx, 190, 5, "center");

		setFont(c, 29, 400);
		c.fillStyle = "rgba(232,246,252,0.55)";
		spaced(c, hhmm(new Date()), mx, 238, 4, "center");

		setFont(c, 21, 400);
		c.fillStyle = "rgba(232,246,252,0.4)";
		spaced(c, "RWD \u25d1", W - 46, 284, 5, "right");
		if (CFG.debug || edit.on) {
			setFont(c, 19, 400);
			c.fillStyle = "rgba(232,246,252,0.3)";
			c.textAlign = "left";
			c.fillText(telem.src + " \u00b7 " + state.calib.toFixed(2), 46, 284);
		}

		var onL = sig.left && sig.phase, onR = sig.right && sig.phase;
		tri(c, 62, cy, 25, -1, onL ? "#2fdd6e" : "rgba(47,221,110,0.09)");
		tri(c, W - 62, cy, 25, 1, onR ? "#2fdd6e" : "rgba(47,221,110,0.09)");
	}

	/* the centre display keeps its own dark glass, because a black screen in
	 * the middle of the cabin is the point; the big right-hand area is the
	 * window the youtube player is warped into (see MEDIA_UV) */
	var MEDIA_UV = { x0: 0.34, y0: 0.23, x1: 0.98, y1: 0.81 };

	function drawScreen(c, W, H) {
		c.clearRect(0, 0, W, H);
		c.fillStyle = "rgba(3,5,8,0.93)";
		rr(c, 0, 0, W, H, 26);
		c.fill();
		c.strokeStyle = "rgba(150,190,210,0.16)";
		c.lineWidth = 2;
		rr(c, 1, 1, W - 2, H - 2, 26);
		c.stroke();

		var now = new Date();
		c.textBaseline = "middle";
		c.textAlign = "left";
		setFont(c, 26, 500);
		c.fillStyle = "#dff0f7";
		c.fillText(hhmm(now), 30, 40);
		c.textAlign = "center";
		setFont(c, 22, 400);
		c.fillStyle = "rgba(223,240,247,0.6)";
		c.fillText(dmy(now), W / 2, 40);
		c.textAlign = "right";
		setFont(c, 20, 400);
		c.fillStyle = "rgba(223,240,247,0.45)";
		c.fillText("LTE \u25b0\u25b0\u25b0", W - 30, 40);

		/* left column: navigation, live speed, trip */
		var lx = 24, lw = 296, top = 70;
		c.fillStyle = "rgba(255,255,255,0.045)";
		rr(c, lx, top, lw, 182, 18);
		c.fill();
		c.save();
		rr(c, lx, top, lw, 182, 18);
		c.clip();
		c.strokeStyle = "rgba(69,200,240,0.75)";
		c.lineWidth = 7;
		c.beginPath();
		c.moveTo(lx + 34, top + 168);
		c.bezierCurveTo(lx + 96, top + 126, lx + 150, top + 104, lx + 262, top + 34);
		c.stroke();
		c.fillStyle = "#45c8f0";
		c.beginPath();
		c.arc(lx + 34, top + 168, 9, 0, Math.PI * 2);
		c.fill();
		c.restore();
		c.textAlign = "left";
		setFont(c, 22, 500);
		c.fillStyle = "#dff0f7";
		c.fillText("NAVI", lx + 20, top + 30);
		setFont(c, 18, 400);
		c.fillStyle = "rgba(223,240,247,0.55)";
		c.fillText("endless road", lx + 20, top + 56);

		var my = top + 196;
		c.fillStyle = "rgba(255,255,255,0.045)";
		rr(c, lx, my, lw, 176, 18);
		c.fill();
		c.textAlign = "center";
		setFont(c, 86, 500);
		c.fillStyle = "#eaf7fc";
		c.fillText(telem.has ? String(Math.round(telem.kph)) : "--", lx + lw / 2, my + 74);
		setFont(c, 20, 400);
		c.fillStyle = "rgba(223,240,247,0.5)";
		spaced(c, "KM/H", lx + lw / 2, my + 128, 5, "center");
		setFont(c, 19, 400);
		c.fillStyle = telem.auto ? "#8fe8a8" : "rgba(223,240,247,0.28)";
		c.fillText(telem.auto ? "AUTODRIVE" : "MANUAL", lx + lw / 2, my + 154);

		var ty = my + 190;
		c.textAlign = "left";
		setFont(c, 19, 400);
		c.fillStyle = "rgba(223,240,247,0.45)";
		c.fillText("TRIP " + state.tripKm.toFixed(1) + " km", lx + 12, ty + 22);
		c.fillText("ODO " + Math.floor(state.odoKm) + " km", lx + 12, ty + 50);
		c.fillText("TIME " + dur(state.driveSec), lx + 12, ty + 78);

		/* body lamps: mirrors the turn signal bulbs around the car */
		var bx = lx + 196, by = ty + 14, bw = 84, bh = 74;
		c.strokeStyle = "rgba(223,240,247,0.22)";
		c.lineWidth = 2;
		rr(c, bx, by, bw, bh, 16);
		c.stroke();
		var onL = sig.left && sig.phase, onR = sig.right && sig.phase;
		var dotsL = [[bx, by + 12], [bx, by + bh - 12]];
		var dotsR = [[bx + bw, by + 12], [bx + bw, by + bh - 12]];
		function dot(p, on) {
			c.beginPath();
			c.arc(p[0], p[1], 6, 0, Math.PI * 2);
			c.fillStyle = on ? "#2fdd6e" : "rgba(47,221,110,0.14)";
			c.fill();
		}
		dotsL.forEach(function (p) { dot(p, onL); });
		dotsR.forEach(function (p) { dot(p, onR); });

		/* media window: chrome only, the player itself is a real iframe */
		var mx0 = MEDIA_UV.x0 * W, my0 = MEDIA_UV.y0 * H;
		var mw = (MEDIA_UV.x1 - MEDIA_UV.x0) * W, mh = (MEDIA_UV.y1 - MEDIA_UV.y0) * H;
		c.fillStyle = "rgba(0,0,0,0.92)";
		rr(c, mx0, my0, mw, mh, 14);
		c.fill();
		if (!(media.live && state.ui.media)) {
			c.textAlign = "center";
			setFont(c, 30, 500);
			c.fillStyle = "rgba(223,240,247,0.7)";
			c.fillText("YOUTUBE", mx0 + mw / 2, my0 + mh / 2 - 14);
			setFont(c, 20, 400);
			c.fillStyle = "rgba(223,240,247,0.4)";
			c.fillText(state.ui.media ? "loading player" : "off \u00b7 F4 to enable", mx0 + mw / 2, my0 + mh / 2 + 24);
		}

		c.textAlign = "left";
		setFont(c, 20, 400);
		c.fillStyle = "rgba(223,240,247,0.5)";
		c.fillText("MEDIA", mx0 + 6, my0 - 18);
		c.textAlign = "right";
		c.fillStyle = media.interact ? "#8fe8a8" : "rgba(223,240,247,0.35)";
		c.fillText(media.interact ? "touch on" : "F5 \u00b7 touch", mx0 + mw - 6, my0 - 18);

		var dy = H - 34;
		var icons = ["\u2302", "\u266a", "\u2668", "\u2699"];
		c.textAlign = "center";
		setFont(c, 26, 400);
		for (var i = 0; i < icons.length; i++) {
			c.fillStyle = i === 1 ? "rgba(223,240,247,0.85)" : "rgba(223,240,247,0.35)";
			c.fillText(icons[i], 60 + i * 66, dy);
		}
		c.textAlign = "right";
		setFont(c, 19, 400);
		c.fillStyle = "rgba(223,240,247,0.4)";
		c.fillText("A/C auto \u00b7 21.5\u00b0", W - 30, dy);
	}

	/* ------------------------------------------------- 6. three.js panel mesh */

	var PANELS = { cluster: null, screen: null };
	var three = { T: null, scene: null, camera: null, renderer: null, ready: false, tries: 0, probeAt: 0 };

	function harvestTHREE() {
		if (three.T) return three.T;
		var keys = Object.keys(window).filter(function (k) { return /^webpackJsonp/.test(k); });
		for (var i = 0; i < keys.length; i++) {
			var arr = window[keys[i]];
			if (!arr || typeof arr.push !== "function") continue;
			var req = null;
			try {
				arr.push([["sr-mod-chunk"], { "sr-mod-probe": function (m, e, r) { req = r; } }, [["sr-mod-probe"]]]);
			} catch (e) {}
			if (!req || !req.c) continue;
			var cache = req.c;
			for (var id in cache) {
				var ex = cache[id] && cache[id].exports;
				if (ex && ex.REVISION && ex.Mesh && ex.Vector3 && ex.Raycaster) { three.T = ex; return ex; }
			}
		}
		return null;
	}

	/* if the bundle cannot be probed, rebuild the handful of constructors we
	 * need straight off objects that already live in the scene */
	function harvestFromScene() {
		if (three.T) return three.T;
		var sc = three.scene;
		if (!sc || !sc.traverse) return null;
		var mesh = null;
		sc.traverse(function (o) { if (!mesh && o && o.isMesh && o.geometry && o.material) mesh = o; });
		if (!mesh) return null;
		var mat = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
		var T = {
			Mesh: mesh.constructor,
			Vector3: mesh.position.constructor,
			Quaternion: mesh.quaternion.constructor,
			BufferGeometry: mesh.geometry.constructor,
			MeshBasicMaterial: mat && mat.constructor,
			DoubleSide: 2,
			AdditiveBlending: 2,
			__harvested: true
		};
		var pos = mesh.geometry.getAttribute && mesh.geometry.getAttribute("position");
		if (pos) T.BufferAttribute = pos.constructor;
		if (mat && mat.map) T.Texture = mat.map.constructor;
		if (!T.Mesh || !T.Vector3 || !T.MeshBasicMaterial || !T.BufferGeometry || !T.BufferAttribute) return null;
		three.T = T;
		return T;
	}

	function planeGeo(T, w, h) {
		if (T.PlaneGeometry) return new T.PlaneGeometry(w, h);
		if (T.PlaneBufferGeometry) return new T.PlaneBufferGeometry(w, h);
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
		var T = three.T;
		var p = PANELS[which];
		if (!T || !p) return null;
		if (p.mesh) return p.mesh;
		var cvs = p.canvas;
		var tex = T.CanvasTexture ? new T.CanvasTexture(cvs) : new T.Texture(cvs);
		tex.needsUpdate = true;
		if (T.LinearFilter != null) { tex.minFilter = T.LinearFilter; tex.magFilter = T.LinearFilter; }
		tex.generateMipmaps = false;
		if (T.SRGBColorSpace) tex.colorSpace = T.SRGBColorSpace;
		var opts = {
			map: tex,
			transparent: true,
			depthWrite: false,
			depthTest: state.depth !== false,
			toneMapped: false,
			side: T.DoubleSide != null ? T.DoubleSide : 2
		};
		/* the cluster is added to the dash instead of covering it, so it reads
		 * as part of the moulding like the stock readout does */
		if (which === "cluster" && T.AdditiveBlending != null) opts.blending = T.AdditiveBlending;
		var mat = new T.MeshBasicMaterial(opts);
		mat.polygonOffset = true;
		mat.polygonOffsetFactor = -4;
		mat.polygonOffsetUnits = -4;
		var mesh = new T.Mesh(planeGeo(T, 1, cvs.height / cvs.width), mat);
		mesh.name = "sr-" + which;
		mesh.__srPanel = which;
		mesh.frustumCulled = false;
		mesh.renderOrder = which === "cluster" ? 991 : 990;
		p.mesh = mesh;
		p.tex = tex;
		p.mat = mat;
		return mesh;
	}

	function qInv(q) { return q.invert ? q.invert() : q.inverse(); }

	function pathOf(obj) {
		var path = [], o = obj;
		while (o && o.parent) {
			var i = o.parent.children.indexOf(o);
			if (i < 0) return null;
			path.unshift(i);
			o = o.parent;
		}
		return path;
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
		if (!p || !p.mesh || !p.mesh.parent) return;
		var m = p.mesh;
		state.place[which] = {
			path: pathOf(m.parent),
			name: String(m.parent.name || ""),
			pos: [m.position.x, m.position.y, m.position.z],
			quat: [m.quaternion.x, m.quaternion.y, m.quaternion.z, m.quaternion.w],
			scale: m.scale.x
		};
		saveLocal();
	}

	function applyPlace(which) {
		var rec = state.place[which];
		var p = PANELS[which];
		if (!rec || !rec.path || !p || !three.scene) return false;
		var anchor = atPath(three.scene, rec.path);
		if (!anchor || !anchor.add) return false;
		if (rec.name && String(anchor.name || "") !== rec.name) return false;
		var mesh = make3d(which);
		if (!mesh) return false;
		anchor.add(mesh);
		mesh.position.set(rec.pos[0], rec.pos[1], rec.pos[2]);
		mesh.quaternion.set(rec.quat[0], rec.quat[1], rec.quat[2], rec.quat[3]);
		mesh.scale.set(rec.scale, rec.scale, rec.scale);
		mesh.updateMatrixWorld && mesh.updateMatrixWorld(true);
		return true;
	}

	/* ---------------------------------------------- 7. welding to the cabin */

	function findParts() {
		var out = { wheel: null, dash: null, inner: null };
		var sc = three.scene;
		if (!sc || !sc.traverse) return out;
		sc.traverse(function (o) {
			if (!o || o.__srPanel) return;
			var n = String(o.name || "").toLowerCase();
			if (!n) return;
			if (!out.wheel && /steer/.test(n)) out.wheel = o;
			if (!out.dash && /(dash|binnacle|gauge|cluster|instrument)/.test(n)) out.dash = o;
			if (!out.inner && /(interior|cockpit|cabin|[-_]int\b|[-_]int$|roadster)/.test(n)) out.inner = o;
		});
		return out;
	}

	function rigBasis() {
		var T = three.T, cam = three.camera;
		var rig = cam.parent && cam.parent !== three.scene ? cam.parent : cam;
		var q = new T.Quaternion();
		rig.getWorldQuaternion(q);
		return {
			q: q,
			fwd: new T.Vector3(0, 0, -1).applyQuaternion(q),
			up: new T.Vector3(0, 1, 0).applyQuaternion(q),
			right: new T.Vector3(1, 0, 0).applyQuaternion(q)
		};
	}

	function facing(b, pitch, yaw) {
		var T = three.T;
		var q = b.q.clone();
		if (yaw) q.multiply(new T.Quaternion().setFromAxisAngle(new T.Vector3(0, 1, 0), yaw));
		if (pitch) q.multiply(new T.Quaternion().setFromAxisAngle(new T.Vector3(1, 0, 0), pitch));
		return q;
	}

	/* the steering wheel is the one landmark that is always where the driver
	 * looks, so the binnacle is measured off it: same trick as the stock
	 * readout, which sits just behind the rim */
	function planByWheel() {
		var T = three.T, sc = three.scene;
		if (!T || !T.Box3 || !T.Quaternion || !sc) return null;
		var parts = findParts();
		if (!parts.wheel) return null;
		var box = new T.Box3();
		try { box.setFromObject(parts.wheel); } catch (e) { return null; }
		if (box.isEmpty && box.isEmpty()) return null;
		var ctr = box.getCenter(new T.Vector3());
		var size = box.getSize(new T.Vector3());
		var rad = Math.max(size.x, size.y, size.z) / 2;
		if (!isFinite(rad) || rad <= 0) return null;
		var b = rigBasis();
		var cw = rad * 1.55;
		var sw = cw * 1.15;
		var cpos = ctr.clone()
			.addScaledVector(b.fwd, rad * 0.55)
			.addScaledVector(b.up, rad * 0.34);
		var spos = cpos.clone()
			.addScaledVector(b.right, cw * 0.5 + sw * 0.5 + cw * 0.14)
			.addScaledVector(b.up, -cw * 0.16)
			.addScaledVector(b.fwd, -rad * 0.12);
		return {
			how: "wheel",
			anchor: parts.dash || parts.inner || parts.wheel.parent || sc,
			cluster: { pos: cpos, quat: facing(b, -0.13, 0), width: cw },
			screen: { pos: spos, quat: facing(b, -0.10, -0.20), width: sw }
		};
	}

	/* no named wheel in the scene: shoot one ray down the driver's line of
	 * sight, weld to whatever interior surface it lands on, and derive the
	 * second panel from the first so it can never end up on a pillar */
	function planByRay() {
		var T = three.T, cam = three.camera, sc = three.scene;
		if (!T || !T.Raycaster || !cam || !sc) return null;
		var eye = new T.Vector3();
		cam.getWorldPosition(eye);
		var b = rigBasis();
		var dir = b.fwd.clone().applyAxisAngle(b.right, -22 * Math.PI / 180).normalize();
		var hits = [];
		try { hits = new T.Raycaster(eye, dir, 0.01, 60).intersectObjects(sc.children, true) || []; } catch (e) { return null; }
		var hit = null;
		for (var i = 0; i < hits.length; i++) {
			var o = hits[i].object;
			if (!o || o.__srPanel || o.visible === false) continue;
			if (/glass|window|shield|mirror|sky|cloud/i.test(String(o.name || ""))) continue;
			hit = hits[i];
			break;
		}
		if (!hit) return null;
		var dist = hit.distance;
		var fov = (cam.fov || 60) * Math.PI / 180;
		var vw = 2 * dist * Math.tan(fov / 2) * (cam.aspect || window.innerWidth / Math.max(1, window.innerHeight));
		var cw = vw * 0.26;
		var sw = cw * 1.15;
		var cpos = hit.point.clone().addScaledVector(eye.clone().sub(hit.point).normalize(), dist * 0.015);
		var spos = cpos.clone()
			.addScaledVector(b.right, cw * 0.5 + sw * 0.5 + cw * 0.14)
			.addScaledVector(b.up, -cw * 0.16);
		return {
			how: "ray",
			anchor: hit.object,
			cluster: { pos: cpos, quat: facing(b, -0.13, 0), width: cw },
			screen: { pos: spos, quat: facing(b, -0.10, -0.20), width: sw }
		};
	}

	function attachPanel(which, spec, anchor) {
		var T = three.T;
		var mesh = make3d(which);
		if (!mesh || !anchor || !anchor.add) return false;
		anchor.updateMatrixWorld && anchor.updateMatrixWorld(true);
		anchor.add(mesh);
		var local = spec.pos.clone();
		if (anchor.worldToLocal) anchor.worldToLocal(local);
		mesh.position.copy(local);
		var aq = new T.Quaternion();
		anchor.getWorldQuaternion(aq);
		mesh.quaternion.copy(qInv(aq).multiply(spec.quat));
		var as = new T.Vector3(1, 1, 1);
		if (anchor.getWorldScale) anchor.getWorldScale(as);
		var s = spec.width / (Math.abs(as.x) > 1e-6 ? Math.abs(as.x) : 1);
		mesh.scale.set(s, s, s);
		mesh.updateMatrixWorld && mesh.updateMatrixWorld(true);
		savePlace(which);
		return true;
	}

	function weld3d() {
		if (!three.T || !three.scene || !three.camera) return false;
		var plan = planByWheel() || planByRay();
		if (!plan) return false;
		var ok = attachPanel("cluster", plan.cluster, plan.anchor);
		ok = attachPanel("screen", plan.screen, plan.anchor) || ok;
		if (ok) log("welded via", plan.how, plan.anchor && plan.anchor.name);
		return ok;
	}

	function nudge(which, dx, dy, dz, ds, dyaw, dpitch) {
		var p = PANELS[which];
		if (!p || !p.mesh) return;
		var m = p.mesh, T = three.T;
		var step = m.scale.x * 0.04;
		if (dx) m.translateX(dx * step);
		if (dy) m.translateY(dy * step);
		if (dz) m.translateZ(dz * step * 0.6);
		if (ds) {
			var s = clamp(m.scale.x * (1 + ds * 0.06), 1e-4, 1e4);
			m.scale.set(s, s, s);
		}
		if (dyaw) m.rotateY(dyaw * 0.035);
		if (dpitch) m.rotateX(dpitch * 0.035);
		m.updateMatrixWorld && m.updateMatrixWorld(true);
		savePlace(which);
	}

	function applyDepth() {
		["cluster", "screen"].forEach(function (k) {
			var p = PANELS[k];
			if (p && p.mat) { p.mat.depthTest = state.depth !== false; p.mat.needsUpdate = true; }
		});
	}

	function pickScene() {
		var best = null, bestN = -1;
		for (var i = 0; i < SCENES.length; i++) {
			var s = SCENES[i];
			if (!s || !s.children) continue;
			var n = s.children.length;
			if (n > bestN) { bestN = n; best = s; }
		}
		return best;
	}

	function patchRenderers() {
		for (var i = 0; i < RENDERERS.length; i++) {
			var r = RENDERERS[i];
			if (!r || r.__srPatched || typeof r.render !== "function") continue;
			r.__srPatched = true;
			var orig = r.render.bind(r);
			r.render = function (scene, camera) {
				if (scene && scene.isScene) {
					if (SCENES.indexOf(scene) < 0) SCENES.push(scene);
					if (!three.scene || (scene.children && three.scene.children && scene.children.length >= three.scene.children.length)) three.scene = scene;
				}
				if (camera && camera.isPerspectiveCamera) three.camera = camera;
				return orig(scene, camera);
			};
			three.renderer = r;
		}
	}

	function findCamera() {
		if (three.camera && three.camera.isPerspectiveCamera) return three.camera;
		var sc = three.scene, found = null;
		if (sc && sc.traverse) sc.traverse(function (o) { if (!found && o && o.isPerspectiveCamera) found = o; });
		return found;
	}

	function setup3d(now) {
		if (three.ready || state.mode !== "3d") return;
		if (now - three.probeAt < 250) return;
		three.probeAt = now;
		three.tries++;
		patchRenderers();
		if (!three.scene) three.scene = pickScene();
		if (!three.scene) { if (three.tries > 48) setMode("dom"); return; }
		if (!three.T) harvestTHREE() || harvestFromScene();
		if (!three.T) { if (three.tries > 48) setMode("dom"); return; }
		three.camera = findCamera();
		if (!three.camera) { if (three.tries > 48) setMode("dom"); return; }
		var ok = applyPlace("cluster");
		var ok2 = applyPlace("screen");
		if (!ok || !ok2) ok = weld3d() || ok;
		if (!ok && !ok2) { if (three.tries > 48) setMode("dom"); return; }
		three.ready = true;
		applyDepth();
		applyVis();
		makeMediaFrame();
		toast("cluster is in the cabin \u00b7 F3 adjust \u00b7 F6 re-weld");
	}

	/* --------------------------------------------- 8. youtube on the dash
	 * A webgl texture cannot host an iframe, so the player stays in the dom
	 * and is perspective-warped onto the four projected corners of the media
	 * window of the centre screen. It tracks the panel frame by frame, so it
	 * leans and slides with the cabin like the rest of the display.
	 */

	var media = {
		layer: null, inner: null, wrap: null, frame: null,
		live: false, interact: false, armed: false, w: 1280, h: 720
	};

	function ytId(s) {
		s = String(s || "").trim();
		var m = /(?:v=|v\/|youtu\.be\/|embed\/|shorts\/|list=)([A-Za-z0-9_-]{6,})/.exec(s);
		if (m) return m[1];
		if (/^[A-Za-z0-9_-]{6,}$/.test(s)) return s;
		return null;
	}

	function ytSrc(id) {
		var list = id.length > 16 ? "&listType=playlist&list=" + encodeURIComponent(id) : "";
		return "https://www.youtube-nocookie.com/embed/" + encodeURIComponent(id) +
			"?autoplay=1&mute=1&playsinline=1&controls=1&rel=0&modestbranding=1&iv_load_policy=3&enablejsapi=1" + list;
	}

	function ytCmd(func, args) {
		if (!media.frame || !media.frame.contentWindow) return;
		try {
			media.frame.contentWindow.postMessage(JSON.stringify({
				event: "command", func: func, args: args || []
			}), "*");
		} catch (e) {}
	}

	function makeMediaFrame() {
		if (media.layer || !state.ui.media) return;
		var layer = elm("div");
		layer.id = "sr-css3d";
		var wrap = elm("div");
		wrap.id = "sr-media";
		var f = document.createElement("iframe");
		f.id = "sr-yt";
		f.setAttribute("allow", "autoplay; encrypted-media; picture-in-picture");
		f.setAttribute("allowfullscreen", "");
		f.setAttribute("frameborder", "0");
		f.setAttribute("referrerpolicy", "strict-origin-when-cross-origin");
		f.src = ytSrc(state.media.id || "jfKfPfyJRdk");
		wrap.appendChild(f);
		layer.appendChild(wrap);
		document.body.appendChild(layer);
		wrap.style.width = media.w + "px";
		wrap.style.height = media.h + "px";
		media.layer = layer;
		media.wrap = wrap;
		media.frame = f;
		setInteract(false);
		if (!media.armed) {
			media.armed = true;
			var arm = function () {
				if (state.media.sound) { ytCmd("unMute"); ytCmd("setVolume", [45]); }
				ytCmd("playVideo");
			};
			window.addEventListener("pointerdown", arm, { once: true });
			window.addEventListener("keydown", arm, { once: true });
		}
	}

	function setVideo(v) {
		var id = ytId(v);
		if (!id) { toast("cannot read that youtube link"); return false; }
		state.media.id = id;
		saveLocal();
		if (media.frame) media.frame.src = ytSrc(id);
		toast("playing " + id);
		return true;
	}

	function setInteract(on) {
		media.interact = !!on;
		if (media.wrap) media.wrap.style.pointerEvents = on ? "auto" : "none";
		if (media.layer) media.layer.classList.toggle("sr-touch", !!on);
	}

	function mediaCorners() {
		var T = three.T, cam = three.camera, p = PANELS.screen;
		if (!T || !cam || !p || !p.mesh || !p.mesh.parent || !cam.matrixWorldInverse) return null;
		var h = p.canvas.height / p.canvas.width;
		var uv = [
			[MEDIA_UV.x0, MEDIA_UV.y0], [MEDIA_UV.x1, MEDIA_UV.y0],
			[MEDIA_UV.x1, MEDIA_UV.y1], [MEDIA_UV.x0, MEDIA_UV.y1]
		];
		var vw = window.innerWidth, vh = window.innerHeight;
		var pts = [], i, v, view;
		p.mesh.updateMatrixWorld && p.mesh.updateMatrixWorld(true);
		for (i = 0; i < 4; i++) {
			v = new T.Vector3(uv[i][0] - 0.5, (0.5 - uv[i][1]) * h, 0.0008);
			p.mesh.localToWorld(v);
			view = v.clone().applyMatrix4(cam.matrixWorldInverse);
			if (!(view.z < -0.03)) return null;
			v.project(cam);
			if (!isFinite(v.x) || !isFinite(v.y)) return null;
			pts.push([(v.x * 0.5 + 0.5) * vw, (0.5 - v.y * 0.5) * vh]);
		}
		var area = 0;
		for (i = 0; i < 4; i++) {
			var a = pts[i], b = pts[(i + 1) % 4];
			area += a[0] * b[1] - b[0] * a[1];
		}
		if (area <= 0) return null;
		var wpx = Math.hypot(pts[1][0] - pts[0][0], pts[1][1] - pts[0][1]);
		if (wpx < 48) return null;
		return pts;
	}

	/* projective map of the unit square onto the four screen corners, poured
	 * straight into a css matrix3d */
	function quadMatrix(pts, w, h) {
		var x0 = pts[0][0], y0 = pts[0][1];
		var x1 = pts[1][0], y1 = pts[1][1];
		var x2 = pts[2][0], y2 = pts[2][1];
		var x3 = pts[3][0], y3 = pts[3][1];
		var dx1 = x1 - x2, dy1 = y1 - y2;
		var dx2 = x3 - x2, dy2 = y3 - y2;
		var sx = x0 - x1 + x2 - x3;
		var sy = y0 - y1 + y2 - y3;
		var den = dx1 * dy2 - dy1 * dx2;
		if (!isFinite(den) || Math.abs(den) < 1e-9) return null;
		var g = (sx * dy2 - dx2 * sy) / den;
		var q = (dx1 * sy - sx * dy1) / den;
		var a = x1 - x0 + g * x1;
		var b = x3 - x0 + q * x3;
		var c = x0;
		var d = y1 - y0 + g * y1;
		var e = y3 - y0 + q * y3;
		var f = y0;
		var m = [a, d, 0, g, b, e, 0, q, 0, 0, 1, 0, c, f, 0, 1];
		for (var i = 0; i < m.length; i++) if (!isFinite(m[i])) return null;
		return "matrix3d(" + m.join(",") + ") scale(" + (1 / w) + "," + (1 / h) + ")";
	}

	function stepMedia() {
		if (!media.layer) return;
		var want = state.mode === "3d" && three.ready && state.ui.screen && state.ui.media;
		var pts = want ? mediaCorners() : null;
		var tf = pts ? quadMatrix(pts, media.w, media.h) : null;
		if (!tf) {
			if (media.live) { media.layer.style.display = "none"; media.live = false; }
			return;
		}
		if (!media.live) { media.layer.style.display = "block"; media.live = true; }
		media.wrap.style.transform = tf;
	}

	/* -------------------------------------------------- 9. surfaces and loop */

	function buildHud() {
		hud = elm("div");
		hud.id = "sr-hud";
		function panel(id, w, h) {
			var el = elm("div", "sr-panel");
			el.id = id;
			var cvs = document.createElement("canvas");
			cvs.width = w;
			cvs.height = h;
			cvs.className = "sr-canvas";
			el.appendChild(cvs);
			hud.appendChild(el);
			return { el: el, canvas: cvs, ctx: cvs.getContext("2d"), mesh: null, tex: null, mat: null, at: 0 };
		}
		PANELS.cluster = panel("sr-cluster", 1024, 320);
		PANELS.screen = panel("sr-screen", 1024, 640);
		var toasts = elm("div");
		toasts.id = "sr-toasts";
		document.body.appendChild(hud);
		document.body.appendChild(toasts);
		applyLayout();
		applyVis();
	}

	function applyLayout() {
		["cluster", "screen"].forEach(function (k) {
			var p = PANELS[k], L = state.layout[k];
			if (!p || !L) return;
			var s = p.el.style;
			s.left = L.x + "%";
			s.top = L.y + "%";
			s.width = L.w + "vw";
			s.transform = "translate(-50%,-50%) perspective(900px) rotateX(" + L.rx + "deg) rotateY(" + L.ry + "deg)";
		});
	}

	function applyVis() {
		if (!hud) return;
		var in3d = state.mode === "3d" && three.ready;
		hud.classList.toggle("sr-3d", in3d);
		hud.classList.toggle("sr-editing", edit.on);
		["cluster", "screen"].forEach(function (k) {
			var p = PANELS[k];
			if (!p) return;
			var on = state.ui[k] !== false;
			p.el.classList.toggle("sr-off", !on);
			p.el.classList.toggle("sr-sel", edit.on && edit.sel === k);
			if (p.mesh) p.mesh.visible = on && in3d;
		});
		if (media.layer && !(state.ui.media && state.ui.screen && in3d)) {
			media.layer.style.display = "none";
			media.live = false;
		}
	}

	function setMode(m) {
		state.mode = m === "dom" ? "dom" : "3d";
		if (state.mode === "dom") {
			three.ready = false;
			["cluster", "screen"].forEach(function (k) {
				var p = PANELS[k];
				if (p && p.mesh) p.mesh.visible = false;
			});
			toast("overlay mode \u00b7 F9 back to in-car");
		} else {
			three.tries = 0;
			toast("looking for the cabin\u2026");
		}
		applyVis();
		saveLocal();
	}

	function paint(now) {
		var c = PANELS.cluster, s = PANELS.screen;
		if (c && state.ui.cluster !== false && now - c.at > 45) {
			c.at = now;
			drawCluster(c.ctx, c.canvas.width, c.canvas.height);
			if (c.tex) c.tex.needsUpdate = true;
		}
		if (s && state.ui.screen !== false && now - s.at > 110) {
			s.at = now;
			drawScreen(s.ctx, s.canvas.width, s.canvas.height);
			if (s.tex) s.tex.needsUpdate = true;
		}
	}

	var actx = null;
	function beep() {
		if (!CFG.sound) return;
		try {
			if (!actx) actx = new (window.AudioContext || window.webkitAudioContext)();
			var o = actx.createOscillator(), g = actx.createGain();
			o.type = "square";
			o.frequency.value = sig.phase ? 880 : 660;
			g.gain.value = 0.015;
			o.connect(g);
			g.connect(actx.destination);
			o.start();
			o.stop(actx.currentTime + 0.045);
		} catch (e) {}
	}

	var sigAt = 0;
	function sigTick(now) {
		if (!sig.left && !sig.right) { sig.phase = false; return; }
		if (now - sigAt < 420) return;
		sigAt = now;
		sig.phase = !sig.phase;
		if (sig.phase) beep();
	}

	var lastT = 0, saveAt = 0, dimAt = 0;
	function loop(ts) {
		requestAnimationFrame(loop);
		var now = ts || performance.now();
		var dt = lastT ? Math.min(0.25, (now - lastT) / 1000) : 0;
		lastT = now;
		try {
			setup3d(now);
			readTelemetry(dt, now);
			sigTick(now);
			paint(now);
			stepMedia();
			if (now - dimAt > 4000) { dimAt = now; applyHudDim(); }
			if (now - saveAt > 5000) { saveAt = now; saveLocal(); }
		} catch (e) {
			if (CFG.debug) console.error("[sr-mod]", e);
		}
	}

	function pressAutodrive() {
		["keydown", "keyup"].forEach(function (type) {
			var ev = new KeyboardEvent(type, { key: "z", code: "KeyZ", bubbles: true, cancelable: true });
			try {
				Object.defineProperty(ev, "keyCode", { get: function () { return 90; } });
				Object.defineProperty(ev, "which", { get: function () { return 90; } });
			} catch (e) {}
			ev.__sr = true;
			document.dispatchEvent(ev);
			window.dispatchEvent(ev);
		});
		toast("autodrive toggled");
	}

	function sceneTree(o, depth, max, out, pre) {
		out = out || [];
		pre = pre || "";
		if (!o || out.length >= (max || 120)) return out;
		var kind = o.isMesh ? "mesh" : (o.isScene ? "scene" : (o.isCamera ? "camera" : (o.isLight ? "light" : "node")));
		out.push(pre + kind + " " + (o.name || "(no name)") + (o.children && o.children.length ? " [" + o.children.length + "]" : ""));
		if (depth > 0 && o.children) {
			for (var i = 0; i < o.children.length && out.length < (max || 120); i++) sceneTree(o.children[i], depth - 1, max, out, pre + "  ");
		}
		return out;
	}

	function debugScan() {
		var parts = findParts();
		var info = {
			version: VER,
			mode: state.mode,
			ready: three.ready,
			tries: three.tries,
			three: three.T ? (three.T.REVISION || "harvested") : null,
			scenes: SCENES.length,
			renderers: RENDERERS.length,
			speedKph: telem.kph,
			source: telem.src,
			calib: state.calib,
			hudSpeed: dom.speed,
			hudDist: dom.dist,
			odoKm: state.odoKm,
			mediaLive: media.live,
			parts: {
				wheel: parts.wheel && parts.wheel.name,
				dash: parts.dash && parts.dash.name,
				inner: parts.inner && parts.inner.name
			},
			place: state.place
		};
		console.log("[sr-mod] scan", info);
		if (three.scene) console.log("[sr-mod] scene\n" + sceneTree(three.scene, 3, 140).join("\n"));
		toast("scan printed to console (F12)");
		return info;
	}

	/* ------------------------------------------------------------- 10. keys */

	function setEdit(on) {
		edit.on = !!on;
		applyVis();
		if (edit.on) toast("edit " + edit.sel + " \u00b7 arrows move \u00b7 -/= size \u00b7 [/] turn \u00b7 ;/' tilt \u00b7 ,/. depth \u00b7 d depth-test \u00b7 tab switch \u00b7 esc done");
		else { savePlace("cluster"); savePlace("screen"); toast("saved"); }
	}

	function editKey(k) {
		var w = edit.sel;
		if (state.mode === "dom") {
			var L = state.layout[w];
			if (k === "ArrowLeft") L.x -= 0.6;
			else if (k === "ArrowRight") L.x += 0.6;
			else if (k === "ArrowUp") L.y -= 0.6;
			else if (k === "ArrowDown") L.y += 0.6;
			else if (k === "-" || k === "_") L.w = clamp(L.w - 0.8, 6, 90);
			else if (k === "=" || k === "+") L.w = clamp(L.w + 0.8, 6, 90);
			else if (k === "[") L.ry -= 1.5;
			else if (k === "]") L.ry += 1.5;
			else if (k === ";") L.rx -= 1.5;
			else if (k === "'") L.rx += 1.5;
			else return false;
			applyLayout();
			saveLocal();
			return true;
		}
		if (k === "ArrowLeft") nudge(w, -1, 0, 0, 0, 0, 0);
		else if (k === "ArrowRight") nudge(w, 1, 0, 0, 0, 0, 0);
		else if (k === "ArrowUp") nudge(w, 0, 1, 0, 0, 0, 0);
		else if (k === "ArrowDown") nudge(w, 0, -1, 0, 0, 0, 0);
		else if (k === ",") nudge(w, 0, 0, -1, 0, 0, 0);
		else if (k === ".") nudge(w, 0, 0, 1, 0, 0, 0);
		else if (k === "-" || k === "_") nudge(w, 0, 0, 0, -1, 0, 0);
		else if (k === "=" || k === "+") nudge(w, 0, 0, 0, 1, 0, 0);
		else if (k === "[") nudge(w, 0, 0, 0, 0, -1, 0);
		else if (k === "]") nudge(w, 0, 0, 0, 0, 1, 0);
		else if (k === ";") nudge(w, 0, 0, 0, 0, 0, -1);
		else if (k === "'") nudge(w, 0, 0, 0, 0, 0, 1);
		else if (k === "d" || k === "D") {
			state.depth = !state.depth;
			applyDepth();
			saveLocal();
			toast("depth test " + (state.depth ? "on" : "off"));
		} else return false;
		return true;
	}

	function onKeyDown(e) {
		if (e.__sr) return;
		var t = e.target;
		if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
		if (e.ctrlKey || e.metaKey) return;
		var k = e.key;
		var eat = false;

		if (edit.on) {
			if (k === "Escape") { setEdit(false); eat = true; }
			else if (k === "Tab") { edit.sel = edit.sel === "cluster" ? "screen" : "cluster"; applyVis(); toast("editing " + edit.sel); eat = true; }
			else if (editKey(k)) eat = true;
		}

		if (!eat) {
			if (k === "z" || k === "Z") {
				if (!e.repeat) { sig.left = !sig.left; if (sig.left) { sig.right = false; sig.phase = true; sigAt = 0; } }
				eat = true;
			} else if (k === "x" || k === "X") {
				if (!e.repeat) { sig.right = !sig.right; if (sig.right) { sig.left = false; sig.phase = true; sigAt = 0; } }
				eat = true;
			} else if (k === "F2") { state.ui.cluster = !state.ui.cluster; applyVis(); saveLocal(); toast("cluster " + (state.ui.cluster ? "on" : "off")); eat = true; }
			else if (k === "F3") { setEdit(!edit.on); eat = true; }
			else if (k === "F4") {
				if (e.shiftKey) { state.ui.screen = !state.ui.screen; toast("centre screen " + (state.ui.screen ? "on" : "off")); }
				else {
					state.ui.media = !state.ui.media;
					if (state.ui.media) makeMediaFrame();
					toast("youtube " + (state.ui.media ? "on" : "off"));
				}
				applyVis();
				saveLocal();
				eat = true;
			} else if (k === "F5") { setInteract(!media.interact); toast(media.interact ? "screen is clickable \u00b7 F5 to give the mouse back" : "mouse back to driving"); eat = true; }
			else if (k === "F6") {
				if (state.mode === "3d") { state.place.cluster = null; state.place.screen = null; toast(weld3d() ? "re-welded to the cabin" : "nothing to weld to yet"); }
				else { state.layout = clone(DEF_LAYOUT); applyLayout(); toast("layout reset"); }
				saveLocal();
				eat = true;
			} else if (k === "F7") { pressAutodrive(); eat = true; }
			else if (k === "F8") { debugScan(); eat = true; }
			else if (k === "F9") { setMode(state.mode === "3d" ? "dom" : "3d"); eat = true; }
			else if (k === "F10") { state.hudDim = !state.hudDim; dom.hudEls = []; applyHudDim(); saveLocal(); toast("game hud " + (state.hudDim ? "faded" : "visible")); eat = true; }
		}

		if (eat) { e.preventDefault(); e.stopImmediatePropagation(); }
	}

	function onKeyUp(e) {
		if (e.__sr) return;
		var k = e.key;
		if (k === "z" || k === "Z" || k === "x" || k === "X" || /^F(2|3|4|5|6|7|8|9|10)$/.test(k) || (edit.on && k === "Tab")) {
			e.preventDefault();
			e.stopImmediatePropagation();
		}
	}

	function bindKeys() {
		window.addEventListener("keydown", onKeyDown, true);
		window.addEventListener("keyup", onKeyUp, true);
		document.addEventListener("keydown", onKeyDown, true);
		document.addEventListener("keyup", onKeyUp, true);
		window.addEventListener("beforeunload", function () { saveLocal(); remotePut(); });
		window.addEventListener("resize", applyLayout);
	}

	/* ---------------------------------------------------------- 11. api, init */

	window.SRMOD = {
		version: VER,
		cfg: CFG,
		state: state,
		three: three,
		panels: PANELS,
		telemetry: function () { return { kph: telem.kph, source: telem.src, calib: state.calib, hud: dom.speed, auto: telem.auto }; },
		setTelemetry: function (kph) { telem.override = kph == null ? null : Number(kph); },
		setCalib: function (v) { state.calib = Number(v) || state.calib; saveLocal(); },
		setEndpoint: function (url) {
			ENDPOINT = String(url || "").replace(/\/+$/, "");
			try { LS.setItem(K_EP, ENDPOINT); } catch (e) {}
			toast(ENDPOINT ? "server save on" : "server save off");
		},
		save: {
			now: function () { return remotePut(); },
			pull: function () { return remoteGet(); },
			export: exportSave,
			wipe: function () { try { LS.removeItem(K_STATE); } catch (e) {} location.reload(); }
		},
		mode: setMode,
		depth: function (on) { state.depth = !!on; applyDepth(); saveLocal(); },
		place: {
			redo: function () { state.place.cluster = null; state.place.screen = null; return weld3d(); },
			get: function () { return state.place; },
			reset: function () { state.place.cluster = null; state.place.screen = null; saveLocal(); location.reload(); }
		},
		layout: {
			edit: setEdit,
			get: function () { return state.layout; },
			reset: function () { state.layout = clone(DEF_LAYOUT); applyLayout(); saveLocal(); }
		},
		media: {
			play: setVideo,
			on: function () { state.ui.media = true; makeMediaFrame(); applyVis(); saveLocal(); },
			off: function () { state.ui.media = false; applyVis(); saveLocal(); },
			touch: setInteract,
			mute: function () { state.media.sound = false; ytCmd("mute"); saveLocal(); },
			unmute: function () { state.media.sound = true; ytCmd("unMute"); ytCmd("playVideo"); saveLocal(); },
			cmd: ytCmd
		},
		hudDim: function (on) { state.hudDim = !!on; dom.hudEls = []; applyHudDim(); saveLocal(); },
		toggleCluster: function () { state.ui.cluster = !state.ui.cluster; applyVis(); saveLocal(); },
		toggleScreen: function () { state.ui.screen = !state.ui.screen; applyVis(); saveLocal(); },
		autodrive: pressAutodrive,
		killJunk: killJunk,
		scan: debugScan
	};

	function init() {
		if (window.__SR_MOD__) return;
		window.__SR_MOD__ = VER;
		killJunk();
		watchJunk();
		buildHud();
		bindKeys();
		applyHudDim();
		requestAnimationFrame(loop);
		log("mod", VER, "ready, mode", state.mode);
	}

	bootSync();
	onReady(init);
})();
