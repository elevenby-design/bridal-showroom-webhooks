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

  // Only allow POST requests
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
    const searchResponse = await fetch(`https://${shopDomain}.myshopify.com/admin/api/2023-10/customers/search.json?query=email:${encodeURIComponent(email)}`, {
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
      // Create new customer if not found
      const createResponse = await fetch(`https://${shopDomain}.myshopify.com/admin/api/2023-10/customers.json`, {
        method: 'POST',
        headers: {
          'X-Shopify-Access-Token': accessToken,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          customer: {
            email: email,
            first_name: 'Bridal',
            last_name: 'Party',
            note: 'Created via bridal showroom'
          }
        })
      });

      if (!createResponse.ok) {
        console.error('Failed to create customer:', createResponse.status, createResponse.statusText);
        return {
          statusCode: 500,
          headers: {
            'Access-Control-Allow-Origin': '*',
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ error: 'Failed to create customer' })
        };
      }

      const createData = await createResponse.json();
      const customerId = createData.customer.id;
      console.log('Created new customer with ID:', customerId);

      // Now set the metafields for the new customer
      await setCustomerMetafields(shopDomain, accessToken, customerId, metafields);

      return {
        statusCode: 200,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ 
          success: true, 
          message: 'Customer created and metafields set',
          customerId: customerId
        })
      };
    } else {
      // Customer exists, update their metafields
      const customerId = customers[0].id;
      console.log('Found existing customer with ID:', customerId);

      await setCustomerMetafields(shopDomain, accessToken, customerId, metafields);

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

    const response = await fetch(`https://${shopDomain}.myshopify.com/admin/api/2023-10/customers/${customerId}/metafields.json`, {
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
