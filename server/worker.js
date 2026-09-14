/**
 * slow-roads save server — Cloudflare Worker + KV.
 *
 *   GET  /state?slot=default   -> saved JSON (or null)
 *   PUT  /state?slot=default   -> store JSON body
 *   POST /state?slot=default   -> same as PUT (used by navigator.sendBeacon)
 *
 * Client side: SRMOD.setEndpoint("https://<name>.workers.dev")
 */

const CORS = {
	"access-control-allow-origin": "*",
	"access-control-allow-methods": "GET,PUT,POST,OPTIONS",
	"access-control-allow-headers": "content-type",
	"access-control-max-age": "86400",
};

const MAX_BODY = 512 * 1024;

function json(data, status = 200) {
	return new Response(JSON.stringify(data), {
		status,
		headers: { ...CORS, "content-type": "application/json" },
	});
}

export default {
	async fetch(request, env) {
		if (request.method === "OPTIONS") return new Response(null, { headers: CORS });

		const url = new URL(request.url);
		const path = url.pathname.replace(/\/+$/, "");
		if (!path.endsWith("/state")) return json({ error: "not found" }, 404);

		const slot = (url.searchParams.get("slot") || "default").slice(0, 64).replace(/[^\w.-]/g, "");
		const key = "state:" + slot;

		if (request.method === "GET") {
			const saved = await env.SR_SAVES.get(key);
			return new Response(saved || "null", {
				headers: { ...CORS, "content-type": "application/json" },
			});
		}

		if (request.method === "PUT" || request.method === "POST") {
			const body = await request.text();
			if (body.length > MAX_BODY) return json({ error: "payload too large" }, 413);
			try {
				JSON.parse(body);
			} catch (e) {
				return json({ error: "invalid json" }, 400);
			}
			await env.SR_SAVES.put(key, body);
			return json({ ok: true, slot: slot, bytes: body.length });
		}

		return json({ error: "method not allowed" }, 405);
	},
};
