// Netlify Function: Status Reader
// POST { emails: ["a@example.com", ...] }

const SHOPIFY_ACCESS_TOKEN = process.env.SHOPIFY_ACCESS_TOKEN;
const SHOPIFY_SHOP_DOMAIN = process.env.SHOPIFY_SHOP_DOMAIN;

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method Not Allowed' }) };
  }

  try {
    const { emails } = JSON.parse(event.body || '{}');
    if (!Array.isArray(emails) || emails.length === 0) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'emails array required' }) };
    }

    const results = {};

    for (const email of emails) {
      try {
        const customer = await getCustomerByEmail(email);
        if (!customer) { results[email] = { status: null }; continue; }

                            // Read bridal_showroom/status metafield
                    const metafields = await getCustomerMetafields(customer.id);
                    const statusMf = metafields.find(m => m.namespace === 'bridal_showroom' && m.key === 'status');
                    const joinedDateMf = metafields.find(m => m.namespace === 'bridal_showroom' && m.key === 'joinedDate');
                    
                    // Check if customer account is activated (state === 'enabled')
                    let status = statusMf ? statusMf.value : null;
                    if (customer.state === 'enabled' && status === 'invited') {
                      status = 'joined';
                    }

                    results[email] = {
                      status: status,
                      joinedDate: joinedDateMf ? joinedDateMf.value : null,
                      customerId: customer.id,
                      accountState: customer.state
                    };
      } catch (e) {
        results[email] = { status: null, error: e.message };
      }
    }

    return { statusCode: 200, headers, body: JSON.stringify({ results }) };
  } catch (error) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: error.message }) };
  }
};

async function getCustomerByEmail(email) {
  const resp = await fetch(`https://${SHOPIFY_SHOP_DOMAIN}/admin/api/2024-10/customers/search.json?query=email:${encodeURIComponent(email)}` ,{
    headers: {
      'X-Shopify-Access-Token': SHOPIFY_ACCESS_TOKEN,
      'Content-Type': 'application/json'
    }
  });
  if (!resp.ok) return null;
  const data = await resp.json();
  return data.customers && data.customers[0] ? data.customers[0] : null;
}

async function getCustomerMetafields(customerId) {
  const resp = await fetch(`https://${SHOPIFY_SHOP_DOMAIN}/admin/api/2024-10/customers/${customerId}/metafields.json`, {
    headers: {
      'X-Shopify-Access-Token': SHOPIFY_ACCESS_TOKEN,
      'Content-Type': 'application/json'
    }
  });
  if (!resp.ok) return [];
  const data = await resp.json();
  return data.metafields || [];
}