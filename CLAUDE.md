# CLAUDE.md — Dashboard La Barra

Contexto permanente para trabajar en este proyecto. Mantener actualizado al terminar cada fase.

## Qué es
PWA de punto de venta y finanzas para un negocio de comida con varias sucursales (ej. "Universidad"). Registra ventas (POS con mesas opcionales), gastos, productos, categorías y sucursales. Datos en **Firebase Firestore** con respaldo en **LocalStorage** y modo offline (`temp_` ids).

## Stack y reglas técnicas
- HTML + CSS + **JavaScript vanilla con ES Modules**. Sin bundler, sin npm, sin framework.
- Firebase 10.9.0 importado desde `gstatic.com`. Chart.js y Flatpickr por CDN. Iconos Phosphor (`ph ph-*`).
- `js/config/firebase-config.js` está en `.gitignore` (credenciales). Nunca subirlo; usar `firebase-config.example.js` como plantilla.
- **Sin IA ni APIs externas** para métricas/recomendaciones: solo algoritmos locales (promedios, desviación, reglas).
- Idioma de la UI, comentarios y commits: **español**. Moneda MXN (`formatMoney`).
- Zona horaria: usar siempre los helpers de `js/core/date-utils.js` (`getLocalDateInputValue`, `isSameLocalDate`). No comparar fechas con `toISOString().slice(0,10)` directo.

## Arquitectura (capas)
```
js/config/    constantes, storage (LocalStorage), firebase-config
js/core/      auth, date-utils (fechas, dinero, texto), ui-feedback (toast)
js/models/    clases y funciones puras: Product, Table, Transaction
js/services/  estado + sincronización Firestore por colección
js/ui/        render DOM y eventos por vista (dashboard, pos, products, expenses, history, tables, charts, backup)
js/app.js     orquestador: navegación (switchView), filtros de periodo, wiring de eventos
```
- La lógica de negocio va en `models/` o `analytics/` como **funciones puras** (testeables con Node; no deben importar Firebase). La UI solo renderiza.
- **Guardado en Firestore siempre por documento** (desde F7a no existe ningún "borrar y reescribir colección"):
  - Elemento individual: `upsertX(item)` / `removeX(id)` con `setDoc(..., {merge:true})` / `deleteDoc` (ej. `upsertExpenseTag`, `expense-groups-service.js`).
  - Listas editadas en bloque (productos, categorías, sucursales): `commitProducts/commitCategories/commitBranches(lista)` → `commitListChanges` (`js/services/firestore-sync.js`) compara con la lista anterior (`diffById` en `js/core/collection-diff.js`) y escribe solo lo que cambió, con merge; borra solo lo que se quitó.
  - Cada tipo define sus campos con `xToDoc()` (`productToDoc`, `categoryToDoc`, `branchToDoc`, `expenseTagToDoc`). Al agregar un campo nuevo, añadirlo ahí.
  - Normalizadores (`normalizeNamedList`, `normalizeExpenseTags`, `Product`) **conservan campos desconocidos** para no perder datos de versiones nuevas.
- Los servicios exponen `get*/set*/subscribe*` y guardan en LocalStorage al cambiar.
- Colecciones Firestore actuales: `transactions`, `dashboard_products`, `dashboard_categories`, `dashboard_expense_tags` (campo `groupId`), `dashboard_expense_groups` (F2), `dashboard_modifier_groups` (F3), `inventory_items` (F4), `daily_sessions` (F5), `dashboard_branches`, `dashboard_tables`. Toda colección nueva debe agregarse a `BACKUP_COLLECTIONS` en `js/services/backup-service.js`.
- Transacción de venta: `{type:'income', amount, branchId, itemsSoldArray[{productId, qty, price, modifiers, modifierText}], source:'sale'|'table', date, createdAt}`. Las ventas guardan snapshot (nombre/precio) para que el historial no cambie si se edita el producto.
- Hora de venta (desde F1): `soldAt` (ISO, hora real) + `timeEstimated` (true si se registró otro día sin hora); ítems de mesa/venta llevan `addedAt`. **Leer la hora siempre con `getSaleTimestamp(tx)`** de `date-utils.js` (maneja ventas viejas sin `soldAt` usando `createdAt`). Ventas con hora estimada no se usan en métricas por hora.

