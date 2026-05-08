#!/usr/bin/env bash

# Quick Deploy Guide for MapaAyudas
# ================================
# Script para implementar rápidamente los cambios en el servidor

set -e

echo "🚀 MapaAyudas - Quick Deploy Guide"
echo "=================================="
echo ""

# Step 1: Update local code
echo "📥 PASO 1: Actualizar código local..."
git fetch origin
git pull origin main

# Step 2: Install dependencies
echo "📦 PASO 2: Instalar dependencias..."
npm install

# Step 3: Test endpoints locally
echo "🔍 PASO 3: Probar endpoints localmente..."
echo "   Asegúrate de que npm start esté corriendo en otra terminal..."
echo "   Luego ejecuta: node test-endpoints.js http://localhost:3000"
echo ""

# Step 4: Stop current server
echo "⏹️  PASO 4: Detener servidor actual..."
# Descomenta según tu gestor:

# Si usas PM2:
pm2 stop MapaAyudas || true

# Si usas systemd:
# sudo systemctl stop mapaayudas || true

sleep 2

# Step 5: Restart server
echo "🔄 PASO 5: Reiniciar servidor..."

# Si usas PM2:
pm2 start npm --name "MapaAyudas" -- start || pm2 restart MapaAyudas

# Si usas systemd:
# sudo systemctl start mapaayudas

# Si ejecutas directamente:
# npm start &

sleep 3

# Step 6: Verify endpoints
echo "✅ PASO 6: Verificar endpoints..."
echo ""

echo "Verificando /health..."
curl -s -H "Accept: application/json" http://localhost:3000/health | jq . || echo "❌ /health falló"

echo ""
echo "Verificando /excel/status..."
curl -s -H "Accept: application/json" http://localhost:3000/excel/status | jq . || echo "❌ /excel/status falló"

echo ""
echo "✅ Deploy completado!"
echo ""
echo "Próximos pasos:"
echo "1. Abre https://ayudas.isamart.es en el navegador"
echo "2. Abre Developer Tools (F12)"
echo "3. Observa los logs de Network para verificar que /excel devuelve JSON"
echo "4. Si el formulario carga correctamente, ¡el problema está resuelto!"
echo ""
