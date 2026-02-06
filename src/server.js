const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 8004;

// Database query logging to file
const logsDir = path.join(__dirname, 'logs');
fs.mkdirSync(logsDir, { recursive: true });
const dbLogPath = path.join(logsDir, 'database.log');
const dbLogStream = fs.createWriteStream(dbLogPath, { flags: 'a' });
const logDbEvent = (message) => {
  const timestamp = new Date().toISOString();
  dbLogStream.write(`[${timestamp}] ${message}\n`);
};
console.log('Database queries will be logged to:', dbLogPath);

// Simple in-memory cache with TTL
const cache = {
  data: new Map(),
  hits: 0,
  misses: 0,

  get(key) {
    const item = this.data.get(key);
    if (!item) {
      this.misses++;
      return null;
    }
    if (item.expires && Date.now() > item.expires) {
      this.data.delete(key);
      this.misses++;
      return null;
    }
    this.hits++;
    return item.value;
  },

  set(key, value, ttlMs = 3600000) { // Default 1 hour TTL
    this.data.set(key, {
      value,
      expires: ttlMs ? Date.now() + ttlMs : null // null = never expires
    });
  },

  clear() {
    this.data.clear();
    this.hits = 0;
    this.misses = 0;
  },

  stats() {
    return {
      entries: this.data.size,
      hits: this.hits,
      misses: this.misses,
      hitRate: this.hits + this.misses > 0
        ? ((this.hits / (this.hits + this.misses)) * 100).toFixed(1) + '%'
        : 'N/A'
    };
  }
};

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Pretty URL for indicators page
app.get(['/indicators', '/indicators/'], (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'indicators.html'));
});

// Database connection
const dbPath = path.join(__dirname, 'data', 'dataoftheworld.db');
console.log('Attempting to open database at:', dbPath);
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('Error opening database:', err);
  } else {
    console.log('Connected to SQLite database at:', dbPath);
  }
});

// Log every SQL statement and its duration to a dedicated log file
// Logging wrapper to ensure each query is recorded once
const wrapDbMethod = (methodName) => {
  const original = db[methodName].bind(db);
  db[methodName] = (sql, params, callback) => {
    let finalParams = params;
    let cb = callback;

    if (typeof params === 'function') {
      cb = params;
      finalParams = [];
    } else if (params === undefined || params === null) {
      finalParams = [];
    }

    const start = Date.now();
    return original(sql, finalParams, function(...args) {
      const elapsed = Date.now() - start;
      const paramText = finalParams && Array.isArray(finalParams) && finalParams.length > 0
        ? ` | params: ${JSON.stringify(finalParams)}`
        : '';
      logDbEvent(`SQL (${methodName}): ${sql}${paramText} | ${elapsed} ms`);
      if (cb) {
        return cb.apply(this, args);
      }
    });
  };
};

['all', 'get'].forEach(wrapDbMethod);

// Load countries into memory for fast lookups (avoid JOINs that may cause issues)
let countriesMap = {};
function loadCountriesMap() {
  db.all('SELECT * FROM countries', [], (err, rows) => {
    if (err) {
      console.error('Error loading countries:', err);
      return;
    }
    rows.forEach(row => {
      const country_name = (row.country_name || '').trim();
      const flag = (row.flag || '').trim();
      const continent = row.continent || null;
      countriesMap[row.country_code] = { ...row, country_name, flag, continent };
    });
    console.log('Countries loaded into memory:', Object.keys(countriesMap).length);
  });
}

// Load countries after DB connection
setTimeout(loadCountriesMap, 100);

