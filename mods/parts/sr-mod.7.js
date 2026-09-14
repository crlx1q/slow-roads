
	/* ------------------------------------ 14. v0.6.2 nameless car finder */

	/* the fork's scene has no object names at all: every node prints as
	 * "(no name)", so every name regex above finds nothing. The car is found
	 * here by behaviour instead: the node the camera hangs on, or the node that
	 * moves exactly like the camera, or the vehicle sized box the camera sits
	 * inside. The travel direction also gives the forward axis for free. */

	VER = "0.6.2";

	var car = {
		node: null,
		how: "",
		why: "looking for the car",
		heading: null,
		meshes: 0,
		span: 0,
		cands: 0,
		scans: 0,
		moved: 0,
		probe: { at: 0, list: null, pos: null, cam: null },
		parts: null,
		partsAt: 0
	};

	function nodePos(o, T) {
		var v = new T.Vector3();
		if (o.matrixWorld) v.setFromMatrixPosition(o.matrixWorld);
		else if (o.getWorldPosition) o.getWorldPosition(v);
		return v;
	}

	function meshCount(o) {
		var n = 0;
		if (!o || !o.traverse) return 0;
		o.traverse(function (c) {
			if (c && c.isMesh && !c.__srPanel && !c.__srLamp) n++;
		});
		return n;
	}

	function carCandidates() {
		var sc = three.scene, out = [];
		if (!sc || !sc.children) return out;
		var walk = function (o, d) {
			if (!o || !o.children || d > 3 || out.length > 220) return;
			for (var i = 0; i < o.children.length; i++) {
				var c = o.children[i];
				if (!c || c.__srPanel || c.__srLamp || c === rig.root || c.isCamera) continue;
				if (c.isLight) continue;
				out.push({ o: c, d: d });
				walk(c, d + 1);
			}
		};
		walk(sc, 1);
		car.cands = out.length;
		return out;
	}

	function bodyLike(o, minSpan, maxSpan) {
		var bx = localBoxOf(o, 700);
		if (!bx) return null;
		var mx = Math.max(bx.size.x, bx.size.y, bx.size.z);
		if (!(mx > minSpan) || mx > maxSpan) return null;
		var n = meshCount(o);
		if (!n) return null;
		return { o: o, box: bx, span: mx, n: n };
	}

	/* 1. cheapest and most exact: the camera is parked inside the car rig */
	function camBody() {
		var cam = three.camera, sc = three.scene;
		if (!cam) return null;
		var o = cam.parent, guard = 0;
		while (o && o !== sc && guard++ < 8) {
			var hit = bodyLike(o, 1.2, 9);
			if (hit) return hit;
			o = o.parent;
		}
		return null;
	}

	/* 2. the node that travels exactly like the camera is bolted to the car */
	function carSample(now) {
		var T = three.T, cam = three.camera;
		if (!T || !cam || !cam.getWorldPosition) return null;
		var camp = new T.Vector3();
		cam.getWorldPosition(camp);
		var s = car.probe, i;
		var reset = function () {
			s.cam = camp.clone();
			s.pos = [];
			for (i = 0; i < s.list.length; i++) s.pos.push(nodePos(s.list[i].o, T));
			s.at = now;
		};
		if (!s.list || !s.list.length || now - s.at > 6000) {
			s.list = carCandidates();
			reset();
			return null;
		}
		if (now - s.at < 220) return null;
		var dc = camp.clone().sub(s.cam), moved = dc.length();
		car.moved = moved;
		if (moved < 0.6) {
			if (now - s.at > 1200) reset();
			car.why = "waiting for the car to move";
			return null;
		}
		var tol = Math.max(0.25, moved * 0.12), best = null;
		for (i = 0; i < s.list.length; i++) {
			var o = s.list[i].o;
			if (!o.parent) continue;
			var d = nodePos(o, T).sub(s.pos[i]);
			if (Math.abs(d.length() - moved) > tol) continue;
			if (d.dot(dc) < moved * moved * 0.85) continue;
			var p = nodePos(o, T);
			if (p.distanceTo(camp) > 18) continue;
			var hit = bodyLike(o, 0.8, 14);
			if (!hit) continue;
			hit.score = hit.n + (4 - s.list[i].d) * 2 - p.distanceTo(camp) * 0.2;
			if (!best || hit.score > best.score) best = hit;
		}
		car.scans++;
		car.heading = dc.clone().normalize();
		reset();
		if (!best) { car.why = "nothing moves with the camera"; return null; }
		return best;
	}

	/* 3. last resort: the vehicle sized box the camera is sitting inside */
	function nearBody() {
		var T = three.T, cam = three.camera;
		if (!T || !cam || !cam.getWorldPosition) return null;
		var camp = new T.Vector3();
		cam.getWorldPosition(camp);
		var list = carCandidates(), best = null;
		for (var i = 0; i < list.length; i++) {
			var o = list[i].o;
			var hit = bodyLike(o, 1.2, 9);
			if (!hit) continue;
			var toLocal = inv4(T, o.matrixWorld);
			if (!toLocal) continue;
			var p = camp.clone().applyMatrix4(toLocal), bx = hit.box;
			var pad = hit.span * 0.3;
			if (p.x < bx.min.x - pad || p.x > bx.max.x + pad) continue;
			if (p.y < bx.min.y - pad || p.y > bx.max.y + pad) continue;
			if (p.z < bx.min.z - pad || p.z > bx.max.z + pad) continue;
			hit.score = hit.n - hit.span;
			if (!best || hit.score > best.score) best = hit;
		}
		if (!best) car.why = "no vehicle sized node around the camera";
		return best;
	}

	function findCar(now) {
		if (car.node && car.node.parent) return car.node;
		var hit = camBody(), how = "camera parent";
		if (!hit) { hit = carSample(now); how = "motion match"; }
		if (!hit) { hit = nearBody(); how = "cabin box around camera"; }
		if (!hit) return null;
		car.node = hit.o;
		car.how = how;
		car.meshes = hit.n;
		car.span = hit.span;
		car.why = "";
		car.parts = null;
		log("car found by", how, "meshes", hit.n, "span", hit.span);
		return car.node;
	}

	/* parts by shape instead of by name: the steering wheel is the small flat
	 * disc right in front of the camera, the dashboard is the wide mass below
	 * eye level a bit further ahead */
	function findParts() {
		var T = three.T, cam = three.camera, host = car.node, now = Date.now();
		if (car.parts && now - car.partsAt < 3000) return car.parts;
		var out = { wheel: null, dash: null, inner: null };
		if (!T || !host || !host.traverse || !cam || !cam.getWorldPosition) {
			var sc = three.scene;
			if (sc && sc.traverse) sc.traverse(function (o) {
				var n = o && !o.__srPanel ? String(o.name || "").toLowerCase() : "";
				if (!n) return;
				if (!out.wheel && /steer/.test(n)) out.wheel = o;
				if (!out.dash && /(dash|binnacle|gauge|cluster|instrument)/.test(n)) out.dash = o;
				if (!out.inner && /(interior|cockpit|cabin|roadster)/.test(n)) out.inner = o;
			});
			return out;
		}
		out.inner = host;
		var eye = new T.Vector3();
		cam.getWorldPosition(eye);
		var dir = new T.Vector3(0, 0, -1);
		if (cam.getWorldDirection) cam.getWorldDirection(dir);
		var bw = null, bd = null, seen = 0;
		host.traverse(function (o) {
			if (seen > 800 || !o || !o.isMesh || o.__srPanel || o.__srLamp || o.visible === false) return;
			seen++;
			var sph = meshSphere(o);
			if (!sph || !(sph.r > 0)) return;
			var to = sph.c.clone().sub(eye), d = to.length();
			if (!(d > 0.01) || d > 3) return;
			var ahead = to.clone().normalize().dot(dir);
			if (ahead < 0.05) return;
			if (sph.r > 0.1 && sph.r < 0.5 && d < 1.5) {
				var g = o.geometry, flat = 1;
				if (g && !g.boundingBox && g.computeBoundingBox) { try { g.computeBoundingBox(); } catch (e) {} }
				var gb = g && g.boundingBox;
				if (gb) {
					var s = [gb.max.x - gb.min.x, gb.max.y - gb.min.y, gb.max.z - gb.min.z];
					s.sort(function (a, b) { return a - b; });
					flat = s[2] > 1e-6 ? s[0] / s[2] : 1;
				}
				var ws = ahead - d * 0.3 + (flat < 0.45 ? 0.5 : 0);
				if (!bw || ws > bw.s) bw = { o: o, s: ws };
			}
			if (sph.r > 0.3 && sph.r < 2.2 && sph.c.y < eye.y + 0.15) {
				var ds = ahead - Math.abs(d - 0.9) * 0.4 + sph.r * 0.2;
				if (!bd || ds > bd.s) bd = { o: o, s: ds };
			}
		});
		if (bw) out.wheel = bw.o;
		if (bd) out.dash = bd.o;
		car.parts = out;
		car.partsAt = now;
		return out;
	}

	function cabinHost() {
		var node = findCar(Date.now());
		if (node && node.add) { rig.how = car.how; return node; }
		var parts = findParts();
		if (parts.dash) { rig.how = "dashboard mesh"; return parts.dash; }
		if (parts.inner) { rig.how = "interior mesh"; return parts.inner; }
		var m = cabinFallback();
		if (m) { rig.how = "nearest cabin geometry"; return m; }
		return null;
	}

	/* forward comes from where the car actually travels, which beats guessing
	 * from box extents on an unnamed node */
	function cabinBasis(host, box) {
		var T = three.T, cam = three.camera;
		var toLocal = inv4(T, host.matrixWorld);
		if (!toLocal) return null;
		var up = new T.Vector3(0, 1, 0).transformDirection(toLocal).normalize();
		if (!isFinite(up.x) || up.lengthSq() < 0.5) up.set(0, 1, 0);
		var head = null;
		if (car.heading) {
			head = car.heading.clone().transformDirection(toLocal).normalize();
			head.sub(up.clone().multiplyScalar(head.dot(up)));
			if (head.lengthSq() < 1e-6) head = null;
			else head.normalize();
		}
		var ax = [new T.Vector3(1, 0, 0), new T.Vector3(0, 1, 0), new T.Vector3(0, 0, 1)];
		var ext = [box.size.x, box.size.y, box.size.z];
		var fwd = null, best = -1;
		for (var i = 0; i < 3; i++) {
			var h = ax[i].clone().sub(up.clone().multiplyScalar(ax[i].dot(up)));
			var len = h.length();
			if (len < 1e-4) continue;
			h.normalize();
			var sc = head ? Math.abs(h.dot(head)) * 10 : ext[i] * len;
			if (sc > best) { best = sc; fwd = h; }
		}
		if (!fwd) return null;
		var eye = null;
		if (cam && cam.getWorldPosition) {
			eye = new T.Vector3();
			cam.getWorldPosition(eye);
			eye.applyMatrix4(toLocal);
		}
		var s = 0;
		if (head) {
			var dh = fwd.dot(head);
			if (Math.abs(dh) > 0.2) s = dh > 0 ? 1 : -1;
		}
		if (!s && cam && cam.getWorldDirection) {
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

	/* same mounting as before, but sized from the car itself when there is no
	 * steering wheel mesh to measure: ref approximates a wheel radius so every
	 * offset below keeps the proportions that were tuned against it */
	function buildCabinRig() {
		var T = three.T;
		if (!T || !three.scene) { three.why = "no scene yet"; return false; }
		var host = cabinHost();
		if (!host || !host.add) { three.why = car.why || "no car node yet"; return false; }
		var box = localBoxOf(host, 6000);
		if (!box) { three.why = "car node has no geometry"; return false; }
		var b = cabinBasis(host, box);
		if (!b) { three.why = "cannot read car axes"; return false; }
		var L = extentAlong(box, b.fwd), W = extentAlong(box, b.right), H = extentAlong(box, b.up);
		if (!(L > 0) || !(W > 0)) { three.why = "car box is degenerate"; return false; }

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
		var ref = wheelR > 0.05 && wheelR < 0.6 ? wheelR : Math.min(0.4, Math.max(0.08, W * 0.1));
		if (!(ref > 0)) { three.why = "cannot size the cabin"; return false; }

		var sideRef = wl || eye;
		var side = sideRef ? (sideRef.clone().sub(box.ctr).dot(b.right) >= 0 ? 1 : -1) : -1;

		var base;
		if (wl) base = wl.clone();
		else if (eye) base = eye.clone().addScaledVector(b.fwd, ref * 1.9).addScaledVector(b.up, -ref * 1.5);
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
		log("rig on car by", rig.how, "ref", ref, "LWH", L, W, H);
		return true;
	}

	function carReport() {
		var T = three.T, cam = three.camera, lines = [];
		if (!T || !three.scene) return lines;
		var camp = new T.Vector3();
		if (cam && cam.getWorldPosition) cam.getWorldPosition(camp);
		var list = carCandidates();
		for (var i = 0; i < list.length && lines.length < 34; i++) {
			var o = list[i].o, bx = localBoxOf(o, 400);
			if (!bx) continue;
			var sz = Math.max(bx.size.x, bx.size.y, bx.size.z);
			if (sz > 60) continue;
			lines.push("d" + list[i].d +
				" kids " + (o.children ? o.children.length : 0) +
				" meshes " + meshCount(o) +
				" size " + bx.size.x.toFixed(2) + "x" + bx.size.y.toFixed(2) + "x" + bx.size.z.toFixed(2) +
				" dist " + nodePos(o, T).distanceTo(camp).toFixed(2) +
				(o === car.node ? "  <= car" : ""));
		}
		return lines;
	}

	/* one flat line so the console can be copied as plain text */
	function debugScan() {
		adoptEarly();
		var b = earlyBag(), parts = findParts();
		var info = {
			version: VER,
			mode: state.mode,
			ready: three.ready,
			tries: three.tries,
			why: three.why,
			three: three.T ? (three.T.REVISION || "harvested") : null,
			scenes: SCENES.length,
			renderers: RENDERERS.length,
			early: b ? (b.observe + "ev " + (b.scenes || []).length + "sc " + (b.renderers || []).length + "rn " + (b.cameras || []).length + "cam " + (b.canvases || []).length + "cv") : "none",
			hunt: hunt.how + " " + hunt.nodes + "n " + hunt.ms + "ms",
			carHow: car.how,
			carWhy: car.why,
			carMeshes: car.meshes,
			carSpan: car.span,
			cands: car.cands,
			scans: car.scans,
			moved: car.moved,
			heading: !!car.heading,
			wheel: !!parts.wheel,
			dash: !!parts.dash,
			rigHow: rig.how,
			rigRef: rig.ref,
			inside: rig.inside,
			lamps: lamps.list.length,
			speedKph: telem.kph,
			source: telem.src,
			odoKm: state.odoKm,
			mediaLive: media.live
		};
		try { console.log("[sr-mod] scan " + JSON.stringify(info)); } catch (e) { console.log("[sr-mod] scan", info); }
		var lines = carReport();
		if (lines.length) console.log("[sr-mod] nodes\n" + lines.join("\n"));
		toast("scan printed to console (F12)");
		return info;
	}

	if (window.SRMOD) {
		window.SRMOD.version = VER;
		window.SRMOD.car = function (reset) {
			if (reset) {
				car.node = null;
				car.parts = null;
				car.probe = { at: 0, list: null, pos: null, cam: null };
				car.why = "re-hunting";
				three.ready = false;
				three.why = "re-hunting";
			}
			return {
				how: car.how,
				why: car.why,
				meshes: car.meshes,
				span: car.span,
				cands: car.cands,
				scans: car.scans,
				node: car.node || null,
				nodes: carReport()
			};
		};
	}

	bootSync();
	onReady(init);
})();
