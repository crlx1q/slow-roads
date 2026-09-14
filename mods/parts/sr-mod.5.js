
	/* ------------------------------------------- 12. v0.6.0 cabin rig layer
	 * The declarations below supersede the v0.5.0 placement code: function
	 * declarations hoist, so these are the bodies the mod actually runs.
	 *
	 * The mod no longer owns a single pixel of the viewport. The cluster and
	 * the centre screen are built as real geometry - shell with thickness,
	 * bezel lip, canvas face, glass pane - parented to the interior mesh of the
	 * car and laid out from that mesh's own local bounding box and from the
	 * steering wheel, so they follow the car, the seat and any future model
	 * without hand-tuned coordinates. The only dom left is the toast strip and
	 * the youtube iframe, and the iframe is warped every frame onto the
	 * projected corners of the screen mesh, which is what CSS3DRenderer does
	 * internally.
	 */

	VER = "0.6.0";

	var K_TUNE = "sr-mod:tune";
	var rig = {
		root: null, host: null, box: null, basis: null,
		eye: null, inside: false, how: "", ref: 0
	};

	function inv4(T, m) {
		var o = new T.Matrix4();
		o.copy(m);
		if (o.invert) return o.invert();
		if (o.getInverse) return o.getInverse(m);
		return null;
	}

	/* bounding box of a subtree expressed in that subtree's own local space:
	 * this is what lets everything be positioned in car coordinates instead of
	 * world or camera coordinates */
	function localBoxOf(host, budget) {
		var T = three.T;
		if (!T || !host || !host.traverse) return null;
		host.updateMatrixWorld && host.updateMatrixWorld(true);
		var toLocal = inv4(T, host.matrixWorld);
		if (!toLocal) return null;
		var min = new T.Vector3(Infinity, Infinity, Infinity);
		var max = new T.Vector3(-Infinity, -Infinity, -Infinity);
		var v = new T.Vector3(), m = new T.Matrix4();
		var seen = 0, cap = budget || 4000;
		host.traverse(function (o) {
			if (seen > cap || !o || o.__srPanel || o.__srLamp) return;
			var g = o.geometry, pos = g && g.attributes && g.attributes.position;
			if (!pos || !pos.count) return;
			var step = Math.max(1, Math.floor(pos.count / 220));
			m.copy(toLocal).multiply(o.matrixWorld);
			for (var i = 0; i < pos.count; i += step) {
				v.set(pos.getX(i), pos.getY(i), pos.getZ(i)).applyMatrix4(m);
				min.min(v);
				max.max(v);
				seen++;
			}
		});
		if (!isFinite(min.x) || !isFinite(max.x)) return null;
		return {
			min: min,
			max: max,
			size: max.clone().sub(min),
			ctr: min.clone().add(max).multiplyScalar(0.5)
		};
	}

	/* full extent of an axis-aligned box along an arbitrary direction */
	function extentAlong(box, dir) {
		return Math.abs(box.size.x * dir.x) + Math.abs(box.size.y * dir.y) + Math.abs(box.size.z * dir.z);
	}

	/* car axes inside the host's local space. Up is world up pulled into local
	 * space, so the panels are always level with the car; forward is the long
	 * horizontal axis of the interior box, and its sign comes from the camera
	 * or from the steering wheel rather than from a guess. */
	function cabinBasis(host, box) {
		var T = three.T, cam = three.camera;
		var toLocal = inv4(T, host.matrixWorld);
		if (!toLocal) return null;
		var up = new T.Vector3(0, 1, 0).transformDirection(toLocal).normalize();
		if (!isFinite(up.x) || up.lengthSq() < 0.5) up.set(0, 1, 0);
		var ax = [new T.Vector3(1, 0, 0), new T.Vector3(0, 1, 0), new T.Vector3(0, 0, 1)];
		var ext = [box.size.x, box.size.y, box.size.z];
		var fwd = null, reach = -1;
		for (var i = 0; i < 3; i++) {
			var h = ax[i].clone().sub(up.clone().multiplyScalar(ax[i].dot(up)));
			var len = h.length();
			if (len < 1e-4) continue;
			var r = ext[i] * len;
			if (r > reach) { reach = r; fwd = h.normalize(); }
		}
		if (!fwd) return null;
		var eye = null;
		if (cam && cam.getWorldPosition) {
			eye = new T.Vector3();
			cam.getWorldPosition(eye);
			eye.applyMatrix4(toLocal);
		}
		var s = 0;
		if (cam && cam.getWorldDirection) {
			var d = new T.Vector3();
			cam.getWorldDirection(d);
			d.transformDirection(toLocal).normalize();
			var dot = d.dot(fwd);
			if (Math.abs(dot) > 0.3) s = dot > 0 ? 1 : -1;
		}
		if (!s) {
			var w = findParts().wheel;
			if (w && w.getWorldPosition) {
				var wp = new T.Vector3();
				w.getWorldPosition(wp);
				wp.applyMatrix4(toLocal);
				var dw = wp.clone().sub(box.ctr).dot(fwd);
				if (Math.abs(dw) > 1e-5) s = dw > 0 ? 1 : -1;
			}
		}
		if (!s) s = 1;
		fwd.multiplyScalar(s);
		var right = new T.Vector3().crossVectors(fwd, up).normalize();
		return { up: up, fwd: fwd, right: right, eye: eye };
	}

	/* ------------------------------------------------ panel as a real object */

	function panelTexture(p) {
		var T = three.T;
		var tex = T.CanvasTexture ? new T.CanvasTexture(p.canvas) : new T.Texture(p.canvas);
		tex.needsUpdate = true;
		if (T.LinearFilter != null) { tex.minFilter = T.LinearFilter; tex.magFilter = T.LinearFilter; }
		tex.generateMipmaps = false;
		if (T.SRGBColorSpace) tex.colorSpace = T.SRGBColorSpace;
		return tex;
	}

	/* the readouts are a lit display, not a decal: emissive standard material
	 * when the renderer has one so the panel glows in shadow and still takes
	 * the scene's lighting on its bezel */
	function faceMaterial(T, tex) {
		try {
			if (T.MeshStandardMaterial) {
				var m = new T.MeshStandardMaterial({
					map: tex,
					emissiveMap: tex,
					roughness: 0.26,
					metalness: 0,
					toneMapped: false
				});
				if (T.Color) m.emissive = new T.Color(0xffffff);
				m.emissiveIntensity = 1.15;
				return m;
			}
		} catch (e) {}
		return new T.MeshBasicMaterial({ map: tex, toneMapped: false });
	}

	function shellMaterial(T) {
		try {
			if (T.MeshStandardMaterial) return new T.MeshStandardMaterial({ color: 0x0a0c0f, roughness: 0.52, metalness: 0.22 });
		} catch (e) {}
		return new T.MeshBasicMaterial({ color: 0x0a0c0f });
	}

	function glassMaterial(T) {
		try {
			if (T.MeshPhysicalMaterial) {
				var g = new T.MeshPhysicalMaterial({
					color: 0xffffff, transparent: true, opacity: 0.1,
					roughness: 0.05, metalness: 0
				});
				if ("clearcoat" in g) g.clearcoat = 1;
				if (three.scene && three.scene.environment) g.envMap = three.scene.environment;
				return g;
			}
			if (T.MeshStandardMaterial) return new T.MeshStandardMaterial({ color: 0xffffff, transparent: true, opacity: 0.08, roughness: 0.07, metalness: 0 });
		} catch (e) {}
		return null;
	}

	function boxGeo(T, w, h, d) {
		var G = T.BoxGeometry || T.BoxBufferGeometry;
		return G ? new G(w, h, d) : planeGeo(T, w, h);
	}

	/* unit-width panel: shell with real thickness, bezel lip, canvas face a
	 * hair in front of it, glass pane over that. Scaled to car units later. */
	function make3d(which) {
		var T = three.T, p = PANELS[which];
		if (!T || !p) return null;
		if (p.mesh) return p.mesh;
		var h = p.canvas.height / p.canvas.width;
		var d = which === "cluster" ? 0.11 : 0.065;
		var lip = 0.055 * h;
		var group = new (T.Group || T.Object3D)();
		group.name = "sr-" + which;
		group.__srPanel = which;

		var shell = new T.Mesh(boxGeo(T, 1 + lip, h + lip, d), shellMaterial(T));
		shell.name = "sr-" + which + "-shell";
		shell.__srPanel = which;
		shell.position.z = -d / 2;
		group.add(shell);

		var tex = panelTexture(p);
		var mat = faceMaterial(T, tex);
		var face = new T.Mesh(planeGeo(T, 1, h), mat);
		face.name = "sr-" + which + "-face";
		face.__srPanel = which;
		face.position.z = 0.002 * h;
		group.add(face);

		var gm = glassMaterial(T);
		if (gm) {
			var glass = new T.Mesh(planeGeo(T, 1 + lip * 0.4, h + lip * 0.4), gm);
			glass.name = "sr-" + which + "-glass";
			glass.__srPanel = which;
			glass.position.z = 0.007 * h;
			glass.renderOrder = 3;
			group.add(glass);
			p.glass = glass;
		}

		p.mesh = group;
		p.face = face;
		p.shell = shell;
		p.tex = tex;
		p.mat = mat;
		return group;
	}

	/* ------------------------------------- saved offsets from the computed fit */

	function tuneLoad() {
		try {
			var t = JSON.parse(LS.getItem(K_TUNE) || "null");
			if (t && typeof t === "object") return t;
		} catch (e) {}
		return {};
	}

	var TUNE = tuneLoad();

	function tuneOf(which) {
		if (!TUNE[which]) TUNE[which] = { dx: 0, dy: 0, dz: 0, scale: 1, yaw: 0, pitch: 0 };
		return TUNE[which];
	}

	function tuneSave() {
		try { LS.setItem(K_TUNE, JSON.stringify(TUNE)); } catch (e) {}
	}

	/* tuning is kept as an offset from the computed mount, never as an absolute
	 * transform, so it survives a re-fit, a car swap or a seat change */
	function applyTune(which) {
		var p = PANELS[which];
		if (!p || !p.mesh || !p.base) return;
		var g = p.mesh, t = tuneOf(which), b = p.base;
		var s = b.scale * (t.scale || 1);
		g.position.copy(b.pos);
		g.quaternion.copy(b.quat);
		g.scale.set(s, s, s);
		if (t.yaw) g.rotateY(t.yaw);
		if (t.pitch) g.rotateX(t.pitch);
		if (t.dx) g.translateX(t.dx * b.scale);
		if (t.dy) g.translateY(t.dy * b.scale);
		if (t.dz) g.translateZ(t.dz * b.scale);
		g.updateMatrixWorld && g.updateMatrixWorld(true);
	}

	function cabinFallback() {
		var c = null;
		try { c = findCabin(); } catch (e) {}
		if (!c) return null;
		if (c.isObject3D || c.traverse) return c;
		return c.mesh || c.obj || c.node || c.target || null;
	}

	/* where the rig lives: the dashboard mesh when the game names one, then the
	 * interior model, then the densest cabin geometry around the eye point */
	function cabinHost() {
		var parts = findParts();
		if (parts.dash) { rig.how = "dashboard mesh"; return parts.dash; }
		if (parts.inner) { rig.how = "interior mesh"; return parts.inner; }
		var m = cabinFallback();
		if (m) { rig.how = "nearest cabin geometry"; return m; }
		return null;
	}

	function mountPanel(which, pos, width, look, b) {
		var T = three.T, g = make3d(which);
		if (!g || !rig.root) return false;
		if (g.parent) g.parent.remove(g);
		rig.root.add(g);
		g.position.copy(pos);
		var n = look.clone().sub(pos);
		if (n.lengthSq() < 1e-9) n.copy(b.fwd).multiplyScalar(-1);
		n.normalize();
		var right = new T.Vector3().crossVectors(b.up, n);
		if (right.lengthSq() < 1e-9) right.copy(b.right);
		right.normalize();
		var up = new T.Vector3().crossVectors(n, right).normalize();
		var m = new T.Matrix4();
		m.makeBasis(right, up, n);
		g.quaternion.setFromRotationMatrix(m);
		g.scale.set(width, width, width);
		PANELS[which].base = { pos: g.position.clone(), quat: g.quaternion.clone(), scale: width };
		applyTune(which);
		return true;
	}

	/* the whole fit in one place: local box of the interior, car axes, the
	 * steering wheel as the driver-side anchor, everything sized from the wheel
	 * radius so a different model or a moved seat still lands correctly */
	function buildCabinRig() {
		var T = three.T;
		if (!T || !three.scene) { three.why = "no scene yet"; return false; }
		var host = cabinHost();
		if (!host || !host.add) { three.why = "no interior mesh"; return false; }
		var box = localBoxOf(host, 6000);
		if (!box) { three.why = "interior has no geometry"; return false; }
		var b = cabinBasis(host, box);
		if (!b) { three.why = "cannot read car axes"; return false; }
		var L = extentAlong(box, b.fwd), W = extentAlong(box, b.right), H = extentAlong(box, b.up);
		if (!(L > 0) || !(W > 0)) { three.why = "interior box is degenerate"; return false; }

		var toLocal = inv4(T, host.matrixWorld);
		var wheel = findParts().wheel;
		var wl = null, wheelR = 0;
		if (wheel && toLocal && wheel.getWorldPosition) {
			wl = new T.Vector3();
			wheel.getWorldPosition(wl);
			wl.applyMatrix4(toLocal);
			var wb = localBoxOf(wheel, 1500);
			if (wb) wheelR = Math.max(wb.size.x, wb.size.y, wb.size.z) * 0.5;
		}
		var eye = b.eye;
		var ref = wheelR > 1e-5 ? wheelR : Math.min(W, H) * 0.42;
		if (!(ref > 0)) { three.why = "cannot size the cabin"; return false; }

		var sideRef = wl || eye;
		var side = sideRef ? (sideRef.clone().sub(box.ctr).dot(b.right) >= 0 ? 1 : -1) : -1;

		var base;
		if (wl) base = wl.clone();
		else if (eye) base = eye.clone().addScaledVector(b.fwd, ref * 1.7).addScaledVector(b.up, -ref * 0.55);
		else base = box.ctr.clone().addScaledVector(b.fwd, L * 0.26).addScaledVector(b.right, side * W * 0.24).addScaledVector(b.up, H * 0.08);

		if (rig.root && rig.root.parent) rig.root.parent.remove(rig.root);
		rig.root = new (T.Group || T.Object3D)();
		rig.root.name = "sr-cabin-rig";
		host.add(rig.root);
		host.updateMatrixWorld && host.updateMatrixWorld(true);

		var cPos = base.clone().addScaledVector(b.fwd, ref * 0.72).addScaledVector(b.up, ref * 0.06);
		var sPos = base.clone()
			.addScaledVector(b.right, -side * ref * 2.15)
			.addScaledVector(b.fwd, ref * 0.5)
			.addScaledVector(b.up, ref * 0.2);
		var latMax = W * 0.34;
		var lat = sPos.clone().sub(box.ctr).dot(b.right);
		if (Math.abs(lat) > latMax) sPos.addScaledVector(b.right, (lat > 0 ? latMax : -latMax) - lat);

		var look = eye || base.clone().addScaledVector(b.fwd, -ref * 3).addScaledVector(b.up, ref * 1.1);
		var okc = mountPanel("cluster", cPos, ref * 1.95, look, b);
		var oks = mountPanel("screen", sPos, ref * 1.8, look, b);
		if (!okc && !oks) { three.why = "panel meshes unavailable"; return false; }

		rig.host = host;
		rig.box = box;
		rig.basis = b;
		rig.eye = eye;
		rig.ref = ref;
		three.anchor = host;
		three.how = rig.how + (wl ? " + steering wheel" : (eye ? " + eye point" : " + box only"));
		applyDepth();
		if (!lamps.list.length) { try { buildLamps(host); } catch (e) { log("lamps failed", e); } }
		updateInside();
		log("rig on", host.name || "(unnamed)", "ref", ref, "LWH", L, W, H);
		return true;
	}

	function weld3d() { return buildCabinRig(); }

	/* first person test: is the camera inside the cabin box. Used to keep the
	 * youtube surface from showing when the car is viewed from outside. */
	function updateInside() {
		var T = three.T;
		if (!T || !rig.host || !rig.box || !three.camera || !three.camera.getWorldPosition) { rig.inside = false; return; }
		var m = inv4(T, rig.host.matrixWorld);
		if (!m) { rig.inside = false; return; }
		var p = new T.Vector3();
		three.camera.getWorldPosition(p);
		p.applyMatrix4(m);
		var box = rig.box;
		var pad = Math.max(box.size.x, box.size.y, box.size.z) * 0.3;
		rig.inside = p.x > box.min.x - pad && p.x < box.max.x + pad &&
			p.y > box.min.y - pad && p.y < box.max.y + pad &&
			p.z > box.min.z - pad && p.z < box.max.z + pad;
	}

	function setup3d(now) {
		if (three.ready) { updateInside(); return; }
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
		three.camera = findCamera() || three.camera;
		if (!three.camera) { three.why = "no camera"; return; }
		if (!buildCabinRig()) return;
		three.ready = true;
		three.why = "";
		state.mode = "3d";
		applyVis();
		if (!media.layer) makeMediaFrame();
		toast("cabin rig on " + (rig.host.name || "interior") + " | F6 refit | F3 nudge | F4 youtube");
	}

	/* ------------------------------------------------ dom-free hud surfaces */

	/* the canvases stay in memory as texture sources only: `hud` is built but
	 * deliberately never appended to the document, so the mod cannot cover the
	 * game even by accident */
	function buildHud() {
		hud = elm("div");
		hud.id = "sr-hud";
		hud.style.display = "none";
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
		document.body.appendChild(toasts);
		applyVis();
	}

	function applyVis() {
		var in3d = three.ready;
		["cluster", "screen"].forEach(function (k) {
			var p = PANELS[k];
			if (!p || !p.mesh) return;
			p.mesh.visible = state.ui[k] !== false && in3d;
		});
		if (media.layer && !(state.ui.media && state.ui.screen && in3d)) {
			media.layer.style.display = "none";
			media.live = false;
		}
	}

	/* there is no overlay mode any more: the panels are cabin geometry or they
	 * are nothing at all. F9 now means "forget the fit and hunt again". */
	function setMode(m) {
		state.mode = "3d";
		if (m === "dom") toast("overlay mode removed | panels live in the car");
		three.ready = false;
		three.tries = 0;
		three.probeAt = 0;
		three.why = "refitting";
		saveLocal();
	}

	function applyDepth() {
		["cluster", "screen"].forEach(function (k) {
			var p = PANELS[k];
			if (!p || !p.mesh || !p.mesh.traverse) return;
			p.mesh.traverse(function (o) {
				if (!o.material) return;
				o.material.depthTest = state.depth !== false;
				o.material.needsUpdate = true;
			});
		});
	}

	function nudge(which, dx, dy, dz, ds, dyaw, dpitch) {
		var p = PANELS[which];
		if (!p || !p.mesh || !p.base) return;
		var t = tuneOf(which);
		if (dx) t.dx += dx * 0.03;
		if (dy) t.dy += dy * 0.03;
		if (dz) t.dz += dz * 0.02;
		if (ds) t.scale = clamp((t.scale || 1) * (1 + ds * 0.06), 0.15, 6);
		if (dyaw) t.yaw += dyaw * 0.035;
		if (dpitch) t.pitch += dpitch * 0.035;
		applyTune(which);
		tuneSave();
	}

	function savePlace(which) { tuneSave(); }

	/* nothing to restore by hand: the fit is recomputed from the car and the
	 * saved offsets are re-applied inside mountPanel */
	function applyPlace(which) { return false; }

	/* lamps and every other rig-relative sum use the car's axes now instead of
	 * the camera's, so they stay correct wherever the driver is looking */
	function rigBasis() {
		var T = three.T, host = rig.host, b = rig.basis;
		if (host && b) {
			host.updateMatrixWorld && host.updateMatrixWorld(true);
			var m = host.matrixWorld;
			var fwd = b.fwd.clone().transformDirection(m).normalize();
			var up = b.up.clone().transformDirection(m).normalize();
			var right = new T.Vector3().crossVectors(fwd, up).normalize();
			var q = new T.Quaternion();
			q.setFromRotationMatrix(new T.Matrix4().makeBasis(right, up, fwd.clone().multiplyScalar(-1)));
			return { q: q, fwd: fwd, up: up, right: right };
		}
		var cam = three.camera, q2 = new T.Quaternion();
		if (cam && cam.getWorldQuaternion) cam.getWorldQuaternion(q2);
		return {
			q: q2,
			fwd: new T.Vector3(0, 0, -1).applyQuaternion(q2),
			up: new T.Vector3(0, 1, 0).applyQuaternion(q2),
			right: new T.Vector3(1, 0, 0).applyQuaternion(q2)
		};
	}

	/* ------------------------------------------------- youtube on the screen */

	function ytSrc(id) {
		var list = id.length > 16 ? "&listType=playlist&list=" + encodeURIComponent(id) : "";
		var org = "";
		try {
			if (location.origin && location.origin.indexOf("http") === 0) org = "&origin=" + encodeURIComponent(location.origin);
		} catch (e) {}
		return "https://www.youtube-nocookie.com/embed/" + encodeURIComponent(id) +
			"?autoplay=1&mute=1&playsinline=1&controls=1&rel=0&modestbranding=1&iv_load_policy=3&enablejsapi=1" + list + org;
	}

	/* the four corners of the display area, read off the screen face mesh and
	 * projected through the game camera. That is the same maths CSS3DRenderer
	 * runs, so the player is a surface inside the car, not a panel on the
	 * glass: it is only shown while the camera is inside the cabin and the
	 * face is turned towards it. */
	function mediaCorners() {
		var T = three.T, cam = three.camera, p = PANELS.screen;
		var face = p && p.face;
		if (!T || !cam || !face || !face.parent || !cam.matrixWorldInverse) return null;
		if (!p.mesh || !p.mesh.visible || !rig.inside) return null;
		var h = p.canvas.height / p.canvas.width;
		face.updateMatrixWorld && face.updateMatrixWorld(true);
		var ctr = new T.Vector3(0, 0, 0);
		face.localToWorld(ctr);
		var nrm = new T.Vector3(0, 0, 1).transformDirection(face.matrixWorld).normalize();
		var eye = new T.Vector3();
		cam.getWorldPosition(eye);
		if (nrm.dot(eye.clone().sub(ctr).normalize()) < 0.12) return null;
		var uv = [
			[MEDIA_UV.x0, MEDIA_UV.y0], [MEDIA_UV.x1, MEDIA_UV.y0],
			[MEDIA_UV.x1, MEDIA_UV.y1], [MEDIA_UV.x0, MEDIA_UV.y1]
		];
		var vw = window.innerWidth, vh = window.innerHeight;
		var pts = [], i, v, view;
		for (i = 0; i < 4; i++) {
			v = new T.Vector3(uv[i][0] - 0.5, (0.5 - uv[i][1]) * h, 0.012 * h);
			face.localToWorld(v);
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
		if (Math.hypot(pts[1][0] - pts[0][0], pts[1][1] - pts[0][1]) < 40) return null;
		return pts;
	}

	function domMediaTransform() { return null; }

	function stepMedia() {
		if (!media.layer) return;
		var on = state.ui.media && state.ui.screen && three.ready && !dom.paused;
		var pts = on ? mediaCorners() : null;
		var tf = pts ? quadMatrix(pts, media.w, media.h) : null;
		if (!tf) {
			if (media.live) { media.layer.style.display = "none"; media.live = false; }
			return;
		}
		if (!media.live) { media.layer.style.display = "block"; media.live = true; }
		media.wrap.style.transform = tf;
	}

	/* ---------------------------------------------------------- 13. rig api */

	if (window.SRMOD) {
		window.SRMOD.version = VER;
		window.SRMOD.refit = function () { return weld3d(); };
		window.SRMOD.rig = function () {
			var out = {
				version: VER,
				host: rig.host ? (rig.host.name || "(unnamed)") : null,
				how: three.how,
				why: three.why,
				ref: rig.ref,
				inside: rig.inside,
				ready: three.ready,
				mediaLive: !!media.live,
				tune: TUNE
			};
			["cluster", "screen"].forEach(function (k) {
				var p = PANELS[k];
				if (!p || !p.mesh) return;
				out[k] = {
					parent: p.mesh.parent ? (p.mesh.parent.name || "(unnamed)") : null,
					local: p.mesh.position.toArray().map(function (n) { return Math.round(n * 1000) / 1000; }),
					width: p.base ? p.base.scale : null,
					visible: !!p.mesh.visible
				};
			});
			console.log("[sr-mod] rig", out);
			return out;
		};
		window.SRMOD.tune = {
			get: function () { return TUNE; },
			reset: function (which) {
				if (which) delete TUNE[which];
				else TUNE = {};
				tuneSave();
				return weld3d();
			}
		};
	}

	bootSync();
	onReady(init);
})();