// Pre-warm cache with common queries after DB is ready
function prewarmCache() {
  console.log('Pre-warming cache...');

  // Cache the schema
  db.all("PRAGMA table_info(all_data)", [], (err, columnInfo) => {
    if (!err && columnInfo) {
      const columns = columnInfo.map(col => col.name);
      cache.set('schema:all_data', columns, null);
    }
  });

  // Cache available years
  db.all(`SELECT DISTINCT year FROM all_data WHERE year IS NOT NULL ORDER BY year DESC`, [], (err, rows) => {
    if (!err && rows) {
      cache.set('raw-data-years', rows.map(r => r.year));
    }
  });

  // Cache global year range
  db.get(`SELECT MIN(year) as min_year, MAX(year) as max_year FROM all_data WHERE year IS NOT NULL`, [], (err, row) => {
    if (!err && row) {
      cache.set('years::::', row);
    }
  });

  // Cache indicators
  const indicatorsPath = path.join(__dirname, 'data', 'indicators.json');
  fs.readFile(indicatorsPath, 'utf8', (err, data) => {
    if (!err) {
      cache.set('indicators', JSON.parse(data), null);
      console.log('Cache pre-warming complete');
    }
  });
}

setTimeout(prewarmCache, 200);

// API endpoint to get year range
app.get('/api/years', (req, res) => {
  const { xIndex, yIndex, index, indexes } = req.query;

  // Build cache key from query params
  const cacheKey = `years:${xIndex || ''}:${yIndex || ''}:${index || ''}:${indexes || ''}`;
  const cached = cache.get(cacheKey);
  if (cached) {
    return res.json(cached);
  }

  let query = `
    SELECT MIN(year) as min_year, MAX(year) as max_year
    FROM all_data
    WHERE year IS NOT NULL
  `;

  if (xIndex && yIndex) {
    // Both indexes specified (for Compare scatter plots)
    query = `
      SELECT MIN(year) as min_year, MAX(year) as max_year
      FROM all_data
      WHERE year IS NOT NULL
        AND ${xIndex} IS NOT NULL
        AND ${yIndex} IS NOT NULL
    `;
  } else if (index) {
    // Single index specified (for Map tab)
    query = `
      SELECT MIN(year) as min_year, MAX(year) as max_year
      FROM all_data
      WHERE year IS NOT NULL
        AND ${index} IS NOT NULL
    `;
  } else if (indexes) {
    // Multiple indexes specified (for Raw Data tab)
    // Find year range where at least one of the indexes has data
    const indexList = indexes.split(',').filter(i => i.trim());
    if (indexList.length > 0) {
      const conditions = indexList.map(idx => `${idx.trim()} IS NOT NULL`).join(' OR ');
      query = `
        SELECT MIN(year) as min_year, MAX(year) as max_year
        FROM all_data
        WHERE year IS NOT NULL
          AND (${conditions})
      `;
    }
  }

  db.get(query, [], (err, row) => {
    if (err) {
      console.error('Error in /api/years:', err);
      res.status(500).json({ error: err.message });
      return;
    }
    const result = row || { min_year: null, max_year: null };
    cache.set(cacheKey, result);
    res.json(result);
  });
});

// API endpoint to get indicators (cached indefinitely - static data)
app.get('/api/indicators', (req, res) => {
  const cached = cache.get('indicators');
  if (cached) {
    return res.json(cached);
  }

  const indicatorsPath = path.join(__dirname, 'data', 'indicators.json');
  fs.readFile(indicatorsPath, 'utf8', (err, data) => {
    if (err) {
      console.error('Error reading indicators.json:', err);
      res.status(500).json({ error: err.message });
      return;
    }
    const result = JSON.parse(data);
    cache.set('indicators', result, null); // Never expires
    res.json(result);
  });
});

// Legacy alias for /api/indexes (used by app.js)
app.get('/api/indexes', (req, res) => {
  const cached = cache.get('indicators');
  if (cached) {
    return res.json(cached);
  }

  const indicatorsPath = path.join(__dirname, 'data', 'indicators.json');
  fs.readFile(indicatorsPath, 'utf8', (err, data) => {
    if (err) {
      console.error('Error reading indicators.json:', err);
      res.status(500).json({ error: err.message });
      return;
    }
    const result = JSON.parse(data);
    cache.set('indicators', result, null); // Never expires
    res.json(result);
  });
});

// API endpoint to get countries
app.get('/api/countries', (req, res) => {
  const countries = Object.values(countriesMap);
  res.json(countries);
});

