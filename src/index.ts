import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { McpAgent } from "agents/mcp";
import { z } from "zod";



// MCP Agent
export class MyMCP extends McpAgent<Env> {
	server = new McpServer({
		name: "Laburen MCP",
		version: "1.0.0",
	});

	async init() {
		this.server.tool(
			"list_products",
			{
			  query: z.string().optional(),
			  // opcional: permitir pasar tokens desde el agente si querés
			  terms: z.array(z.string().min(1)).optional(),
		  
			  limit: z.number().int().min(1).max(50).optional(),
			  min_price: z.number().int().min(0).optional(),
			  max_price: z.number().int().min(0).optional(),
			},
			async ({ query, terms, limit, min_price, max_price }) => {
			  const lim = limit ?? 20;
		  
			  // ---- helpers de búsqueda ----
			  const stripAccents = (s: string) =>
				s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
		  
			  const tokenize = (s: string) => {
				const raw = s
				  .toLowerCase()
				  .replace(/[^\p{L}\p{N}\s]/gu, " ")
				  .split(/\s+/)
				  .filter(Boolean);
		  
				// stopwords simples
				const stop = new Set(["de", "del", "la", "el", "los", "las", "para", "y"]);
				return raw.filter((t) => !stop.has(t));
			  };
		  
			  const singularize = (t: string) => {
				// ultra simple: pantalones -> pantalon
				if (t.length > 3 && t.endsWith("es")) return t.slice(0, -2);
				if (t.length > 3 && t.endsWith("s")) return t.slice(0, -1);
				return t;
			  };
		  
			  // IMPORTANTÍSIMO: siempre devolvemos términos NORMALIZADOS (sin tildes + lower)
			  const normalizeTerm = (t: string) => stripAccents(t.toLowerCase());
		  
			  // variantes: original, sin acento, singular, singular sin acento
			  // pero lo que realmente usamos para LIKE es el NORMALIZADO
			  const expandTerm = (t: string) => {
				const a = t;
				const b = stripAccents(t);
				const c = singularize(t);
				const d = stripAccents(c);
				return Array.from(new Set([a, b, c, d]))
				  .map((x) => normalizeTerm(x))
				  .filter((x) => x.length >= 3);
			  };
		  
			  // ---- construir términos de búsqueda ----
			  const q = (query ?? "").trim();
			  const baseTerms = (terms && terms.length ? terms : q ? tokenize(q) : []).slice(
				0,
				6
			  ); // cap por seguridad
		  
			  // 1 grupo por término base, con variantes normalizadas
			  // ✅ Entre grupos: AND (todos los términos deben estar)
			  // ✅ Dentro del grupo: OR (cualquiera de sus variantes sirve)
			  const termGroups = baseTerms
				.map((t) => Array.from(new Set(expandTerm(t))).slice(0, 6)) // cap por grupo
				.filter((g) => g.length > 0)
				.slice(0, 6); // cap grupos
		  
			  // ---- filtros ----
			  const minP = typeof min_price === "number" ? min_price : null;
			  const maxP = typeof max_price === "number" ? max_price : null;
			  const min = minP !== null && maxP !== null ? Math.min(minP, maxP) : minP;
			  const max = minP !== null && maxP !== null ? Math.max(minP, maxP) : maxP;
		  
			  const where: string[] = [];
			  const params: any[] = [];
		  
			  // --- NORMALIZACIÓN EN SQL (quita tildes + lower) ---
			  const normSql = (col: string) => `
				REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(LOWER(${col}),
				'á','a'),'é','e'),'í','i'),'ó','o'),'ú','u'),'ü','u'),'ñ','n')
			  `;
		  
			  if (termGroups.length > 0) {
				const groupSql = termGroups
				  .map((group) => {
					const ors = group
					  .map(
						() => `(${normSql("name")} LIKE ? OR ${normSql("description")} LIKE ?)`
					  )
					  .join(" OR ");
					return `(${ors})`;
				  })
				  .join(" AND ");
		  
				where.push(`(${groupSql})`);
		  
				for (const group of termGroups) {
				  for (const v of group) {
					const like = `%${v}%`;
					params.push(like, like);
				  }
				}
			  }
		  
			  if (min !== null) {
				where.push("price >= ?");
				params.push(min);
			  }
			  if (max !== null) {
				where.push("price <= ?");
				params.push(max);
			  }
		  
			  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
		  
			  const sql = `
				SELECT id, name, description, price, stock
				FROM products
				${whereSql}
				ORDER BY stock DESC, price ASC, id DESC
				LIMIT ?
			  `;
			  params.push(lim);
		  
			  const res = await this.env.DB.prepare(sql).bind(...params).all();
		  
			  return {
				content: [{ type: "text", text: JSON.stringify(res.results ?? [], null, 2) }],
			  };
			}
		  );
		  
		  
		  
		this.server.tool(
			"create_cart",
			{
			  conversation_id: z.string().min(1),
			},
			async ({ conversation_id }) => {
			  const now = new Date().toISOString();
		  
			  const existing = await this.env.DB
				.prepare(
				  `SELECT id, conversation_id, created_at, updated_at
				   FROM carts
				   WHERE conversation_id = ?
				   LIMIT 1`,
				)
				.bind(conversation_id)
				.first();
		  
			  if (existing) {
				return {
				  content: [{ type: "text", text: JSON.stringify(existing, null, 2) }],
				};
			  }
		  
			  const cartId = crypto.randomUUID();
		  
			  await this.env.DB
				.prepare(
				  `INSERT INTO carts (id, conversation_id, created_at, updated_at)
				   VALUES (?, ?, ?, ?)`,
				)
				.bind(cartId, conversation_id, now, now)
				.run();
		  
			  return {
				content: [
				  {
					type: "text",
					text: JSON.stringify(
					  { id: cartId, conversation_id, created_at: now, updated_at: now },
					  null,
					  2,
					),
				  },
				],
			  };
			},
		  );
		  this.server.tool(
			"update_cart",
			{
			  conversation_id: z.string().min(1),
			  product_id: z.number().int(),
			  qty: z.number().int(),
			},
			async ({ conversation_id, product_id, qty }) => {
			  const now = new Date().toISOString();
		  
			  // Obtener carrito
			  const cart = await this.env.DB
				.prepare(`SELECT id FROM carts WHERE conversation_id = ? LIMIT 1`)
				.bind(conversation_id)
				.first();
		  
			  if (!cart) {
				return {
				  content: [{ type: "text", text: "Cart not found" }],
				};
			  }
		  
			  const cartId = cart.id as string;
		  
			  if (qty <= 0) {
				// eliminar item
				await this.env.DB
				  .prepare(`DELETE FROM cart_items WHERE cart_id = ? AND product_id = ?`)
				  .bind(cartId, product_id)
				  .run();
			  } else {
				// upsert item
				await this.env.DB
				  .prepare(
					`INSERT INTO cart_items (cart_id, product_id, qty)
					 VALUES (?, ?, ?)
					 ON CONFLICT(cart_id, product_id)
					 DO UPDATE SET qty = excluded.qty`,
				  )
				  .bind(cartId, product_id, qty)
				  .run();
			  }
		  
			  await this.env.DB
				.prepare(`UPDATE carts SET updated_at = ? WHERE id = ?`)
				.bind(now, cartId)
				.run();
		  
			  return {
				content: [
				  {
					type: "text",
					text: JSON.stringify({ cart_id: cartId, product_id, qty }, null, 2),
				  },
				],
			  };
			},
		  );
		  this.server.tool(
			"get_cart",
			{
			  conversation_id: z.string().min(1),
			},
			async ({ conversation_id }) => {
			  const cart = await this.env.DB
				.prepare(`SELECT id FROM carts WHERE conversation_id = ? LIMIT 1`)
				.bind(conversation_id)
				.first();
		  
			  if (!cart) {
				return {
				  content: [{ type: "text", text: "Cart not found" }],
				};
			  }
		  
			  const cartId = cart.id as string;
		  
			  const items = await this.env.DB
				.prepare(
				  `SELECT p.id, p.name, p.price, ci.qty
				   FROM cart_items ci
				   JOIN products p ON p.id = ci.product_id
				   WHERE ci.cart_id = ?`,
				)
				.bind(cartId)
				.all();
		  
			  return {
				content: [
				  {
					type: "text",
					text: JSON.stringify(
					  {
						cart_id: cartId,
						items: items.results ?? [],
					  },
					  null,
					  2,
					),
				  },
				],
			  };
			},
		  );
		  
		  
		  
	}
}

export default {
	fetch(request: Request, env: Env, ctx: ExecutionContext) {
		const url = new URL(request.url);

		if (url.pathname === "/mcp") {
			return MyMCP.serve("/mcp").fetch(request, env, ctx);
		}

		return new Response("Not found", { status: 404 });
	},
};
