const fetch = require('node-fetch');

exports.handler = async function(event, context) {
  // Handle CORS
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS'
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
    const { email } = JSON.parse(event.body);
    
    if (!email) {
      return {
        statusCode: 400,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ error: 'Email is required' })
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

    console.log('Deleting showroom data for email:', email);

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
      console.log('Customer not found - nothing to delete');
      return {
        statusCode: 200,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ 
          success: true, 
          message: 'Customer not found - nothing to delete'
        })
      };
    }

    const customerId = customers[0].id;
    console.log('Found customer with ID:', customerId);

    // Get customer metafields to find showroom data
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
    const showroomMetafields = metafieldsData.metafields.filter(m => m.namespace === 'showroom');

    if (showroomMetafields.length === 0) {
      console.log('No showroom metafields found - nothing to delete');
      return {
        statusCode: 200,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ 
          success: true, 
          message: 'No showroom data found - nothing to delete'
        })
      };
    }

    // Delete each showroom metafield
    console.log(`Found ${showroomMetafields.length} showroom metafields to delete`);
    
    for (const metafield of showroomMetafields) {
      try {
        const deleteResponse = await fetch(`https://${shopDomain}/admin/api/2024-10/customers/${customerId}/metafields/${metafield.id}.json`, {
          method: 'DELETE',
          headers: {
            'X-Shopify-Access-Token': accessToken,
            'Content-Type': 'application/json'
          }
        });

        if (!deleteResponse.ok) {
          console.error(`Failed to delete metafield ${metafield.id}:`, deleteResponse.status, deleteResponse.statusText);
        } else {
          console.log(`Successfully deleted metafield ${metafield.id}`);
        }
      } catch (error) {
        console.error(`Error deleting metafield ${metafield.id}:`, error);
      }
    }

    // Also remove the showroom-bride tag if present
    try {
      const currentTags = customers[0].tags ? customers[0].tags.split(',').map(tag => tag.trim()) : [];
      const updatedTags = currentTags.filter(tag => tag !== 'showroom-bride');
      
      if (updatedTags.length !== currentTags.length) {
        const updateResponse = await fetch(`https://${shopDomain}/admin/api/2024-10/customers/${customerId}.json`, {
          method: 'PUT',
          headers: {
            'X-Shopify-Access-Token': accessToken,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            customer: {
              id: customerId,
              tags: updatedTags.join(', ')
            }
          })
        });

        if (updateResponse.ok) {
          console.log('Successfully removed showroom-bride tag');
        } else {
          console.error('Failed to remove showroom-bride tag:', updateResponse.status);
        }
      }
    } catch (error) {
      console.error('Error updating customer tags:', error);
    }

    console.log('Showroom deletion completed successfully');

    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ 
        success: true, 
        message: 'Showroom data deleted successfully',
        deletedMetafields: showroomMetafields.length
      })
    };

  } catch (error) {
    console.error('Error in showroom deletion:', error);
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