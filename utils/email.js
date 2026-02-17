const normalizeAttachmentContent = (content) => {
  if (Buffer.isBuffer(content)) return content;
  if (content instanceof Uint8Array) return Buffer.from(content);
  if (content instanceof ArrayBuffer) return Buffer.from(new Uint8Array(content));
  return Buffer.from(String(content || ''), 'utf8');
};

const sendViaSmtp = async ({ to, subject, text, html, attachments = [] }) => {
  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT || 587);
  const smtpUser = process.env.SMTP_USER;
  const smtpPass = process.env.SMTP_PASS;
  const from = process.env.SMTP_FROM || smtpUser;

  if (!host || !from || !to) {
    return false;
  }

  let nodemailer;
  try {
    nodemailer = require('nodemailer');
  } catch (err) {
    console.warn('SMTP email skipped: nodemailer is not installed');
    return false;
  }

  const transporter = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: smtpUser && smtpPass ? { user: smtpUser, pass: smtpPass } : undefined,
  });

  await transporter.sendMail({
    from,
    to,
    subject,
    text,
    html,
    attachments: attachments.map((attachment) => ({
      ...attachment,
      content: normalizeAttachmentContent(attachment.content),
    })),
  });

  return true;
};

const toGraphAttachments = (attachments = []) =>
  attachments
    .filter((attachment) => attachment?.filename && attachment?.content)
    .map((attachment) => ({
      '@odata.type': '#microsoft.graph.fileAttachment',
      name: attachment.filename,
      contentType: attachment.contentType || 'application/octet-stream',
      contentBytes: normalizeAttachmentContent(attachment.content).toString('base64'),
    }));

const sendViaGraph = async ({ to, subject, text, html, attachments = [] }) => {
  const tenantId = process.env.MS365_TENANT_ID;
  const clientId = process.env.MS365_CLIENT_ID;
  const clientSecret = process.env.MS365_CLIENT_SECRET;
  const sender = process.env.MS365_SENDER || process.env.SMTP_FROM;

  if (!tenantId || !clientId || !clientSecret || !sender || !to) {
    return false;
  }

  const tokenUrl = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`;
  const tokenBody = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: clientId,
    client_secret: clientSecret,
    scope: 'https://graph.microsoft.com/.default',
  });

  const tokenRes = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: tokenBody.toString(),
  });

  if (!tokenRes.ok) {
    const errText = await tokenRes.text().catch(() => '');
    throw new Error(`Graph token request failed (${tokenRes.status}): ${errText}`);
  }

  const tokenJson = await tokenRes.json();
  const accessToken = tokenJson.access_token;
  if (!accessToken) {
    throw new Error('Graph token response did not contain access_token');
  }

  const recipients = String(to)
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
    .map((address) => ({ emailAddress: { address } }));

  const sendRes = await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(sender)}/sendMail`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      message: {
        subject,
        body: {
          contentType: html ? 'HTML' : 'Text',
          content: html || text || '',
        },
        toRecipients: recipients,
        attachments: toGraphAttachments(attachments),
      },
      saveToSentItems: 'false',
    }),
  });

  if (!sendRes.ok) {
    const errText = await sendRes.text().catch(() => '');
    throw new Error(`Graph sendMail failed (${sendRes.status}): ${errText}`);
  }

  return true;
};

const sendAppEmail = async ({ to, subject, text, html, attachments = [] }) => {
  try {
    const graphSent = await sendViaGraph({ to, subject, text, html, attachments });
    if (graphSent) return { sent: true, provider: 'graph' };
  } catch (err) {
    console.error('Graph email send failed:', err.message || err);
  }

  try {
    const smtpSent = await sendViaSmtp({ to, subject, text, html, attachments });
    if (smtpSent) return { sent: true, provider: 'smtp' };
  } catch (err) {
    console.error('SMTP email send failed:', err.message || err);
  }

  return { sent: false, provider: null };
};

module.exports = {
  sendAppEmail,
};
