# Plan: Gastos ordenados, Modificadores globales, Inventario por sucursal, Cortes y Métricas

**Estado:** 🚧 En implementación — F0, F1, F2 y rediseño probados; F7a, F3 y F4 en prueba local. Avance detallado en CLAUDE.md
**Rama:** `Buenaspracticas`
**Fecha:** 2026-10-15
**Restricción clave:** todo el análisis y las recomendaciones se calculan en el navegador con algoritmos (promedios, percentiles, reglas). **Sin IA ni APIs externas.**

---

## 0. Diagnóstico rápido del proyecto actual

### Lo que está bien y se conserva
- Arquitectura por capas (`config/ core/ models/ services/ ui/`) y `app.js` como orquestador.
- Flujo de registro de gastos (chips de atajos → monto por cada uno → varios gastos de una vez). **No se cambia la captura**, solo cómo se muestra la lista.
- Flujo de ventas POS + mesas, borrador, offline con `temp_` y re-sincronización.
- `itemsSoldArray` en cada venta: ya guarda `productId`, `qty`, `price`, modificadores. Es la base de todas las métricas nuevas.

### Hallazgos técnicos a tener en cuenta (no bloquean, pero influyen en el diseño)
| # | Hallazgo | Dónde | Impacto | Propuesta |
|---|----------|-------|---------|-----------|
| H1 | La hora de venta no es confiable: `createLocalDateFromInput()` toma la fecha elegida + la hora *actual*. Si registras una venta de ayer, se guarda con la hora de ahora. | `js/core/date-utils.js` | Las métricas por hora saldrían mal | Campo nuevo `soldAt` (hora real) + selector de hora opcional cuando se registra con otra fecha |
| H2 | La sincronización de productos/categorías/atajos **borra toda la colección y la reescribe** en cada guardado. | `products-service.js` `sync*ToCloud` | Con 2 dispositivos guardando a la vez se pueden perder cambios | Las colecciones nuevas usarán escritura por documento (`setDoc/updateDoc`). Migrar las existentes en una fase técnica |
| H3 | Si una colección llega vacía de Firebase, se sube lo local. | `subscribe*` | Puede "resucitar" datos borrados | Mantener solo para el arranque inicial; no replicar en colecciones nuevas |
| H4 | `fetchTransactions` escucha **todas** las transacciones históricas. | `transactions-service.js` | Crecerá en costo/lentitud con meses de datos | Más adelante: limitar por rango de fechas; los cortes guardan resúmenes para no recalcular todo |
| H5 | Los modificadores viven dentro de cada producto. | `models/Product.js` | Duplicación (tema de esta mejora) | Fase 3 |
| H6 | No hay pruebas automatizadas. | — | La lógica de inventario/métricas es delicada | Funciones puras en `js/analytics/` y `js/models/` probadas con `node --test` (sin dependencias) |

---

## Orden de implementación propuesto

| Fase | Qué | Por qué en este orden |
|------|-----|-----------------------|
| **F1** | Hora de venta (`soldAt`) | Es pequeño y conviene que **empiece a acumular datos ya**, aunque las métricas lleguen después |
| **F2** | Lista de gastos ordenada | Independiente, rápido, mejora inmediata |
| **F3** | Modificadores globales reutilizables | Necesario antes del inventario (los modificadores también pueden descontar inventario) |
| **F4** | Artículos de inventario + consumo por producto (el "doble valor") | Base del control |
| **F5** | Jornada por sucursal: carga de inventario, descuento en vivo y **Corte del día** | Usa F1+F4 |
| **F6** | Sección **Cortes / Reportes**: métricas semanales y recomendaciones | Usa los cortes guardados en F5 |
| **F7** (opcional) | Deuda técnica: H2, H3, H4, reglas de Firestore | Cuando lo nuevo esté estable |

Cada fase se entrega como un commit (o varios) funcional por sí mismo, con verificación `node --check` + pruebas de funciones puras + prueba manual en navegador.

---

## F1 — Hora de venta

**Objetivo:** cada venta tiene la hora real en que se vendió.

- Nuevo campo en transacciones: `soldAt` (ISO con hora real).
  - Venta normal: `soldAt = ahora`.
  - Mesa: `soldAt` = hora de cobro; además cada ítem de mesa guarda `addedAt` (hora en que se pidió) → para métricas de "a qué hora sale cada producto" se usa `addedAt` si existe.
  - Venta registrada en otra fecha: aparece un campo **hora** (opcional) junto a la fecha; si no se llena, se marca `timeEstimated: true` y se excluye de métricas por hora.
