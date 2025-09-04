// Netlify Function: Showroom Lister
// GET /showroom-lister?email=user@example.com
// Returns all showrooms associated with a customer email

const SHOPIFY_ACCESS_TOKEN = process.env.SHOPIFY_ACCESS_TOKEN;
const SHOPIFY_SHOP_DOMAIN = process.env.SHOPIFY_SHOP_DOMAIN;

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, OPTIONS'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method Not Allowed' }) };
  }

  try {
    const { email } = event.queryStringParameters || {};
    
    if (!email) {
      return { 
        statusCode: 400, 
        headers, 
        body: JSON.stringify({ error: 'Email parameter is required' }) 
      };
    }

    console.log('Searching for showrooms for email:', email);

    // Search for customer by email
    const customer = await getCustomerByEmail(email);
    
    if (!customer) {
      return { 
        statusCode: 404, 
        headers, 
        body: JSON.stringify({ error: 'Customer not found' }) 
      };
    }

    // Get all metafields for this customer
    const metafields = await getCustomerMetafields(customer.id);
    
    // Find bride-owned showroom metafields
    const brideMetafields = metafields.filter(mf => 
      mf.namespace === 'showroom' && 
      (mf.key === 'showroom_data' || mf.key === 'bride_name' || mf.key === 'wedding_date')
    );

    // Find invited (bridal_showroom) metafields
    const invitedByMetafields = metafields.filter(mf => mf.namespace === 'bridal_showroom');

    console.log('Found showroom metafields:', brideMetafields.length, 'invited metafields:', invitedByMetafields.length);

    // Parse bride-owned showrooms
    const showrooms = [];
    for (const mf of brideMetafields) {
      try {
        if (mf.key === 'showroom_data') {
          const showroomData = JSON.parse(mf.value);
          if (showroomData && (showroomData.bride_name || showroomData.wedding_date)) {
            showrooms.push({
              id: showroomData.showroom_id || 'unknown',
              bride_name: showroomData.bride_name || '',
              wedding_date: showroomData.wedding_date || '',
              roles: ['bride'],
              type: 'owned',
              created_date: mf.created_at,
              updated_date: mf.updated_at
            });
          }
        }
      } catch (parseError) {
        console.warn('Failed to parse bride showroom data:', parseError);
      }
    }

    // Parse invited showrooms (group by showroom_id)
    const invitedMap = new Map();
    for (const mf of invitedByMetafields) {
      try {
        if (mf.key === 'showroom_id') {
          const id = mf.value;
          if (!invitedMap.has(id)) invitedMap.set(id, { id, type: 'invited', roles: [], bride_name: '', wedding_date: '', created_date: mf.created_at, updated_date: mf.updated_at });
        } else if (mf.key === 'roles') {
          const roles = JSON.parse(mf.value || '[]');
          // roles will be attached after we ensure the object exists when showroom_id is seen
          invitedMap.set('__roles__', roles);
        } else if (mf.key === 'bride_name') {
          invitedMap.set('__bride_name__', mf.value || '');
        } else if (mf.key === 'wedding_date') {
          invitedMap.set('__wedding_date__', mf.value || '');
        }
      } catch (e) {
        console.warn('Failed parsing invited metafield:', mf.key, e);
      }
    }

    // Materialize invited entries if we have a showroom_id
    const rolesFallback = invitedMap.get('__roles__') || [];
    const brideNameFallback = invitedMap.get('__bride_name__') || '';
    const weddingDateFallback = invitedMap.get('__wedding_date__') || '';

    invitedMap.forEach((val, key) => {
      if (key && key !== '__roles__' && key !== '__bride_name__' && key !== '__wedding_date__') {
        showrooms.push({
          id: val.id,
          bride_name: brideNameFallback,
          wedding_date: weddingDateFallback,
          roles: rolesFallback,
          type: 'invited',
          created_date: val.created_date,
          updated_date: val.updated_date
        });
      }
    });

    console.log('Processed showrooms:', showrooms);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        customer_id: customer.id,
        email: customer.email,
        showrooms: showrooms,
        total_showrooms: showrooms.length
      })
    };

  } catch (error) {
    console.error('Error in showroom lister:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Internal server error', details: error.message })
    };
  }
};

async function getCustomerByEmail(email) {
  const resp = await fetch(`https://${SHOPIFY_SHOP_DOMAIN}/admin/api/2024-10/customers/search.json?query=email:${encodeURIComponent(email)}`, {
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