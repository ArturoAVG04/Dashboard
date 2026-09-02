# Contexto de Cambios Realizados en el Dashboard

Este documento detalla todas las modificaciones, nuevas características, refactorizaciones y correcciones realizadas en el proyecto para facilitar su revisión en Visual Studio Code o por herramientas como Codex.

---

## 1. Objetivos y Requerimientos Solicitados

1. **Reinicio Diario de Numeración de Mesas**:
   - Cada día nuevo (fecha local), la numeración de las mesas creadas debe reiniciar en **Mesa 1** (y consecutivas: Mesa 2, Mesa 3, etc.).
   - Las mesas creadas en días anteriores (abiertas o cobradas) no deben incrementar la numeración del día actual.

2. **Sistema de Modificadores / Opciones en Productos**:
   - En la sección de Gestión de Productos, permitir configurar uno o varios grupos de modificadores (ej. "Salsas", "Toppings", "Aderezos extras").
   - Soportar tipo de selección única (🔘 **Radio**: 1 sola opción) y selección múltiple (☑️ **Casillas/Checkboxes**: 1 o más opciones a la vez).
   - Opciones con costo extra opcional ($0 o precio adicional).
   - En el Punto de Venta (POS) y Mesas, al agregar un producto con modificadores, abrir una ventana emergente para elegir las opciones deseadas, ajustar cantidades y calcular precios dinámicamente.
   - Mostrar el detalle de los modificadores elegidos en el resumen del pedido, en las tarjetas de mesas abiertas y en el historial de transacciones.

3. **Reemplazo de la Pantalla Antigua de Edición de Ventas**:
   - Eliminar el formulario antiguo de ventas que aparecía al hacer clic en el botón "Editar" (lápiz) del historial de transacciones.
   - Integrar la edición de ventas con la interfaz moderna de Punto de Venta (`#sale-modal`), permitiendo modificar productos, modificadores, cantidades, fecha, total y sucursal.
   - Dejar el modal secundario (`#transaction-modal`) exclusivamente para el registro y edición rápida de **Gastos**.

4. **Bypass Temporal de Autenticación**:
   - Desactivación temporal de la pantalla de contraseña para acceder directamente a la aplicación en Live Server.

---

## 2. Archivos Modificados y Detalle de Cambios

### A. `index.html`
* **Formulario de Productos (`#manage-new-product-form`)**:
  - Se agregó el contenedor `#manage-modifier-groups-container` y el botón `#btn-add-modifier-group` para añadir grupos de modificadores.
* **Modal de Modificadores (`#modifiers-modal`)**:
  - Se añadió la ventana emergente con selector de cantidad (`#mod-qty-minus`, `#mod-qty-plus`), cuerpo dinámico para checkboxes/radios (`#modifiers-modal-body`) y botón de confirmación (`#btn-confirm-modifiers`).
* **Limpieza de `#transaction-modal`**:
  - Se removieron los campos viejos de ventas (`#extra-sales-fields`, selectores de zona e inputs obsoletos de productos).
  - Se dejó el modal dedicado exclusivamente a **Gastos / Insumos** (`#desc-group`, atajos, descripción manual, monto y fecha).
* **Bypass de Pantalla de Login**:
  - Se configuró `#login-screen` con `style="display: none;"` y `#main-app` con `style="display: flex;"`.

---

### B. `css/styles.css`
* **Estilos para Modificadores y POS**:
  - `.product-mod-badge`: Distintivo visual en las tarjetas del catálogo POS indicando que el producto tiene opciones.
  - `.sale-order-modifiers`: Formato de texto para los modificadores seleccionados en cada renglón del pedido.
  - `.modifiers-modal`, `.mod-group-section`, `.mod-option-row`, `.mod-qty-selector`: Estilos del popup de personalización de producto.
  - `.modifier-group-card`, `.mod-option-row-edit`: Diseño de tarjetas y filas para crear/editar grupos y opciones de modificadores en la gestión de productos.

---

### C. `js/app.js`

