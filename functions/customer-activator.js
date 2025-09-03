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
    const { email, firstName, lastName, showroomId, brideName, weddingDate, roles, customerNote } = JSON.parse(event.body || '{}');
    
    if (!email || !firstName || !lastName) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Email, firstName, and lastName are required' }) };
    }

    // Step 1: Create customer in Shopify
    const customerResult = await createCustomerInShopify(email, firstName, lastName, customerNote);
    
    if (!customerResult.success) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: customerResult.error }) };
    }

    const customer = customerResult.customer;
    
    // Step 2: Add customer tags for bridal party
    await addBridalPartyTags(customer.id, roles);
    
    // Step 3: Store comprehensive bridal party data in customer metafields
    await storeBridalPartyData(customer.id, showroomId, email, brideName, weddingDate, roles);
    
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
async function createCustomerInShopify(email, firstName, lastName, customerNote) {
  try {
    // First, check if customer already exists
    const existingCustomer = await getCustomerByEmail(email);
    
    if (existingCustomer) {
      console.log('Customer already exists:', existingCustomer.id);
      
      // Return existing customer; invite will be sent by caller if needed
      return { success: true, customer: existingCustomer };
    }
    
    // Generate a secure password (not strictly needed if using invite)
    const password = generateSecurePassword();
    
    const response = await fetch(`https://${SHOPIFY_SHOP_DOMAIN}/admin/api/2024-10/customers.json`, {
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
          accepts_marketing: true,
          state: 'disabled',
          note: customerNote || ''
        }
      })
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      console.error('Shopify customer creation error:', response.status, errorText);
      return { success: false, error: `Shopify create customer ${response.status} ${errorText}` };
    }

    const data = await response.json();
    const customer = data.customer;
    
    // Send invite email explicitly (does not return activation URL; Shopify emails it)
    const inviteResp = await fetch(`https://${SHOPIFY_SHOP_DOMAIN}/admin/api/2024-10/customers/${customer.id}/send_invite.json`, {
      method: 'POST',
      headers: {
        'X-Shopify-Access-Token': SHOPIFY_ACCESS_TOKEN,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        customer_invite: {
          subject: 'Activate your account',
          custom_message: 'You have been invited to the bridal showroom. Please activate your account.'
        }
      })
    });
    if (!inviteResp.ok) {
      const inviteText = await inviteResp.text().catch(() => '');
      console.error('Shopify send_invite error:', inviteResp.status, inviteText);
      // Still return success for created customer; storefront UI will reflect invited state
    }
    
    console.log('Customer created successfully:', customer.id);
    
    return { success: true, customer };

  } catch (error) {
    console.error('Error creating customer in Shopify:', error);
    return { success: false, error: error.message };
  }
}

// Add customer tags for bridal party
async function addBridalPartyTags(customerId, roles) {
  try {
    // Build tags array
    const tags = ['bridal-party', 'showroom-invited'];
    
    // Add role-specific tags
    if (roles && Array.isArray(roles)) {
      roles.forEach(role => {
        switch(role) {
          case 'bridesmaid':
            tags.push('bridesmaid');
            break;
          case 'maid-of-honor':
            tags.push('maid-of-honor', 'moh');
            break;
          case 'wedding-guest':
            tags.push('wedding-guest');
            break;
          default:
            tags.push(role);
        }
      });
    }
    
    // Get existing customer to preserve existing tags
    const existingCustomer = await getCustomerById(customerId);
    const existingTags = existingCustomer ? existingCustomer.tags.split(',').map(tag => tag.trim()).filter(tag => tag) : [];
    
    // Combine existing tags with new tags, avoiding duplicates
    const allTags = [...new Set([...existingTags, ...tags])];
    
    // Update customer with new tags
    const response = await fetch(`https://${SHOPIFY_SHOP_DOMAIN}/admin/api/2024-10/customers/${customerId}.json`, {
      method: 'PUT',
      headers: {
        'X-Shopify-Access-Token': SHOPIFY_ACCESS_TOKEN,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        customer: {
          id: customerId,
          tags: allTags.join(', ')
        }
      })
    });
    
    if (response.ok) {
      console.log(`Added tags to customer ${customerId}:`, allTags);
    } else {
      console.error('Failed to add tags to customer:', response.status);
    }
  } catch (error) {
    console.error('Error adding bridal party tags:', error);
  }
}

// Get customer by ID
async function getCustomerById(customerId) {
  try {
    const response = await fetch(`https://${SHOPIFY_SHOP_DOMAIN}/admin/api/2024-10/customers/${customerId}.json`, {
      headers: {
        'X-Shopify-Access-Token': SHOPIFY_ACCESS_TOKEN,
        'Content-Type': 'application/json'
      }
    });
    
    if (response.ok) {
      const data = await response.json();
      return data.customer;
    }
    
    return null;
  } catch (error) {
    console.error('Error getting customer by ID:', error);
    return null;
  }
}

