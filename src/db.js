const mysql = require('mysql2/promise');

let pool;

function getPool() {
  if (pool) return pool;
  pool = mysql.createPool({
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    connectionLimit: Number(process.env.DB_POOL_SIZE || 8),
    waitForConnections: true,
    queueLimit: 0,
    connectTimeout: 8000,
    timezone: 'Z',
  });
  return pool;
}

module.exports = { getPool };
