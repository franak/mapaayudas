/**
 * emailService.js  —  SMTP SSL/TLS  (nodemailer)
 * Paleta ISAMART: navy #2c3e50 + naranja #e67e22
 */

const nodemailer = require('nodemailer');

const SMTP_HOST = process.env.SMTP_HOST || 'lin114.loading.es';
const SMTP_PORT = parseInt(process.env.SMTP_PORT || '465', 10);
const SMTP_USER = process.env.SMTP_USER || 'contacto@isamart.es';
const SMTP_PASS = process.env.SMTP_PASS || 'Te@541bt0';
const FROM_NAME = process.env.EMAIL_FROM_NAME || 'Mapa de Ayudas · ISAMART';
const FROM_ADDR = SMTP_USER;
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admon@isamart.es';
const UNSUBSCRIBE = process.env.UNSUBSCRIBE_EMAIL || 'rgpd@isamart.es';
const HOME_URL = process.env.URL_HOME || 'https://isamart.es';

// ─── Transporter ──────────────────────────────────────────────────
function createTransporter() {
  return nodemailer.createTransport({
    host: SMTP_HOST, port: SMTP_PORT, secure: true,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
    tls: { rejectUnauthorized: false },
  });
}

// ─── Shared HTML shell ────────────────────────────────────────────
function buildHtml(title, bodyHtml) {
  return `<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title></head>
<body style="margin:0;padding:0;background:#ecf0f1;font-family:'Segoe UI',Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#ecf0f1;padding:28px 0;">
 <tr><td align="center">
  <table width="580" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:6px;overflow:hidden;max-width:580px;box-shadow:0 4px 16px rgba(44,62,80,.14);">

   <!-- HEADER -->
   <tr>
    <td style="background:#2c3e50;padding:22px 28px;">
     <table width="100%" cellpadding="0" cellspacing="0">
      <tr>
       <td>
        <div style="font-family:Arial,sans-serif;font-size:22px;font-weight:800;color:#ffffff;letter-spacing:.06em;">
          I <span style="color:#e67e22">S</span> A M A R T
        </div>
        <div style="font-size:11px;color:rgba(255,255,255,.5);margin-top:3px;letter-spacing:.08em;text-transform:uppercase;">
          Rehabilitación Energética
        </div>
       </td>
       <td align="right">
        <div style="font-size:11px;color:rgba(255,255,255,.45);line-height:1.7;">
         615 469 845<br>contacto@isamart.es
        </div>
       </td>
      </tr>
     </table>
     <div style="margin-top:14px;padding-top:14px;border-top:1px solid rgba(255,255,255,.12);">
      <p style="margin:0;font-size:13px;color:rgba(255,255,255,.5);text-transform:uppercase;letter-spacing:.1em;">Mapa de Ayudas · Comunidad de Madrid</p>
      <h1 style="margin:4px 0 0;font-size:20px;font-weight:700;color:#ffffff;">${title}</h1>
     </div>
    </td>
   </tr>

   <!-- BODY -->
   <tr><td style="padding:28px 28px 20px;">${bodyHtml}</td></tr>

   <!-- CTA BUTTON (placeholder, replaced per-email) -->

   <!-- FOOTER -->
   <tr>
    <td style="background:#f8f9fa;border-top:1px solid #ecf0f1;padding:18px 28px;">
     <p style="margin:0;font-size:10px;color:#95a5a6;line-height:1.65;">
      Este mensaje fue enviado por <strong>REHABILITACION ENERGETICA I S A M A R T, SL</strong>
      (NIF: B56558869), con domicilio en Madrid.<br>
      De conformidad con el <strong>Reglamento (UE) 2016/679 (RGPD)</strong> y la LOPDGDD 3/2018,
      puede ejercer sus derechos de acceso, rectificación, supresión y oposición escribiendo a
      <a href="mailto:${UNSUBSCRIBE}" style="color:#e67e22;">${UNSUBSCRIBE}</a>.<br>
      Para <strong>darse de baja</strong> envíe un correo a
      <a href="mailto:${UNSUBSCRIBE}?subject=BAJA" style="color:#e67e22;">${UNSUBSCRIBE}</a>
      con el asunto «BAJA».
     </p>
     <p style="margin:8px 0 0;font-size:10px;color:#bdc3c7;">
      © ${new Date().getFullYear()} REHABILITACION ENERGETICA I S A M A R T, SL · Tel: 615 469 845
     </p>
    </td>
   </tr>

  </table>
 </td></tr>
</table>
</body></html>`;
}