## Sistema de diseño (css/styles.css)
- El CSS está organizado en secciones numeradas (tokens → base → layout → componentes → vistas → modales → responsive). Agregar estilos nuevos en la sección que corresponda, no al final.
- **Usar siempre tokens** (`--surface`, `--text-muted`, `--primary-solid`, `--space-*`, `--radius-*`); no colores ni tamaños sueltos.
- **No estilos en línea** en HTML/JS salvo valores dinámicos (color de sucursal/grupo, ancho de barra, `display` de estado).
- Botones: `.btn` + variante (`.btn-primary` acción principal, `.btn-success` cobrar/guardar, `.btn-danger`, `.btn-warning`, `.btn-secondary`, `.btn-ghost` acciones de texto) + tamaño (`.btn-sm`, `.btn-lg`, `.btn-block`). Ícono solo: `.btn-icon` (+ `.btn-icon-danger`) **con `aria-label`**. Cantidades: `.stepper`.
- Contenedores: `.panel` + `.panel-header` (`h3` + `.panel-actions`); formularios desplegables `.form-panel`; vacío `.empty-state`; pestañas `.tabs/.tab`; filtros `.segmented`.
- Navegación: Principal, **Jornadas** (vista propia con las tarjetas de jornada; punto verde/ámbar en el menú), Mesas, Historial, Productos, Respaldos.
- **Orden de productos por sucursal**: `branch.productOrder = [productId…]` (`sortProductsForBranch` en `js/models/Product.js`). Con una sucursal elegida en Productos, mover/arrastrar/A-Z solo cambia esa sucursal; con "Todas" cambia el orden general (`product.order`). La venta usa el orden de su sucursal.
- Ventanas emergentes: el fondo queda bloqueado (`initModalScrollLock` en `ui-feedback.js`, automático para todo `.modal-overlay`); su contenido empieza arriba solo al abrir. **No** hacer scroll automático al agregar/editar dentro de una ventana (el usuario lo pidió explícitamente). `scrollToTop` solo al cambiar de vista.
- En celular, "Registrar venta/gasto" son botones circulares flotantes (preferencia del usuario).
- Reglas de usabilidad: objetivos táctiles ≥ 44px; **nunca scroll dentro de scroll** (modales: un solo `.modal-body` con scroll, encabezado y pie fijos; en el POS de escritorio menú y pedido son paneles lado a lado); acciones destructivas con menor peso visual que la principal; contraste AA (texto blanco solo sobre `*-solid`); números con `tabular-nums`; respetar `prefers-reduced-motion`.
- Celular (≤768px): navegación inferior + botones circulares flotantes de venta/gasto; las tablas de movimientos (`.stack-mobile`) se muestran como tarjetas; los modales salen como hoja inferior. El POS cambia a una columna con pestañas Menú/Pedido a ≤900px (coincide con `isStackedSaleLayout()`).

## Verificación antes de dar algo por terminado
```bash
node --check js/app.js js/config/*.js js/core/*.js js/models/*.js js/services/*.js js/ui/*.js
TZ=America/Mexico_City node --test tests/*.test.mjs   # pruebas de funciones puras (sin dependencias)
```
- Verificar que todo `getElementById` usado en JS exista en `index.html` y que cada `import { x }` local esté exportado (node --check no lo detecta).
- El usuario abre la app con Live Server (VS Code); no levantar servidores para él. Para revisar visualmente, Claude puede usar una copia en el scratchpad con `db = null` y datos de ejemplo (nunca contra el Firebase real) y capturas con `google-chrome --headless`. En esas capturas, desactivar transiciones: con tiempo virtual no avanzan y dejan estados viejos pintados.
- Probar manualmente en el navegador (servir con `python3 -m http.server`), incluyendo modo sin conexión.