#### 1. Manejo de Fechas y Mesas
* **`isSameLocalDate(dateA, dateB)`**: Compara fechas basándose en el calendario local del usuario para evitar discrepancias causadas por UTC/zonas horarias.
* **`getNextTableName(branchId)`**: Calcula el siguiente número de mesa considerando únicamente las mesas y transacciones registradas en el día local actual (`isSameLocalDate`). Reinicia automáticamente a `Mesa 1` cada día.
* **`getTodayTablesCount(branchId)`**: Cuenta las mesas abiertas y cobradas exclusivamente del día de hoy.
* **`normalizeTable(table)`**: Normaliza los ítems de las mesas preservando `modifierText`, `selectedModifiers`, `modSignature`, precio y subtotal.

#### 2. Gestión y Venta con Modificadores
* **`normalizeProduct(product)`**: Valida y estructura los grupos de modificadores (`id`, `name`, `type: 'single' | 'multiple'`, `options: [{ id, name, price }]`).
* **`createModifierGroupCardHtml()` / `createModifierOptionRowHtml()`**: Plantillas dinámicas para el creador de modificadores.
* **`getManageProductModifiers()` / `renderManageProductModifiers()`**: Lectura y renderizado de modificadores al crear o editar productos.
* **`openModifiersModal(productId)` / `confirmAddProductWithModifiers()`**: Control del flujo del modal de opciones, validación de selecciones y cálculo dinámico de precio con extras.
* **`addItemToCurrentSale(productId, options)`**: Agrega productos al borrador del pedido generando líneas independientes cuando tienen diferentes combinaciones de modificadores (`modSignature`).

#### 3. Edición de Ventas con Punto de Venta (POS)
* **`openSaleEditor(transaction)`**: Carga una venta existente del historial dentro de `#sale-modal` con sus sucursales, productos, modificadores, fecha y total.
* **`updateSaleModalMeta()`**: Identifica el modo `edit-transaction`, cambiando el título a *"Editar Venta"* y el botón principal a *"Actualizar Venta"*.
* **`handleSalePrimaryAction()`**: En modo `edit-transaction`, actualiza el registro en Firestore (`updateDoc`) y en el estado local `transactions`.
* **`window.editTransaction(id)`**:
  - Si la transacción es una venta (`type === 'income'`), ejecuta `openSaleEditor(transaction)`.
  - Si es un gasto (`type === 'expense'`), ejecuta `openExpenseModal(transaction)`.

#### 4. Eventos y Carga Segura
* **`setupEventListeners()`**: Todos los selectores de botones y navegación utilizan encadenamiento opcional seguro (`?.addEventListener`) para evitar errores que detengan la ejecución si algún elemento no está presente.
* **`init()`**: Comprueba `document.readyState` para ejecutarse correctamente tanto en carga inicial como en recargas rápidas con Live Server.
* **`unlockApp()`**: Ejecuta `updateDashboard()` de forma inmediata e incondicional al iniciar.

---

### D. `js/auth.js`
* **`isAuthenticated()` y `authenticate()`**: Configurados para retornar `true` de inmediato como bypass temporal de desarrollo.

---

## 3. Estado Actual de la Estructura de Datos (Transacciones)

```javascript
// Estructura de Venta Guardada / Actualizada
{
  id: "doc_id_firebase",
  type: "income",
  amount: 250,
  desc: "2x Alitas (Barbecue, Búfalo), 1x Refresco",
  category: "Venta",
  branch: "branch_id",
  branchId: "branch_id",
  zone: "Principal",
  tableName: "Mesa 1", // si provino de una mesa
  source: "sale",       // o "table"
  itemsSoldArray: [
    {
      productId: "prod_alitas_id",
      name: "Alitas (Barbecue, Búfalo)",
      rawName: "Alitas",
      qty: 2,
      price: 100,
      total: 200,
      modifiers: [
        { groupName: "Salsa", optionName: "Barbecue", price: 0 },
        { groupName: "Salsa", optionName: "Búfalo", price: 0 }
      ],
      modifierText: "Barbecue, Búfalo",
      category: "Snacks"
    }
  ],
  date: "2026-09-01T...",
  createdAt: "2026-09-01T..."
}
```
