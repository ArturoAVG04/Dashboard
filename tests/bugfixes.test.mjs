import test from 'node:test';
import assert from 'node:assert/strict';
import { escapeHtml } from '../js/core/date-utils.js';
import { resolveCloseAfterOpen } from '../js/analytics/session-metrics.js';

test('escapeHtml conserva el 0 y escapa caracteres peligrosos', () => {
    assert.equal(escapeHtml(0), '0');
    assert.equal(escapeHtml(null), '');
    assert.equal(escapeHtml(undefined), '');
    assert.equal(escapeHtml('<b a="x">&\'</b>'), '&lt;b a=&quot;x&quot;&gt;&amp;&#39;&lt;/b&gt;');
});

test('resolveCloseAfterOpen: cierre normal, mismo minuto y después de medianoche', () => {
    const opened = new Date(2026, 10, 20, 20, 0, 30);
    const normal = new Date(2026, 10, 20, 23, 0);
    assert.equal(resolveCloseAfterOpen(normal, opened), normal);

    const sameMinute = new Date(2026, 10, 20, 20, 0);
    const now = new Date(2026, 10, 20, 20, 0, 45);
    assert.equal(resolveCloseAfterOpen(sameMinute, opened, now).getTime(), now.getTime());

    const afterMidnight = new Date(2026, 10, 20, 0, 10);
    const result = resolveCloseAfterOpen(afterMidnight, opened);
    assert.equal(result.getTime(), new Date(2026, 10, 21, 0, 10).getTime());
});

test('resolveCloseAfterOpen: hora inválida devuelve null', () => {
    const opened = new Date(2026, 10, 20, 8, 0);
    assert.equal(resolveCloseAfterOpen(new Date(2026, 10, 20, 6, 0), opened), null);
});
