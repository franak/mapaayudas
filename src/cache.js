const NodeCache = require('node-cache');

const CACHE_TTL = parseInt(process.env.CACHE_TTL || '300', 10);

const cache = new NodeCache({ stdTTL: CACHE_TTL, checkperiod: 60 });

/**
 * Returns a cache key for a given URL + sheet name.
 */
function buildKey(url, sheet) {
  return `${url}::${sheet || '__all__'}`;
}

module.exports = { cache, buildKey, CACHE_TTL };
