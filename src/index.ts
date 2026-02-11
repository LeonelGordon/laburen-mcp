import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { McpAgent } from "agents/mcp";
import { z } from "zod";

const mkTrace = (tool: string) =>
  `${tool}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

const ms = (start: number) => Date.now() - start;

const safeErr = (e: any) => ({
  message: e?.message ?? String(e),
  name: e?.name,
  stack: e?.stack ? String(e.stack).slice(0, 800) : undefined,
});

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
        terms: z.array(z.string().min(1)).optional(),
        limit: z.number().int().min(1).max(50).optional(),
        min_price: z.number().int().min(0).optional(),
        max_price: z.number().int().min(0).optional(),
      },
      async ({ query, terms, limit, min_price, max_price }) => {
        const traceId = mkTrace("list_products");
        const t0 = Date.now();

        console.log("[tool:list_products] start", {
          traceId,
          hasQuery: Boolean(query && query.trim()),
          queryPreview: (query ?? "").slice(0, 40),
          termsCount: terms?.length ?? 0,
          termsPreview: (terms ?? []).slice(0, 6),
          limit,
          min_price,
          max_price,
        });

        try {
          const lim = limit ?? 20;

          const stripAccents = (s: string) =>
            s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");

          const tokenize = (s: string) => {
            const raw = s
              .toLowerCase()
              .replace(/[^\p{L}\p{N}\s]/gu, " ")
              .split(/\s+/)
              .filter(Boolean);

            const stop = new Set(["de", "del", "la", "el", "los", "las", "para", "y"]);
            return raw.filter((t) => !stop.has(t));
          };

          const singularize = (t: string) => {
            if (t.length > 3 && t.endsWith("es")) return t.slice(0, -2);
            if (t.length > 3 && t.endsWith("s")) return t.slice(0, -1);
            return t;
          };

          const normalizeTerm = (t: string) => stripAccents(t.toLowerCase());

          const expandTerm = (t: string) => {
            const a = t;
            const b = stripAccents(t);
            const c = singularize(t);
            const d = stripAccents(c);
            return Array.from(new Set([a, b, c, d]))
              .map((x) => normalizeTerm(x))
              .filter((x) => x.length >= 3);
          };

          const q = (query ?? "").trim();
          const baseTerms = (terms && terms.length ? terms : q ? tokenize(q) : []).slice(0, 6);

          const termGroups = baseTerms
            .map((t) => Array.from(new Set(expandTerm(t))).slice(0, 6))
            .filter((g) => g.length > 0)
            .slice(0, 6);

          const minP = typeof min_price === "number" ? min_price : null;
          const maxP = typeof max_price === "number" ? max_price : null;
          const min = minP !== null && maxP !== null ? Math.min(minP, maxP) : minP;
          const max = minP !== null && maxP !== null ? Math.max(minP, maxP) : maxP;

          const where: string[] = [];
          const params: any[] = [];

          const normSql = (col: string) => `
            REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(LOWER(${col}),
            'á','a'),'é','e'),'í','i'),'ó','o'),'ú','u'),'ü','u'),'ñ','n')
          `;

          if (termGroups.length > 0) {
            const groupSql = termGroups
              .map((group) => {
                const ors = group
                  .map(() => `(${normSql("name")} LIKE ? OR ${normSql("description")} LIKE ?)`)
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

          console.log("[tool:list_products] query_built", {
            traceId,
            baseTerms,
            termGroupsCount: termGroups.length,
            whereClauses: where.length,
            paramsCount: params.length,
            limit: lim,
          });

          const res = await this.env.DB.prepare(sql).bind(...params).all();
          const results = (res.results ?? []) as any[];

          console.log("[tool:list_products] done", {
            traceId,
            ms: ms(t0),
            resultsCount: results.length,
            topIds: results.slice(0, 5).map((r) => r?.id),
          });

          return {
            content: [{ type: "text", text: JSON.stringify(results, null, 2) }],
          };
        } catch (e: any) {
          console.error("[tool:list_products] error", { traceId, ms: ms(t0), ...safeErr(e) });
          return {
            content: [{ type: "text", text: JSON.stringify({ error: "list_products_failed", traceId }, null, 2) }],
          };
        }
      }
    );

    this.server.tool(
      "create_cart",
      { conversation_id: z.string().min(1) },
      async ({ conversation_id }) => {
        const traceId = mkTrace("create_cart");
        const t0 = Date.now();

        console.log("[tool:create_cart] start", { traceId, conversation_id });

        try {
          const now = new Date().toISOString();

          const existing = await this.env.DB
            .prepare(
              `SELECT id, conversation_id, created_at, updated_at
               FROM carts
               WHERE conversation_id = ?
               LIMIT 1`
            )
            .bind(conversation_id)
            .first();

          if (existing) {
            console.log("[tool:create_cart] existing", { traceId, ms: ms(t0), cart_id: (existing as any)?.id });
            return { content: [{ type: "text", text: JSON.stringify(existing, null, 2) }] };
          }

          const cartId = crypto.randomUUID();

          await this.env.DB
            .prepare(
              `INSERT INTO carts (id, conversation_id, created_at, updated_at)
               VALUES (?, ?, ?, ?)`
            )
            .bind(cartId, conversation_id, now, now)
            .run();

          console.log("[tool:create_cart] created", { traceId, ms: ms(t0), cart_id: cartId });

          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({ id: cartId, conversation_id, created_at: now, updated_at: now }, null, 2),
              },
            ],
          };
        } catch (e: any) {
          console.error("[tool:create_cart] error", { traceId, ms: ms(t0), ...safeErr(e) });
          return {
            content: [{ type: "text", text: JSON.stringify({ error: "create_cart_failed", traceId }, null, 2) }],
          };
        }
      }
    );

    this.server.tool(
      "update_cart",
      {
        conversation_id: z.string().min(1),
        product_id: z.number().int(),
        qty: z.number().int(),
      },
      async ({ conversation_id, product_id, qty }) => {
        const traceId = mkTrace("update_cart");
        const t0 = Date.now();

        console.log("[tool:update_cart] start", { traceId, conversation_id, product_id, qty });

        try {
          const now = new Date().toISOString();

          const cart = await this.env.DB
            .prepare(`SELECT id FROM carts WHERE conversation_id = ? LIMIT 1`)
            .bind(conversation_id)
            .first();

          if (!cart) {
            console.log("[tool:update_cart] cart_not_found", { traceId, ms: ms(t0) });
            return { content: [{ type: "text", text: "Cart not found" }] };
          }

          const cartId = (cart as any).id as string;

          if (qty <= 0) {
            await this.env.DB
              .prepare(`DELETE FROM cart_items WHERE cart_id = ? AND product_id = ?`)
              .bind(cartId, product_id)
              .run();

            console.log("[tool:update_cart] deleted_item", { traceId, ms: ms(t0), cart_id: cartId });
          } else {
            await this.env.DB
              .prepare(
                `INSERT INTO cart_items (cart_id, product_id, qty)
                 VALUES (?, ?, ?)
                 ON CONFLICT(cart_id, product_id)
                 DO UPDATE SET qty = excluded.qty`
              )
              .bind(cartId, product_id, qty)
              .run();

            console.log("[tool:update_cart] upsert_item", { traceId, ms: ms(t0), cart_id: cartId });
          }

          await this.env.DB.prepare(`UPDATE carts SET updated_at = ? WHERE id = ?`).bind(now, cartId).run();

          console.log("[tool:update_cart] done", { traceId, ms: ms(t0), cart_id: cartId });

          return {
            content: [{ type: "text", text: JSON.stringify({ cart_id: cartId, product_id, qty }, null, 2) }],
          };
        } catch (e: any) {
          console.error("[tool:update_cart] error", { traceId, ms: ms(t0), ...safeErr(e) });
          return {
            content: [{ type: "text", text: JSON.stringify({ error: "update_cart_failed", traceId }, null, 2) }],
          };
        }
      }
    );

    this.server.tool(
      "get_cart",
      { conversation_id: z.string().min(1) },
      async ({ conversation_id }) => {
        const traceId = mkTrace("get_cart");
        const t0 = Date.now();

        console.log("[tool:get_cart] start", { traceId, conversation_id });

        try {
          const cart = await this.env.DB
            .prepare(`SELECT id FROM carts WHERE conversation_id = ? LIMIT 1`)
            .bind(conversation_id)
            .first();

          if (!cart) {
            console.log("[tool:get_cart] cart_not_found", { traceId, ms: ms(t0) });
            return { content: [{ type: "text", text: "Cart not found" }] };
          }

          const cartId = (cart as any).id as string;

          const items = await this.env.DB
            .prepare(
              `SELECT p.id, p.name, p.price, ci.qty
               FROM cart_items ci
               JOIN products p ON p.id = ci.product_id
               WHERE ci.cart_id = ?`
            )
            .bind(cartId)
            .all();

          const results = (items.results ?? []) as any[];

          console.log("[tool:get_cart] done", { traceId, ms: ms(t0), cart_id: cartId, itemsCount: results.length });

          return {
            content: [{ type: "text", text: JSON.stringify({ cart_id: cartId, items: results }, null, 2) }],
          };
        } catch (e: any) {
          console.error("[tool:get_cart] error", { traceId, ms: ms(t0), ...safeErr(e) });
          return {
            content: [{ type: "text", text: JSON.stringify({ error: "get_cart_failed", traceId }, null, 2) }],
          };
        }
      }
    );

    this.server.tool(
      "handoff_to_human",
      {
        conversation_id: z.string().min(1),
        reason: z.string().min(1),
        context: z.string().min(1).max(4000),
        labels: z.array(z.string().min(1)).optional(),
      },
      async ({ conversation_id, reason, context, labels }) => {
        const traceId = mkTrace("handoff_to_human");
        const t0 = Date.now();
    
        console.log("[tool:handoff_to_human] start", {
          traceId,
          conversation_id,
          reason,
          labels: labels ?? [],
          context_len: context?.length ?? 0,
        });
    
        const base = "https://chatwootchallenge.laburen.com";
        const accountId = "87";
        const token = this.env.CHATWOOT_API_TOKEN;
    
        if (!token) {
          console.error("[tool:handoff_to_human] missing_token", { traceId, ms: ms(t0) });
          return { content: [{ type: "text", text: "Missing secret: CHATWOOT_API_TOKEN" }] };
        }
    
        // ✅ Chatwoot API requiere conversation_id numérico.
        // En este challenge, el agente te pasa algo tipo: chatwoot_..._118_87_59
        // Según la docs, la API NO acepta IDs decorados; hay que extraer el ID numérico real.
        // En ese formato, el ID real de conversación suele ser el ÚLTIMO número (59).
        const parseConversationId = (raw: string): number | null => {
          // caso 1: numérico directo
          const direct = Number(raw);
          if (Number.isFinite(direct)) return direct;
    
          // caso 2: patrón final _<x>_<accountId>_<y>  -> tomar el último
          const m = raw.match(/_(\d+)_(\d+)_(\d+)$/);
          if (m) return Number(m[3]);
    
          // fallback: último número encontrado
          const all = raw.match(/\d+/g);
          if (all && all.length) return Number(all[all.length - 1]);
    
          return null;
        };
    
        const convoIdNum = parseConversationId(conversation_id);
        if (convoIdNum === null) {
          console.error("[tool:handoff_to_human] invalid_conversation_id", { traceId, conversation_id });
          return {
            content: [{ type: "text", text: `Invalid conversation_id: ${conversation_id}` }],
          };
        }
    
        console.log("[tool:handoff_to_human] parsed_conversation_id", {
          traceId,
          raw: conversation_id,
          convoIdNum,
        });
    
        const headers: Record<string, string> = {
          "Content-Type": "application/json",
          api_access_token: token,
        };
    
        const convoUrl = `${base}/api/v1/accounts/${accountId}/conversations/${convoIdNum}`;
    
        const result: any = {
          ok: false,
          traceId,
          chatwoot_conversation_id: convoIdNum,
        };
    
        // 1) Labels — siempre incluir "handoff"
        const finalLabels = Array.from(new Set([...(labels ?? []), "handoff"]));
    
        try {
          const resLabels = await fetch(`${convoUrl}/labels`, {
            method: "POST",
            headers,
            body: JSON.stringify({ labels: finalLabels }),
          });
    
          result.labels_status = resLabels.status;
    
          if (resLabels.ok) {
            result.labels_applied = finalLabels;
          } else {
            const txt = await resLabels.text();
            result.labels_error = `Failed to add labels: ${resLabels.status} ${txt}`;
          }
    
          console.log("[tool:handoff_to_human] labels_done", {
            traceId,
            ms: ms(t0),
            ok: resLabels.ok,
            status: resLabels.status,
            labels: finalLabels,
          });
        } catch (e: any) {
          result.labels_error = `Failed to add labels (network): ${e?.message ?? String(e)}`;
          console.error("[tool:handoff_to_human] labels_error", { traceId, ms: ms(t0), ...safeErr(e) });
        }
    
        // 2) Nota privada con contexto (no loguear el contenido)
        const noteBody =
          `🤝 HANDOFF A HUMANO\n` +
          `Motivo: ${reason}\n\n` +
          `Resumen / Contexto:\n${context}\n`;
    
        const resMsg = await fetch(`${convoUrl}/messages`, {
          method: "POST",
          headers,
          body: JSON.stringify({
            content: noteBody,
            private: true,
          }),
        });
    
        result.private_message_status = resMsg.status;
    
        if (!resMsg.ok) {
          const txt = await resMsg.text();
          result.private_message = "failed";
          result.private_message_error = `Failed to create private message: ${resMsg.status} ${txt}`;
          console.error("[tool:handoff_to_human] private_message_failed", {
            traceId,
            ms: ms(t0),
            status: resMsg.status,
          });
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }
    
        result.private_message = "created";
        console.log("[tool:handoff_to_human] private_message_created", {
          traceId,
          ms: ms(t0),
          status: resMsg.status,
        });
    
        // 3) Abrir conversación para humano
        try {
          const resOpen = await fetch(convoUrl, {
            method: "PATCH",
            headers,
            body: JSON.stringify({ status: "open" }),
          });
    
          result.status_open_http = resOpen.status;
    
          if (resOpen.ok) result.status_open = "ok";
          else result.status_open = `failed: ${resOpen.status} ${await resOpen.text()}`;
    
          console.log("[tool:handoff_to_human] status_set", {
            traceId,
            ms: ms(t0),
            ok: resOpen.ok,
            status: resOpen.status,
          });
        } catch (e: any) {
          result.status_open = `failed (network): ${e?.message ?? String(e)}`;
          console.error("[tool:handoff_to_human] status_error", { traceId, ms: ms(t0), ...safeErr(e) });
        }
    
        result.ok = true;
    
        console.log("[tool:handoff_to_human] done", { traceId, ms: ms(t0), ok: true });
    
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      }
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
