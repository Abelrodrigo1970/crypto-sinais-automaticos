/**
 * Script para fazer backup do banco de dados SQLite
 * Preserva todos os dados (estratégias e sinais)
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Determinar qual banco usar
let dbPath = process.env.DATABASE_URL?.replace('file:', '') || './data/prod.db';
let dbFile = path.resolve(process.cwd(), dbPath);

// Se o banco de produção não existir, tentar o de desenvolvimento
if (!fs.existsSync(dbFile)) {
  const devDb = path.resolve(process.cwd(), './prisma/dev.db');
  if (fs.existsSync(devDb)) {
    console.log('⚠️  Banco de produção não encontrado. Usando banco de desenvolvimento.');
    dbPath = './prisma/dev.db';
    dbFile = devDb;
  }
}

const dbDir = path.dirname(dbFile);

// Diretório de backups
const backupDir = path.resolve(process.cwd(), './backups');
const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
const backupFileName = `backup-${timestamp}.db`;
const backupPath = path.join(backupDir, backupFileName);

console.log('=== Backup do Banco de Dados ===');
console.log('Banco original:', dbFile);
console.log('Backup será salvo em:', backupPath);

// Verificar se o banco existe
if (!fs.existsSync(dbFile)) {
  console.error('❌ Erro: Banco de dados não encontrado em:', dbFile);
  console.log('   Verifique se DATABASE_URL está configurado corretamente.');
  process.exit(1);
}

// Criar diretório de backups se não existir
if (!fs.existsSync(backupDir)) {
  fs.mkdirSync(backupDir, { recursive: true });
  console.log(`✅ Diretório de backups criado: ${backupDir}`);
}

// Fazer cópia do banco
try {
  fs.copyFileSync(dbFile, backupPath);
  
  // Verificar se a cópia foi bem-sucedida
  const originalSize = fs.statSync(dbFile).size;
  const backupSize = fs.statSync(backupPath).size;
  
  if (originalSize === backupSize && originalSize > 0) {
    console.log('✅ Backup criado com sucesso!');
    console.log(`   Arquivo: ${backupFileName}`);
    console.log(`   Tamanho: ${(backupSize / 1024).toFixed(2)} KB`);
    console.log(`   Local: ${backupPath}`);
    
    // Listar backups existentes
    const backups = fs.readdirSync(backupDir)
      .filter(f => f.startsWith('backup-') && f.endsWith('.db'))
      .sort()
      .reverse();
    
    console.log(`\n📦 Total de backups: ${backups.length}`);
    if (backups.length > 10) {
      console.log('⚠️  Você tem mais de 10 backups. Considere limpar backups antigos.');
    }
    
    // Mostrar últimos 5 backups
    console.log('\n📋 Últimos backups:');
    backups.slice(0, 5).forEach((file, index) => {
      const filePath = path.join(backupDir, file);
      const stats = fs.statSync(filePath);
      const size = (stats.size / 1024).toFixed(2);
      const date = stats.mtime.toLocaleString('pt-BR');
      console.log(`   ${index + 1}. ${file} (${size} KB) - ${date}`);
    });
  } else {
    console.error('❌ Erro: Backup pode estar corrompido. Tamanhos não coincidem.');
    process.exit(1);
  }
} catch (error) {
  console.error('❌ Erro ao criar backup:', error.message);
  process.exit(1);
}

