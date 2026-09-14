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
			stepLamps();
			paint(now);
			stepMedia();
			if (hud) hud.classList.toggle("sr-paused", !!dom.paused);
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
			how: three.how || null,
			why: three.why,
			anchor: three.anchor && (three.anchor.name || three.anchor.type),
			lamps: lamps.list.length,
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
		scan: debugScan,
		diag: function () {
			return {
				version: VER,
				welded: three.ready,
				how: three.how || null,
				why: three.why,
				anchor: three.anchor && (three.anchor.name || three.anchor.type),
				lamps: lamps.list.length,
				media: { live: media.live, id: state.media.id },
				scenes: SCENES.length,
				renderers: RENDERERS.length,
				three: three.T ? (three.T.REVISION || "harvested") : null,
				tries: three.tries
			};
		},
		hunt: function () { three.ready = false; three.tries = 0; three.probeAt = 0; return "hunting"; },
		lamps: function () { return lamps.list.length; }
	};

	function init() {
		if (window.__SR_MOD__) return;
		window.__SR_MOD__ = VER;
		killJunk();
		watchJunk();
		buildHud();
		bindKeys();
		applyHudDim();
		makeMediaFrame();
		requestAnimationFrame(loop);
		setTimeout(function () {
			if (!three.ready) toast("car not found yet (" + (three.why || "searching") + ") \u00b7 press F8 and send the log");
		}, 15000);
		log("mod", VER, "ready, mode", state.mode);
	}

	bootSync();
	onReady(init);
})();
