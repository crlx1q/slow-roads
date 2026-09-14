/* slow-roads mod loader v0.5.0
 * The mod itself lives in mods/parts/sr-mod.[1-4].js as four byte-fragments,
 * so it can be published and patched in small pieces. They are fetched in
 * order, concatenated and executed here. The fragments are deliberately NOT
 * valid JavaScript on their own: only the concatenation is.
 * Docs: docs/MODS.md
 */
(function () {
	"use strict";

	var VER = "0.5.0";
	var here = (document.currentScript && document.currentScript.src) || "";
	var base = here ? here.replace(/[^/]*$/, "") : "./mods/";
	var PARTS = [
		"parts/sr-mod.1.js",
		"parts/sr-mod.2.js",
		"parts/sr-mod.3.js",
		"parts/sr-mod.4.js"
	];

	function get(url) {
		return fetch(url, { cache: "no-cache", credentials: "omit" }).then(function (r) {
			if (!r.ok) throw new Error(url + " -> " + r.status);
			return r.text();
		});
	}

	Promise.all(PARTS.map(function (p) { return get(base + p + "?v=" + VER); })).then(function (chunks) {
		var src = chunks.join("") + "\n//# sourceURL=sr-mod.js\n";
		try {
			new Function(src)();
		} catch (e) {
			console.error("[sr-mod] boot failed", e);
		}
	}).catch(function (e) {
		console.error("[sr-mod] cannot load mod parts", e);
	});
})();
