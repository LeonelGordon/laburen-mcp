Laburen MCP

MCP desarrollado para el challenge técnico de AI Engineer – Laburen.

Implementa un agente de compras con:

Exploración de productos

Carrito por conversación

Filtros por texto y precio

Derivación a humano vía Chatwoot

Deploy serverless en Cloudflare

Stack

Cloudflare Workers (MCP runtime)

D1 (SQLite)

Chatwoot API

Wrangler

Funcionalidades
Productos

Tool

list_products


Búsqueda por nombre / descripción

Matching sin tildes

Filtros opcionales por precio

Carrito

Un carrito por conversación:

create_cart
update_cart
get_cart

Handoff humano
handoff_to_human


Acciones:

Parseo del conversation_id (incluye IDs decorados)

Label handoff

Nota privada con contexto

Apertura de conversación para agente humano

Deploy
npm install
npx wrangler deploy

Logs / Debug

Logs en tiempo real:

npx wrangler tail


Permite ver:

Ejecución de tools

Requests a Chatwoot

Errores HTTP

Tiempos de respuesta

Usado durante el desarrollo para validar handoff y flujos MCP.

Secrets

Token Chatwoot:

npx wrangler secret put CHATWOOT_API_TOKEN


Acceso desde Worker:

this.env.CHATWOOT_API_TOKEN

Autor

Leonel Gordon – Argentina