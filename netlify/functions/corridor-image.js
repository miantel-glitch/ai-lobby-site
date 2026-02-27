// Scene Image Generator
// Generates atmospheric scene images using FAL.ai FLUX Schnell
// Returns a direct image URL for the frontend to display
// Supports style override for different contexts (corridors, outings, etc.)

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json'
};

exports.handler = async (event, context) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const falKey = process.env.FAL_KEY;
  if (!falKey) {
    console.error('No FAL_KEY environment variable set');
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ imageUrl: null, error: 'Image generation not configured' })
    };
  }

  try {
    const body = JSON.parse(event.body || '{}');
    const { prompt, sceneId, style } = body;

    if (!prompt) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Prompt required' })
      };
    }

    // Check if we already generated an image for this scene
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_ANON_KEY;

    if (supabaseUrl && supabaseKey && sceneId) {
      try {
        const sceneRes = await fetch(
          `${supabaseUrl}/rest/v1/corridor_scenes?id=eq.${sceneId}&select=image_url`,
          { headers: { 'apikey': supabaseKey, 'Authorization': `Bearer ${supabaseKey}` } }
        );
        if (sceneRes.ok) {
          const scenes = await sceneRes.json();
          if (scenes[0]?.image_url) {
            // Already have an image for this scene — return cached URL
            return {
              statusCode: 200,
              headers,
              body: JSON.stringify({ imageUrl: scenes[0].image_url, cached: true })
            };
          }
        }
      } catch (e) {
        console.log('Cache check failed (non-fatal):', e.message);
      }
    }

    // Style prefix — default is dark liminal for corridors, but can be overridden for outings etc.
    const defaultStyle = 'dark atmospheric lighting, cinematic composition, liminal space aesthetic, muted color palette, no text, no people, no characters';
    const stylePrefix = style || defaultStyle;
    const styledPrompt = `${prompt}, ${stylePrefix}`;

    // Call FAL.ai FLUX Schnell
    const falResponse = await fetch('https://fal.run/fal-ai/flux/schnell', {
      method: 'POST',
      headers: {
        'Authorization': `Key ${falKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        prompt: styledPrompt,
        image_size: 'landscape_16_9',
        num_images: 1,
        num_inference_steps: 4,
        enable_safety_checker: false
      })
    });

    if (!falResponse.ok) {
      const errorText = await falResponse.text();
      console.error('FAL.ai error:', falResponse.status, errorText);
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ imageUrl: null, error: 'Image generation failed' })
      };
    }

    const falData = await falResponse.json();
    const imageUrl = falData.images?.[0]?.url;

    if (!imageUrl) {
      console.error('No image URL in FAL response:', JSON.stringify(falData));
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ imageUrl: null, error: 'No image returned' })
      };
    }

    // Cache the image URL in the scene record
    if (supabaseUrl && supabaseKey && sceneId) {
      fetch(
        `${supabaseUrl}/rest/v1/corridor_scenes?id=eq.${sceneId}`,
        {
          method: 'PATCH',
          headers: {
            'apikey': supabaseKey,
            'Authorization': `Bearer ${supabaseKey}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ image_url: imageUrl })
        }
      ).catch(e => console.log('Image URL cache save failed (non-fatal):', e.message));
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ imageUrl })
    };

  } catch (error) {
    console.error('Corridor image error:', error);
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ imageUrl: null, error: error.message })
    };
  }
};
