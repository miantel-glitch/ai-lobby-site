// Manual trigger for the Affinity Loss Engine
// Use this to manually run the engine since scheduled functions can't be called via HTTP
//
// POST with {"dryRun": true} to preview changes without applying them
// POST with {"dryRun": false} to apply changes
// POST with {"character": "Kevin"} to run for a single character
// POST with {} defaults to dry run for safety

const engine = require('./affinity-loss-engine');

exports.handler = async (event, context) => {
  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch (e) {
    body = {};
  }

  // Default to dry run for safety
  if (body.dryRun === undefined) {
    body.dryRun = true;
  }

  const syntheticEvent = {
    ...event,
    body: JSON.stringify(body)
  };

  return engine.handler(syntheticEvent, context);
};
