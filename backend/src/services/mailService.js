const nodemailer = require('nodemailer');
const path = require('path');
const fs = require('fs');

/**
 * Crea e restituisce un trasportatore SMTP configurato con le variabili d'ambiente
 */
function createTransporter() {
    return nodemailer.createTransport({
        host: process.env.SMTP_HOST || 'smtp.gmail.com',
        port: parseInt(process.env.SMTP_PORT || '587', 10),
        secure: process.env.SMTP_PORT === '465', // true per porta 465, false per altre porte
        auth: {
            user: process.env.SMTP_USER,
            pass: process.env.SMTP_PASS
        }
    });
}

/**
 * Genera il template HTML dell'email aziendale NovaBanca
 * @param {string} recipientName - Nome del destinatario o dipartimento
 * @param {string} reportSummary - Sintesi redatta dall'LLM
 * @param {boolean} hasChart - Flag che indica se è presente un grafico allegato
 * @returns {string} - Stringa HTML completa
 */
function generateHtmlTemplate(recipientName, reportSummary, hasChart) {
    const formattedSummary = reportSummary.replace(/\n/g, '<br/>');

    return `
    <!DOCTYPE html>
    <html lang="it">
    <head>
        <meta charset="UTF-8">
        <style>
            body { font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; background-color: #f4f6f9; margin: 0; padding: 20px; color: #333; }
            .container { max-width: 650px; background-color: #ffffff; margin: 0 auto; border-radius: 8px; overflow: hidden; box-shadow: 0 4px 12px rgba(0,0,0,0.08); border-top: 6px solid #005A9C; }
            .header { background-color: #005A9C; color: #ffffff; padding: 20px 30px; text-align: left; }
            .header h1 { margin: 0; font-size: 20px; font-weight: 600; letter-spacing: 0.5px; }
            .header p { margin: 5px 0 0 0; font-size: 12px; opacity: 0.85; }
            .content { padding: 30px; }
            .greeting { font-size: 16px; font-weight: bold; color: #005A9C; margin-bottom: 15px; }
            .summary-box { background-color: #f8fafc; border-left: 4px solid #FF6600; padding: 18px; margin: 20px 0; border-radius: 0 6px 6px 0; font-size: 14px; line-height: 1.6; color: #2d3748; }
            .chart-notice { background-color: #ebf8ff; border: 1px solid #bee3f8; padding: 12px; border-radius: 6px; font-size: 13px; color: #2b6cb0; margin-top: 20px; text-align: center; }
            .footer { background-color: #f1f5f9; padding: 15px 30px; text-align: center; font-size: 11px; color: #64748b; border-top: 1px solid #e2e8f0; }
        </style>
    </head>
    <body>
        <div class="container">
            <div class="header">
                <h1>NOVABANCA</h1>
                <p>Risk & Credit Intelligence Hub — Executive Report</p>
            </div>
            <div class="content">
                <div class="greeting">Gentile ${recipientName || 'Analista Risk / Management'},</div>
                <p>Si trasmette di seguito la sintesi dell'analisi di rischio creditizio elaborata dal sistema agentico su richiesta dell'operatore:</p>
                
                <div class="summary-box">
                    ${formattedSummary}
                </div>

                ${hasChart ? `
                <div class="chart-notice">
                    📈 <strong>Grafico Allegato:</strong> Trovate in allegato a questa email l'elaborazione grafica ad alta risoluzione generata dall'Analytics Engine.
                </div>
                ` : ''}

                <p style="font-size: 13px; color: #718096; margin-top: 25px;">
                    <em>Nota: Il presente documento è generato automaticamente da un agente AI e riservato ad uso interno aziendale del Gruppo NovaBanca.</em>
                </p>
            </div>
            <div class="footer">
                © 2026 NovaBanca S.p.A. — Direzione Centrale Risk Management — Tutti i diritti riservati.
            </div>
        </div>
    </body>
    </html>
    `;
}

/**
 * Invia un report executive via mail con eventuale grafico allegato
 * @param {Object} params
 * @param {string} params.to - Indirizzo email destinatario
 * @param {string} params.subject - Oggetto dell'email
 * @param {string} params.summary - Testo di sintesi prodotto dall'LLM
 * @param {string} [params.chartPath] - Percorso relativo o assoluto del grafico PNG generato
 * @returns {Promise<Object>} - Esito dell'invio SMTP
 */
async function sendExecutiveReport({ to, subject, summary, chartPath }) {
    try {
        const transporter = createTransporter();
        const recipientEmail = to || process.env.SMTP_USER;
        const recipientName = recipientEmail ? recipientEmail.split('@')[0] : 'Management';

        let attachments = [];
        let hasChart = false;

        // Se è presente un percorso di grafico valido, risolvilo e aggiungilo come allegato
        if (chartPath) {
            // Risoluzione del percorso assoluto se il grafico si trova nel volume statico
            const normalizedPath = chartPath.startsWith('/static/') 
                ? path.resolve(__dirname, '../../../data_agent', chartPath.replace('/static/', 'static/'))
                : path.resolve(chartPath);

            if (fs.existsSync(normalizedPath)) {
                attachments.push({
                    filename: `Report_Grafico_ISP_${Date.now()}.png`,
                    path: normalizedPath
                });
                hasChart = true;
                console.log(`[MailService] Allegato grafico trovato e aggiunto: ${normalizedPath}`);
            } else {
                console.warn(`[MailService Warning] File grafico non trovato nel percorso: ${normalizedPath}`);
            }
        }

        const htmlContent = generateHtmlTemplate(recipientName, summary, hasChart);

        const mailOptions = {
            from: process.env.EMAIL_FROM || '"NovaBanca Risk Hub" <risk-intelligence@novabanca.com>',
            to: recipientEmail,
            subject: subject || '📊 NovaBanca — Executive Risk Report',
            html: htmlContent,
            attachments: attachments
        };

        const info = await transporter.sendMail(mailOptions);
        console.log(`[MailService Success] Report inviato con successo a: ${recipientEmail}. Message ID: ${info.messageId}`);

        return {
            success: true,
            messageId: info.messageId,
            recipient: recipientEmail
        };

    } catch (error) {
        console.error('[MailService Error] Errore durante l\'invio dell\'email:', error.message);
        return {
            success: false,
            error: error.message
        };
    }
}

/**
 * Wrapper con firma posizionale (recipient, subject, content, chartPath) usato
 * dal tool 'send_executive_report' del ReAct Agent. Normalizza la chiamata
 * verso la funzione principale sendExecutiveReport({...}).
 * @param {string} recipient - Indirizzo email destinatario
 * @param {string} subject - Oggetto dell'email
 * @param {string} content - Testo/HTML di sintesi
 * @param {string} [chartPath] - Percorso opzionale del grafico da allegare
 */
async function sendExecutiveEmail(recipient, subject, content, chartPath = null) {
    return sendExecutiveReport({
        to: recipient,
        subject,
        summary: content,
        chartPath
    });
}

module.exports = {
    sendExecutiveReport,
    sendExecutiveEmail
};