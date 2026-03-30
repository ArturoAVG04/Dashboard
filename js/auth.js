const AUTH_SESSION_KEY = 'dashboardAuthenticatedAt';
const AUTH_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const PASSWORD_HASH = 'bade41f7736f487f882dacc0c7b71028c331d73058214d51a88d08091303e5a5';

async function sha256Hex(value) {
    const bytes = new TextEncoder().encode(value);
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return [...new Uint8Array(digest)]
        .map(byte => byte.toString(16).padStart(2, '0'))
        .join('');
}

export async function authenticate(password) {
    const hash = await sha256Hex(password);
    const isValid = hash === PASSWORD_HASH;

    if (isValid) {
        localStorage.setItem(AUTH_SESSION_KEY, Date.now().toString());
    }

    return isValid;
}

export function isAuthenticated() {
    const rawTimestamp = localStorage.getItem(AUTH_SESSION_KEY);
    if (!rawTimestamp) return false;

    const timestamp = Number(rawTimestamp);
    if (!Number.isFinite(timestamp)) {
        localStorage.removeItem(AUTH_SESSION_KEY);
        return false;
    }

    const isValid = (Date.now() - timestamp) < AUTH_SESSION_TTL_MS;
    if (!isValid) {
        localStorage.removeItem(AUTH_SESSION_KEY);
    }

    return isValid;
}

export function clearAuthentication() {
    localStorage.removeItem(AUTH_SESSION_KEY);
}