function listHeaders(recipient) {
  return {
    'List-Unsubscribe': `<mailto:${UNSUBSCRIBE}?subject=BAJA-${encodeURIComponent(recipient)}>`,
    'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    'Precedence': 'list',
    'X-Mailer': 'MapaAyudas-ISAMART/2.0',
  };
}

function btn(url, text) {
  return `<table cellpadding="0" cellspacing="0" style="margin:24px auto 0;">
    <tr><td style="background:#e67e22;border-radius:4px;padding:0;">
     <a href="${url}" target="_blank"
        style="display:inline-block;padding:13px 28px;font-size:14px;font-weight:700;
               color:#ffffff;text-decoration:none;letter-spacing:.04em;font-family:Arial,sans-serif;">
       ${text}
     </a>
    </td></tr></table>`;
}

// ─── 1. Welcome + confirmation email ─────────────────────────────
async function sendWelcomeEmail(subscriber, confirmUrl) {
  const t = createTransporter();
  const nombre = subscriber.nombre ? `, ${subscriber.nombre}` : '';
  const body = `
    <h2 style="margin:0 0 14px;font-size:18px;font-weight:700;color:#2c3e50;">
      ¡Bienvenido${nombre} al Mapa de Ayudas!
    </h2>
    <p style="margin:0 0 10px;font-size:14px;color:#555;line-height:1.65;">
      Ha solicitado suscribirse a las alertas del <strong>Mapa de Ayudas a la Rehabilitación
      Energética</strong> de la Comunidad de Madrid.
      Le notificaremos cada vez que el mapa se actualice con nuevas convocatorias.
    </p>
    <p style="margin:0 0 10px;font-size:14px;color:#555;line-height:1.65;">
      Para activar su suscripción, por favor <strong>confirme su dirección de correo</strong>
      pulsando el botón:
    </p>
    ${btn(confirmUrl, 'Confirmar mi suscripción →')}
    <p style="margin:20px 0 0;font-size:12px;color:#95a5a6;line-height:1.5;">
      Si el botón no funciona, copie y pegue este enlace en su navegador:<br>
      <a href="${confirmUrl}" style="color:#e67e22;word-break:break-all;">${confirmUrl}</a>
    </p>
    <p style="margin:12px 0 0;font-size:12px;color:#95a5a6;">
      Si no solicitó esta suscripción, ignore este mensaje. El enlace caduca en 72 horas.
    </p>`;

  await t.sendMail({
    from: `"${FROM_NAME}" <${FROM_ADDR}>`,
    to: subscriber.email,
    subject: '[Mapa de Ayudas] Confirme su suscripción',
    html: buildHtml('Confirme su suscripción', body),
    headers: listHeaders(subscriber.email),
  });
  console.log(`[email] Bienvenida enviada a ${subscriber.email}`);
}

