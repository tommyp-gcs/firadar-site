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

    const { to, from, subject, body } = JSON.parse(event.body);

    if (!to || !subject || !body) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing required fields: to, subject, body' }) };
    }

    const response = await fetch('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${sendgridKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: to }] }],
        from: { email: from || 'tom.penton@firadar.finance', name: 'Tom Penton · FiRadar' },
        subject: subject,
        content: [{ type: 'text/plain', value: body }]
      })
    });

    if (response.status === 202) {
      return { statusCode: 200, headers, body: JSON.stringify({ success: true, message: 'Email sent successfully' }) };
    } else {
      const errData = await response.json().catch(() => ({}));
      return { statusCode: response.status, headers, body: JSON.stringify({ error: errData }) };
    }

  } catch (err) {
    console.error('SendGrid error:', err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
