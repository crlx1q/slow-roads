
	/* ------------------------------------ 15. v0.6.3 math rescue */

	/* this build never exposes three.js itself, so T is assembled from the live
	 * objects found in the scene and only carries the classes those objects
	 * happened to expose: Mesh, Vector3, Quaternion, one geometry and one
	 * material. Matrix4 and Group were missing, which is why every measurement
	 * threw "T.Matrix4 is not a constructor" and no rig could ever be built.
	 * Below: a self contained 4x4 implementation as the last resort, then a
	 * harvester that pulls every other missing class off a live instance. */

	VER = "0.6.3";

	function SRMat4() {
		this.elements = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
		this.isMatrix4 = true;
	}

	SRMat4.prototype.identity = function () {
		var e = this.elements;
		e[0] = 1; e[1] = 0; e[2] = 0; e[3] = 0;
		e[4] = 0; e[5] = 1; e[6] = 0; e[7] = 0;
		e[8] = 0; e[9] = 0; e[10] = 1; e[11] = 0;
		e[12] = 0; e[13] = 0; e[14] = 0; e[15] = 1;
		return this;
	};

	SRMat4.prototype.copy = function (m) {
		var s = m && m.elements ? m.elements : m, e = this.elements;
		if (!s) return this;
		for (var i = 0; i < 16; i++) e[i] = s[i];
		return this;
	};

	SRMat4.prototype.clone = function () { return new SRMat4().copy(this); };

	SRMat4.prototype.makeBasis = function (x, y, z) {
		var e = this.elements;
		e[0] = x.x; e[1] = x.y; e[2] = x.z; e[3] = 0;
		e[4] = y.x; e[5] = y.y; e[6] = y.z; e[7] = 0;
		e[8] = z.x; e[9] = z.y; e[10] = z.z; e[11] = 0;
		e[12] = 0; e[13] = 0; e[14] = 0; e[15] = 1;
		return this;
	};

	SRMat4.prototype.multiplyMatrices = function (a, b) {
		var ae = a.elements, be = b.elements, te = this.elements;
		var a11 = ae[0], a12 = ae[4], a13 = ae[8], a14 = ae[12];
		var a21 = ae[1], a22 = ae[5], a23 = ae[9], a24 = ae[13];
		var a31 = ae[2], a32 = ae[6], a33 = ae[10], a34 = ae[14];
		var a41 = ae[3], a42 = ae[7], a43 = ae[11], a44 = ae[15];
		var b11 = be[0], b12 = be[4], b13 = be[8], b14 = be[12];
		var b21 = be[1], b22 = be[5], b23 = be[9], b24 = be[13];
		var b31 = be[2], b32 = be[6], b33 = be[10], b34 = be[14];
		var b41 = be[3], b42 = be[7], b43 = be[11], b44 = be[15];
		te[0] = a11 * b11 + a12 * b21 + a13 * b31 + a14 * b41;
		te[4] = a11 * b12 + a12 * b22 + a13 * b32 + a14 * b42;
		te[8] = a11 * b13 + a12 * b23 + a13 * b33 + a14 * b43;
		te[12] = a11 * b14 + a12 * b24 + a13 * b34 + a14 * b44;
		te[1] = a21 * b11 + a22 * b21 + a23 * b31 + a24 * b41;
		te[5] = a21 * b12 + a22 * b22 + a23 * b32 + a24 * b42;
		te[9] = a21 * b13 + a22 * b23 + a23 * b33 + a24 * b43;
		te[13] = a21 * b14 + a22 * b24 + a23 * b34 + a24 * b44;
		te[2] = a31 * b11 + a32 * b21 + a33 * b31 + a34 * b41;
		te[6] = a31 * b12 + a32 * b22 + a33 * b32 + a34 * b42;
		te[10] = a31 * b13 + a32 * b23 + a33 * b33 + a34 * b43;
		te[14] = a31 * b14 + a32 * b24 + a33 * b34 + a34 * b44;
		te[3] = a41 * b11 + a42 * b21 + a43 * b31 + a44 * b41;
		te[7] = a41 * b12 + a42 * b22 + a43 * b32 + a44 * b42;
		te[11] = a41 * b13 + a42 * b23 + a43 * b33 + a44 * b43;
		te[15] = a41 * b14 + a42 * b24 + a43 * b34 + a44 * b44;
		return this;
	};

	SRMat4.prototype.multiply = function (m) { return this.multiplyMatrices(this.clone(), m); };

	SRMat4.prototype.invert = function () {
		var te = this.elements,
			n11 = te[0], n21 = te[1], n31 = te[2], n41 = te[3],
			n12 = te[4], n22 = te[5], n32 = te[6], n42 = te[7],
			n13 = te[8], n23 = te[9], n33 = te[10], n43 = te[11],
			n14 = te[12], n24 = te[13], n34 = te[14], n44 = te[15],
			t11 = n23 * n34 * n42 - n24 * n33 * n42 + n24 * n32 * n43 - n22 * n34 * n43 - n23 * n32 * n44 + n22 * n33 * n44,
			t12 = n14 * n33 * n42 - n13 * n34 * n42 - n14 * n32 * n43 + n12 * n34 * n43 + n13 * n32 * n44 - n12 * n33 * n44,
			t13 = n13 * n24 * n42 - n14 * n23 * n42 + n14 * n22 * n43 - n12 * n24 * n43 - n13 * n22 * n44 + n12 * n23 * n44,
			t14 = n14 * n23 * n32 - n13 * n24 * n32 - n14 * n22 * n33 + n12 * n24 * n33 + n13 * n22 * n34 - n12 * n23 * n34;
		var det = n11 * t11 + n21 * t12 + n31 * t13 + n41 * t14;
		if (det === 0) return this.identity();
		var d = 1 / det;
		te[0] = t11 * d;
		te[1] = (n24 * n33 * n41 - n23 * n34 * n41 - n24 * n31 * n43 + n21 * n34 * n43 + n23 * n31 * n44 - n21 * n33 * n44) * d;
		te[2] = (n22 * n34 * n41 - n24 * n32 * n41 + n24 * n31 * n42 - n21 * n34 * n42 - n22 * n31 * n44 + n21 * n32 * n44) * d;
		te[3] = (n23 * n32 * n41 - n22 * n33 * n41 - n23 * n31 * n42 + n21 * n33 * n42 + n22 * n31 * n43 - n21 * n32 * n43) * d;
		te[4] = t12 * d;
		te[5] = (n13 * n34 * n41 - n14 * n33 * n41 + n14 * n31 * n43 - n11 * n34 * n43 - n13 * n31 * n44 + n11 * n33 * n44) * d;
		te[6] = (n14 * n32 * n41 - n12 * n34 * n41 - n14 * n31 * n42 + n11 * n34 * n42 + n12 * n31 * n44 - n11 * n32 * n44) * d;
		te[7] = (n12 * n33 * n41 - n13 * n32 * n41 + n13 * n31 * n42 - n11 * n33 * n42 - n12 * n31 * n43 + n11 * n32 * n43) * d;
		te[8] = t13 * d;
		te[9] = (n14 * n23 * n41 - n13 * n24 * n41 - n14 * n21 * n43 + n11 * n24 * n43 + n13 * n21 * n44 - n11 * n23 * n44) * d;
		te[10] = (n12 * n24 * n41 - n14 * n22 * n41 + n14 * n21 * n42 - n11 * n24 * n42 - n12 * n21 * n44 + n11 * n22 * n44) * d;
		te[11] = (n13 * n22 * n41 - n12 * n23 * n41 - n13 * n21 * n42 + n11 * n23 * n42 + n12 * n21 * n43 - n11 * n22 * n43) * d;
		te[12] = t14 * d;
		te[13] = (n13 * n24 * n31 - n14 * n23 * n31 + n14 * n21 * n33 - n11 * n24 * n33 - n13 * n21 * n34 + n11 * n23 * n34) * d;
		te[14] = (n14 * n22 * n31 - n12 * n24 * n31 - n14 * n21 * n32 + n11 * n24 * n32 + n12 * n21 * n34 - n11 * n22 * n34) * d;
		te[15] = (n12 * n23 * n31 - n13 * n22 * n31 + n13 * n21 * n32 - n11 * n23 * n32 - n12 * n21 * n33 + n11 * n22 * n33) * d;
		return this;
	};

	SRMat4.prototype.getInverse = function (m) { return this.copy(m).invert(); };

	/* every class the harvested T is missing is taken from a live instance:
	 * an Object3D carries a real Matrix4 in matrixWorld, a material carries its
	 * own class, and a plain node carries a container class for the rig root */

	var mathAt = 0;

	function classOf(v) {
		return v && typeof v.constructor === "function" ? v.constructor : null;
	}

	function tryNew(C, a, b) {
		if (typeof C !== "function") return null;
		try { return new C(a, b); } catch (e) { return null; }
	}

	function fillMath() {
		var T = three.T, sc = three.scene, now = Date.now();
		if (!T || !sc || !sc.traverse) return T || null;
		if (T.__srFull) return T;
		if (T.Matrix4 && now - mathAt < 1500) return T;
		mathAt = now;

		var mesh = null, plain = null, seen = 0;
		var wantG = { BoxGeometry: 1, BoxBufferGeometry: 1, PlaneGeometry: 1, PlaneBufferGeometry: 1 };
		var wantM = { MeshStandardMaterial: 1, MeshPhysicalMaterial: 1, MeshBasicMaterial: 1, MeshLambertMaterial: 1, MeshPhongMaterial: 1 };
		sc.traverse(function (o) {
			if (seen > 4000 || !o || o.__srPanel || o.__srLamp) return;
			seen++;
			if (!mesh && o.isMesh && o.geometry && o.material) mesh = o;
			if (!plain && !o.isMesh && !o.isLight && !o.isCamera && !o.isScene && o.children && typeof o.add === "function") plain = o;
			var g = o.geometry;
			if (g && g.type && wantG[g.type] && !T[g.type]) T[g.type] = classOf(g);
			var m = o.material;
			if (!m) return;
			var arr = Array.isArray(m) ? m : [m];
			for (var i = 0; i < arr.length; i++) {
				var mm = arr[i];
				if (!mm) continue;
				if (mm.type && wantM[mm.type] && !T[mm.type]) T[mm.type] = classOf(mm);
				if (mm.color && !T.Color) T.Color = classOf(mm.color);
				if (mm.map && !T.Texture) T.Texture = classOf(mm.map);
				if (mm.map && mm.map.isCanvasTexture && !T.CanvasTexture) T.CanvasTexture = classOf(mm.map);
			}
		});

		var any = mesh || plain || sc;
		if (typeof T.Matrix4 !== "function") {
			var C = any && any.matrixWorld ? classOf(any.matrixWorld) : null;
			var probe = tryNew(C);
			var real = !!(probe && probe.elements && probe.elements.length === 16 &&
				(typeof probe.invert === "function" || typeof probe.getInverse === "function") &&
				typeof probe.makeBasis === "function");
			T.Matrix4 = real ? C : SRMat4;
			log("matrix4", real ? "harvested" : "built in shim");
		}
		if (typeof T.Vector3 !== "function" && any) T.Vector3 = classOf(any.position);
		if (typeof T.Quaternion !== "function" && any) T.Quaternion = classOf(any.quaternion);
		if (typeof T.Euler !== "function" && any) T.Euler = classOf(any.rotation);
		if (typeof T.Matrix3 !== "function" && mesh && mesh.normalMatrix) T.Matrix3 = classOf(mesh.normalMatrix);
		if (typeof T.Group !== "function" && typeof T.Object3D !== "function") {
			var list = [];
			if (plain) list.push(classOf(plain));
			if (typeof T.Mesh === "function") list.push(T.Mesh);
			for (var k = 0; k < list.length; k++) {
				var holder = tryNew(list[k]);
				if (holder && holder.children && typeof holder.add === "function" && !holder.isScene) {
					T.Group = list[k];
					log("container class", k === 0 ? "scene node" : "mesh");
					break;
				}
			}
		}
		if (T.LinearFilter == null) T.LinearFilter = 1006;
		if (T.SRGBColorSpace == null) T.SRGBColorSpace = "srgb";
		if (T.DoubleSide == null) T.DoubleSide = 2;
		T.__srFull = !!(T.Matrix4 && (T.Group || T.Object3D) && T.MeshStandardMaterial &&
			(T.PlaneGeometry || T.PlaneBufferGeometry || T.BoxGeometry));
		return T;
	}

	/* never throws again: harvested class first, own implementation second */
	function inv4(T, m) {
		if (!m) return null;
		var C = T && typeof T.Matrix4 === "function" ? T.Matrix4 : null;
		if (!C) {
			fillMath();
			C = three.T && typeof three.T.Matrix4 === "function" ? three.T.Matrix4 : null;
		}
		var o = tryNew(C);
		if (o && o.elements && o.elements.length === 16) {
			try {
				o.copy(m);
				if (typeof o.invert === "function") return o.invert();
				if (typeof o.getInverse === "function") return o.getInverse(m);
			} catch (e) {}
		}
		return new SRMat4().copy(m).invert();
	}

	/* ------------------------------------ 16. v0.6.3 camera and a safe tick */

	/* the old finder only accepted isPerspectiveCamera, and this build never
	 * announced a camera on the devtools bus, so the rig never got past the
	 * camera check. Anything that has a projection matrix now counts. */

	function cameraLike(o) {
		if (!o || o.__srPanel) return false;
		if (o.isCamera) return true;
		return !!(o.projectionMatrix && o.matrixWorldInverse && o.updateMatrixWorld);
	}

	function camScore(o) {
		var s = 0;
		if (o.isPerspectiveCamera || o.fov) s += 5;
		if (o.isOrthographicCamera) s -= 4;
		if (o.isArrayCamera) s -= 2;
		if (o.parent) s += 1;
		if (o.far > 200) s += 1;
		return s;
	}

	function findCamera() {
		var best = null, bs = -99, i, c, s, bag = earlyBag();
		if (cameraLike(three.camera)) { best = three.camera; bs = camScore(three.camera) + 3; }
		for (i = 0; i < RENDERERS.length; i++) {
			c = RENDERERS[i] && RENDERERS[i].__srCam;
			if (!cameraLike(c)) continue;
			s = camScore(c) + 4;
			if (s > bs) { bs = s; best = c; }
		}
		if (bag && bag.cameras) for (i = 0; i < bag.cameras.length; i++) {
			c = bag.cameras[i];
			if (!cameraLike(c)) continue;
			s = camScore(c);
			if (s > bs) { bs = s; best = c; }
		}
		var sc = three.scene, seen = 0;
		if (sc && sc.traverse) sc.traverse(function (o) {
			if (seen > 4000) return;
			seen++;
			if (!cameraLike(o)) return;
			var v = camScore(o);
			if (v > bs) { bs = v; best = o; }
		});
		return best;
	}

	function noteFrame(scene, camera) {
		if (scene && scene.isScene) {
			if (SCENES.indexOf(scene) < 0) SCENES.push(scene);
			var cur = three.scene;
			if (!cur || !cur.children || (scene.children && scene.children.length >= cur.children.length)) three.scene = scene;
		}
		if (cameraLike(camera)) three.camera = camera;
	}

	function patchRenderFn(r, key) {
		var fn = r[key];
		if (typeof fn !== "function" || fn.__srWrap) return;
		var wrapped = function (scene, camera) {
			try {
				if (cameraLike(camera)) r.__srCam = camera;
				noteFrame(scene, camera);
			} catch (e) {}
			return fn.apply(this, arguments);
		};
		wrapped.__srWrap = true;
		try { r[key] = wrapped; } catch (e) {}
	}

	/* WebGPU renderers draw through renderAsync, so both entry points are hooked */
	function patchRenderers() {
		for (var i = 0; i < RENDERERS.length; i++) {
			var r = RENDERERS[i];
			if (!r) continue;
			patchRenderFn(r, "render");
			patchRenderFn(r, "renderAsync");
			if (!three.renderer) three.renderer = r;
		}
	}

	function setup3d(now) {
		if (three.ready) { updateInside(); return; }
		if (now - three.probeAt < (three.tries < 40 ? 250 : 1500)) return;
		three.probeAt = now;
		three.tries++;
		adoptEarly();
		if (!three.T) harvestTHREE();
		patchProto();
		patchRenderers();
		if (!three.scene) three.scene = pickScene();
		if (!three.scene && (three.tries === 2 || three.tries % 6 === 0)) scanWindow();
		if (!three.scene) { three.why = "no scene yet"; return; }
		if (!three.T) harvestFromScene();
		if (!three.T) { three.why = "three not reachable"; return; }
		fillMath();
		if (!three.T.Matrix4) { three.why = "no matrix math"; return; }
		var cam = findCamera();
		if (cam) three.camera = cam;
		if (!three.camera) { three.why = "no camera"; return; }
		var ok = false;
		try {
			ok = buildCabinRig();
		} catch (e) {
			three.why = "rig error: " + (e && e.message ? e.message : e);
			if (!three.errAt || now - three.errAt > 8000) { three.errAt = now; log("rig error", e); }
			return;
		}
		if (!ok) return;
		three.ready = true;
		three.why = "";
		state.mode = "3d";
		applyVis();
		if (!media.layer) makeMediaFrame();
		toast("cabin mounted on the car (" + rig.how + ") | F6 refit | F3 nudge | F4 youtube");
	}

	function debugScan() {
		adoptEarly();
		var T = fillMath() || {}, bag = earlyBag(), parts = {}, cam = three.camera;
		try { parts = findParts() || {}; } catch (e) { parts = {}; }
		var info = {
			version: VER,
			ready: three.ready,
			tries: three.tries,
			why: three.why,
			scenes: SCENES.length,
			renderers: RENDERERS.length,
			early: bag ? (bag.observe + "ev " + (bag.scenes || []).length + "sc " + (bag.renderers || []).length + "rn " + (bag.cameras || []).length + "cam") : "none",
			mat4: T.Matrix4 ? (T.Matrix4 === SRMat4 ? "shim" : "real") : "none",
			group: !!(T.Group || T.Object3D),
			std: !!T.MeshStandardMaterial,
			plane: !!(T.PlaneGeometry || T.PlaneBufferGeometry),
			boxGeo: !!(T.BoxGeometry || T.BoxBufferGeometry),
			cam: cam ? (cam.type || "camera") : "none",
			camFov: cam && cam.fov,
			camParent: !!(cam && cam.parent),
			carHow: car.how,
			carWhy: car.why,
			carMeshes: car.meshes,
			carSpan: car.span,
			cands: car.cands,
			scans: car.scans,
			moved: car.moved,
			wheel: !!parts.wheel,
			dash: !!parts.dash,
			rigHow: rig.how,
			rigRef: rig.ref,
			inside: rig.inside,
			lamps: lamps.list.length,
			speedKph: telem.kph,
			odoKm: state.odoKm,
			mediaLive: media.live
		};
		try { console.log("[sr-mod] scan " + JSON.stringify(info)); } catch (e) { console.log("[sr-mod] scan", info); }
		var lines = [];
		try { lines = carReport(); } catch (e) { lines = ["node report failed: " + (e && e.message ? e.message : e)]; }
		if (lines.length) console.log("[sr-mod] nodes\n" + lines.join("\n"));
		toast("scan printed to console (F12)");
		return info;
	}

	if (window.SRMOD) {
		window.SRMOD.version = VER;
		window.SRMOD.math = function () {
			var T = fillMath() || {};
			return {
				matrix4: T.Matrix4 ? (T.Matrix4 === SRMat4 ? "shim" : "real") : null,
				container: !!(T.Group || T.Object3D),
				standard: !!T.MeshStandardMaterial,
				physical: !!T.MeshPhysicalMaterial,
				texture: !!T.Texture,
				canvasTexture: !!T.CanvasTexture,
				plane: !!(T.PlaneGeometry || T.PlaneBufferGeometry),
				box: !!(T.BoxGeometry || T.BoxBufferGeometry)
			};
		};
		window.SRMOD.camera = function () {
			var c = findCamera();
			if (c) three.camera = c;
			return c || null;
		};
	}

	bootSync();
	onReady(init);
})();
