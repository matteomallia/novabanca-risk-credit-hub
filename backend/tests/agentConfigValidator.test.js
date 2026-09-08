const {
    AGENT_MODELS,
    DEFAULT_MODEL,
    DEFAULT_PERSONA,
    resolveModel,
    resolveTools,
    resolvePersona
} = require('../src/agent/agentConfigValidator');

const ALL_TOOL_IDS = ['query_knowledge_base', 'execute_data_analytics', 'fetch_market_news', 'send_executive_report'];

describe('resolveModel', () => {
    test('accetta un modello valido presente in whitelist', () => {
        expect(resolveModel('gpt-4o')).toBe('gpt-4o');
    });

    test('fa fallback al modello di default se il modello richiesto non è in whitelist', () => {
        expect(resolveModel('modello-fasullo-non-esistente')).toBe(DEFAULT_MODEL);
    });

    test('fa fallback al default se non viene passato alcun modello', () => {
        expect(resolveModel(undefined)).toBe(DEFAULT_MODEL);
    });

    test('ogni modello whitelisted ha un id e una label', () => {
        AGENT_MODELS.forEach((m) => {
            expect(typeof m.id).toBe('string');
            expect(typeof m.label).toBe('string');
        });
    });
});

describe('resolveTools', () => {
    test('abilita tutti i tool di default se il client non invia enabledTools', () => {
        expect(resolveTools(undefined, ALL_TOOL_IDS)).toEqual(ALL_TOOL_IDS);
    });

    test('rispetta un array esplicito e vuoto (modalità solo-chat)', () => {
        expect(resolveTools([], ALL_TOOL_IDS)).toEqual([]);
    });

    test('filtra via gli id di tool non esistenti', () => {
        const result = resolveTools(['query_knowledge_base', 'tool_inventato'], ALL_TOOL_IDS);
        expect(result).toEqual(['query_knowledge_base']);
    });

    test('mantiene un sottoinsieme valido intatto', () => {
        const requested = ['fetch_market_news', 'send_executive_report'];
        expect(resolveTools(requested, ALL_TOOL_IDS)).toEqual(requested);
    });
});

describe('resolvePersona', () => {
    test('accetta una persona valida', () => {
        expect(resolvePersona('executive_summary')).toBe('executive_summary');
    });

    test('fa fallback alla persona di default se non valida', () => {
        expect(resolvePersona('persona-inventata')).toBe(DEFAULT_PERSONA);
    });

    test('fa fallback al default se non specificata', () => {
        expect(resolvePersona(undefined)).toBe(DEFAULT_PERSONA);
    });
});
