/** Compatibility for the application's runtime SQL, not a PostgreSQL migration translator.
 * Follow-up RETURNING reads MUST run on the same connection and in the caller's transaction.
 * MariaDB 10.4 uses blocking row locks: removing SKIP LOCKED trades throughput for safety.
 */
export interface MysqlQueryPlan {
  sql: string;
  values: unknown[];
  returning?: { sql: string; values: unknown[] };
  returningOnlyIfAffected?: boolean;
  ignoreDuplicateConstraint?: string;
}

function unsupported(detail: string): never {
  throw new Error(`Unsupported PostgreSQL query for MariaDB: ${detail}`);
}

/** Walk SQL without rewriting quoted literals or comments. */
function mapCode(sql: string, transform: (code: string) => string): string {
  return sql.split(/('(?:''|[^'])*'|--[^\n]*(?:\n|$)|\/\*[\s\S]*?\*\/)/g)
    .map((part, index) => index % 2 ? part : transform(part)).join('');
}

function bind(sql: string, input: readonly unknown[]): { sql: string; values: unknown[] } {
  const values: unknown[] = [];
  sql = mapCode(sql, code => code.replace(/\$(\d+)/g, (_match, index: string) => {
    const offset = Number(index) - 1;
    if (offset < 0 || offset >= input.length) unsupported('missing parameter');
    const value = input[offset];
    if (Array.isArray(value)) unsupported('array parameter outside a supported ANY expression');
    values.push(typeof value === 'boolean' ? Number(value) : value);
    return '?';
  }));
  return { sql, values };
}

function datetime(value: unknown): unknown {
  if (value === null || value instanceof Date) return value;
  if (typeof value !== 'string') unsupported('invalid timestamp parameter');
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{6}$/.test(value)) return value;
  // Avoid JS Date's millisecond truncation for six-digit keyset cursors.
  const utc = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?Z$/.exec(value);
  if (utc) return `${utc[1]} ${utc[2]}.${(utc[3] ?? '').padEnd(6, '0')}`;
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) unsupported('invalid timestamp parameter');
  return parsed.toISOString().replace('T', ' ').replace(/Z$/, '');
}

