const { createPendingEmail, getPendingEmail, resolvePendingEmail } = require('../src/services/pendingActions');

describe('pendingActions (guardrail email human-in-the-loop)', () => {
    test('createPendingEmail restituisce un id e getPendingEmail recupera i dati corretti', () => {
        const id = createPendingEmail({
            recipient: 'management@novabanca.com',
            subject: 'Report Test',
            content: 'Contenuto di prova',
            chartPath: '/static/charts/chart_test.png'
        });

        expect(typeof id).toBe('string');

        const entry = getPendingEmail(id);
        expect(entry).not.toBeNull();
        expect(entry.recipient).toBe('management@novabanca.com');
        expect(entry.subject).toBe('Report Test');
        expect(entry.chartPath).toBe('/static/charts/chart_test.png');
    });

    test('getPendingEmail restituisce null per un id inesistente', () => {
        expect(getPendingEmail('id-che-non-esiste-mai')).toBeNull();
    });

    test('resolvePendingEmail restituisce i dati e poi elimina l\'entry (non riutilizzabile due volte)', () => {
        const id = createPendingEmail({
            recipient: 'test@example.com',
            subject: 'Oggetto',
            content: 'Testo'
        });

        const resolved = resolvePendingEmail(id);
        expect(resolved).not.toBeNull();
        expect(resolved.recipient).toBe('test@example.com');

        // Seconda risoluzione sullo stesso id: deve fallire, previene un doppio invio
        const secondAttempt = resolvePendingEmail(id);
        expect(secondAttempt).toBeNull();
    });

    test('chartPath è null quando non fornito', () => {
        const id = createPendingEmail({ recipient: 'a@b.com', subject: 'S', content: 'C' });
        expect(getPendingEmail(id).chartPath).toBeNull();
    });
});
