// Netlify Function: Status Updater
// Deploy this to Netlify Functions for easy hosting

const crypto = require('crypto');

// Environment variables (set these in Netlify dashboard)
const SHOPIFY_WEBHOOK_SECRET = process.env.SHOPIFY_WEBHOOK_SECRET;
const SHOPIFY_ACCESS_TOKEN = process.env.SHOPIFY_ACCESS_TOKEN;
const SHOPIFY_SHOP_DOMAIN = process.env.SHOPIFY_SHOP_DOMAIN;

// Verify Shopify webhook signature
function verifyWebhook(body, hmac) {
  if (!hmac || !SHOPIFY_WEBHOOK_SECRET) {
    return false;
  }
  
  const hash = crypto
    .createHmac('sha256', SHOPIFY_WEBHOOK_SECRET)
    .update(body, 'utf8')
    .digest('base64');
  
  return hash === hmac;
}

// Handle customer creation (when someone signs up)
exports.handler = async (event, context) => {
  // Enable CORS
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS'
  };

  // Handle preflight requests
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers,
      body: ''
    };
  }

  try {
    // Verify webhook signature
    const hmac = event.headers['x-shopify-hmac-sha256'];
    const topic = event.headers['x-shopify-topic'];
    
    if (!verifyWebhook(event.body, hmac)) {
      return {
        statusCode: 401,
        headers,
        body: JSON.stringify({ error: 'Unauthorized' })
      };
    }

    const body = JSON.parse(event.body);
    
    if (topic === 'customers/create') {
      // Handle customer creation (for cases where account is created manually)
      const customer = body;
      console.log('Customer created:', customer.email);
      
      // Check if this customer is part of a bridal party
      const bridalPartyData = await checkBridalPartyMembership(customer.email);
      
      if (bridalPartyData) {
        // Update the bridal party status to 'joined'
        await updateBridalPartyStatus(bridalPartyData.showroomId, customer.email, 'joined', {
          customerId: customer.id,
          joinedDate: new Date().toISOString()
        });
        
        console.log(`Updated ${customer.email} status to 'joined' in showroom ${bridalPartyData.showroomId}`);
      }
      
    } else if (topic === 'customers/login') {
      // Handle customer login (more reliable for tracking when someone actually joins)
      const customer = body;
      console.log('Customer logged in:', customer.email);
      
      // Check if this customer is part of a bridal party
      const bridalPartyData = await checkBridalPartyMembership(customer.email);
      
      if (bridalPartyData && bridalPartyData.status === 'invited') {
        // Update the bridal party status to 'joined'
        await updateBridalPartyStatus(bridalPartyData.showroomId, customer.email, 'joined', {
          customerId: customer.id,
          joinedDate: new Date().toISOString()
        });
        
        console.log(`Updated ${customer.email} status to 'joined' in showroom ${bridalPartyData.showroomId}`);
      }
      
    } else if (topic === 'orders/create') {
      // Handle order creation
      const order = body;
      const customerEmail = order.email;
      console.log('Order created for:', customerEmail);
      
      // Check if this customer is part of a bridal party
      const bridalPartyData = await checkBridalPartyMembership(customerEmail);
      
      if (bridalPartyData && bridalPartyData.status === 'joined') {
        // Check if the order contains products from the showroom
        const showroomProducts = await getShowroomProducts(bridalPartyData.showroomId);
        const orderProductIds = order.line_items.map(item => item.product_id.toString());
        
        const hasShowroomProduct = orderProductIds.some(productId => 
          showroomProducts.includes(productId)
        );
        
        if (hasShowroomProduct) {
          // Update the bridal party status to 'purchased'
          await updateBridalPartyStatus(bridalPartyData.showroomId, customerEmail, 'purchased', {
            purchasedDate: new Date().toISOString(),
            orderId: order.id
          });
          
          console.log(`Updated ${customerEmail} status to 'purchased' in showroom ${bridalPartyData.showroomId}`);
        }
      }
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: true })
    };
    
  } catch (error) {
    console.error('Error handling webhook:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Internal Server Error' })
    };
  }
};