// Get customer by email
async function getCustomerByEmail(email) {
  try {
    const response = await fetch(`https://${SHOPIFY_SHOP_DOMAIN}/admin/api/2024-10/customers/search.json?query=email:${encodeURIComponent(email)}`, {
      headers: {
        'X-Shopify-Access-Token': SHOPIFY_ACCESS_TOKEN,
        'Content-Type': 'application/json'
      }
    });
    
    if (response.ok) {
      const data = await response.json();
      return data.customers && data.customers[0] ? data.customers[0] : null;
    }
    
    return null;
  } catch (error) {
    console.error('Error getting customer by email:', error);
    return null;
  }
}

// Generate activation URL for existing customer
async function generateActivationUrl(customerId) {
  try {
    const response = await fetch(`https://${SHOPIFY_SHOP_DOMAIN}/admin/api/2024-10/customers/${customerId}/send_invite.json`, {
      method: 'POST',
      headers: {
        'X-Shopify-Access-Token': SHOPIFY_ACCESS_TOKEN,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        customer_invite: {
          subject: 'Activate your account',
          custom_message: 'Please activate your bridal party account.'
        }
      })
    });
    
    if (response.ok) {
      // The invite will be sent via email, but we need to get the URL
      // For now, we'll construct it manually
      const inviteToken = await getInviteToken(customerId);
      if (inviteToken) {
        return `https://${SHOPIFY_SHOP_DOMAIN}/account/activate/${customerId}/${inviteToken}`;
      }
    }
    
    return null;
  } catch (error) {
    console.error('Error generating activation URL:', error);
    return null;
  }
}

// Get invite token (this is a simplified approach)
async function getInviteToken(customerId) {
  try {
    const response = await fetch(`https://${SHOPIFY_SHOP_DOMAIN}/admin/api/2024-10/customers/${customerId}.json`, {
      headers: {
        'X-Shopify-Access-Token': SHOPIFY_ACCESS_TOKEN,
        'Content-Type': 'application/json'
      }
    });
    
    if (response.ok) {
      const data = await response.json();
      // Note: This is a simplified approach. In practice, you might need to
      // handle this differently as Shopify doesn't always expose the invite token
      return data.customer.invite_token || null;
    }
    
    return null;
  } catch (error) {
    console.error('Error getting invite token:', error);
    return null;
  }
}

// Store comprehensive bridal party data in customer metafields
async function storeBridalPartyData(customerId, showroomId, email, brideName, weddingDate, roles) {
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
      },
      {
        namespace: 'bridal_showroom',
        key: 'bride_name',
        value: brideName || '',
        type: 'single_line_text_field'
      },
      {
        namespace: 'bridal_showroom',
        key: 'wedding_date',
        value: weddingDate || '',
        type: 'single_line_text_field'
      },
      {
        namespace: 'bridal_showroom',
        key: 'roles',
        value: JSON.stringify(roles || []),
        type: 'json_string'
      },
      {
        namespace: 'bridal_showroom',
        key: 'invite_source',
        value: 'bride_invitation',
        type: 'single_line_text_field'
      },
      {
        namespace: 'bridal_showroom',
        key: 'showroom_url',
        value: `https://${SHOPIFY_SHOP_DOMAIN}/pages/showroom-signup?showroom=${showroomId}`,
        type: 'single_line_text_field'
      },
      {
        namespace: 'bridal_showroom',
        key: 'account_created',
        value: new Date().toISOString(),
        type: 'date_time'
      },
      {
        namespace: 'bridal_showroom',
        key: 'invitation_count',
        value: '1',
        type: 'number_integer'
      }
    ];

    // Create metafields in batches to avoid rate limits
    const batchSize = 5;
    for (let i = 0; i < metafields.length; i += batchSize) {
      const batch = metafields.slice(i, i + batchSize);
      
      const promises = batch.map(metafield => 
        fetch(`https://${SHOPIFY_SHOP_DOMAIN}/admin/api/2024-10/customers/${customerId}/metafields.json`, {
          method: 'POST',
          headers: {
            'X-Shopify-Access-Token': SHOPIFY_ACCESS_TOKEN,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ metafield })
        })
      );
      
      await Promise.all(promises);
      
      // Small delay between batches to respect rate limits
      if (i + batchSize < metafields.length) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }

    console.log(`Stored comprehensive bridal party data for customer ${customerId}`);
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