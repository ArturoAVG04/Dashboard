// "¿Cerraste temprano?": null = cierre normal; 'lluvia' | 'agotado' | 'otro'. Funciones puras.
export const EARLY_CLOSE_OPTIONS = [
    { value: null, label: 'Normal' },
    { value: 'lluvia', label: 'Lluvia' },
    { value: 'agotado', label: 'Se acabó' },
    { value: 'otro', label: 'Otro' }
];

export function normalizeEarlyClose(value) {
    return EARLY_CLOSE_OPTIONS.some(option => option.value && option.value === value) ? value : null;
}