// ─── 2. Admin alert: new subscriber ──────────────────────────────
async function sendNewSubscriberAlert(subscriber) {
  const t = createTransporter();
  const body = `
    <h2 style="margin:0 0 14px;font-size:17px;color:#2c3e50;">Nueva suscripción (pendiente de confirmar)</h2>
    <table style="width:100%;border-collapse:collapse;font-size:13px;">
      <tr style="background:#f8f9fa;"><td style="padding:7px 10px;color:#7f8c8d;width:120px;border:1px solid #ecf0f1;">Nombre</td><td style="padding:7px 10px;border:1px solid #ecf0f1;"><strong>${subscriber.nombre || '—'}</strong></td></tr>
      <tr><td style="padding:7px 10px;color:#7f8c8d;border:1px solid #ecf0f1;">Email</td><td style="padding:7px 10px;border:1px solid #ecf0f1;">${subscriber.email}</td></tr>
      <tr style="background:#f8f9fa;"><td style="padding:7px 10px;color:#7f8c8d;border:1px solid #ecf0f1;">Teléfono</td><td style="padding:7px 10px;border:1px solid #ecf0f1;">${subscriber.telefono || '—'}</td></tr>
      <tr><td style="padding:7px 10px;color:#7f8c8d;border:1px solid #ecf0f1;">Observaciones</td><td style="padding:7px 10px;border:1px solid #ecf0f1;">${subscriber.observaciones || '—'}</td></tr>
      <tr style="background:#f8f9fa;"><td style="padding:7px 10px;color:#7f8c8d;border:1px solid #ecf0f1;">Registrado</td><td style="padding:7px 10px;border:1px solid #ecf0f1;">${new Date().toLocaleString('es-ES')}</td></tr>
      <tr><td style="padding:7px 10px;color:#7f8c8d;border:1px solid #ecf0f1;">Estado</td><td style="padding:7px 10px;border:1px solid #ecf0f1;color:#e67e22;font-weight:700;">Pendiente confirmación</td></tr>
    </table>`;

  await t.sendMail({
    from: `"${FROM_NAME}" <${FROM_ADDR}>`,
    to: ADMIN_EMAIL,
    subject: `[Mapa de Ayudas] Nueva suscripción — ${subscriber.email}`,
    html: buildHtml('Nueva suscripción registrada', body),
    headers: listHeaders(ADMIN_EMAIL),
  });
}

// ─── 3. Update alert (only confirmed) ────────────────────────────
/**
 * Envía alertas de actualización a suscriptores confirmados.
 * @param {array} subscriberEmails - Emails de suscriptores confirmados
 * @param {object} syncResult - Resultado de la sincronización
 * @param {string} source - Fuente: 'coam', 'plan-recuperacion', 'both', etc.
 */
async function sendUpdateAlert(subscriberEmails, syncResult, source = 'coam') {
  const t = createTransporter();
  const date = new Date().toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: '2-digit' });

  const sourceLabel = {
    'coam': 'Mapa de Ayudas COAM',
    'plan-recuperacion': 'Plan de Recuperación (Rehabilitación Energética)',
    'both': 'Mapa de Ayudas (COAM + Plan de Recuperación)',
  }[source] || source;

  const body = `
    <h2 style="margin:0 0 14px;font-size:18px;font-weight:700;color:#2c3e50;">
      📋 Nuevas ayudas disponibles
    </h2>
    <p style="margin:0 0 10px;font-size:14px;color:#555;line-height:1.65;">
      El <strong>${sourceLabel}</strong> ha sido actualizado el <strong>${date}</strong>.
      Puede que haya nuevas convocatorias abiertas o cambios en las existentes.
    </p>
    <div style="background:#f8f9fa;border-left:3px solid #e67e22;padding:12px 16px;margin:16px 0;border-radius:0 4px 4px 0;">
      <p style="margin:0;font-size:12px;font-family:monospace;color:#95a5a6;">
        Fuente: <strong>${esc(sourceLabel)}</strong>
      </p>
    </div>
    ${btn(HOME_URL, 'Ver el Mapa de Ayudas →')}`;

  const subject = `[Mapa de Ayudas] Actualización — ${sourceLabel}`;

  await t.sendMail({
    from: `"${FROM_NAME}" <${FROM_ADDR}>`, to: ADMIN_EMAIL,
    subject: `[ADMIN] ${subject}`,
    html: buildHtml('Actualización del Mapa de Ayudas', body),
    headers: listHeaders(ADMIN_EMAIL),
  });

  const errors = [];
  for (const email of subscriberEmails) {
    try {
      await t.sendMail({
        from: `"${FROM_NAME}" <${FROM_ADDR}>`, to: email,
        subject, html: buildHtml('Actualización del Mapa de Ayudas', body),
        headers: listHeaders(email),
      });
    } catch (e) {
      errors.push({ email, error: e.message });
      console.error(`[email] Error enviando a ${email}: ${e.message}`);
    }
  }
  return { sent: subscriberEmails.length - errors.length, errors };
}

