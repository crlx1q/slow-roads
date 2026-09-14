					if (better) three.scene = scene;
				}
				if (camera && camera.isPerspectiveCamera) three.camera = camera;
			} catch (e) {}
			return orig.apply(this, arguments);
		};
	}

	/* last resort: some builds leave the scene on a global */
	function scanWindow() {
		if (three.scene) return three.scene;
		var keys;
		try { keys = Object.keys(window); } catch (e) { return null; }
		for (var i = 0; i < keys.length && i < 900; i++) {
			var v;
			try { v = window[keys[i]]; } catch (e) { continue; }
			if (!v || typeof v !== "object" || v.nodeType) continue;
			if (v.isScene) { three.scene = v; return v; }
			var sub = null;
			try { sub = v.scene || (v.props && v.props.scene); } catch (e) {}
			if (sub && sub.isScene) { three.scene = sub; return sub; }
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
		three.anchor = anchor;
		three.how = "saved";
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
		if (!T || !T.Quaternion || !sc) return null;
		var parts = findParts();
		if (!parts.wheel) return null;
		var box = worldBox(parts.wheel, 1500);
		if (!box) return null;
		var rad = spanOf(box) / 2;
		if (!isFinite(rad) || rad <= 0) return null;
		var b = rigBasis();
		var cw = rad * 1.55;
		var sw = cw * 1.15;
		var cpos = box.ctr.clone()
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
			if (!o || o.__srPanel || o.__srLamp || o.visible === false) continue;
			if (SKIP_MESH.test(String(o.name || ""))) continue;
			hit = hits[i];
			break;
		}
		if (!hit) return null;
		return planAtDistance(b, eye, hit.distance, hit.object, "ray");
	}

	/* no named wheel, no raycaster: the cabin is simply the nearest solid
	 * geometry wrapped around the driver, so the panels are parked a fixed
	 * angle below the line of sight and parented to that very mesh. Whatever
	 * happens, the anchor is a real part of the car model */
	function planByCabin() {
		var T = three.T, cam = three.camera;
		if (!T || !cam) return null;
		var cab = findCabin();
		if (!cab) return null;
		var eye = new T.Vector3();
		cam.getWorldPosition(eye);
		var b = rigBasis();
		var d = cab.near + cab.sph.r * 0.35;
		if (!isFinite(d) || d <= 0) d = Math.max(0.3, cab.sph.r);
		return planAtDistance(b, eye, d, cab.obj, "cabin");
	}

	/* panels sized by viewing angle, so they look right whatever the world
	 * scale of the model happens to be */
	function planAtDistance(b, eye, dist, anchor, how) {
		var cw = dist * 0.52;
		var sw = cw * 1.15;
		var down = b.fwd.clone().applyAxisAngle(b.right, -19 * Math.PI / 180).normalize();
		var cpos = eye.clone().addScaledVector(down, dist * 0.97);
		var spos = cpos.clone()
			.addScaledVector(b.right, cw * 0.5 + sw * 0.5 + cw * 0.12)
			.addScaledVector(b.up, -cw * 0.14);
		return {
			how: how,
			anchor: anchor,
			cluster: { pos: cpos, quat: facing(b, -0.13, 0), width: cw },
			screen: { pos: spos, quat: facing(b, -0.10, -0.20), width: sw }
		};
	}

	/* our own bounding box: T.Box3 is missing whenever the namespace had to be
	 * rebuilt from scene objects, and sampled vertices are accurate enough */
	function worldBox(obj, budget) {
		var T = three.T;
		if (!T || !obj || !obj.traverse) return null;
		var min = null, max = null, seen = 0;
		var v = new T.Vector3();
		if (obj.updateMatrixWorld) obj.updateMatrixWorld(true);
		obj.traverse(function (o) {
			if (!o || !o.isMesh || o.__srPanel || o.__srLamp || !o.geometry) return;
			if (budget && seen > budget) return;
			var attr = o.geometry.attributes && o.geometry.attributes.position;
			if (!attr || !attr.count || !attr.getX) return;
			var step = Math.max(1, Math.floor(attr.count / 240));
			for (var i = 0; i < attr.count; i += step) {
				v.set(attr.getX(i), attr.getY(i), attr.getZ(i));
				if (o.matrixWorld) v.applyMatrix4(o.matrixWorld);
				if (!min) { min = v.clone(); max = v.clone(); seen++; continue; }
				if (v.x < min.x) min.x = v.x;
				if (v.y < min.y) min.y = v.y;
				if (v.z < min.z) min.z = v.z;
				if (v.x > max.x) max.x = v.x;
				if (v.y > max.y) max.y = v.y;
				if (v.z > max.z) max.z = v.z;
				seen++;
			}
		});
		if (!min) return null;
		return {
			min: min,
			max: max,
			ctr: min.clone().add(max).multiplyScalar(0.5),
			size: max.clone().sub(min)
		};
	}

	function spanOf(box) {
		return box ? Math.max(box.size.x, box.size.y, box.size.z) : 0;
	}

	/* cheap locator used while scoring cabin candidates */
	function meshSphere(o) {
		var T = three.T;
		var g = o.geometry;
		if (!g) return null;
		if (!g.boundingSphere && g.computeBoundingSphere) {
			try { g.computeBoundingSphere(); } catch (e) { return null; }
		}
		var bs = g.boundingSphere;
		if (!bs || !bs.center) return null;
		var c = new T.Vector3(bs.center.x, bs.center.y, bs.center.z);
		if (o.matrixWorld) c.applyMatrix4(o.matrixWorld);
		var s = new T.Vector3(1, 1, 1);
		if (o.getWorldScale) o.getWorldScale(s);
		var k = Math.max(Math.abs(s.x), Math.abs(s.y), Math.abs(s.z));
		return { c: c, r: (bs.radius || 0) * (isFinite(k) && k > 0 ? k : 1) };
	}

	var SKIP_MESH = /glass|window|shield|mirror|sky|cloud|terrain|ground|road|grass|tree|plant|fern|water|rock|fog|sun|moon|guard|rail|particle/i;

	function findCabin() {
		var T = three.T, cam = three.camera, sc = three.scene;
		if (!T || !cam || !sc || !sc.traverse) return null;
		var eye = new T.Vector3();
		cam.getWorldPosition(eye);
		var b = rigBasis();
		var best = null, count = 0;
		sc.traverse(function (o) {
			if (count > 4000) return;
			count++;
			if (!o || !o.isMesh || o.__srPanel || o.__srLamp || o.visible === false) return;
			var n = String(o.name || "");
			if (SKIP_MESH.test(n)) return;
			var sph = meshSphere(o);
			if (!sph || !(sph.r > 0) || sph.r > 40) return;
			var d = sph.c.distanceTo(eye);
			if (!isFinite(d)) return;
			var near = Math.max(0.002, d - sph.r);
			var dir = sph.c.clone().sub(eye);
			if (dir.lengthSq() < 1e-9) return;
			var ahead = dir.normalize().dot(b.fwd);
			var score = 1 / (1 + near * 2) + ahead * 0.4;
			if (/dash|cockpit|interior|cabin|steer|instrument|console|seat/i.test(n)) score += 2;
			if (/wheel_0|tyre|tire/i.test(n)) score -= 0.6;
			if (!best || score > best.score) best = { obj: o, sph: sph, near: near, score: score };
		});
		return best;
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
		var plan = planByWheel() || planByRay() || planByCabin();
		if (!plan) return false;
		var ok = attachPanel("cluster", plan.cluster, plan.anchor);
		ok = attachPanel("screen", plan.screen, plan.anchor) || ok;
		if (ok) {
			three.anchor = plan.anchor;
			three.how = plan.how;
			buildLamps(plan.anchor);
			log("welded via", plan.how, plan.anchor && plan.anchor.name);
		}
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

	/* --------------------------------------- 7b. turn signals on the car body */

	var lamps = { list: [], tex: null, root: null };

	function lampTexture() {
		if (lamps.tex) return lamps.tex;
		var T = three.T;
		var cvs = document.createElement("canvas");
		cvs.width = 64;
		cvs.height = 64;
		var c = cvs.getContext("2d");
		var g = c.createRadialGradient(32, 32, 0, 32, 32, 32);
		g.addColorStop(0, "rgba(255,226,168,1)");
