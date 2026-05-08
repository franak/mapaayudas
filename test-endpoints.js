#!/usr/bin/env node

/**
 * Script de diagnóstico para verificar endpoints y estado del servidor
 * Uso: node test-endpoints.js [URL_BASE]
 * Ejemplo: node test-endpoints.js http://localhost:3000
 */

const BASE_URL = process.argv[2] || 'http://localhost:3000';

const tests = [
  {
    name: 'Health Check',
    method: 'GET',
    path: '/health',
    expectedStatus: 200,
  },
  {
    name: 'Excel Status',
    method: 'GET',
    path: '/excel/status',
    expectedStatus: 200,
  },
  {
    name: 'Go Excel (sin datos)',
    method: 'GET',
    path: '/excel',
    expectedStatus: 200,
  },
  {
    name: 'POST Sync (forzar sincronización)',
    method: 'POST',
    path: '/excel/sync?source=coam',
    expectedStatus: 200,
    body: null,
  },
  {
    name: 'GET Sheets',
    method: 'GET',
    path: '/excel/sheets',
    expectedStatus: [200, 503], // 503 si no hay archivo local
  },
];

async function runTests() {
  console.log(`\n📋 Ejecutando diagnóstico en: ${BASE_URL}\n`);
  console.log('─'.repeat(70));

  for (const test of tests) {
    try {
      const url = new URL(test.path, BASE_URL);
      const options = {
        method: test.method,
        headers: {
          'Content-Type': 'application/json',
        },
      };

      if (test.body) {
        options.body = JSON.stringify(test.body);
      }

      console.log(`\n[${test.method}] ${test.path}`);
      console.log('Esperado:', Array.isArray(test.expectedStatus) 
        ? test.expectedStatus.join(' o ')
        : test.expectedStatus);

      const response = await fetch(url.toString(), options);
      const contentType = response.headers.get('content-type');
      console.log('Status:', response.status, response.statusText);
      console.log('Content-Type:', contentType);

      // Validate content type
      if (!contentType?.includes('application/json')) {
        console.log('⚠️ ERROR: No es JSON! Content-Type es:', contentType);
      }

      let data;
      try {
        data = await response.json();
        console.log('Response:', JSON.stringify(data, null, 2).substring(0, 300));
      } catch (e) {
        const text = await response.text();
        console.log('❌ NO ES JSON VÁLIDO!');
        console.log('Raw response:', text.substring(0, 200));
      }

      // Check expected status
      const expectedStatuses = Array.isArray(test.expectedStatus)
        ? test.expectedStatus
        : [test.expectedStatus];

      if (!expectedStatuses.includes(response.status)) {
        console.log(`❌ Status inesperado. Esperado: ${expectedStatuses.join(' o ')}`);
      } else {
        console.log('✅ OK');
      }
    } catch (err) {
      console.log(`❌ Error: ${err.message}`);
    }
  }

  console.log('\n' + '─'.repeat(70));
  console.log('✅ Diagnóstico completado\n');
}

runTests();
