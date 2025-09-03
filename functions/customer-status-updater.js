exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') { return { statusCode: 204, headers: h() }; }
  const { mode, email, customerId, createdAtMin } = JSON.parse(event.body || '{}');
  const domain = process.env.SHOPIFY_STORE_DOMAIN;
  const ver = process.env.SHOPIFY_API_VERSION || '2024-10';
  try {
    if (mode === 'search') {
      const resp = await fetch(`https://${domain}/admin/api/${ver}/customers/search.json?query=email:${encodeURIComponent(email)}`, {
        headers: { 'X-Shopify-Access-Token': process.env.SHOPIFY_ADMIN_ACCESS_TOKEN }
      });
      const json = await resp.json();
      return ok(json);
    }
    if (mode === 'orders') {
      const resp = await fetch(`https://${domain}/admin/api/${ver}/orders.json?customer_id=${customerId}&status=any&created_at_min=${encodeURIComponent(createdAtMin)}&limit=10`, {
        headers: { 'X-Shopify-Access-Token': process.env.SHOPIFY_ADMIN_ACCESS_TOKEN }
      });
      const json = await resp.json();
      return ok(json);
    }
    return bad({ error: 'Invalid mode' });
  } catch (e) {
    return bad({ error: e.message });
  }
  function h(){return {'Access-Control-Allow-Origin':process.env.CORS_ALLOWED_ORIGIN||'*','Access-Control-Allow-Methods':'GET,POST,OPTIONS','Access-Control-Allow-Headers':'Content-Type, Authorization'};}
  function ok(b){return { statusCode: 200, headers: h(), body: JSON.stringify(b) }; }
  function bad(b){return { statusCode: 400, headers: h(), body: JSON.stringify(b) }; }
};