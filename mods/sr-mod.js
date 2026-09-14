/* sr-mod loader
 * The mod is stored as byte slices under mods/parts so every file stays small
 * enough to review and patch. Parts 1-4 are the v0.5.0 body, part 5 is the
 * v0.6.0 cabin rig layer. That layer has to live inside the same closure, so
 * the boot tail at the end of part 4 is cut here and re-added by part 5.
 * The slices are NOT standalone scripts: only the joined source parses.
 */
(function () {
	var VER = "0.6.0";
	var here = document.currentScript && document.currentScript.src;
	var base = here ? here.replace(/[^/]*$/, "") : "./mods/";
	var PARTS = [
		"parts/sr-mod.1.js",
		"parts/sr-mod.2.js",
		"parts/sr-mod.3.js",
		"parts/sr-mod.4.js",
		"parts/sr-mod.5.js"
	];
	var BOOT = "\n\tbootSync();";

	function get(url) {
		return fetch(url, { cache: "no-cache", credentials: "omit" }).then(function (r) {
			if (!r.ok) throw new Error(url + " -> " + r.status);
			return r.text();
		});
	}

	Promise.all(PARTS.map(function (p) { return get(base + p + "?v=" + VER); })).then(function (chunks) {
		var body = chunks.slice(0, 4).join("");
		var cut = body.lastIndexOf(BOOT);
		if (cut < 0) throw new Error("boot tail not found in parts 1-4");
		var src = body.slice(0, cut) + "\n" + chunks[4] + "\n//# sourceURL=sr-mod.js\n";
		try {
			new Function(src)();
		} catch (e) {
			console.error("[sr-mod] boot failed", e);
		}
	}).catch(function (e) {
		console.error("[sr-mod] cannot load mod parts", e);
	});
})();
