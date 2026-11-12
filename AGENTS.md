# AGENTS.md — Dashboard

> Para cualquier IA o agente que trabaje en esta carpeta.
> **Contexto general de Arturo y de La Barra:** `/home/arturo/second-brain/AGENTS.md` (y `INDICE.md`).

## Regla obligatoria
Al terminar cualquier cambio o revisión aquí:
1. Agrega una entrada en la sección **Registro** de este archivo.
2. Agrega un resumen al final de `/home/arturo/second-brain/log.md`.
3. Si tienes memoria propia, guárdalo ahí también.
Formato: `### AAAA-MM-DD · Qué se hizo — Agente` + qué se hizo, qué se aprendió y qué falta.

## Qué es
Punto de venta y finanzas de La Barra: ventas, gastos, mesas, productos, inventario, cortes y comparativa de sucursales. HTML/JS vanilla con ES Modules, Firebase 10 por CDN (proyecto `la-barra-data`), en Vercel. **Las reglas técnicas detalladas están en `CLAUDE.md`** (NUNCA tocar datos existentes en Firebase).
- **Visión (Arturo, 2026-11-07):** se maneja aparte del menú. A futuro, lo mejor de aquí se pasará a Menulabarra y este dashboard se dejará de usar.

## Documentación existente
- `CLAUDE.md` (reglas técnicas y arquitectura), `BITACORA_MIGRACION_Y_FUTURO.md`, `PLAN_INVENTARIO_Y_METRICAS.md`, `PLAN_MIGRACION_ARQUITECTURA.md`
- Revisión: `/home/arturo/second-brain/04-software/SISTEMAS.md`

## Registro
### 2026-11-07 · Revisión (solo lectura) — Claude
- Estado: activo (último commit 2026-10-26). Problemas: el login es un hash en el JS cliente (se puede saltar); las reglas de `la-barra-data` no están en el repo, hay que revisarlas en la consola; los gastos se registran todos como "Gastos (General)", sin categorías útiles.
- Se exportó el respaldo anual a `second-brain/03-la-barra/datos/` y se analizó en `VENTAS-2026.md`.

### 2026-11-12 · Pagos efectivo/tarjeta, cambio en caja, arreglo de opciones y diseño tipo iPhone — Claude
- **Arreglo:** en la ventana de opciones de un producto, el `−`/`+` solo cambiaba el número en pantalla y siempre agregaba 1. Ahora agrega la cantidad elegida con la misma selección (`changeModifierQty` en `pos-ui.js`).
- **Efectivo / Tarjeta en todas las ventas** (no solo con inventario): `paymentMethod`, y con tarjeta `cardFee` = 4.06% del cobro (3.5% + impuestos). Se ve en el pedido ("recibes $X"), en el historial (se puede buscar "tarjeta"), en Principal (efectivo/tarjeta y la comisión se resta de la ganancia neta) y en el corte.
- **Cambio en caja:** al cargar inventario/reabastecer, "¿Dejas cambio? Sí/No" + cuánto (sugiere el de la última vez). En el corte, sección **Caja**: cambio (corregible), ventas en efectivo, efectivo que debe haber, efectivo contado (opcional) y diferencia; tarjeta con comisión y lo que deposita la terminal.
- **Diseño tipo iPhone** (modo oscuro de iOS): ver CLAUDE.md.
- Nuevo `js/models/Payment.js` + `tests/payment.test.mjs` (76 pruebas pasan). Versión 2.4.0. Probado con capturas en copia local (sin Firebase real). Sin commit: Arturo lo prueba primero.
- Aprendido: `node --check a.js b.js` solo revisa el primer archivo; hay que recorrerlos uno por uno.
- Pendiente: la comparativa de sucursales todavía no resta comisiones de tarjeta; modo claro (si lo quiere).

