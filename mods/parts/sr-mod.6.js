
	/* ------------------------------------ 13. v0.6.1 scene capture rescue */

	/* the body of the mod is fetched by the loader, so the devtools bridge at
	 * the very top of part 1 installs itself long after the game has already
	 * built its scene and its renderer: those `observe` events are gone by the
	 * time we arrive, which is why scenes/renderers stayed at 0. The loader now
	 * installs the same bridge synchronously in <head> and parks what it sees
	 * in window.__SR_EARLY__. Everything below adopts that bag, and adds a late
	 * hunt (react fiber tree + object graph) for the case where the game's
	 * three build has no devtools hook at all. */

	VER = "0.6.1";

	var hunt = { roots: 0, nodes: 0, ms: 0, how: "", ran: 0 };

	function earlyBag() {
		var b = window.__SR_EARLY__;
		return b && typeof b === "object" ? b : null;
	}

	function adoptEarly() {
		var b = earlyBag();
		if (!b) return;
		var i, v;
		if (b.scenes) for (i = 0; i < b.scenes.length; i++) {
			v = b.scenes[i];
			if (v && v.isScene && SCENES.indexOf(v) < 0) SCENES.push(v);
		}
		if (b.renderers) for (i = 0; i < b.renderers.length; i++) {
			v = b.renderers[i];
			if (v && typeof v.render === "function" && RENDERERS.indexOf(v) < 0) RENDERERS.push(v);
		}
		if (b.cameras && !three.camera) for (i = 0; i < b.cameras.length; i++) {
			v = b.cameras[i];
			if (v && v.isPerspectiveCamera) { three.camera = v; break; }
		}
	}

	function noteFrame(scene, camera) {
		if (scene && scene.isScene) {
			if (SCENES.indexOf(scene) < 0) SCENES.push(scene);
			var cur = three.scene;
			var better = !cur || !cur.children || (scene.children && scene.children.length >= cur.children.length);
			if (better) three.scene = scene;
		}
		if (camera && camera.isPerspectiveCamera) three.camera = camera;
	}

	/* three assigns render() on the instance, not on the prototype, so both
	 * spots are wrapped: whichever one the build uses, frames are observed */
	function patchRenderers() {
		adoptEarly();
		for (var i = 0; i < RENDERERS.length; i++) {
			var r = RENDERERS[i];
			if (!r || typeof r.render !== "function") continue;
			if (!three.renderer) three.renderer = r;
			var proto = null;
			try { proto = Object.getPrototypeOf(r); } catch (e) {}
			if (proto && proto !== Object.prototype && typeof proto.render === "function" && !proto.__srPatched) {
				proto.__srPatched = true;
				three.protoPatched = true;
				wrapRender(proto);
			}
			if (r.__srPatched) continue;
			if (!Object.prototype.hasOwnProperty.call(r, "render")) continue;
			r.__srPatched = true;
			wrapRender(r);
		}
	}

	function wrapRender(target) {
		var orig = target.render;
		target.render = function (scene, camera) {
			try { noteFrame(scene, camera); } catch (e) {}
			return orig.apply(this, arguments);
		};
	}

	function pickScene() {
		adoptEarly();
		var best = null, bestN = -1;
		for (var i = 0; i < SCENES.length; i++) {
			var s = SCENES[i];
			if (!s || !s.children) continue;
			var n = s.children.length;
			if (n > bestN) { bestN = n; best = s; }
		}
		return best;
	}

	function findCamera() {
		if (three.camera && three.camera.isPerspectiveCamera) return three.camera;
		var b = earlyBag(), i;
		if (b && b.cameras) for (i = 0; i < b.cameras.length; i++) {
			if (b.cameras[i] && b.cameras[i].isPerspectiveCamera) return b.cameras[i];
		}
		var sc = three.scene, found = null;
		if (sc && sc.traverse) sc.traverse(function (o) { if (!found && o && o.isPerspectiveCamera) found = o; });
		return found;
	}

	/* late hunt: used only when the early bridge came back empty, i.e. when
	 * the game's three build has no devtools hook. Walks the react fiber tree
	 * and the reachable object graph with a hard node budget. */

	var SKIP_KEY = /^(window|self|top|parent|opener|frames|document|location|navigator|history|localStorage|sessionStorage|indexedDB|performance|caches|crypto|speechSynthesis|__SR_EARLY__|__THREE_DEVTOOLS__|SRMOD)$/;

	function newSet() {
		if (typeof Set === "function") return new Set();
		var a = [];
		return { has: function (v) { return a.indexOf(v) >= 0; }, add: function (v) { a.push(v); } };
	}

	function usable(v) {
		if (!v || typeof v !== "object") return false;
		if (v === window || v.nodeType) return false;
		if (v.buffer && v.byteLength != null) return false;
		return true;
	}

	function consider(v) {
		if (v.isScene && v.children) {
			if (SCENES.indexOf(v) < 0) SCENES.push(v);
			return true;
		}
		if (typeof v.render === "function" && v.domElement && typeof v.setSize === "function") {
			if (RENDERERS.indexOf(v) < 0) RENDERERS.push(v);
		} else if (v.isPerspectiveCamera && !three.camera) three.camera = v;
		return false;
	}

	function deepFind(root, depth, seen, budget) {
		var q = [{ v: root, d: depth }];
		while (q.length && budget.n > 0) {
			var it = q.shift(), v = it.v;
			if (!usable(v) || seen.has(v)) continue;
			seen.add(v);
			budget.n--;
			hunt.nodes++;
			var hit = false;
			try { hit = consider(v); } catch (e) {}
			if (hit) return true;
			if (it.d <= 0) continue;
			var keys;
			try { keys = Object.keys(v); } catch (e) { continue; }
			var lim = keys.length > 160 ? 160 : keys.length;
			for (var i = 0; i < lim; i++) {
				if (SKIP_KEY.test(keys[i])) continue;
				var c;
				try { c = v[keys[i]]; } catch (e) { continue; }
				if (c && typeof c === "object") q.push({ v: c, d: it.d - 1 });
			}
		}
		return false;
	}

	function fiberOf(el) {
		if (!el) return null;
		var keys;
		try { keys = Object.keys(el); } catch (e) { return null; }
		for (var i = 0; i < keys.length; i++) {
			var k = keys[i];
			if (k.indexOf("__reactFiber$") === 0 || k.indexOf("__reactInternalInstance$") === 0 || k.indexOf("__reactContainer$") === 0) return el[k];
		}
		return null;
	}

	function scanFiber(budget) {
		var els = [document.getElementById("root"), document.body], i;
		var cs = document.getElementsByTagName("canvas");
		for (i = 0; i < cs.length && i < 8; i++) els.push(cs[i]);
		var b = earlyBag();
		if (b && b.canvases) for (i = 0; i < b.canvases.length && i < 8; i++) els.push(b.canvases[i]);
		var roots = [];
		for (i = 0; i < els.length; i++) {
			var f = fiberOf(els[i]);
			if (f && roots.indexOf(f) < 0) roots.push(f);
		}
		hunt.roots = roots.length;
		var deep = newSet(), fibers = newSet(), q = roots.slice();
		while (q.length && budget.n > 0) {
			var fib = q.shift();
			if (!fib || typeof fib !== "object" || fibers.has(fib)) continue;
			fibers.add(fib);
			budget.n--;
			var sn = fib.stateNode;
			if (sn && typeof sn === "object" && !sn.nodeType && deepFind(sn, 3, deep, budget)) return true;
			var ms = fib.memoizedState, guard = 0;
			while (ms && typeof ms === "object" && guard++ < 60) {
				var hv = ms.memoizedState;
				if (hv && typeof hv === "object" && deepFind(hv, 3, deep, budget)) return true;
				ms = ms.next;
			}
			var mp = fib.memoizedProps;
			if (mp && typeof mp === "object" && deepFind(mp, 2, deep, budget)) return true;
			if (fib.child) q.push(fib.child);
			if (fib.sibling) q.push(fib.sibling);
		}
		return false;
	}

	function scanWindow() {
		if (three.scene) return three.scene;
		adoptEarly();
		var sc = pickScene();
		if (sc) { three.scene = sc; if (!hunt.how) hunt.how = "devtools"; return sc; }
		var t0 = Date.now();
		hunt.ran++;
		var budget = { n: 9000 }, seen = newSet(), keys;
		try { keys = Object.keys(window); } catch (e) { keys = []; }
		for (var i = 0; i < keys.length && i < 400 && budget.n > 0 && !SCENES.length; i++) {
			if (SKIP_KEY.test(keys[i])) continue;
			var v;
			try { v = window[keys[i]]; } catch (e) { continue; }
			if (v && typeof v === "object") deepFind(v, 3, seen, budget);
		}
		if (!SCENES.length) scanFiber(budget);
		hunt.ms = Date.now() - t0;
		sc = pickScene();
		if (sc) {
			three.scene = sc;
			hunt.how = "hunt";
			patchRenderers();
			toast("scene found, fitting the cabin");
		}
		return sc || null;
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
		three.camera = findCamera() || three.camera;
		if (!three.camera) { three.why = "no camera"; return; }
		if (!buildCabinRig()) return;
		three.ready = true;
		three.why = "";
		state.mode = "3d";
		applyVis();
		if (!media.layer) makeMediaFrame();
		toast("cabin rig on " + (rig.host && (rig.host.name || rig.host.type) || "interior") + " | F6 refit | F3 nudge | F4 youtube");
	}

	function debugScan() {
		adoptEarly();
		var b = earlyBag();
		var parts = findParts();
		var info = {
			version: VER,
			mode: state.mode,
			ready: three.ready,
			tries: three.tries,
			three: three.T ? (three.T.REVISION || "harvested") : null,
			scenes: SCENES.length,
			renderers: RENDERERS.length,
			early: b ? {
				hooked: true,
				observe: b.observe || 0,
				scenes: (b.scenes || []).length,
				renderers: (b.renderers || []).length,
				cameras: (b.cameras || []).length,
				canvases: (b.canvases || []).length,
				ctx: (b.ctx || []).join(",")
			} : { hooked: false },
			hunt: { how: hunt.how, roots: hunt.roots, nodes: hunt.nodes, ms: hunt.ms, ran: hunt.ran },
			speedKph: telem.kph,
			source: telem.src,
			hudSpeed: dom.speed,
			hudDist: dom.dist,
			odoKm: state.odoKm,
			mediaLive: media.live,
			how: three.how || null,
			why: three.why,
			host: rig.host && (rig.host.name || rig.host.type),
			inside: rig.inside,
			lamps: lamps.list.length,
			parts: {
				wheel: parts.wheel && parts.wheel.name,
				dash: parts.dash && parts.dash.name,
				inner: parts.inner && parts.inner.name
			}
		};
		console.log("[sr-mod] scan", info);
		if (three.scene) console.log("[sr-mod] scene\n" + sceneTree(three.scene, 3, 140).join("\n"));
		toast("scan printed to console (F12)");
		return info;
	}

	if (window.SRMOD) {
		window.SRMOD.version = VER;
		window.SRMOD.scene = function () { return three.scene || null; };
		window.SRMOD.early = function () { return earlyBag(); };
		window.SRMOD.hunt = function () {
			var sc = scanWindow();
			return {
				found: !!sc,
				how: hunt.how,
				roots: hunt.roots,
				nodes: hunt.nodes,
				ms: hunt.ms,
				scenes: SCENES.length,
				renderers: RENDERERS.length
			};
		};
	}

	bootSync();
	onReady(init);
})();
