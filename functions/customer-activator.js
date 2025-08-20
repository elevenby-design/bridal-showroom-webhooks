// Netlify Function: Customer Activator
// Creates customers in Shopify and sends activation emails via Klaviyo

const SHOPIFY_ACCESS_TOKEN = process.env.SHOPIFY_ACCESS_TOKEN;
const SHOPIFY_SHOP_DOMAIN = process.env.SHOPIFY_SHOP_DOMAIN;
const KLAVIYO_PRIVATE_API_KEY = process.env.KLAVIYO_PRIVATE_API_KEY;

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
    const { email, firstName, lastName, showroomId, brideName, weddingDate } = JSON.parse(event.body || '{}');
    
    if (!email || !firstName || !lastName) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Email, firstName, and lastName are required' }) };
    }

    // Step 1: Create customer in Shopify
    const customerResult = await createCustomerInShopify(email, firstName, lastName);
    
    if (!customerResult.success) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: customerResult.error }) };
    }

    const customer = customerResult.customer;
    
    // Step 2: Store bridal party data in customer metafields
    await storeBridalPartyData(customer.id, showroomId, email);
    
    return { 
      statusCode: 200, 
      headers, 
      body: JSON.stringify({ 
        success: true, 
        customer: customer
      }) 
    };

  } catch (error) {
    console.error('Error in customer activator:', error);
    return { statusCode: 500, headers, body: JSON.stringify({ error: error.message }) };
  }
};

// Create customer in Shopify
async function createCustomerInShopify(email, firstName, lastName) {
  try {
    // Generate a secure password
    const password = generateSecurePassword();
    
    const response = await fetch(`https://${SHOPIFY_SHOP_DOMAIN}/admin/api/2023-10/customers.json`, {
      method: 'POST',
      headers: {
        'X-Shopify-Access-Token': SHOPIFY_ACCESS_TOKEN,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        customer: {
          email: email,
          first_name: firstName,
          last_name: lastName,
          password: password,
          password_confirmation: password,
          send_email_welcome: false, // We'll send our own activation email
          send_email_invite: true, // This will generate the activation URL
          accepts_marketing: true,
          state: 'disabled' // Ensure account is disabled until activated
        }
      })
    });

    if (!response.ok) {
      const errorData = await response.json();
      console.error('Shopify customer creation error:', errorData);
      return { success: false, error: errorData.errors || 'Failed to create customer' };
    }

    const data = await response.json();
    const customer = data.customer;
    
    // Get the activation URL from the customer object
    // Shopify will provide this in the response when send_email_invite is true
    const activationUrl = customer.account_activation_url;
    
    if (!activationUrl) {
      console.error('No activation URL generated for customer:', customer.id);
      return { success: false, error: 'Failed to generate activation URL' };
    }
    
    console.log('Customer created successfully:', customer.id);
    console.log('Activation URL:', activationUrl);
    
    return { 
      success: true, 
      customer: {
        ...customer,
        account_activation_url: activationUrl
      }
    };

  } catch (error) {
    console.error('Error creating customer in Shopify:', error);
    return { success: false, error: error.message };
  }
}

// Store bridal party data in customer metafields
async function storeBridalPartyData(customerId, showroomId, email) {
  try {
    const metafields = [
      {
        namespace: 'bridal_showroom',
        key: 'showroom_id',
        value: showroomId,
        type: 'single_line_text_field'
      },
      {
        namespace: 'bridal_showroom',
        key: 'status',
        value: 'invited',
        type: 'single_line_text_field'
      },
      {
        namespace: 'bridal_showroom',
        key: 'invite_date',
        value: new Date().toISOString(),
        type: 'single_line_text_field'
      }
    ];

    for (const metafield of metafields) {
      await fetch(`https://${SHOPIFY_SHOP_DOMAIN}/admin/api/2023-10/customers/${customerId}/metafields.json`, {
        method: 'POST',
        headers: {
          'X-Shopify-Access-Token': SHOPIFY_ACCESS_TOKEN,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ metafield })
      });
    }

    console.log(`Stored bridal party data for customer ${customerId}`);
  } catch (error) {
    console.error('Error storing bridal party data:', error);
  }
}



// Generate a secure password
function generateSecurePassword() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*';
  let password = '';
  for (let i = 0; i < 12; i++) {
    password += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return password;
} 