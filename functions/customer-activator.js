exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') { return { statusCode: 204, headers: corsHeaders() }; }
  const { name, email, roles, brideName, weddingDate, showroomId } = JSON.parse(event.body || '{}');
  const domain = process.env.SHOPIFY_STORE_DOMAIN;
  const ver = process.env.SHOPIFY_API_VERSION || '2023-10';
  try {
    const tags = ['bridal-party', 'showroom-invited', ...(roles || [])].join(',');
    const note = `Bridal party member - Showroom: ${showroomId} - Bride: ${brideName} - Wedding: ${weddingDate} - Roles: ${(roles||[]).join(', ')}`;
    const body = { customer: { first_name: name, last_name: '', email, note, tags, accepts_marketing: true, send_email_invite: true } };
    const resp = await fetch(`https://${domain}/admin/api/${ver}/customers.json`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': process.env.SHOPIFY_ADMIN_ACCESS_TOKEN
      },
      body: JSON.stringify(body)
    });
    const text = await resp.text();
    const json = safeJson(text);
    return respond(resp.status, json || { raw: text });
  } catch (e) {
    return respond(500, { error: e.message });
  }
  function corsHeaders() {
    return {
      'Access-Control-Allow-Origin': process.env.CORS_ALLOWED_ORIGIN || '*',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization'
    };
  }
  function respond(status, body) { return { statusCode: status, headers: corsHeaders(), body: JSON.stringify(body) }; }
  function safeJson(s) { try { return JSON.parse(s); } catch { return null; } }
};