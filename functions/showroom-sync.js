const fetch = require('node-fetch');

exports.handler = async function(event, context) {
  // Handle CORS
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE'
      }
    };
  }

  // Handle GET requests for reading showroom data
  if (event.httpMethod === 'GET') {
    try {
      const { email } = event.queryStringParameters || {};
      
      if (!email) {
        return {
          statusCode: 400,
          headers: {
            'Access-Control-Allow-Origin': '*',
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ error: 'Email parameter is required' })
        };
      }

      // Get Shopify credentials from environment variables
      const shopDomain = process.env.SHOPIFY_SHOP_DOMAIN;
      const accessToken = process.env.SHOPIFY_ACCESS_TOKEN;

      if (!shopDomain || !accessToken) {
        console.error('Missing Shopify credentials');
        return {
          statusCode: 500,
          headers: {
            'Access-Control-Allow-Origin': '*',
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ error: 'Shopify configuration missing' })
        };
      }

      // Search for customer by email
      const searchResponse = await fetch(`https://${shopDomain}/admin/api/2024-10/customers/search.json?query=email:${encodeURIComponent(email)}`, {
        method: 'GET',
        headers: {
          'X-Shopify-Access-Token': accessToken,
          'Content-Type': 'application/json'
        }
      });

      if (!searchResponse.ok) {
        console.error('Failed to search for customer:', searchResponse.status, searchResponse.statusText);
        return {
          statusCode: 500,
          headers: {
            'Access-Control-Allow-Origin': '*',
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ error: 'Failed to search for customer' })
        };
      }

      const searchData = await searchResponse.json();
      const customers = searchData.customers || [];

      if (customers.length === 0) {
        return {
          statusCode: 404,
          headers: {
            'Access-Control-Allow-Origin': '*',
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ error: 'Customer not found' })
        };
      }

      const customerId = customers[0].id;
      console.log('Found customer with ID:', customerId);

      // Get customer metafields
      const metafieldsResponse = await fetch(`https://${shopDomain}/admin/api/2024-10/customers/${customerId}/metafields.json`, {
        method: 'GET',
        headers: {
          'X-Shopify-Access-Token': accessToken,
          'Content-Type': 'application/json'
        }
      });

      if (!metafieldsResponse.ok) {
        console.error('Failed to get customer metafields:', metafieldsResponse.status, metafieldsResponse.statusText);
        return {
          statusCode: 500,
          headers: {
            'Access-Control-Allow-Origin': '*',
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ error: 'Failed to get customer metafields' })
        };
      }

      const metafieldsData = await metafieldsResponse.json();
      const showroomMetafield = metaffieldsFindShowroom(metafieldsData.metafields);

      if (!showroomMetafield) {
        return {
          statusCode: 404,
          headers: {
            'Access-Control-Allow-Origin': '*',
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ error: 'No showroom data found' })
        };
      }

      return {
        statusCode: 200,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ 
          success: true, 
          showroomData: JSON.parse(showroomMetafield.value)
        })
      };

    } catch (error) {
      console.error('Error reading showroom data:', error);
      return {
        statusCode: 500,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ error: 'Internal server error', details: error.message })
      };
    }
  }

  // Handle POST requests for saving showroom data
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  try {
    // Parse the request body
    const { email, metafields } = JSON.parse(event.body);
    
    if (!email || !metafields) {
      return {
        statusCode: 400,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ error: 'Email and metafields are required' })
      };
    }

    // Get Shopify credentials from environment variables
    const shopDomain = process.env.SHOPIFY_SHOP_DOMAIN;
    const accessToken = process.env.SHOPIFY_ACCESS_TOKEN;

    if (!shopDomain || !accessToken) {
      console.error('Missing Shopify credentials');
      return {
        statusCode: 500,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ error: 'Shopify configuration missing' })
      };
    }

    // First, find the customer by email
    const searchResponse = await fetch(`https://${shopDomain}/admin/api/2024-10/customers/search.json?query=email:${encodeURIComponent(email)}`, {
      method: 'GET',
      headers: {
        'X-Shopify-Access-Token': accessToken,
        'Content-Type': 'application/json'
      }
    });

    if (!searchResponse.ok) {
      console.error('Failed to search for customer:', searchResponse.status, searchResponse.statusText);
      return {
        statusCode: 500,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ error: 'Failed to search for customer' })
      };
    }

    const searchData = await searchResponse.json();
    const customers = searchData.customers || [];

    if (customers.length === 0) {
      // Do not create placeholder customers here; require the user to be registered/logged in
      return {
        statusCode: 404,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ error: 'Customer not found; please sign in before syncing' })
      };
    } else {
      // Customer exists, update their metafields
      const customerId = customers[0].id;
      console.log('Found existing customer with ID:', customerId);

      await setCustomerMetafields(shopDomain, accessToken, customerId, metafields);

      // Try to update first/last name and tags based on showroom_data if present
      try {
        const showroomJson = safeParseShowroomData(metafields && metafields.showroom_data);
        const profileUpdate = buildProfileUpdateFromShowroom(showroomJson);
        const tagUpdate = await buildTagsFromShowroom(shopDomain, accessToken, customerId, showroomJson);

        if (profileUpdate || tagUpdate) {
          const body = { customer: { id: customerId, ...(profileUpdate || {}), ...(tagUpdate || {}) } };
          const updateResp = await fetch(`https://${shopDomain}/admin/api/2024-10/customers/${customerId}.json`, {
            method: 'PUT',
            headers: {
              'X-Shopify-Access-Token': accessToken,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify(body)
          });
          if (!updateResp.ok) {
            const t = await updateResp.text().catch(() => '');
            console.warn('Customer update (name/tags) failed:', updateResp.status, t);
          }
        }
      } catch (e) {
        console.warn('Post-save profile/tag update failed', e);
      }

      return {
        statusCode: 200,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ 
          success: true, 
          message: 'Customer metafields updated',
          customerId: customerId
        })
      };
    }

  } catch (error) {
    console.error('Error in showroom sync:', error);
    return {
      statusCode: 500,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ error: 'Internal server error', details: error.message })
    };
  }
};

