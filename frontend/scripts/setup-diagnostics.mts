export class SetupError extends Error {}

export function checkRuntime(nodeVersion: string, npmAgent = ''): void {
  const nodeMajor = Number(nodeVersion.replace(/^v/, '').split('.')[0]);
  if (nodeMajor < 22) throw new SetupError('Node.js terlalu lama. Gunakan Node.js 22 atau lebih baru.');
  const npm = /npm\/(\d+)\.(\d+)\.(\d+)/.exec(npmAgent);
  if (npm && (Number(npm[1]) < 10 || (Number(npm[1]) === 10 && (Number(npm[2]) < 5 || (Number(npm[2]) === 5 && Number(npm[3]) < 1))))) {
    throw new SetupError('npm terlalu lama. Gunakan npm 10.5.1 atau lebih baru, lalu jalankan setup kembali.');
  }
}

export function checkDatabaseVersion(version: string): void {
  const match = /(\d+)\.(\d+)\.\d+(?=-MariaDB)/i.exec(version);
  if (!match) throw new SetupError('Server database bukan MariaDB. Setup ini memerlukan MariaDB 10.4+; Oracle MySQL belum didukung. Gunakan MariaDB/XAMPP atau jalur PostgreSQL pada README.');
  if (Number(match[1]) < 10 || (Number(match[1]) === 10 && Number(match[2]) < 4)) {
    throw new SetupError('MariaDB terlalu lama. Gunakan MariaDB 10.4 atau lebih baru.');
  }
}

export function describeSetupError(error: unknown, stage: string): string {
  if (error instanceof SetupError) return error.message;
  const code = (error as { code?: string } | null)?.code;
  const hints: Record<string, string> = {
    ECONNREFUSED: 'Database tidak dapat dihubungi. Nyalakan MariaDB/XAMPP dan periksa host serta port.',
    ETIMEDOUT: 'Koneksi database melewati batas waktu. Periksa host, port, jaringan, dan firewall.',
    ENOTFOUND: 'Host database tidak ditemukan. Periksa alamat host.',
    ER_ACCESS_DENIED_ERROR: 'Login database ditolak. Periksa user, password, dan izin akun untuk host 127.0.0.1. Password database berbeda dari password admin SIGAP.',
    ER_DBACCESS_DENIED_ERROR: 'Akun database tidak memiliki izin untuk database tujuan. Berikan izin pada database SIGAP melalui administrator database.',
    ER_BAD_DB_ERROR: 'Database tujuan belum tersedia. Buat database kosong atau gunakan akun yang memiliki izin membuat database.',
    ER_UNKNOWN_COLLATION: 'Collation MariaDB tidak tersedia. Pastikan server menggunakan MariaDB 10.4+.',
    EACCES: 'File konfigurasi atau sertifikat tidak dapat ditulis. Periksa izin folder project.',
    EEXIST: 'File konfigurasi dibuat oleh proses lain. Hentikan setup lain lalu coba kembali.',
  };
  // Never print driver messages: they may contain SQL, URLs or credentials.
  return hints[code ?? ''] ?? `Setup berhenti pada tahap ${stage}. Periksa konfigurasi dan panduan pemecahan masalah; detail rahasia tidak ditampilkan.`;
}