- Datos viejos: se usa `createdAt` como respaldo de hora (con `timeEstimated: true` si `date` y `createdAt` caen en días distintos).
- UI: el historial y "transacciones recientes" muestran `14:35` junto a la fecha.
- Helper nuevo en `date-utils.js`: `getSaleTimestamp(tx)` (única fuente de verdad para la hora).

---

## F2 — Lista de gastos más fácil de encontrar

**Situación actual:** los atajos de gasto (chips del modal "Registrar Gasto") se muestran todos juntos en orden alfabético.

> ⚠️ Supuesto: me refiero a los **chips de atajos del modal de gasto** (y su lista en Productos → "Accesos Rápidos de Gastos"). Si te referías a la tabla "Gastos por Concepto" del historial, aplica la misma idea de grupos.

**Propuesta (sin cambiar cómo se captura):**
1. **Grupos de gasto** definidos por ti, ej.: *Insumos/Carne, Verdura, Bebidas, Desechables, Gas/Servicios, Personal, Otros*. Cada atajo tiene un `groupId`.
   - Modelo: `dashboard_expense_groups` `{id, name, color, icon, order}` y en el atajo: `groupId`.
   - Atajos sin grupo caen en "Sin grupo" (migración automática, nada se rompe).
2. **Barra de búsqueda** arriba de los chips (filtra en vivo, ignora acentos — ya existe `normalizeText`).
3. **Fila "Frecuentes"** al inicio: los 6–8 gastos más registrados en los últimos 30 días (calculado de las transacciones, sin configurar nada).
4. **Grupos colapsables** debajo, cada uno con su color; dentro, orden alfabético (o drag & drop como ya hay en productos).
5. **Último precio pagado** como placeholder del input de monto (ej. "Último: $180") → acelera la captura y sirve para detectar cambios de precio.
6. En la administración: asignar grupo con un selector y arrastrar entre grupos.
7. En el historial "Gastos por Concepto": opción de ver **por grupo** (total de Insumos, Bebidas…) con subtotales desplegables.

---

## F3 — Modificadores globales (reutilizables en varios productos)

**Hoy:** `product.modifiers = [{name, type, options[]}]` embebidos en cada producto.

**Nuevo modelo:**
```js
// colección: dashboard_modifier_groups
{
  id: 'modg_...',
  name: 'Salsas',
  type: 'single' | 'multiple',
  required: false,          // obligar a elegir
  maxSelect: null,          // límite en 'multiple'
  options: [{ id, name, price, stockUsage: [] }], // stockUsage se usa en F4
  order: 0
}
// producto
{ ..., modifierGroupIds: ['modg_salsas', 'modg_extras'] }
```

**UI:**
- Nueva pestaña en Productos: **"Modificadores"** — crear/editar grupos y sus opciones una sola vez.
- En el formulario de producto se reemplaza el editor embebido por una lista de **checkboxes de grupos** ("¿Qué modificadores aplica?").
- Desde la pantalla de un modificador: "Aplicar a…" con selección múltiple de productos o de una categoría completa (ej. aplicar "Salsas" a toda la categoría Burritos).
- Si editas un modificador, cambia en todos los productos que lo usan.

**Migración (automática y segura):**
1. Al cargar, si un producto tiene `modifiers` embebidos y no tiene `modifierGroupIds`, se convierten a grupos globales.
2. Deduplicación: grupos con mismo nombre + mismas opciones/precios se fusionan en uno.
3. Se conserva `modifiers` legado en lectura durante una versión por compatibilidad; las ventas viejas no cambian (ya guardan el texto/precio del modificador elegido).
4. Ventas nuevas guardan `groupId` y `optionId` además del nombre (snapshot), para métricas por modificador.

---

## F4 — Inventario: artículos y consumo ("el doble valor")

**Concepto clave:** separar lo que **vendes** (producto del menú) de lo que **llevas** (artículo de inventario).

| Lo que llevas (artículo) | Producto del menú | Consume |
|---|---|---|
| Burrito | "Burrito" | 1 Burrito |
| Burrito | "2 Burritos por $X" | **2** Burritos |
| Burrito + Hamburguesa | "Combo Burri-Burger" | 1 Burrito + 1 Hamburguesa |
| Refresco | "Extra refresco" (opción de modificador) | 1 Refresco |

