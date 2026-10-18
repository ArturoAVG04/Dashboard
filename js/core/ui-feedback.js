const SUCCESS_PATTERN = /(guardad|actualizad|eliminad|descargad|agregad|cread|cobrad|éxito|exito|→)/i;

function getToastContainer() {
    let container = document.getElementById('toast-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'toast-container';
        container.className = 'toast-container';
        container.setAttribute('role', 'status');
        container.setAttribute('aria-live', 'polite');
        document.body.appendChild(container);
    }
    return container;
}

// type: 'success' | 'warning'. Si no se indica, se deduce del mensaje.
export function showToast(message, type = null) {
    const variant = type || (SUCCESS_PATTERN.test(message) ? 'success' : 'warning');
    const container = getToastContainer();

    const toast = document.createElement('div');
    toast.className = `toast-notification toast-${variant}`;
    const icon = document.createElement('i');
    icon.className = variant === 'success' ? 'ph-fill ph-check-circle' : 'ph-fill ph-warning-circle';
    const text = document.createElement('span');
    text.textContent = message;
    toast.append(icon, text);
    container.appendChild(toast);

    // Máximo 3 avisos visibles a la vez
    while (container.children.length > 3) container.firstElementChild.remove();

    requestAnimationFrame(() => toast.classList.add('show'));

    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 250);
    }, 3200);
}

export function scrollToTop() {
    window.scrollTo({ top: 0, left: 0, behavior: 'smooth' });
}

// ---------- Bloqueo del fondo mientras hay una ventana emergente abierta ----------
// Fija el body en su posición actual (funciona también en iOS) y al cerrar regresa al mismo punto.
let lockedScrollY = 0;
let isScrollLocked = false;

function lockPageScroll() {
    if (isScrollLocked) return;
    isScrollLocked = true;
    lockedScrollY = window.scrollY;
    document.body.style.top = `-${lockedScrollY}px`;
    document.body.classList.add('modal-open');
}

function unlockPageScroll() {
    if (!isScrollLocked) return;
    isScrollLocked = false;
    document.body.classList.remove('modal-open');
    document.body.style.top = '';
    window.scrollTo({ top: lockedScrollY, left: 0, behavior: 'instant' });
}

// Al abrir una ventana su contenido empieza arriba (una sola vez, sin animación)
function resetModalScroll(overlay) {
    [overlay, ...overlay.querySelectorAll('.modal, .modal-body, .sale-menu-panel, .sale-order-items')]
        .forEach(element => { element.scrollTop = 0; });
}

export function initModalScrollLock() {
    const overlays = [...document.querySelectorAll('.modal-overlay')];
    const wasOpen = new WeakMap(overlays.map(overlay => [overlay, overlay.classList.contains('open')]));

    const sync = () => {
        overlays.forEach(overlay => {
            const isOpen = overlay.classList.contains('open');
            if (isOpen && !wasOpen.get(overlay)) resetModalScroll(overlay);
            wasOpen.set(overlay, isOpen);
        });
        if (overlays.some(overlay => overlay.classList.contains('open'))) lockPageScroll();
        else unlockPageScroll();
    };

    const observer = new MutationObserver(sync);
    overlays.forEach(overlay => observer.observe(overlay, { attributes: true, attributeFilter: ['class'] }));
    sync();
}
