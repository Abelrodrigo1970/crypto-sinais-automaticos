/**
 * Script para restaurar um backup do banco de dados
 * Uso: node scripts/restore-db.js [nome-do-backup]
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');

const backupDir = path.resolve(process.cwd(), './backups');
const dbPath = process.env.DATABASE_URL?.replace('file:', '') || './data/prod.db';
const dbFile = path.resolve(process.cwd(), dbPath);
const dbDir = path.dirname(dbFile);

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

function listBackups() {
  if (!fs.existsSync(backupDir)) {
    console.log('❌ Diretório de backups não existe.');
    return [];
  }
  
  const backups = fs.readdirSync(backupDir)
    .filter(f => f.startsWith('backup-') && f.endsWith('.db'))
    .sort()
    .reverse();
  
  return backups;
}

function restoreBackup(backupFileName) {
  const backupPath = path.join(backupDir, backupFileName);
  
  if (!fs.existsSync(backupPath)) {
    console.error(`❌ Backup não encontrado: ${backupPath}`);
    process.exit(1);
  }
  
  // Criar backup do banco atual antes de restaurar
  if (fs.existsSync(dbFile)) {
    const currentBackup = path.join(backupDir, `pre-restore-${Date.now()}.db`);
    fs.copyFileSync(dbFile, currentBackup);
    console.log(`✅ Backup do banco atual criado: ${path.basename(currentBackup)}`);
  }
  
  // Criar diretório se não existir
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }
  
  // Restaurar backup
  try {
    fs.copyFileSync(backupPath, dbFile);
    console.log(`✅ Banco de dados restaurado com sucesso!`);
    console.log(`   Backup usado: ${backupFileName}`);
    console.log(`   Banco restaurado em: ${dbFile}`);
  } catch (error) {
    console.error('❌ Erro ao restaurar backup:', error.message);
    process.exit(1);
  }
}

// Main
const backupName = process.argv[2];

if (backupName) {
  // Restaurar backup específico
  restoreBackup(backupName);
  rl.close();
} else {
  // Listar backups e pedir escolha
  const backups = listBackups();
  
  if (backups.length === 0) {
    console.log('❌ Nenhum backup encontrado.');
    rl.close();
    process.exit(1);
  }
  
  console.log('\n📦 Backups disponíveis:');
  backups.forEach((file, index) => {
    const filePath = path.join(backupDir, file);
    const stats = fs.statSync(filePath);
    const size = (stats.size / 1024).toFixed(2);
    const date = stats.mtime.toLocaleString('pt-BR');
    console.log(`   ${index + 1}. ${file} (${size} KB) - ${date}`);
  });
  
  rl.question('\nDigite o número do backup para restaurar (ou Ctrl+C para cancelar): ', (answer) => {
    const index = parseInt(answer) - 1;
    if (index >= 0 && index < backups.length) {
      restoreBackup(backups[index]);
    } else {
      console.error('❌ Número inválido.');
    }
    rl.close();
  });
}