// API endpoint to get raw data for table display
app.get('/api/raw-data', (req, res) => {
  const { year } = req.query;

  if (!year) {
    res.status(400).json({ error: 'Missing required parameter: year' });
    return;
  }

  // Check cache
  const cacheKey = `raw-data:${year}`;
  const cached = cache.get(cacheKey);
  if (cached) {
    return res.json(cached);
  }

  // Dynamically get all columns from the database schema (cache the schema too)
  const schemaCacheKey = 'schema:all_data';
  const cachedSchema = cache.get(schemaCacheKey);

  const processWithSchema = (columns) => {
    const query = `
      SELECT ${columns.join(', ')}
      FROM all_data
      WHERE year = ?
      ORDER BY country_code
    `;

    db.all(query, [parseInt(year)], (err, rows) => {
      if (err) {
        console.error('Error in /api/raw-data:', err);
        res.status(500).json({ error: err.message });
        return;
      }

      // Enrich with country info from memory
      const enriched = rows.map(row => {
        const info = countriesMap[row.country_code] || {};
        const name = info.country_name || row.country_code;
        const flag = info.flag || '';
        const displayName = flag ? `${flag} ${name}`.trim() : name;
        const continent = info.continent || null;
        return {
          ...row,
          country_name: name,
          country_display_name: displayName,
          continent,
          flag
        };
      });

      cache.set(cacheKey, enriched);
      res.json(enriched);
    });
  };

  if (cachedSchema) {
    processWithSchema(cachedSchema);
  } else {
    db.all("PRAGMA table_info(all_data)", [], (err, columnInfo) => {
      if (err) {
        console.error('Error getting table schema:', err);
        res.status(500).json({ error: err.message });
        return;
      }
      const columns = columnInfo.map(col => col.name);
      cache.set(schemaCacheKey, columns, null); // Never expires
      processWithSchema(columns);
    });
  }
});

// API endpoint to get available years for raw data
app.get('/api/raw-data/years', (req, res) => {
  const cached = cache.get('raw-data-years');
  if (cached) {
    return res.json(cached);
  }

  const query = `
    SELECT DISTINCT year
    FROM all_data
    WHERE year IS NOT NULL
    ORDER BY year DESC
  `;

  db.all(query, [], (err, rows) => {
    if (err) {
      console.error('Error in /api/raw-data/years:', err);
      res.status(500).json({ error: err.message });
      return;
    }

    const years = rows.map(r => r.year);
    cache.set('raw-data-years', years);
    res.json(years);
  });
});

// API endpoint to get data
app.get('/api/data', (req, res) => {
  const { year, xIndex, yIndex, allYears } = req.query;

  if (!xIndex || !yIndex) {
    res.status(400).json({ error: 'Missing required parameters: xIndex, yIndex' });
    return;
  }

  // Build cache key
  const cacheKey = `data:${xIndex}:${yIndex}:${allYears === 'true' ? 'all' : year}`;
  const cached = cache.get(cacheKey);
  if (cached) {
    return res.json(cached);
  }

  let query;
  let params = [];

  if (allYears === 'true') {
    query = `
      SELECT country_code, year, ${xIndex} as x_value, ${yIndex} as y_value
      FROM all_data
      WHERE ${xIndex} IS NOT NULL AND ${yIndex} IS NOT NULL
      ORDER BY year, country_code
    `;
  } else {
    if (!year) {
      res.status(400).json({ error: 'Missing required parameter: year' });
      return;
    }
    query = `
      SELECT country_code, year, ${xIndex} as x_value, ${yIndex} as y_value
      FROM all_data
      WHERE year = ? AND ${xIndex} IS NOT NULL AND ${yIndex} IS NOT NULL
    `;
    params = [parseInt(year)];
  }

  db.all(query, params, (err, rows) => {
    if (err) {
      console.error('Error in /api/data:', err);
      res.status(500).json({ error: err.message });
      return;
    }

    // Enrich with country info from memory
    const enriched = rows.map(row => {
      const info = countriesMap[row.country_code] || {};
      const name = info.country_name || row.country_code;
      const flag = info.flag || '';
      const displayName = flag ? `${flag} ${name}`.trim() : name;
      const continent = info.continent || null;
      return {
        ...row,
        country_name: name,
        country_display_name: displayName,
        continent,
        flag
      };
    });

    cache.set(cacheKey, enriched);
    res.json(enriched);
  });
});

