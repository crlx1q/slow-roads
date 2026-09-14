/* sr-mod loader
 *
 * The mod body lives in mods/parts as byte slices so every file stays small
 * enough to review and patch: parts 1-5 are the mod itself, part 6 is the
 * scene capture layer and part 7 finds the car in a scene where nothing has
 * a name. Every part except the last one gets its boot tail cut here, so the
 * joined source is still one closure with one boot. The slices are NOT
 * standalone scripts, only the joined source parses.
 *
 * The hooks below MUST live in this file. This is a classic script in <head>,
 * so it runs before the game bundle, while the body is fetched and therefore
 * evaluated much later - by then the game has already created its scene and
 * its renderer and the three.js devtools events are long gone. Whatever is
 * seen early is parked on window.__SR_EARLY__ and adopted by part 6.
 */
(function () {
	var VER = "0.6.2";

	var early = window.__SR_EARLY__ || (window.__SR_EARLY__ = {
		scenes: [],
		renderers: [],
		cameras: [],
		canvases: [],
		ctx: [],
		observe: 0,
		at: Date.now()
	});

	function keep(list, v) {
		if (v && list.indexOf(v) < 0 && list.length < 24) list.push(v);
	}

	/* three.js announces every scene, renderer and camera it builds on this
	 * bus, but only if the bus already exists when the object is created */
	try {
		var prev = window.__THREE_DEVTOOLS__;
		var bus = prev && typeof prev.addEventListener === "function" ? prev : new EventTarget();
		bus.addEventListener("observe", function (e) {
			var d = e && e.detail;
			if (!d) return;
			early.observe++;
			try {
				if (d.isScene) keep(early.scenes, d);
				else if (typeof d.render === "function" && d.domElement && typeof d.setSize === "function") keep(early.renderers, d);
				else if (d.isCamera) keep(early.cameras, d);
			} catch (err) {}
		});
		window.__THREE_DEVTOOLS__ = bus;
	} catch (e) {}

	/* fallback trail: the canvas the game renders into, so the late hunt has a
	 * react root to start from even when the devtools bus stays empty */
	try {
		var getCtx = HTMLCanvasElement.prototype.getContext;
		HTMLCanvasElement.prototype.getContext = function (type) {
			var ctx = getCtx.apply(this, arguments);
			try {
				if (ctx && /webgl/i.test(String(type))) {
					keep(early.canvases, this);
					if (early.ctx.indexOf(String(type)) < 0) early.ctx.push(String(type));
				}
			} catch (err) {}
			return ctx;
		};
	} catch (e) {}

	var here = document.currentScript && document.currentScript.src;
	var base = here ? here.replace(/[^/]*$/, "") : "./mods/";
	var PARTS = [
		"parts/sr-mod.1.js",
		"parts/sr-mod.2.js",
		"parts/sr-mod.3.js",
		"parts/sr-mod.4.js",
		"parts/sr-mod.5.js",
		"parts/sr-mod.6.js",
		"parts/sr-mod.7.js"
	];
	var BOOT = "\n\tbootSync();";

	function strip(text) {
		var i = text.lastIndexOf(BOOT);
		return i < 0 ? text : text.slice(0, i);
	}

	function get(url) {
		return fetch(url, { cache: "no-cache", credentials: "omit" }).then(function (r) {
			if (!r.ok) throw new Error(url + " -> " + r.status);
			return r.text();
		});
	}

	Promise.all(PARTS.map(function (p) { return get(base + p + "?v=" + VER); })).then(function (chunks) {
		var last = chunks[chunks.length - 1];
		if (last.lastIndexOf(BOOT) < 0) throw new Error("boot tail missing in the last part");
		var body = chunks.slice(0, chunks.length - 1).map(strip).join("");
		var src = body + "\n" + last + "\n//# sourceURL=sr-mod.js\n";
		try {
			new Function(src)();
		} catch (e) {
			console.error("[sr-mod] boot failed", e);
		}
	}).catch(function (e) {
		console.error("[sr-mod] cannot load mod parts", e);
	});
})();
