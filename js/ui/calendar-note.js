import { escapeHtml } from '../core/date-utils.js';

// Línea discreta con las notas del calendario del día objetivo (no cambia cantidades).
export function calendarNoteText(calendar) {
    if (!calendar) return '';
    const notes = Array.isArray(calendar.notes) ? [...calendar.notes] : [];
    if (calendar.likelyClosed) notes.push('Probablemente no abres');
    return notes.join(' · ');
}

export function renderCalendarNote(calendar) {
    const text = calendarNoteText(calendar);
    return text ? `<p class="calendar-note"><i class="ph ph-calendar-blank"></i> ${escapeHtml(text)}</p>` : '';
}
