exports.handler = async function(event) {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  try {
    const sendgridKey = process.env.SENDGRID_API_KEY;
    if (!sendgridKey) {
      return { statusCode: 500, headers, body: JSON.stringify({ error: 'SendGrid API key not configured' }) };
    }

    const { to, from, replyTo, subject, body } = JSON.parse(event.body);

    if (!to || !subject || !body) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing required fields: to, subject, body' }) };
    }

    // SAFETY: SendGrid will reject sends from any address not verified on
    // your account (e.g. a visitor's personal Gmail). Always send FROM a
    // verified firadar.finance address. If the caller passed an unverified
    // "from", treat it as a reply-to instead so replies still go to the
    // right person without breaking deliverability.
    const VERIFIED_DOMAIN = 'firadar.finance';
    const isVerifiedFrom = typeof from === 'string' && from.toLowerCase().endsWith('@' + VERIFIED_DOMAIN);

    const senderEmail = isVerifiedFrom ? from : 'tom.penton@firadar.finance';
    const effectiveReplyTo = replyTo || (!isVerifiedFrom ? from : undefined);

    const payload = {
      personalizations: [{ to: [{ email: to }] }],
      from: { email: senderEmail, name: 'FiRadar' },
      subject: subject,
      content: [{ type: 'text/plain', value: body }]
    };

    if (effectiveReplyTo && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(effectiveReplyTo)) {
      payload.reply_to = { email: effectiveReplyTo };
    }

    const response = await fetch('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${sendgridKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    if (response.status === 202) {
      return { statusCode: 200, headers, body: JSON.stringify({ success: true, message: 'Email sent successfully' }) };
    } else {
      const errData = await response.json().catch(() => ({}));
      console.error('SendGrid rejected send:', response.status, JSON.stringify(errData));
      return { statusCode: response.status, headers, body: JSON.stringify({ error: errData }) };
    }

  } catch (err) {
    console.error('SendGrid error:', err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