Ejemplo tuyo: vendo 1 "Burrito" + 1 "2 Burritos por $X" → inventario de Burrito baja **3**. ✅

**Modelo:**
```js
// colección: inventory_items  (catálogo de lo que se lleva)
{ id: 'inv_burrito', name: 'Burrito', unit: 'pza', active: true, order: 0 }

// en producto (y opcionalmente en opciones de modificador)
stockUsage: [{ itemId: 'inv_burrito', qty: 2 }]
```
- Productos sin `stockUsage` simplemente no afectan inventario (bebidas que no controlas, etc.).
- Atajo: botón "Crear artículo de inventario a partir de este producto" (crea el artículo y lo liga con 1:1).
- **Snapshot en la venta:** cada transacción guarda `stockConsumption: [{itemId, qty, at}]` calculado al momento de vender. Si después cambias la receta, el histórico no se altera.
- Función pura `computeConsumption(items, products, modifierGroups)` en `js/models/Inventory.js` (con pruebas).

---

## F5 — Jornada por sucursal: apertura ("En servicio"), inventario y Corte del día

### 5.1 Configuración por sucursal (casillas, como "Usar mesas")
Nada se asigna desde el código: en **Productos → Sucursales**, al editar una sucursal aparecen estas opciones:

| Opción | Qué hace |
|---|---|
| ☐ **Usar mesas** | (ya existe) |
| ☐ **Registrar jornadas y métricas** | Activa el control de apertura/cierre y las métricas por hora de esa sucursal. Sin esta casilla la sucursal funciona igual que hoy. |
| ☐ **Llevar inventario** | Pide "¿Qué llevas hoy?" al abrir; descuenta en vivo; conteo obligatorio al corte. *(Requiere la casilla anterior)* |
| **Cómo abre** (selector) | **Horario fijo** → se abre y cierra sola según el horario.  **Botón "En servicio"** → la abres tú a mano. *(Con inventario, guardar la carga ya cuenta como "En servicio")* |
| **Horario** (opcional) | Días y horas por día (ej. Sáb 13:00–21:00, Dom 13:00–19:00). En "Horario fijo" es obligatorio; en "Botón" sirve de **referencia**. |

**Cómo quedarían tus sucursales:**
| Sucursal | Jornadas | Inventario | Cómo abre | Horario |
|---|---|---|---|---|
| Noria (local) | ✅ | ☐ | Horario fijo | su horario |
| La Presa | ✅ | ☐ | **Botón "En servicio"** | Sáb 13–21, Dom 13–19 como referencia |
| Universidad | ✅ | ✅ | Al guardar la carga | — |
| Eventos | ✅ | opcional | Botón "En servicio" | — |

**Recomendación para La Presa: botón + horario de referencia.** Al algoritmo le importa la hora **real** en que empezaste a vender, no la planeada. Si se usa el horario fijo y llegan tarde, parecería que no se vendió nada de 1 a 2:30 y bajarían las recomendaciones. Con el botón se guarda la hora real, y el horario de referencia sirve para:
- recordarte ("Son las 13:20, ¿poner La Presa en servicio?"),
- medir cuánto tarde abren (puntualidad),
- saber hasta qué hora normalmente vendes (para estimar la demanda cuando algo se agota).

**Redes de seguridad (por si se olvida algo):**
- Si registras una venta en una sucursal con jornadas **sin haber puesto "En servicio"**, la jornada se abre automáticamente a la hora de esa venta (queda marcada como "apertura automática").
- Si se olvida cerrar: al día siguiente la jornada queda **pendiente de corte** y se toma como hora de cierre la de la última venta + 15 min (marcada como "cierre estimado"). En horario fijo cierra a la hora del horario.
- "Pausa" (opcional, futuro): por si cierran un rato a medio día.

### 5.2 Flujo del día
1. **Abrir**:
   - *Con inventario* (Uni): pantalla "¿Qué llevas hoy?" con la lista de artículos, **pre-llenada con la recomendación** (F6). Al guardar → **En servicio** (`openedAt` = ahora).
   - *Botón* (Presa, Eventos): botón **"En servicio"** en el Dashboard / POS de esa sucursal.
   - *Horario fijo* (Noria): automático a la hora de apertura del día.
