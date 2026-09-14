		g.addColorStop(0.32, "rgba(255,164,44,0.9)");
		g.addColorStop(1, "rgba(255,120,0,0)");
		c.fillStyle = g;
		c.fillRect(0, 0, 64, 64);
		var tex = T.CanvasTexture ? new T.CanvasTexture(cvs) : new T.Texture(cvs);
		tex.needsUpdate = true;
		lamps.tex = tex;
		return tex;
	}

	/* climb from the anchor to the whole car, but stop before the world */
	function carRoot(anchor) {
		var node = anchor, best = anchor;
		var span0 = spanOf(worldBox(anchor, 800)) || 1;
		for (var i = 0; i < 4 && node.parent && node.parent !== three.scene; i++) {
			node = node.parent;
			var bx = worldBox(node, 2600);
			if (!bx) break;
			if (spanOf(bx) > span0 * 16) break;
			best = node;
		}
		return best;
	}

	function makeLamp(side) {
		var T = three.T;
		var mat = new T.MeshBasicMaterial({
			map: lampTexture(),
			transparent: true,
			depthWrite: false,
			depthTest: true,
			toneMapped: false,
			side: T.DoubleSide != null ? T.DoubleSide : 2
		});
		if (T.AdditiveBlending != null) mat.blending = T.AdditiveBlending;
		var m = new T.Mesh(planeGeo(T, 1, 1), mat);
		m.name = "sr-lamp-" + side;
		m.__srLamp = side;
		m.frustumCulled = false;
		m.renderOrder = 992;
		m.visible = false;
		return m;
	}

	/* six blinkers measured off the car's own bounding box: front pair, rear
	 * pair and side repeaters, parented to the car so they ride with it */
	function buildLamps(anchor) {
		var T = three.T;
		if (!T || lamps.list.length || !anchor) return;
		var root = carRoot(anchor);
		if (!root || !root.add) return;
		var box = worldBox(root, 6000);
		if (!box) return;
		var b = rigBasis();
		function ext(dir) {
			return 0.5 * (Math.abs(box.size.x * dir.x) + Math.abs(box.size.y * dir.y) + Math.abs(box.size.z * dir.z));
		}
		var L = ext(b.fwd), Wd = ext(b.right), Hh = ext(b.up);
		if (!(L > 0) || !(Wd > 0)) return;
		var size = Math.max(Wd, L) * 0.15;
		var as = new T.Vector3(1, 1, 1);
		if (root.getWorldScale) root.getWorldScale(as);
		var k = Math.abs(as.x) > 1e-6 ? Math.abs(as.x) : 1;
		var spots = [
			["left", 0.95, -0.82, -0.05],
			["right", 0.95, 0.82, -0.05],
			["left", -0.97, -0.80, 0.02],
			["right", -0.97, 0.80, 0.02],
			["left", 0.28, -1.0, -0.04],
			["right", 0.28, 1.0, -0.04]
		];
		spots.forEach(function (s) {
			var m = makeLamp(s[0]);
			var world = box.ctr.clone()
				.addScaledVector(b.fwd, L * s[1])
				.addScaledVector(b.right, Wd * s[2])
				.addScaledVector(b.up, Hh * s[3]);
			root.add(m);
			var local = world.clone();
			if (root.worldToLocal) root.worldToLocal(local);
			m.position.copy(local);
			var sc = size / k;
			m.scale.set(sc, sc, sc);
			lamps.list.push(m);
		});
		lamps.root = root;
		log("lamps mounted on", root.name || "(car)", lamps.list.length);
	}

	function stepLamps() {
		if (!lamps.list.length) return;
		var T = three.T, cam = three.camera;
		var eye = null;
		if (T && cam) { eye = new T.Vector3(); cam.getWorldPosition(eye); }
		for (var i = 0; i < lamps.list.length; i++) {
			var m = lamps.list[i];
			var on = m.__srLamp === "left" ? (sig.left && sig.phase) : (sig.right && sig.phase);
			m.visible = !!on;
			if (on && eye && m.lookAt) { try { m.lookAt(eye); } catch (e) {} }
		}
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

	/* the hunt never gives up any more: v0.4.0 switched to the overlay for
	 * good after twelve seconds and saved that choice, which is why the panels
	 * stayed glued on top of the game */
	function setup3d(now) {
		if (three.ready || state.mode !== "3d") return;
		if (now - three.probeAt < (three.tries < 40 ? 250 : 1500)) return;
		three.probeAt = now;
		three.tries++;
		if (!three.T) harvestTHREE();
		patchProto();
		patchRenderers();
		if (!three.scene) three.scene = pickScene();
		if (!three.scene && three.tries % 8 === 0) scanWindow();
		if (!three.scene) { three.why = "no scene yet"; return; }
		if (!three.T) harvestFromScene();
		if (!three.T) { three.why = "three not reachable"; return; }
		three.camera = findCamera();
		if (!three.camera) { three.why = "no camera"; return; }
		var ok = applyPlace("cluster");
		var ok2 = applyPlace("screen");
		if (!ok || !ok2) ok = weld3d() || ok;
		if (!ok) { three.why = "no cabin geometry"; return; }
		three.ready = true;
		three.why = "";
		applyDepth();
		applyVis();
		makeMediaFrame();
		if (!lamps.list.length && three.anchor) buildLamps(three.anchor);
		toast("panels welded onto the car (" + three.how + ") \u00b7 look ahead + F6 to refit \u00b7 F3 to nudge");
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

	/* overlay mode has no quad to warp onto, so the player is parked over the
	 * media window of the dom panel instead: youtube works either way */
	function domMediaTransform() {
		var p = PANELS.screen;
		if (!p || !p.canvas || !p.el || p.el.classList.contains("sr-off")) return null;
		var r = p.canvas.getBoundingClientRect();
		if (!r || r.width < 80) return null;
		var x = r.left + MEDIA_UV.x0 * r.width;
		var y = r.top + MEDIA_UV.y0 * r.height;
		var w = (MEDIA_UV.x1 - MEDIA_UV.x0) * r.width;
		var h = (MEDIA_UV.y1 - MEDIA_UV.y0) * r.height;
		if (!(w > 40) || !(h > 24)) return null;
		return "translate(" + x + "px," + y + "px) scale(" + (w / media.w) + "," + (h / media.h) + ")";
	}

	function stepMedia() {
		if (!media.layer) return;
		var on = state.ui.media && state.ui.screen && !dom.paused;
		var tf = null;
		if (on && three.ready && state.mode === "3d") {
			var pts = mediaCorners();
			tf = pts ? quadMatrix(pts, media.w, media.h) : null;
		} else if (on) {
			tf = domMediaTransform();
		}
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
