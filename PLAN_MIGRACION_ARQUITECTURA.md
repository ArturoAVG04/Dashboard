# 🗺️ Plan Maestro de Migración y Arquitectura Profesional

**Proyecto:** Dashboard & POS "La Barra" (PWA + Firebase)  
**Objetivo:** Transformar el archivo monolítico actual en una arquitectura modular, escalable y mantenible basada en buenas prácticas de ingeniería de software, sin detener la operación del negocio.

---

## 📂 1. Nueva Estructura de Carpetas y Archivos

Cada carpeta y archivo tiene un único propósito claro y un nombre autoexplicativo:

```text
Dashboard/
├── index.html                      # Estructura visual HTML limpia
├── manifest.webmanifest            # Configuración PWA (instalación en celular/PC)
├── sw.js                           # Service Worker para caché y funcionamiento offline
│
├── css/
│   └── styles.css                  # Estilos visuales centralizados
│
└── js/
    ├── app.js                      # Punto de entrada: solo arranca la app e inicializa módulos (~80 líneas)
    │
    ├── config/                     # Configuraciones fijas del sistema
    │   ├── firebase-config.js      # Conexión y credenciales de Firebase Firestore
    │   ├── constants.js            # Valores iniciales (categorías, productos base, paleta de colores)
    │   └── storage.js              # Helpers seguros para LocalStorage y claves
    │
    ├── core/                       # Lógica base y utilidades generales
    │   ├── auth.js                 # Seguridad, login y manejo de sesiones
    │   └── date-utils.js           # Fechas locales, zonas horarias y formateo de moneda ($)
    │
    ├── models/                     # Entidades del negocio (POO / Clases y Fábricas)
    │   ├── Product.js              # Clase Producto, modificadores y validaciones
    │   ├── Table.js                # Clase Mesa, cálculo de órdenes y totales
    │   └── Transaction.js          # Clase Transacción (Venta y Gasto)
    │
    ├── services/                   # Lógica de datos (hablan con Firebase y LocalStorage)
    │   ├── branches-service.js     # Sucursales activas y filtros
    │   ├── products-service.js     # Guardado, sincronización en la nube y ordenamiento
    │   ├── tables-service.js       # Numeración diaria de mesas, apertura, edición y cobro
    │   └── transactions-service.js # Guardado de ventas/gastos, historial y sincronización offline
    │
    ├── ui/                         # Controladores visuales (manipulan el HTML y escuchan clics)
    │   ├── dashboard-ui.js         # Tarjetas de balance, filtros de tiempo (Hoy, Semana, Mes) y atajos
    │   ├── charts-ui.js            # Gráficas de barras y pastel (Chart.js)
    │   ├── pos-ui.js               # Pantalla de Punto de Venta, modal de pedido y modificadores
    │   ├── tables-ui.js            # Cuadrícula de mesas abiertas, estados y cobro
    │   ├── history-ui.js           # Tabla de transacciones, buscador y filtros de ventas/gastos
    │   ├── products-ui.js          # Formularios de gestión de productos, drag & drop y modificadores
    │   └── backup-ui.js            # Exportación de respaldos en CSV e imagen
    │
    └── ai/                         # [Fase Futura] Inteligencia Artificial y Métricas Predictivas
        └── analytics-ai.js         # Predicción de demanda, mejores días y sugerencias de compra
```

---

## 🛠️ 2. Hoja de Ruta Paso a Paso (Migración Progresiva)

Cada paso es independiente. Al terminar un paso, **se verifica que el sistema siga funcionando al 100%** antes de pasar al siguiente.

---

### 🔹 FASE 1: Configuración y Núcleo Base (Core)

#### **Paso 1: Aislar Configuración y Almacenamiento (`config/`)**
* **Archivos:** `js/config/storage.js`, `js/config/constants.js`, `js/config/firebase-config.js`.
* **Objetivo:** Asegurar que las llaves de LocalStorage y constantes no estén dispersas.
* **Verificación:** La app abre sin errores en consola y lee las configuraciones locales.