export function compileMysqlQuery(source: string, input: readonly unknown[] = []): MysqlQueryPlan {
  let sql = source.trim().replace(/;$/, '');
  const parameters = [...input];
  // A narrow replacement for throttle cleanup. DELETE locks its selected rows atomically;
  // the original bounded, ordered cleanup and transaction-free reservation setup remain.
  const cleanup = /^DELETE FROM (staff_login_throttle|citizen_intake_throttle) WHERE bucket_key IN\s*\(\s*SELECT bucket_key FROM \1 WHERE expires_at <= clock_timestamp\(\) ORDER BY bucket_key LIMIT 100 FOR UPDATE SKIP LOCKED\s*\)$/i.exec(sql.replace(/\s+/g, ' '));
  if (cleanup) return { sql: `DELETE FROM ${cleanup[1]} WHERE expires_at <= CURRENT_TIMESTAMP(6) ORDER BY bucket_key LIMIT 100`, values: [] };

  // Session resurrection guard: each assignment uses the same immutable expiry/revocation condition.
  if (/INSERT INTO staff_sessions\(sid_hash,session_data,principal_id,credential_version,expires_at\)/i.test(sql)) {
    if (!/WHERE staff_sessions\.revoked_at IS NULL AND staff_sessions\.expires_at>now\(\)/i.test(sql)) unsupported('session upsert guard');
    sql = sql.replace(/ON CONFLICT[\s\S]+$/i, `ON DUPLICATE KEY UPDATE
      session_data=IF(revoked_at IS NULL AND expires_at>CURRENT_TIMESTAMP(6),VALUES(session_data),session_data),
      principal_id=IF(revoked_at IS NULL AND expires_at>CURRENT_TIMESTAMP(6),VALUES(principal_id),principal_id),
      credential_version=IF(revoked_at IS NULL AND expires_at>CURRENT_TIMESTAMP(6),VALUES(credential_version),credential_version)`);
  }

  // PostgreSQL evaluates SET expressions from the old row; MariaDB assigns left to right.
  // Decide dead-letter status before incrementing attempts, preserving the exact threshold.
  sql = sql.replace(/UPDATE outbox_events SET attempts = attempts \+ 1,\s*failed_attempts_total = failed_attempts_total \+ 1,\s*(dead_lettered_at = CASE WHEN attempts \+ 1 >= \$4 THEN clock_timestamp\(\) ELSE NULL END),/i,
    'UPDATE outbox_events SET $1, attempts = attempts + 1, failed_attempts_total = failed_attempts_total + 1,');

  let returningSql: string | undefined;
  let ignoreDuplicateConstraint: string | undefined;
  const returning = /\s+RETURNING\s+([\s\S]+)$/i.exec(sql);
  if (returning) {
    const projection = returning[1].trim();
    sql = sql.slice(0, returning.index);
    const update = /^UPDATE\s+(incidents|dispatch_intents)\s+[\s\S]+\sWHERE\s+id\s*=\s*(\$\d+)$/i.exec(sql);
    const insert = /^INSERT INTO\s+(incidents|dispatch_intents|staff_login_throttle|citizen_intake_throttle)\s*\(\s*(id|bucket_key)\s*,/i.exec(sql);
    if (update && projection === '*') returningSql = `SELECT * FROM ${update[1]} WHERE id=${update[2]}`;
    else if (insert && (projection === '*' || /^(staff_login_throttle|citizen_intake_throttle)$/i.test(insert[1]))) {
      returningSql = `SELECT ${projection} FROM ${insert[1]} WHERE ${insert[2]}=$1`;
    } else unsupported('RETURNING shape');
  }

  if (/ON CONFLICT\s*\(idempotency_digest\) DO NOTHING/i.test(sql)) {
    if (!/^INSERT INTO incidents\b/i.test(sql)) unsupported('conflict target');
    sql = sql.replace(/\s+ON CONFLICT\s*\(idempotency_digest\) DO NOTHING/i, '');
    ignoreDuplicateConstraint = 'incidents_idempotency_digest_key';
  } else if (/ON CONFLICT/i.test(sql)) {
    if (!/^INSERT INTO (staff_sessions|staff_login_throttle|citizen_intake_throttle)\b/i.test(sql)) unsupported('upsert table');
    sql = sql.replace(/ON CONFLICT\s*\((sid_hash|bucket_key)\) DO UPDATE SET/i, 'ON DUPLICATE KEY UPDATE');
  }

  function translate(statement: string): { sql: string; values: unknown[] } {
    let result = statement;
    // MariaDB 10.4 lacks JSON_ARRAYAGG; ordered JSON_QUOTE + GROUP_CONCAT preserves strings.
    // The driver sets group_concat_max_len large enough for bounded configuration collections.
    result = result.replace(/ARRAY\(SELECT c\.(coverage_region_id|category_id) FROM (operation_responder_coverage|operation_responder_categories) c\s+WHERE c\.region_id=r\.region_id AND c\.config_version=r\.config_version AND c\.responder_id=r\.id ORDER BY c\.\1\)/gi,
      (_match, column: string, table: string) => `(SELECT COALESCE(CONCAT('[',GROUP_CONCAT(JSON_QUOTE(c.${column}) ORDER BY c.${column} SEPARATOR ','),']'),'[]') FROM ${table} c WHERE c.region_id=r.region_id AND c.config_version=r.config_version AND c.responder_id=r.id)`);
    result = result.replace(/to_char\(([\w.]+) AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'\)/gi, "DATE_FORMAT($1,'%Y-%m-%dT%H:%i:%s.%fZ')");
    result = result.replace(/EXTRACT\(EPOCH FROM\s*\(\s*(statement_timestamp\(\)|now\(\))\s*-\s*([\w.]+)\s*\)\)/gi, 'TIMESTAMPDIFF(MICROSECOND,$2,CURRENT_TIMESTAMP(6))/1000000');
    result = result.replace(/EXTRACT\(EPOCH FROM\s*\(\s*([\w.]+)\s*-\s*now\(\)\s*\)\)/gi, 'TIMESTAMPDIFF(MICROSECOND,CURRENT_TIMESTAMP(6),$1)/1000000');
    // The one monitoring MAX FILTER expression has nested parentheses, so match its known shape explicitly.
    result = result.replace(/max\(GREATEST\(0,TIMESTAMPDIFF\(MICROSECOND,next_attempt_at,CURRENT_TIMESTAMP\(6\)\)\/1000000\)\)\s*FILTER\(WHERE ([^)]*statement_timestamp\(\))\)/gi,
      'MAX(CASE WHEN $1 THEN GREATEST(0,TIMESTAMPDIFF(MICROSECOND,next_attempt_at,CURRENT_TIMESTAMP(6))/1000000) ELSE NULL END)');
    // COUNT FILTER conditions in monitoring contain timestamp parentheses; use a balanced scanner.
    result = rewriteCountFilters(result);
    result = result.replace(/jsonb_object_agg\(status,count\)/gi, 'JSON_OBJECTAGG(status,count)');
    // Character counts are part of the API contract (including values inside JSON_OBJECTAGG).
    result = result.replace(/(count\(\*\)|SUM\(CASE WHEN [\s\S]*? THEN 1 ELSE 0 END\)|COALESCE\(sum\(failed_attempts_total\),0\))::text/gi, 'CAST($1 AS CHAR)');
    result = result.replace(/\$(\d+)::timestamptz/gi, (_match, n: string) => { parameters[Number(n) - 1] = datetime(parameters[Number(n) - 1]); return `$${n}`; });
    // Arrays are expanded into independent bound parameters, including repeated ANY uses.
    result = mapCode(result, code => code.replace(/([\w.]+)\s*=\s*ANY\(\$(\d+)::text\[\]\)/gi, (_match, column: string, n: string) => {
      const array = parameters[Number(n) - 1];
      if (!Array.isArray(array) || !array.every(item => typeof item === 'string')) unsupported('ANY text array');
      if (array.length === 0) return '(1=0)';
      const slots = array.map(item => { parameters.push(item); return `$${parameters.length}`; });
      return `${column} IN (${slots.join(',')})`;
    }));
    result = mapCode(result, code => code
      .replace(/::(?:double precision|timestamptz|integer|bigint|boolean|jsonb|text|uuid|numeric)\b/gi, '')
      .replace(/\b(clock_timestamp|statement_timestamp|now)\(\)/gi, 'CURRENT_TIMESTAMP(6)')
      .replace(/EXCLUDED\.([a-z_]+)/gi, 'VALUES($1)')
      .replace(/FOR UPDATE OF [\w, ]+(?=\s+SKIP LOCKED|$)/gi, 'FOR UPDATE')
      .replace(/FOR SHARE(?: OF [\w, ]+)?$/gi, 'LOCK IN SHARE MODE')
      .replace(/\s+SKIP LOCKED\b/gi, '')
      .replace(/"([A-Za-z_][A-Za-z_0-9]*)"/g, '`$1`'));
    // Known intervals: use arithmetic INTERVAL expressions, with fractional milliseconds as microseconds.
    result = result.replace(/(?:\(\s*(\$\d+)\s*\*\s*interval '1 (second|minute|millisecond)'\s*\)|(\$\d+)\s*\*\s*interval '1 (second|minute|millisecond)')/gi,
      (_match, groupedSlot: string, groupedUnit: string, plainSlot: string, plainUnit: string) => { const slot = groupedSlot ?? plainSlot; const unit = groupedUnit ?? plainUnit; return unit.toLowerCase() === 'millisecond' ? `INTERVAL (${slot} * 1000) MICROSECOND` : `INTERVAL ${slot} ${unit.toUpperCase()}`; });
    result = result.replace(/interval '(\d+) (seconds?|minutes?)'/gi, (_match, amount: string, unit: string) => `INTERVAL ${amount} ${unit.replace(/s$/i, '').toUpperCase()}`);
    if (/\binterval\s*'/i.test(result)) unsupported('interval unit');
    if (/\$[A-Za-z_]*\$/.test(result)) unsupported('dollar-quoted SQL');
    const remaining = mapCode(result, code => code).replace(/'(?:''|[^'])*'/g, '');
    if (/::|\b(?:ANY|FILTER|RETURNING|ILIKE|ARRAY|EXTRACT|to_char|pg_\w+|jsonb_\w+)\s*\(|\bON CONFLICT\b|\bAT TIME ZONE\b|\binterval\s*'/i.test(remaining)) unsupported('untranslated syntax');
    if (/\bILIKE\b/i.test(remaining)) unsupported('ILIKE requires an explicit collation');
    return bind(result, parameters);
  }
  const primary = translate(sql);
  const followup = returningSql ? translate(returningSql) : undefined;
  return { ...primary, ...(followup ? { returning: followup, returningOnlyIfAffected: true } : {}), ...(ignoreDuplicateConstraint ? { ignoreDuplicateConstraint } : {}) };
}

function rewriteCountFilters(sql: string): string {
  const startPattern = /count\(\*\)\s*FILTER\(WHERE\s*/ig;
  let match: RegExpExecArray | null;
  while ((match = startPattern.exec(sql))) {
    let depth = 1;
    let end = startPattern.lastIndex;
    let quoted = false;
    for (; end < sql.length; end++) {
      const char = sql[end];
      if (char === "'") {
        if (quoted && sql[end + 1] === "'") { end++; continue; }
        quoted = !quoted;
      }
      if (!quoted && char === '(') depth++;
      if (!quoted && char === ')' && --depth === 0) break;
    }
    if (depth !== 0) unsupported('unbalanced FILTER');
    const condition = sql.slice(startPattern.lastIndex, end);
    // COALESCE reproduces COUNT's zero on an empty input relation.
    let replacement = `COALESCE(SUM(CASE WHEN ${condition} THEN 1 ELSE 0 END),0)`;
    let tail = end + 1;
    if (sql.slice(tail, tail + 6).toLowerCase() === '::text') {
      replacement = `CAST(${replacement} AS CHAR)`; tail += 6;
    }
    sql = sql.slice(0, match.index) + replacement + sql.slice(tail);
    startPattern.lastIndex = match.index + replacement.length;
  }
  return sql;
}