2. **Durante el servicio**:
   - El Dashboard muestra por sucursal: 🟢 En servicio desde 13:25 · 2 h 10 min · $1,850.
   - *Con inventario*: cada venta descuenta; en el POS cada producto muestra **"Quedan 3"**; al llegar a 0 → **Agotado** (permite vender con confirmación por si se contó mal). Se guarda la **hora de agotado** de cada artículo. Botón **Reabastecer** (con hora).
3. **Hacer corte** (cierra la jornada; `closedAt` = ahora):
   - Aviso si hay mesas abiertas sin cobrar.
   - **Tiempo en servicio** (ej. 5 h 40 min), ventas $, gastos $, utilidad, tickets, ticket promedio, hora pico, ventas por hora.
   - *Con inventario*: por artículo **Llevado · Vendido · Conteo real (obligatorio) · Merma (piezas y $) · % vendido · Hora de agotado · Tiempo en agotarse desde la apertura**.
   - Se guarda un **snapshot inmutable**. Se puede reabrir solo con confirmación.
4. Lo que sobra **no pasa al día siguiente**: es merma.

### 5.3 Modelo
```js
// en la sucursal (dashboard_branches) — campos nuevos opcionales
{
  ..., useTables,
  sessionsEnabled: false,
  inventoryEnabled: false,
  openMode: 'manual' | 'schedule',          // con inventario: abre al guardar la carga
  schedule: { 6: { open: '13:00', close: '21:00' }, 0: { open: '13:00', close: '19:00' } } // 0 = domingo
}

// colección nueva: daily_sessions  (una por sucursal por jornada)
{
  id, branchId, dateKey: '2026-10-18',
  status: 'open' | 'closed',
  openedAt, closedAt,
  openSource: 'manual' | 'schedule' | 'inventory' | 'auto-first-sale',
  closeSource: 'cut' | 'schedule' | 'estimated',
  scheduledOpen: '13:00', scheduledClose: '21:00',   // copia del horario de ese día (referencia)
  loads: [{ itemId, qty, at, note }],      // carga inicial + reabastecimientos (solo con inventario)
  physicalCount: { inv_burrito: 1 },       // conteo real al corte (obligatorio con inventario)
  summary: { ...snapshot calculado al cerrar... }
}
// en transacción nueva: sessionId (liga la venta a la jornada)
```
- El "vendido" se **calcula** a partir de las transacciones de la jornada (no hay contador que se desincronice). Si editas o borras una venta, todo se corrige solo.
- Offline: la jornada se guarda local y se sincroniza, igual que las ventas.
- ⚠️ **Requisito previo (F7a):** hoy `normalizeNamedList` y `syncBranchesToCloud` solo conservan `name`, `useTables` y `order`. **Cualquier campo nuevo de la sucursal se perdería** al guardar. Antes de agregar estas casillas hay que cambiar la sucursal a guardado por documento y que conserve todos sus campos.

### 5.4 Cómo usa el algoritmo el tiempo en servicio
- Todo se mide **relativo a la apertura real**, no a la hora del reloj. Así un evento de 3 h y un sábado de 8 h se comparan bien.
- **Velocidad de venta** = piezas vendidas / horas en servicio.
- **Tiempo en agotarse** = hora de agotado − apertura (ej. "los burritos duran 2 h 15 min en la Uni").
- **Demanda estimada cuando se agota** = vendido ÷ (fracción de las ventas que normalmente ocurren en ese tramo del servicio). Ejemplo: si se agotó a las 2 h de un servicio que suele durar 5 h, y normalmente en las primeras 2 h se vende el 50 % del día → demanda ≈ vendido × 2.
- Las jornadas con apertura o cierre **estimados** pesan menos en el cálculo.

---

## F6 — Sección "Cortes" y métricas semanales con recomendaciones

Nueva vista en el menú lateral: **Cortes**.

### 6.1 Lista de cortes
- Tarjetas por día y sucursal: fecha, ventas $, % vendido global, sobrante, artículos agotados.
- Filtros: sucursal, semana, rango.
- Al abrir un corte: el detalle completo (igual al de F5) + gráfica de ventas por hora + curva de inventario restante durante el día.

### 6.2 Resumen semanal (por sucursal)
- Llevado vs vendido por artículo y por día (tabla tipo mapa de calor).
- % vendido promedio, sobrante total, merma total.
- **Hora promedio de agotado** y en cuántos días se agotó.
- **Velocidad de venta** (piezas/hora) y "tiempo para vender el 50%".
- Ventas por hora × día de la semana (mapa de calor) → hora pico.
- Comparativa vs semana anterior (▲▼ %).
- Top productos, productos lentos, modificadores más pedidos.

