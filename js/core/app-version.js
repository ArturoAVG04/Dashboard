// Aviso de versión nueva.
// La versión que se está ejecutando es el "?v=" con el que index.html carga app.js.
// La versión publicada está en /version.json (se pide sin caché). Si son distintas,
// se muestra un aviso centrado para actualizar. Al publicar: subir la versión en
// index.html (css y js) y en version.json (una prueba verifica que coincidan).

const CHECK_INTERVAL_MS = 5 * 60 * 1000;
const SNOOZE_MS = 10 * 60 * 1000;

let runningVersion = null;
let pendingVersion = null;
let snoozedUntil = 0;

export function getRunningVersion() {
    return runningVersion;
}

function readRunningVersion() {
    const script = document.querySelector('script[type="module"][src*="js/app.js"]');
    try {
        return new URL(script?.src || '', location.href).searchParams.get('v');
    } catch (error) {
        return null;
    }
}

async function fetchPublishedVersion() {
    try {
        const response = await fetch(`version.json?t=${Date.now()}`, { cache: 'no-store' });
        if (!response.ok) return null;
        const data = await response.json();
        return typeof data?.version === 'string' ? data.version : null;
    } catch (error) {
        return null; // sin conexión: se revisa después
    }
}

function isAnyModalOpen() {
    return Boolean(document.querySelector('.modal-overlay.open:not(#update-modal)'));
}

function showUpdatePrompt(version) {
    const modal = document.getElementById('update-modal');
    if (!modal) return;
    const text = document.getElementById('update-modal-versions');
    if (text) text.textContent = runningVersion ? `Tienes la ${runningVersion} · nueva: ${version}` : `Nueva versión: ${version}`;
    modal.classList.add('open');
}

function hideUpdatePrompt() {
    document.getElementById('update-modal')?.classList.remove('open');
}

export async function checkForUpdate() {
    if (!runningVersion || Date.now() < snoozedUntil) return;
    const published = await fetchPublishedVersion();
    if (!published || published === runningVersion) return;
    pendingVersion = published;
    // No interrumpir una venta o gasto a medias: se muestra al cerrar la ventana
    if (isAnyModalOpen()) return;
    showUpdatePrompt(published);
}

// Borra cachés y service workers viejos y abre la versión nueva
export async function applyUpdate() {
    const button = document.getElementById('update-modal-apply');
    if (button) {
        button.disabled = true;
        button.textContent = 'Actualizando...';
    }
    try {
        const registrations = await navigator.serviceWorker?.getRegistrations?.() || [];
        await Promise.all(registrations.map(registration => registration.unregister()));
    } catch (error) { /* sin service worker */ }
    try {
        const keys = await caches?.keys?.() || [];
        await Promise.all(keys.map(key => caches.delete(key)));
    } catch (error) { /* sin Cache API */ }

    const url = new URL(location.href);
    url.searchParams.set('v', pendingVersion || Date.now().toString());
    location.replace(url.toString());
}

export function dismissUpdate() {
    snoozedUntil = Date.now() + SNOOZE_MS;
    hideUpdatePrompt();
}

export function initUpdateChecker() {
    runningVersion = readRunningVersion();
    if (!runningVersion) return;

    document.getElementById('update-modal-apply')?.addEventListener('click', applyUpdate);
    document.getElementById('update-modal-dismiss')?.addEventListener('click', dismissUpdate);

    // Si había una versión pendiente mientras una venta estaba abierta, avisar al cerrarla
    const observer = new MutationObserver(() => {
        if (pendingVersion && pendingVersion !== runningVersion && !isAnyModalOpen() && Date.now() >= snoozedUntil) {
            showUpdatePrompt(pendingVersion);
        }
    });
    document.querySelectorAll('.modal-overlay:not(#update-modal)').forEach(overlay => {
        observer.observe(overlay, { attributes: true, attributeFilter: ['class'] });
    });

    checkForUpdate();
    setInterval(checkForUpdate, CHECK_INTERVAL_MS);
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') checkForUpdate();
    });
}
