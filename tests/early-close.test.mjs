import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeEarlyClose, EARLY_CLOSE_OPTIONS } from '../js/models/EarlyClose.js';
import { calendarNoteText } from '../js/ui/calendar-note.js';
import { buildAnalysisExport } from '../js/analytics/analysis-export.js';

test('normaliza el cierre temprano', () => {
    assert.equal(normalizeEarlyClose('lluvia'), 'lluvia');
    assert.equal(normalizeEarlyClose('agotado'), 'agotado');
    assert.equal(normalizeEarlyClose('x'), null);
    assert.equal(normalizeEarlyClose(undefined), null);
    assert.equal(EARLY_CLOSE_OPTIONS[0].value, null);
});

test('nota de calendario', () => {
    assert.equal(calendarNoteText({ notes: ['Sin clases', 'Quincena'], likelyClosed: false }), 'Sin clases · Quincena');
    assert.equal(calendarNoteText({ notes: ['Sin clases'], likelyClosed: true }), 'Sin clases · Probablemente no abres');
    assert.equal(calendarNoteText({ notes: [], likelyClosed: false }), '');
    assert.equal(calendarNoteText(null), '');
});

test('cierre_temprano en la fila por día (vacío si no hay)', () => {
    const mk = (id, dateKey, earlyClose) => ({ id, branchId: 'b', dateKey, status: 'closed', earlyClose, summary: { durationMinutes: 60, items: [] } });
    const out = buildAnalysisExport({ branches: [{ id: 'b', name: 'U' }], sessions: [mk('1', '2026-11-16', 'agotado'), mk('2', '2026-11-17'), mk('3', '2026-11-18', 'raro')] });
    assert.deepEqual(out.dias.map(d => d.cierre_temprano), ['agotado', '', '']);
});