// ─── 4. Info request: admin alert ────────────────────────────────
/**
 * Sends an info-request email to the admin.
 * @param {Object} contact  { empresa?, nombre?, telefono, email, observaciones? }
 * @param {Object|null} conv { titulo?, fechaHasta?, ambito?, normativa? }
 */
async function sendInfoRequestToAdmin(contact, conv) {
  const t = createTransporter();

  const titulo = conv?.titulo || 'Consulta general';
  const subject = `[Solicitud Info] ${titulo}`;

  const convBlock = conv ? `
    <h3 style="margin:20px 0 10px;font-size:15px;color:#2c3e50;border-bottom:2px solid #e67e22;padding-bottom:6px;">
      Datos de la convocatoria
    </h3>
    <table style="width:100%;border-collapse:collapse;font-size:13px;">
      <tr style="background:#f8f9fa;"><td style="padding:7px 10px;color:#7f8c8d;width:130px;border:1px solid #ecf0f1;">Convocatoria</td><td style="padding:7px 10px;border:1px solid #ecf0f1;"><strong>${esc(conv.titulo || '—')}</strong></td></tr>
      <tr><td style="padding:7px 10px;color:#7f8c8d;border:1px solid #ecf0f1;">Fecha hasta</td><td style="padding:7px 10px;border:1px solid #ecf0f1;">${esc(conv.fechaHasta || '—')}</td></tr>
      <tr style="background:#f8f9fa;"><td style="padding:7px 10px;color:#7f8c8d;border:1px solid #ecf0f1;">Ámbito</td><td style="padding:7px 10px;border:1px solid #ecf0f1;">${esc(conv.ambito || '—')}</td></tr>
      <tr><td style="padding:7px 10px;color:#7f8c8d;border:1px solid #ecf0f1;">Normativa</td><td style="padding:7px 10px;border:1px solid #ecf0f1;font-size:12px;line-height:1.4;">${esc(conv.normativa || '—')}</td></tr>
    </table>` : '';

  const body = `
    <h2 style="margin:0 0 14px;font-size:17px;color:#2c3e50;">Nueva solicitud de información</h2>
    <h3 style="margin:0 0 10px;font-size:15px;color:#2c3e50;border-bottom:2px solid #e67e22;padding-bottom:6px;">
      Datos del contacto
    </h3>
    <table style="width:100%;border-collapse:collapse;font-size:13px;">
      <tr style="background:#f8f9fa;"><td style="padding:7px 10px;color:#7f8c8d;width:130px;border:1px solid #ecf0f1;">Empresa</td><td style="padding:7px 10px;border:1px solid #ecf0f1;"><strong>${esc(contact.empresa || '—')}</strong></td></tr>
      <tr><td style="padding:7px 10px;color:#7f8c8d;border:1px solid #ecf0f1;">Nombre</td><td style="padding:7px 10px;border:1px solid #ecf0f1;">${esc(contact.nombre || '—')}</td></tr>
      <tr style="background:#f8f9fa;"><td style="padding:7px 10px;color:#7f8c8d;border:1px solid #ecf0f1;">Teléfono</td><td style="padding:7px 10px;border:1px solid #ecf0f1;">${esc(contact.telefono || '—')}</td></tr>
      <tr><td style="padding:7px 10px;color:#7f8c8d;border:1px solid #ecf0f1;">Email</td><td style="padding:7px 10px;border:1px solid #ecf0f1;"><a href="mailto:${esc(contact.email)}" style="color:#e67e22;">${esc(contact.email)}</a></td></tr>
      <tr style="background:#f8f9fa;"><td style="padding:7px 10px;color:#7f8c8d;border:1px solid #ecf0f1;">Observaciones</td><td style="padding:7px 10px;border:1px solid #ecf0f1;">${esc(contact.observaciones || '—')}</td></tr>
      <tr><td style="padding:7px 10px;color:#7f8c8d;border:1px solid #ecf0f1;">Recibido</td><td style="padding:7px 10px;border:1px solid #ecf0f1;">${new Date().toLocaleString('es-ES')}</td></tr>
    </table>
    ${convBlock}`;

  await t.sendMail({
    from: `"${FROM_NAME}" <${FROM_ADDR}>`,
    to: ADMIN_EMAIL,
    subject,
    html: buildHtml('Nueva solicitud de información', body),
    headers: listHeaders(ADMIN_EMAIL),
  });
  console.log(`[email] Info-request admin alert sent — ${contact.email}`);
}

