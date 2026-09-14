/* slow-roads mod layer v0.5.0
 * The cluster and the centre display are welded into the car model itself:
 * the mod hunts down the game's three.js scene, measures the cabin geometry
 * around the driver and parents canvas panels to it. Turn signals blink on
 * the body of the car and the centre display runs a real YouTube player.
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

	var VER = "0.5.0";
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
		screen: { x: 78, y: 78, w: 22, rx: 6, ry: 0 }
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
		/* mode is deliberately not restored: v0.4.0 could persist the overlay
		 * fallback and then never look for the car again on later visits */
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

	var dom = { at: 0, speed: null, dist: null, unit: "kph", lastDist: null, hudEls: [], hudAt: 0, paused: false };
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
		/* the title screen is a dom overlay of the game: our panels and the
		 * video have no business floating above it */
		dom.paused = /endless driving zen/i.test(txt);
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
		setFont(c, 19, 400);
		c.textAlign = "left";
		if (!three.ready) {
			c.fillStyle = "rgba(255,196,86,0.6)";
			c.fillText("OVERLAY \u00b7 " + (three.why || "looking for the car"), 46, 284);
		} else if (CFG.debug || edit.on) {
			c.fillStyle = "rgba(232,246,252,0.3)";
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
	var three = { T: null, scene: null, camera: null, renderer: null, ready: false, tries: 0, probeAt: 0, why: "", how: "", anchor: null, protoPatched: false };

	function looksLikeTHREE(ex) {
		return !!(ex && ex.Mesh && ex.Vector3 && ex.Scene && ex.PerspectiveCamera);
	}

	/* the game never exports three, so borrow it from the webpack cache. The
	 * old check demanded REVISION and Raycaster and found nothing in this
	 * build, which is exactly why the mod kept falling back to the overlay */
	function harvestTHREE() {
		if (three.T) return three.T;
		if (looksLikeTHREE(window.THREE)) { three.T = window.THREE; return three.T; }
		var keys = Object.keys(window).filter(function (k) { return /^webpackJsonp/.test(k); });
		for (var i = 0; i < keys.length; i++) {
			var arr = window[keys[i]];
			if (!arr || typeof arr.push !== "function") continue;
			var req = null;
			try {
				arr.push([["sr-mod-chunk-" + i], { "sr-mod-probe": function (m, e, r) { req = r; } }, [["sr-mod-probe"]]]);
			} catch (e) {}
			if (!req || !req.c) continue;
			var cache = req.c;
			for (var id in cache) {
				var ex = cache[id] && cache[id].exports;
				if (looksLikeTHREE(ex)) { three.T = ex; return ex; }
				if (ex && looksLikeTHREE(ex.default)) { three.T = ex.default; return three.T; }
			}
		}
		return null;
	}

	/* with the namespace in hand the renderer itself hands us the scene and the
	 * camera on every frame: no devtools hook, no guessing */
	function patchProto() {
		var T = three.T;
		if (!T || three.protoPatched) return;
		var R = T.WebGLRenderer;
		if (!R || !R.prototype || typeof R.prototype.render !== "function") return;
		three.protoPatched = true;
		if (R.prototype.__srPatched) return;
		R.prototype.__srPatched = true;
		var orig = R.prototype.render;
		R.prototype.render = function (scene, camera) {
			try {
				if (scene && scene.isScene) {
					if (SCENES.indexOf(scene) < 0) SCENES.push(scene);
					var cur = three.scene;
					var better = !cur || !cur.children || (scene.children && scene.children.length >= cur.children.length);