## Forma de trabajo acordada
- Proponer plan y esperar visto bueno antes de cambios grandes.
- **Git solo cuando el usuario lo pida** ("haz commit"): trabajar en la rama `Buenaspracticas`, sin crear ramas nuevas. Las credenciales de Firebase ya están configuradas en Vercel: no subir `js/config/firebase-config.js` ni tocar nada de credenciales en git.
- Migraciones de datos siempre **compatibles hacia atrás** (leer formato viejo, escribir el nuevo), nunca borrar datos históricos.

## Roadmap activo
Plan detallado: [PLAN_INVENTARIO_Y_METRICAS.md](PLAN_INVENTARIO_Y_METRICAS.md). Historia previa: [BITACORA_MIGRACION_Y_FUTURO.md](BITACORA_MIGRACION_Y_FUTURO.md).

Orden: F0 → F1 → F2 → F7a → F3 → F4 → F5 → F6 → F7b → F8

| Fase | Tema | Estado |
|------|------|--------|
| F0 | Respaldo JSON completo de todas las colecciones (antes de tocar nada) | ✅ probado por el usuario |
| F1 | Hora real de venta (`soldAt`, `addedAt` en ítems de mesa) | ✅ probado por el usuario |
| F2 | Chips de gastos: grupos, búsqueda, frecuentes, último precio | ✅ probado por el usuario |
| — | Rediseño visual y de usabilidad (sistema de diseño, sin scroll anidado, fondo bloqueado con modal abierto) | ✅ probado por el usuario (ajustes de FAB/scroll en prueba) |
| F7a | Sync por documento (quitar el borra-y-reescribe); sucursal conserva TODOS sus campos | 🧪 implementado, en prueba local |
| F3 | Modificadores compartidos (`dashboard_modifier_groups`, `product.modifierGroupIds`; `modifiers` legado se conserva) | 🧪 implementado, en prueba local |
| F4 | Artículos de inventario, consumo por producto/opción (`stockUsage`), costo (`unitCost`), `stockConsumption` en ventas | 🧪 implementado, en prueba local |
| F5 | Jornada (apertura/En servicio) y Corte del día; casillas por sucursal `sessionsEnabled`, `inventoryEnabled`, `openMode`, `schedule` | 🧪 implementado, en prueba local |
| F6 | Vista Cortes: métricas semanales y recomendaciones por sucursal × día de la semana | ⏳ |
| F7b | Rendimiento: escuchar solo 90 días, histórico bajo demanda, aviso de almacenamiento lleno | ⏳ |
| F8 | Comparativa de sucursales (requiere gasto con sucursal opcional) | futuro |

### Reglas de negocio confirmadas por el usuario
- **NUNCA modificar, borrar ni reescribir datos existentes en Firebase.** Solo colecciones nuevas y campos opcionales nuevos; datos viejos se adaptan al leerlos (en memoria).
- Todo comportamiento por sucursal se **configura con casillas en la UI de sucursales** (como "Usar mesas"), nunca fijo en el código.
- Casillas: *Registrar jornadas y métricas*, *Llevar inventario* (ej. Universidad; agotado = no hay más), *Cómo abre*: horario fijo (Noria) o botón "En servicio" (La Presa, Eventos); con inventario, guardar la carga = apertura. Horario opcional como referencia.
- Métricas de tiempo siempre relativas a la **apertura real** (`openedAt`), no a la hora del reloj.
- El inventario se descuenta **al cobrar** (también en mesas).
- El sobrante **no pasa al día siguiente**: es merma.
- El **conteo físico es obligatorio** al hacer corte en sucursales `stock`.
- Recomendaciones sin IA: se recalculan con cada corte, por sucursal × día de la semana.