// ─── 5. Info request: user acknowledgement ────────────────────────
/**
 * Sends a polite acknowledgement to the user who requested info.
 * @param {Object} contact  { nombre?, email }
 * @param {string|null} convTitulo
 */
async function sendInfoRequestAck(contact, convTitulo) {
  const t = createTransporter();
  const nombre = contact.nombre ? `, ${contact.nombre}` : '';
  const convRef = convTitulo
    ? `<p style="margin:0 0 10px;font-size:14px;color:#555;line-height:1.65;">
        Ha solicitado información sobre la convocatoria:<br>
        <strong style="color:#2c3e50;">${esc(convTitulo)}</strong>
       </p>`
    : `<p style="margin:0 0 10px;font-size:14px;color:#555;line-height:1.65;">
        Ha realizado una consulta general sobre ayudas a la rehabilitación energética.
       </p>`;

  const body = `
    <h2 style="margin:0 0 14px;font-size:18px;font-weight:700;color:#2c3e50;">
      Hemos recibido su solicitud${nombre}
    </h2>
    <p style="margin:0 0 10px;font-size:14px;color:#555;line-height:1.65;">
      Gracias por su interés en el <strong>Mapa de Ayudas a la Rehabilitación Energética</strong>
      de la Comunidad de Madrid.
    </p>
    ${convRef}
    <p style="margin:14px 0 10px;font-size:14px;color:#555;line-height:1.65;">
      Hemos recibido su solicitud correctamente y nos pondremos en contacto con usted
      <strong>lo antes posible</strong> para atender su consulta.
    </p>
    <p style="margin:14px 0 0;font-size:13px;color:#95a5a6;line-height:1.5;">
      Si tiene cualquier urgencia puede contactarnos directamente:<br>
      📞 <a href="tel:+34615469845" style="color:#e67e22;">615 469 845</a> &nbsp;|&nbsp;
      ✉ <a href="mailto:contacto@isamart.es" style="color:#e67e22;">contacto@isamart.es</a>
    </p>
    ${btn(HOME_URL + '/mapa-ayudas/', 'Ver el Mapa de Ayudas →')}`;

  await t.sendMail({
    from: `"${FROM_NAME}" <${FROM_ADDR}>`,
    to: contact.email,
    subject: '[Mapa de Ayudas] Hemos recibido su solicitud de información',
    html: buildHtml('Solicitud de información recibida', body),
    headers: listHeaders(contact.email),
  });
  console.log(`[email] Info-request ack sent to ${contact.email}`);
}

// ─── Helper (HTML entity escaping for email templates) ────────────
function esc(s) { return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

module.exports = { sendWelcomeEmail, sendNewSubscriberAlert, sendUpdateAlert, sendInfoRequestToAdmin, sendInfoRequestAck, ADMIN_EMAIL };

