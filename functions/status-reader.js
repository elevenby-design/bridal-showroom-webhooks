exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') { return { statusCode: 204, headers: h() }; }
  const { customerId, showroomData } = JSON.parse(event.body || '{}');
  const domain = process.env.SHOPIFY_STORE_DOMAIN;
  const ver = process.env.SHOPIFY_API_VERSION || '2023-10';
  try {
    const resp = await fetch(`https://${domain}/admin/api/${ver}/customers/${customerId}/metafields.json`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': process.env.SHOPIFY_ADMIN_ACCESS_TOKEN
      },
      body: JSON.stringify({
        metafield: {
          namespace: 'showroom',
          key: 'data',
          value: JSON.stringify(showroomData),
          type: 'json_string'
        }
      })
    });
    const json = await resp.json();
    return { statusCode: resp.status, headers: h(), body: JSON.stringify(json) };
  } catch (e) {
    return { statusCode: 500, headers: h(), body: JSON.stringify({ error: e.message }) };
  }
  function h(){return {'Access-Control-Allow-Origin':process.env.CORS_ALLOWED_ORIGIN||'*','Access-Control-Allow-Methods':'GET,POST,OPTIONS','Access-Control-Allow-Headers':'Content-Type, Authorization'};}
};