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
    const hubspotKey = process.env.HUBSPOT_API_KEY;
    if (!hubspotKey) {
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: 'HubSpot API key not configured' })
      };
    }

    const { properties } = JSON.parse(event.body);

    if (!properties || !Array.isArray(properties)) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Missing properties array' })
      };
    }

    // Find email in properties
    const emailProp = properties.find(p => p.property === 'email');
    if (!emailProp || !emailProp.value) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Email property required' })
      };
    }

    // Try to create contact; if it exists (409), update instead
    const createRes = await fetch('https://api.hubapi.com/contacts/v1/contact', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${hubspotKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ properties })
    });

    if (createRes.status === 409) {
      // Contact already exists — update by email
      const updateRes = await fetch(
        `https://api.hubapi.com/contacts/v1/contact/email/${encodeURIComponent(emailProp.value)}/profile`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${hubspotKey}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ properties })
        }
      );
      const updateData = await updateRes.json().catch(() => ({}));
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: true, action: 'updated', data: updateData })
      };
    }

    const createData = await createRes.json().catch(() => ({}));
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: true, action: 'created', data: createData })
    };

  } catch (err) {
    console.error('HubSpot contact error:', err);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: err.message })
    };
  }
};