### 6.3 Algoritmos (todos locales, sin IA)

**a) Demanda estimada (corrige el sesgo de "se agotó")**
Si algo se agota a las 2 pm y cierras a las 6 pm, la demanda real fue mayor a lo vendido.
```
fracciónDelDíaCubierta = ventasHistóricasHastaHoraAgotado / ventasHistóricasDelDíaCompleto   (curva por hora de esa sucursal)
demandaEstimada = vendido / fracciónDelDíaCubierta      (solo si se agotó; si no, demanda = vendido)
```

**b) Cantidad recomendada a llevar (por sucursal × día de la semana × artículo)**
```
historial = demandaEstimada de los últimos N (4–8) mismos días de la semana
base      = promedio ponderado (más peso a lo reciente: pesos 4,3,2,1)
seguridad = k × desviación estándar   (k configurable: 0.5 conservador, 1.0 normal)
recomendado = redondear_arriba(base + seguridad)
```
- Si hay pocos datos (< 3 días iguales), usa todos los días de esa sucursal y lo marca como "confianza baja".
- Ajuste por desperdicio: si el sobrante promedio > 30 % durante 2+ semanas, se reduce la seguridad.
- Se muestra recomendado **por día** y **total de la semana**.

**c) Clasificación de productos (reglas)**
| Etiqueta | Regla |
|---|---|
| ⭐ Estrella | % vendido ≥ 90 % y se agotó en ≥ 50 % de los días |
| 🔥 Se queda corto | se agota antes del 60 % del horario → "lleva más" |
| ✅ Estable | % vendido entre 70–90 % |
| 🐢 Lento / le cuesta salir | % vendido < 60 % en ≥ 3 días de la semana, o velocidad muy por debajo de la media |
| ⚠️ Merma | diferencia entre sobrante esperado y conteo real > 10 % |

**d) Recomendaciones en texto (plantillas)**
Generadas con reglas, ej.:
- "Burritos se agotaron 4 de 5 días, en promedio a las 13:40. Para el lunes lleva **14** (antes 10)."
- "Hamburguesas: sobró 35 % en promedio. Considera llevar **6** en lugar de 8."
- "Los viernes vendes 40 % más que el resto de la semana en Universidad."
- "La promo '2 burritos' representa 45 % de los burritos vendidos."
- "Entre 12:00 y 14:00 se vende el 60 % del día."

### 6.4 Código
- `js/analytics/inventory-metrics.js` — cálculo de llevado/vendido/sobrante/agotado por jornada (puro).
- `js/analytics/forecast.js` — demanda estimada, recomendación, clasificación (puro).
- `js/analytics/insights.js` — reglas → textos.
- `js/ui/cuts-ui.js` — vista Cortes. Gráficas con Chart.js (ya incluido).
- `tests/*.test.mjs` — pruebas con `node --test`.

---

## Decisiones confirmadas (2026-10-15)

1. ✅ La lista de gastos a mejorar es la de **chips de atajos del modal "Registrar Gasto"**.
2. ✅ **Modos de sucursal** (ver F5.1: ahora son casillas `sessionsEnabled` / `inventoryEnabled` + `openMode`):
   - `'stock'` — **con inventario** (ej. Universidad): se registra lo que se lleva, se descuenta en vivo y al agotarse no hay más que vender (se permite vender con confirmación solo por si se contó mal).
   - `'metrics'` — **solo métricas** (ej. La Presa): no se registra lo llevado. Se analiza lo vendido (por día de la semana y por hora) para recomendar cuánto preparar el siguiente fin de semana y qué productos conviene sacar del menú.
   - `'none'` — como hoy (por defecto, para no cambiar nada sin que lo actives).
3. ✅ El inventario baja **al cobrar** (también en mesas). No hay conflicto: Universidad no usa mesas y La Presa (con mesas) no lleva inventario.
4. ✅ **El sobrante NO pasa al día siguiente.** Todo lo que sobra al corte es **merma** (aunque se regale o se venda barato fuera del sistema; no cuenta en el dashboard).
5. ✅ **El conteo físico es obligatorio al hacer corte** en sucursales `'stock'`. Con eso se mide merma real y rentabilidad.

6. ✅ (2026-10-16) **Hora de apertura**: cada sucursal elige con casillas cómo abre: horario fijo (Noria), botón "En servicio" (La Presa, Eventos) o al guardar la carga de inventario (Uni). Ver F5.1.