#### **Paso 2: Aislar Utilidades de Fecha y Formato (`core/date-utils.js`)**
* **Archivos:** `js/core/date-utils.js`.
* **Objetivo:** Extraer funciones puras: `isSameLocalDate()`, `getLocalDateInputValue()`, `formatMoney()`, `createLocalDateFromInput()`.
* **Verificación:** Probar que las fechas locales y el formateo de `$0.00` sigan mostrándose correctamente.

#### **Paso 3: Centralizar Seguridad y Sesiones (`core/auth.js`)**
* **Archivos:** `js/core/auth.js`.
* **Objetivo:** Manejo de sesiones, validación de contraseñas y TTL de login.
* **Verificación:** Probar el bloqueo/desbloqueo de pantalla según el estado de autenticación.

---

### 🔹 FASE 2: Modelos de Negocio (POO / Entidades)

#### **Paso 4: Modelo de Producto y Modificadores (`models/Product.js`)**
* **Archivos:** `js/models/Product.js`.
* **Objetivo:** Clase o normalizador `Product` con validación de precios, categorías y grupos de modificadores (single/multiple).
* **Verificación:** Crear y normalizar un producto con opciones y verificar que su estructura sea válida.

#### **Paso 5: Modelo de Mesa y Pedido (`models/Table.js`)**
* **Archivos:** `js/models/Table.js`.
* **Objetivo:** Encapsular la lógica de cálculo de ítems, modificadores y total de la mesa.
* **Verificación:** Agregar ítems con extras a una mesa y comprobar que el total se calcule automáticamente.

#### **Paso 6: Modelo de Transacción (`models/Transaction.js`)**
* **Archivos:** `js/models/Transaction.js`.
* **Objetivo:** Clases `IncomeTransaction` y `ExpenseTransaction` para estructurar ventas y gastos uniformemente.
* **Verificación:** Generar objetos de venta y gasto y validar que contengan todos los campos requeridos por Firebase.

---

### 🔹 FASE 3: Servicios de Datos (Firebase & Persistencia)

#### **Paso 7: Servicio de Sucursales (`services/branches-service.js`)**
* **Archivos:** `js/services/branches-service.js`.
* **Objetivo:** Cargar, guardar y sincronizar sucursales desde Firebase.
* **Verificación:** Cambiar de sucursal en el select y comprobar que se guarde la última sucursal usada.

#### **Paso 8: Servicio de Productos y Categorías (`services/products-service.js`)**
* **Archivos:** `js/services/products-service.js`.
* **Objetivo:** CRUD completo de productos, categorías y sincronización en tiempo real (`onSnapshot`).
* **Verificación:** Agregar/editar un producto y confirmar que se refleje de inmediato en Firestore.

#### **Paso 9: Servicio de Mesas y Numeración Diaria (`services/tables-service.js`)**
* **Archivos:** `js/services/tables-service.js`.
* **Objetivo:** Apertura, actualización, eliminación de mesas y la función `getNextTableName()` (reinicio diario a Mesa 1).
* **Verificación:** Crear mesas en fechas distintas y comprobar que cada día comience desde el número 1.

#### **Paso 10: Servicio de Transacciones y Modo Offline (`services/transactions-service.js`)**
* **Archivos:** `js/services/transactions-service.js`.
* **Objetivo:** Registro de ventas/gastos, historial, eliminación y cola de sincronización offline.
* **Verificación:** Registrar una venta sin internet y comprobar que se sincronice al reconectar.

---

### 🔹 FASE 4: Controladores de Interfaz de Usuario (UI)

#### **Paso 11: Módulo de Gráficas (`ui/charts-ui.js`)**
* **Archivos:** `js/ui/charts-ui.js`.
* **Objetivo:** Inicialización y actualización de gráficas con Chart.js (barras de ingresos/gastos y dona de categorías).
* **Verificación:** Cambiar entre filtros de tiempo (Hoy, Semana, Mes) y ver que las gráficas se actualicen fluidamente.