### Modelo de modificadores e inventario (F3/F4)
- Producto usa el **sistema nuevo** si tiene el campo `modifierGroupIds` (aunque sea `[]`); si no, se usan sus `modifiers` embebidos (sistema anterior). Resolver siempre con `getProductModifierGroups(product)` / `resolveProductModifierGroups` (`js/models/ModifierGroup.js`). Nunca leer `product.modifiers` directo.
- Conversión del sistema anterior: botón en la pestaña Modificadores (`planLegacyModifierMigration`): fusiona grupos idénticos, ids deterministas, no borra `modifiers`. Al asignar un grupo nuevo a un producto del sistema anterior, se convierten primero sus grupos para no perderlos.
- Grupo: `{ name, type: 'single'|'multiple', required, maxSelect, options: [{ id, name, price }], order }`.
- **Inventario por sucursal, configurado desde el artículo** (decisión del usuario 2026-10-17): `inventory_items` = `{ branchId, name, unit, unitCost, active, consumers: [{ type: 'product', productId, qty } | { type: 'option', groupId, optionId, qty }] }`. La pestaña Inventario solo muestra sucursales con `inventoryEnabled`.
- Consumo de una venta: `computeStockConsumption(saleItems, getBranchInventoryItems(branchId))` (`js/models/Inventory.js`); uso de un producto: `getProductUsage(productId, branchItems)`. Cada venta guarda `stockConsumption: [{ itemId, qty }]` (snapshot) y sus modificadores llevan `groupId`/`optionId`.
- Esquema anterior de F4 (consumo en `product.stockUsage` / `option.stockUsage`, artículos sin `branchId`): ya no se usa; esos campos se conservan sin tocar y se convierten con el botón "Asignar a <sucursal>" (`planLegacyInventoryMigration`).
- Precio medio por unidad (`computeItemUnitPrice`): ponderado por ventas reales de la sucursal (60 días) o, sin historial, media simple de precio ÷ unidades de cada producto. Se usa en "¿Qué llevas hoy?" para la venta esperada, junto con el promedio vendido (`computeItemSalesHistory`).

### Jornadas y corte (F5)
- Configuración por sucursal (casillas en Sucursales): `sessionsEnabled`, `inventoryEnabled` (requiere jornadas), `openMode: 'manual'|'schedule'`, `schedule: { '0'..'6': { open, close } }` (0 = domingo). Leer siempre con `getBranchSessionConfig` / `getScheduleForDate` (`js/models/BranchConfig.js`).
- `daily_sessions/{ses_<branchId>_<YYYY-MM-DD>}` (id determinista): `{ branchId, dateKey, status, openedAt, closedAt, openSource: manual|inventory|schedule|auto-first-sale, closeSource: cut|schedule|estimated, loads: [{itemId, qty, at}], physicalCount, summary }`. Servicio: `js/services/sessions-service.js`; UI: `js/ui/sessions-ui.js`.
- Ventas de hoy de sucursales con jornadas llevan `sessionId` (`ensureSessionForSale`: si no hay jornada abierta la abre con la primera venta; ventas de otro día o después del corte no se ligan).
- Todo lo vendido/agotado se **calcula** de las ventas con ese `sessionId` (`js/analytics/session-metrics.js`), nunca con contadores. El corte guarda `summary` como snapshot (lo usa F6).
- Merma = todo lo que sobra al corte (no pasa al día siguiente). `difference` = debería quedar − contado (positivo = faltan piezas).
- Horario fijo (`runScheduleTick`, cada minuto): abre y cierra solo en sucursales **sin** inventario; con inventario se abre al cargar y se cierra con conteo obligatorio. Jornadas viejas sin corte aparecen como "corte pendiente" con cierre estimado = última venta + 15 min.
- En la venta: "Quedan N" por producto (descuenta lo que va en el pedido) y confirmación si algo está agotado; no aplica al editar una venta ya registrada.

### Glosario del dominio
- **Artículo de inventario**: lo que se lleva físicamente (Burrito, Hamburguesa).
- **Producto**: lo que se vende en el menú; puede consumir N artículos (promo "2 burritos" consume 2).
- **Jornada**: periodo de venta de una sucursal en un día, con su carga de inventario.
- **Corte**: cierre de la jornada con snapshot de llevado/vendido/sobrante/agotados/totales.