### Agregados derivados de tus respuestas
- **Costo por pieza** (opcional) en cada artículo de inventario (`unitCost`). Permite calcular: costo de la merma en $, margen por producto y si un producto es **rentable** o conviene llevar menos.
- El "algoritmo que aprende": las recomendaciones se recalculan solas con cada corte nuevo, por **sucursal × día de la semana** (lunes ≠ jueves). Mientras más semanas, más confianza (se muestra el nivel: baja/media/alta según cuántos días comparables hay).
- **F8 (futuro): comparativa de sucursales** — cuál conviene más (ventas, ticket promedio, merma, tendencia). ⚠️ Hoy los gastos se guardan **sin sucursal** (`zone: ''`), así que la utilidad por sucursal no se puede calcular. Propuesta: agregar un selector de sucursal **opcional** al registrar gasto (los gastos viejos quedan como "General").

---

## Seguridad de los datos existentes (regla de oro)

**Ningún cambio de este plan modifica, borra ni reescribe datos ya registrados en Firebase.**

- **Solo cambios aditivos:** colecciones nuevas (`inventory_items`, `daily_sessions`, `dashboard_modifier_groups`, `dashboard_expense_groups`) y campos nuevos **opcionales** en documentos **nuevos**.
- **Migraciones en lectura (en memoria):** los datos viejos se interpretan al cargarlos (ej. venta sin `soldAt` → usa `createdAt`), sin escribir de vuelta en el documento original.
- **Modificadores (F3):** el campo `modifiers` de cada producto **se conserva intacto**; solo se agrega `modifierGroupIds`. Si algo sale mal, basta con ignorar el campo nuevo.
- **Antes de cualquier fase:**
  - **F0 — Respaldo completo**: botón en Respaldos que descarga un `.json` con *todas* las colecciones de Firebase (no solo el CSV de transacciones). Se ejecuta antes de empezar.
  - **Proyecto de Firebase de pruebas** (recomendado): un segundo proyecto gratuito con una copia de los datos; se cambia solo `firebase-config.js` local para desarrollar sin tocar producción.
- ⚠️ **Riesgo que ya existe hoy** (no lo crea este plan): guardar un producto/categoría/atajo/sucursal **borra y reescribe** toda esa colección (H2). Propongo corregirlo pronto (F7 adelantada a después de F2) para que cada guardado toque solo el documento editado.

---

## Rendimiento: ¿Firebase + respaldo local es buena opción?

**Sí, la idea es buena y se mantiene.** El problema no es el diseño, sino *cuánto* se carga:

1. **Lecturas de Firebase:** al abrir la app se escucha **toda** la colección `transactions` desde el inicio. Cada vez que la app se abre (pasado un rato), Firebase cobra una lectura por documento devuelto. Con 5,000 ventas, abrir la app 10 veces al día = ~50,000 lecturas, que es justo el límite gratis diario del plan Spark.
2. **Límite de LocalStorage (~5 MB):** el respaldo local guarda todas las transacciones como texto. Cada venta con productos pesa ~1–2 KB, así que el límite llega en unas **3,000–5,000 ventas**. Al pasarse, `saveLocalState` falla **en silencio** (solo un aviso en consola) y **el respaldo local deja de actualizarse sin que te enteres**.
3. **Cálculos:** filtrar miles de ventas en cada render se va sintiendo lento en celulares.

**Propuesta (F7, sin tocar datos en Firebase):**
- Escuchar en vivo solo un rango reciente (ej. **últimos 90 días**). Al elegir "Año" o "Todos", consultar el resto bajo demanda.
- Firestore ya tiene activado su caché en **IndexedDB** (`enableIndexedDbPersistence`), que aguanta cientos de MB. El respaldo en LocalStorage queda para lo ligero (productos, sucursales, ventas pendientes `temp_` sin sincronizar).
- Los **cortes guardan resúmenes**: las métricas semanales leen ~7 resúmenes en lugar de cientos de ventas.
- Aviso visible si el almacenamiento local se llena.

---

## Orden actualizado

F0 Respaldo JSON → F1 Hora de venta → F2 Gastos → F7a Sync por documento (quita el riesgo H2) → F3 Modificadores → F4 Inventario/costos → F5 Jornada y corte (modos `stock`/`metrics`) → F6 Cortes y recomendaciones → F7b Rendimiento (90 días, IndexedDB) → F8 Comparativa de sucursales.