#### **Paso 12: Módulo del Dashboard Principal (`ui/dashboard-ui.js`)**
* **Archivos:** `js/ui/dashboard-ui.js`.
* **Objetivo:** Actualizar tarjetas de Ingresos, Gastos, Balance Neto, productos más vendidos y accesos rápidos.
* **Verificación:** Confirmar que los totales del dashboard cuadren exactamente con las transacciones registradas.

#### **Paso 13: Módulo de Mesas (`ui/tables-ui.js`)**
* **Archivos:** `js/ui/tables-ui.js`.
* **Objetivo:** Renderizado de tarjetas de mesas activas, chips de productos con modificadores y botón de cobro.
* **Verificación:** Abrir una mesa, editarla desde su tarjeta y cobrarla exitosamente.

#### **Paso 14: Módulo de Punto de Venta y Modificadores (`ui/pos-ui.js`)**
* **Archivos:** `js/ui/pos-ui.js`.
* **Objetivo:** Catálogo de venta, modal de pedido, popup de personalización de salsas/extras y switch móvil menú/pedido.
* **Verificación:** Armar un pedido mixto con modificadores y cobrar en efectivo o mandar a mesa.

#### **Paso 15: Módulo de Gestión de Productos (`ui/products-ui.js`)**
* **Archivos:** `js/ui/products-ui.js`.
* **Objetivo:** Listas de administración, constructor de modificadores y drag & drop de ordenamiento.
* **Verificación:** Reordenar productos arrastrando y confirmar que el nuevo orden se guarde.

#### **Paso 16: Módulo de Historial y Edición de Ventas (`ui/history-ui.js`)**
* **Archivos:** `js/ui/history-ui.js`.
* **Objetivo:** Tabla de transacciones, búsqueda en tiempo real, filtros y apertura de `openSaleEditor()` al pulsar "Editar".
* **Verificación:** Buscar una venta por nombre, editarla en el POS y confirmar que los cambios se guarden.

#### **Paso 17: Módulo de Respaldos (`ui/backup-ui.js`)**
* **Archivos:** `js/ui/backup-ui.js`.
* **Objetivo:** Generación de archivo CSV y captura en imagen (html2canvas).
* **Verificación:** Descargar el respaldo en CSV y comprobar que abra en Excel sin caracteres rotos.

---

### 🔹 FASE 5: Orquestador Principal y Pruebas Globales

#### **Paso 18: Adelgazar `app.js` al mínimo**
* **Archivos:** `js/app.js`.
* **Objetivo:** `app.js` queda como un orquestador limpio (~80 líneas) que solo importa los módulos y los inicializa:
```javascript
import { initAuth } from './core/auth.js';
import { initTablesService } from './services/tables-service.js';
import { initTransactionsService } from './services/transactions-service.js';
import { initDashboardUI } from './ui/dashboard-ui.js';
import { initPosUI } from './ui/pos-ui.js';

function initApp() {
    initAuth();
    initTablesService();
    initTransactionsService();
    initDashboardUI();
    initPosUI();
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initApp);
} else {
    initApp();
}
```

#### **Paso 19: Prueba de Integración de Punta a Punta**
* **Flujo completo:** Crear producto con modificador ➔ Abrir mesa en sucursal ➔ Agregar producto personalizado ➔ Cobrar mesa ➔ Comprobar que sume en el Dashboard ➔ Editar venta desde el historial ➔ Descargar respaldo.

---

### 🔹 FASE 6: Módulo Futuro de IA Predictiva (`ai/analytics-ai.js`)

#### **Paso 20: Inteligencia Artificial para el Negocio**
Una vez que el código esté modular y limpio, este módulo podrá alimentarse de las transacciones históricas para:
1. **Pronóstico de Demanda**: Predecir cuántas piezas de alitas o insumos se venderán el próximo fin de semana.
2. **Detección de Días Clave**: Indicar qué días y horarios tienen mayor afluencia por sucursal.
3. **Optimización de Menú**: Identificar productos "estrella" (altos ingresos) vs productos "lentos" para crear promociones inteligentes.