function metaffieldsFindShowroom(metafields) {
  if (!Array.isArray(metafields)) return null;
  return metafields.find(m => m.namespace === 'showroom' && m.key === 'showroom_data');
}

function safeParseShowroomData(value) {
  try { return value ? JSON.parse(value) : null; } catch(_) { return null; }
}

function splitBrideName(name) {
  if (!name || typeof name !== 'string') return {};
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return { first_name: parts[0] };
  return { first_name: parts[0], last_name: parts.slice(1).join(' ') };
}

function buildProfileUpdateFromShowroom(showroom) {
  if (!showroom) return null;
  const update = {};
  if (showroom.bride_name) {
    Object.assign(update, splitBrideName(showroom.bride_name));
  }
  return Object.keys(update).length ? update : null;
}

async function buildTagsFromShowroom(shopDomain, accessToken, customerId, showroom) {
  try {
    if (!showroom) return null;
    const existingResp = await fetch(`https://${shopDomain}/admin/api/2024-10/customers/${customerId}.json`, {
      headers: {
        'X-Shopify-Access-Token': accessToken,
        'Content-Type': 'application/json'
      }
    });
    if (!existingResp.ok) return null;
    const data = await existingResp.json();
    const existingTags = (data.customer && data.customer.tags ? String(data.customer.tags).split(',').map(t => t.trim()).filter(Boolean) : []);

    const newTags = new Set(existingTags);
    newTags.add('showroom-bride');
    if (showroom.party_size) newTags.add(`showroom-bridal-party-${showroom.party_size}`);

    return { tags: Array.from(newTags).join(', ') };
  } catch (_) {
    return null;
  }
}

async function setCustomerMetafields(shopDomain, accessToken, customerId, metafields) {
  // Set each metafield
  for (const [key, value] of Object.entries(metafields)) {
    const metafieldData = {
      metafield: {
        namespace: 'showroom',
        key: key,
        value: value,
        type: 'json_string'
      }
    };

    const response = await fetch(`https://${shopDomain}/admin/api/2024-10/customers/${customerId}/metafields.json`, {
      method: 'POST',
      headers: {
        'X-Shopify-Access-Token': accessToken,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(metafieldData)
    });

    if (!response.ok) {
      console.error(`Failed to set metafield ${key}:`, response.status, response.statusText);
      throw new Error(`Failed to set metafield ${key}`);
    }

    console.log(`Successfully set metafield ${key}`);
  }
}