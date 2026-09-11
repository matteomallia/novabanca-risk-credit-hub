# FAQ Operative - Consulenti Risk & Credit NovaBanca

### Q1: Qual e il tasso soglia usura attualmente in vigore per i finanziamenti personali?
**R:** Ai sensi della legge 108/96 e secondo le rilevazioni trimestrali di Banca d'Italia, il Tasso Effettivo Globale Medio (TEGM) viene aggiornato con cadenza trimestrale. Per il trimestre corrente, la soglia di usura e calcolata aumentando il TEGM del 25% a cui si aggiungono ulteriori 4 punti percentuali.

### Q2: Come ci si comporta in caso di discrepanze nelle categorie professionali o dati mancanti nei form di richiesta?
**R:** Il Data Cleaning Engine del nostro Data Agent pulisce automaticamente le stringhe grezze, convertendo i redditi formattati (es. "45.000 €") in float numerici e rimuovendo spazi superflui. In presenza di valori mancanti (NaN) su campioni trascurabili (<5%), le pratiche vengono escluse dal calcolo delle medie per non distorcere le analisi di rischio.

### Q3: Quali requisiti impone la direttiva MiFID II per la vendita di prodotti finanziari abbinati al credito?
**R:** E obbligatoria la profilatura adeguata del cliente tramite questionario MiFID II prima dell'emissione di qualsiasi prodotto finanziario complesso abbinato al fido.
