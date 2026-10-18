import { db } from '../config/firebase-config.js';
import { collection, onSnapshot, doc, setDoc } from "https://www.gstatic.com/firebasejs/10.9.0/firebase-firestore.js";
import { STORAGE_KEYS, loadLocalState, saveLocalState } from '../config/storage.js';
import { getLocalDateInputValue } from '../core/date-utils.js';
import { getBranchById } from './branches-service.js';
import { getBranchSessionConfig, getScheduleForDate } from '../models/BranchConfig.js';
import { getTransactions } from './transactions-service.js';
import { computeSessionStock } from '../analytics/session-metrics.js';

// Colección nueva (F5): una jornada por sucursal y día. El id es determinista
// (sucursal + fecha) para que dos dispositivos que abren a la vez usen el mismo documento.
const COLLECTION = 'daily_sessions';

let sessions = loadLocalState(STORAGE_KEYS.sessions, []);

export function getSessionId(branchId, dateKey) {
    return `ses_${branchId}_${dateKey}`;
}

export function sessionToDoc(session) {
    return {
        branchId: session.branchId,
        dateKey: session.dateKey,
        status: session.status === 'closed' ? 'closed' : 'open',
        openedAt: session.openedAt || null,
        closedAt: session.closedAt || null,
        openSource: session.openSource || 'manual',
        closeSource: session.closeSource || null,
        scheduledOpen: session.scheduledOpen || null,
        scheduledClose: session.scheduledClose || null,
        loads: Array.isArray(session.loads) ? session.loads : [],
        physicalCount: session.physicalCount || null,
        summary: session.summary || null,
        updatedAt: new Date().toISOString()
    };
}

export function getSessions() {
    return sessions;
}

export function getSessionById(id) {
    return sessions.find(session => session.id === id) || null;
}

export function getTodayKey(date = new Date()) {
    return getLocalDateInputValue(date);
}

// Jornada de hoy de una sucursal (abierta o cerrada)
export function getTodaySession(branchId, now = new Date()) {
    return getSessionById(getSessionId(branchId, getTodayKey(now)));
}

// Jornada abierta de hoy (las de días anteriores sin corte no reciben ventas nuevas)
export function getActiveSession(branchId, now = new Date()) {
    const session = getTodaySession(branchId, now);
    return session?.status === 'open' ? session : null;
}

// Jornadas abiertas de días anteriores: corte pendiente
export function getStaleOpenSessions(now = new Date()) {
    const today = getTodayKey(now);
    return sessions.filter(session => session.status === 'open' && session.dateKey < today);
}

function setLocal(nextSessions) {
    sessions = nextSessions.sort((a, b) => (b.dateKey || '').localeCompare(a.dateKey || ''));
    saveLocalState(STORAGE_KEYS.sessions, sessions);
}

export async function saveSession(session) {
    const stored = { ...session, ...sessionToDoc(session), id: session.id };
    setLocal([stored, ...sessions.filter(item => item.id !== stored.id)]);
    if (db) {
        try {
            await setDoc(doc(db, COLLECTION, stored.id), sessionToDoc(stored), { merge: true });
        } catch (error) {
            console.warn("No se pudo guardar la jornada:", error);
        }
    }
    return stored;
}

// Abre (o reabre) la jornada de hoy de una sucursal
export async function openSession(branchId, { openedAt = new Date(), openSource = 'manual', loads = [] } = {}) {
    const dateKey = getTodayKey(openedAt);
    const id = getSessionId(branchId, dateKey);
    const existing = getSessionById(id);
    const schedule = getScheduleForDate(getBranchById(branchId), openedAt);
    return saveSession({
        ...(existing || {}),
        id,
        branchId,
        dateKey,
        status: 'open',
        openedAt: existing?.openedAt || openedAt.toISOString(),
        closedAt: null,
        closeSource: null,
        openSource: existing?.openSource || openSource,
        scheduledOpen: schedule?.open || null,
        scheduledClose: schedule?.close || null,
        loads: [...(existing?.loads || []), ...loads]
    });
}

export async function addSessionLoads(sessionId, loads) {
    const session = getSessionById(sessionId);
    if (!session) return null;
    return saveSession({ ...session, loads: [...(session.loads || []), ...loads] });
}

export async function closeSession(sessionId, { closedAt = new Date(), closeSource = 'cut', physicalCount = null, summary = null } = {}) {
    const session = getSessionById(sessionId);
    if (!session) return null;
    return saveSession({
        ...session,
        status: 'closed',
        closedAt: (closedAt instanceof Date ? closedAt : new Date(closedAt)).toISOString(),
        closeSource,
        physicalCount,
        summary
    });
}

export async function reopenSession(sessionId) {
    const session = getSessionById(sessionId);
    if (!session) return null;
    return saveSession({ ...session, status: 'open', closedAt: null, closeSource: null });
}

// Jornada a la que se liga una venta de hoy. Si la sucursal registra jornadas y nadie la abrió,
// la primera venta la abre (queda marcada como apertura automática).
export async function ensureSessionForSale(branchId, saleDate = new Date()) {
    const config = getBranchSessionConfig(getBranchById(branchId));
    if (!config.sessionsEnabled) return null;
    if (getTodayKey(saleDate) !== getTodayKey()) return null; // ventas de otro día no se ligan
    const active = getActiveSession(branchId, saleDate);
    if (active) return active;
    if (getTodaySession(branchId, saleDate)?.status === 'closed') return null; // ya se hizo el corte de hoy
    return openSession(branchId, { openedAt: saleDate, openSource: 'auto-first-sale' });
}

export function subscribeSessions(callback) {
    if (!db) return;
    onSnapshot(collection(db, COLLECTION), (snapshot) => {
        setLocal(snapshot.docs.map(item => ({ ...item.data(), id: item.id })));
        if (typeof callback === 'function') callback(sessions);
    }, (error) => {
        console.warn("No se pudieron leer las jornadas desde Firebase:", error);
    });
}

// Existencias en vivo de una sucursal con inventario y jornada abierta con carga.
// Devuelve null si no aplica (sin inventario, sin jornada o sin nada cargado).
export function getLiveStock(branchId) {
    if (!getBranchSessionConfig(getBranchById(branchId)).inventoryEnabled) return null;
    const session = getActiveSession(branchId);
    if (!session || !(session.loads || []).length) return null;
    return computeSessionStock(session, getTransactions());
}
