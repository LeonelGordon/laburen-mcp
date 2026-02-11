#  Laburen MCP

MCP desarrollado para el challenge técnico de **AI Engineer – Laburen**.

Agente de compras construido sobre MCP con capacidades de:

-  Exploración de productos  
-  Carrito por conversación  
-  Filtros por texto y precio  
-  Derivación a humano vía Chatwoot  
-  Deploy serverless en Cloudflare  

---

## Arquitectura / Stack

- Cloudflare Workers (MCP runtime)  
- D1 (SQLite)  
- Chatwoot API  
- Wrangler  

---

##  Funcionalidades

### Productos

**Tool**

```text
list_products
Incluye:

Búsqueda por nombre / descripción

Matching sin tildes

Filtros opcionales por precio

Carrito
Un carrito por conversación:

create_cart
update_cart
get_cart

Handoff a humano
handoff_to_human
Acciones realizadas:

Parseo de conversation_id (incluye IDs decorados)

Aplicación automática del label handoff

Creación de nota privada con contexto del agente

Apertura de conversación para atención humana

Deploy
npm install
npx wrangler deploy
Observabilidad / Logs
Logs en tiempo real:

npx wrangler tail
Permite inspeccionar:

Ejecución de tools MCP

Requests hacia Chatwoot

Errores HTTP

Latencias y tiempos de respuesta

Utilizado durante el desarrollo para validar flujos MCP y handoff humano.

Secrets
Configuración del token de Chatwoot:

npx wrangler secret put CHATWOOT_API_TOKEN
Acceso desde el Worker:

this.env.CHATWOOT_API_TOKEN

Autor
Leonel Gordon