// API endpoint to get global min/max values for an index across all years
app.get('/api/index-range', (req, res) => {
  const { index, continent } = req.query;

  if (!index) {
    res.status(400).json({ error: 'Missing required parameter: index' });
    return;
  }

  // Build cache key
  const cacheKey = `index-range:${index}:${continent || 'all'}`;
  const cached = cache.get(cacheKey);
  if (cached) {
    return res.json(cached);
  }

  let query;
  let params = [];

  if (continent && continent !== 'all') {
    // Get continent country codes from countriesMap
    const continentCodes = Object.entries(countriesMap)
      .filter(([code, info]) => info.continent === continent)
      .map(([code]) => code);

    if (continentCodes.length === 0) {
      const result = { min_value: null, max_value: null };
      cache.set(cacheKey, result);
      res.json(result);
      return;
    }

    const placeholders = continentCodes.map(() => '?').join(',');
    query = `
      SELECT MIN(${index}) as min_value, MAX(${index}) as max_value
      FROM all_data
      WHERE ${index} IS NOT NULL
        AND country_code IN (${placeholders})
    `;
    params = continentCodes;
  } else {
    query = `
      SELECT MIN(${index}) as min_value, MAX(${index}) as max_value
      FROM all_data
      WHERE ${index} IS NOT NULL
    `;
  }

  db.get(query, params, (err, row) => {
    if (err) {
      console.error('Error in /api/index-range:', err);
      res.status(500).json({ error: err.message });
      return;
    }
    const result = row || { min_value: null, max_value: null };
    cache.set(cacheKey, result);
    res.json(result);
  });
});

// API endpoint to get time series data for countries
app.get('/api/country-data', (req, res) => {
  const { countries, indexes } = req.query;

  if (!countries) {
    res.status(400).json({ error: 'Missing required parameter: countries' });
    return;
  }

  // Parse countries and indexes (comma-separated lists)
  const countryList = countries.split(',').filter(c => c.trim()).sort();
  const indexList = indexes ? indexes.split(',').filter(i => i.trim()).sort() : [];

  if (countryList.length === 0) {
    res.status(400).json({ error: 'Missing required parameter: countries' });
    return;
  }

  if (indexList.length === 0) {
    res.status(400).json({ error: 'Missing required parameter: indexes' });
    return;
  }

  // Build cache key (sorted for consistency)
  const cacheKey = `country-data:${countryList.join(',')}:${indexList.join(',')}`;
  const cached = cache.get(cacheKey);
  if (cached) {
    return res.json(cached);
  }

  // Build query with selected indexes
  const columns = ['country_code', 'year', ...indexList];
  const placeholders = countryList.map(() => '?').join(',');
  const query = `
    SELECT ${columns.join(', ')}
    FROM all_data
    WHERE country_code IN (${placeholders})
    ORDER BY country_code, year ASC
  `;

  db.all(query, countryList, (err, rows) => {
    if (err) {
      console.error('Error in /api/country-data:', err);
      res.status(500).json({ error: err.message });
      return;
    }

    cache.set(cacheKey, rows);
    res.json(rows);
  });
});

// Cache stats endpoint (for debugging)
app.get('/api/cache-stats', (req, res) => {
  res.json(cache.stats());
});

// Serve index.html
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Redirect any non-API 404 to the main page (keeps SPA routes working)
app.use((req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: 'Not found' });
  }
  return res.redirect('/');
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
  console.log('In-memory caching enabled for API responses');
});

// Graceful shutdown
process.on('SIGINT', () => {
  db.close(() => {
    dbLogStream.end(() => process.exit(0));
  });
});