// Check if a customer is part of a bridal party
async function checkBridalPartyMembership(email) {
  try {
    const response = await fetch(`https://${SHOPIFY_SHOP_DOMAIN}/admin/api/2024-10/customers/search.json?query=email:${email}`, {
      headers: {
        'X-Shopify-Access-Token': SHOPIFY_ACCESS_TOKEN,
        'Content-Type': 'application/json'
      }
    });
    
    if (response.ok) {
      const data = await response.json();
      const customer = data.customers[0];
      
      if (customer) {
        // Check if customer has bridal party metafields
        const metafieldsResponse = await fetch(`https://${SHOPIFY_SHOP_DOMAIN}/admin/api/2024-10/customers/${customer.id}/metafields.json`, {
          headers: {
            'X-Shopify-Access-Token': SHOPIFY_ACCESS_TOKEN,
            'Content-Type': 'application/json'
          }
        });
        
        if (metafieldsResponse.ok) {
          const metafieldsData = await metafieldsResponse.json();
          const bridalPartyMetafield = metafieldsData.metafields.find(
            m => m.namespace === 'bridal_showroom' && m.key === 'showroom_id'
          );
          
          if (bridalPartyMetafield) {
            // Get current status
            const statusMetafield = metafieldsData.metafields.find(
              m => m.namespace === 'bridal_showroom' && m.key === 'status'
            );
            
            return {
              showroomId: bridalPartyMetafield.value,
              status: statusMetafield ? statusMetafield.value : 'invited'
            };
          }
        }
      }
    }
    
    return null;
  } catch (error) {
    console.error('Error checking bridal party membership:', error);
    return null;
  }
}

// Update bridal party status
async function updateBridalPartyStatus(showroomId, email, status, additionalData = {}) {
  try {
    const customer = await getCustomerByEmail(email);
    if (!customer) return;
    
    // Update status metafield
    await updateCustomerMetafield(customer.id, 'bridal_showroom', 'status', status);
    
    // Update additional data metafields
    for (const [key, value] of Object.entries(additionalData)) {
      await updateCustomerMetafield(customer.id, 'bridal_showroom', key, value);
    }
    
    console.log(`Updated status for ${email} to ${status}`);
  } catch (error) {
    console.error('Error updating bridal party status:', error);
  }
}

// Get customer by email
async function getCustomerByEmail(email) {
  try {
    const response = await fetch(`https://${SHOPIFY_SHOP_DOMAIN}/admin/api/2024-10/customers/search.json?query=email:${email}`, {
      headers: {
        'X-Shopify-Access-Token': SHOPIFY_ACCESS_TOKEN,
        'Content-Type': 'application/json'
      }
    });
    
    if (response.ok) {
      const data = await response.json();
      return data.customers[0] || null;
    }
    
    return null;
  } catch (error) {
    console.error('Error getting customer by email:', error);
    return null;
  }
}

// Update customer metafield
async function updateCustomerMetafield(customerId, namespace, key, value) {
  try {
    const response = await fetch(`https://${SHOPIFY_SHOP_DOMAIN}/admin/api/2024-10/customers/${customerId}/metafields.json`, {
      method: 'POST',
      headers: {
        'X-Shopify-Access-Token': SHOPIFY_ACCESS_TOKEN,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        metafield: {
          namespace: namespace,
          key: key,
          value: value,
          type: typeof value === 'number' ? 'number_integer' : 'single_line_text_field'
        }
      })
    });
    
    return response.ok;
  } catch (error) {
    console.error('Error updating customer metafield:', error);
    return false;
  }
}

// Get showroom products from localStorage sync
async function getShowroomProducts(showroomId) {
  try {
    // Since we're using localStorage for showroom data, we'll need to sync this
    // For now, we'll check if the order contains any products that might be in the showroom
    // This is a simplified approach - in production you might want to store showroom data in Shopify metafields
    
    // For now, return an empty array - we'll implement this based on your showroom data structure
    return [];
  } catch (error) {
    console.error('Error getting showroom products:', error);
    return [];
  }
}

// Enhanced function to handle bridal party data sync
async function syncBridalPartyData(email, showroomId) {
  try {
    const customer = await getCustomerByEmail(email);
    if (!customer) return;
    
    // Store showroom ID in customer metafields
    await updateCustomerMetafield(customer.id, 'bridal_showroom', 'showroom_id', showroomId);
    await updateCustomerMetafield(customer.id, 'bridal_showroom', 'invite_date', new Date().toISOString());
    
    console.log(`Synced bridal party data for ${email} in showroom ${showroomId}`);
  } catch (error) {
    console.error('Error syncing bridal party data:', error);
  }
}