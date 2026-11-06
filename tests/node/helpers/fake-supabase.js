// In-memory fake of the parts of @supabase/supabase-js (PostgREST query builder) that a
// typical server app uses. Generic on purpose: it knows nothing about any particular app's
// queries, only about tables/columns/constraints described by a schema object, so code that
// is refactored but still uses ordinary supabase-js calls keeps working against it.
//
// Supported:
//   client.from(t).select(cols, {count, head}) with "*", "col", "alias:col", "col::cast",
//     embedded resources "table(cols)", "alias:table!hint(cols)", "table!inner(cols)"
//     (many-to-one -> object|null, one-to-many -> array; ambiguity -> PGRST201 like PostgREST)
//   insert / upsert({onConflict, ignoreDuplicates}) / update / delete, each optionally .select()
//   filters: eq neq gt gte lt lte like ilike is in contains containedBy overlaps match not filter or
//   modifiers: order (multi, nullsFirst) limit range single maybeSingle throwOnError returns abortSignal
//   count: 'exact' | 'planned' | 'estimated' (all exact here), head: true
//   db-max-rows (default 1000, like Supabase): no query ever returns more rows than that
// Constraints modelled: column types (uuid/int/bool/timestamptz/text/text[] input syntax),
//   NOT NULL, defaults (now(), gen_random_uuid(), identity), PK/UNIQUE, CHECK (JS predicates),
//   FOREIGN KEY on insert/update, ON DELETE CASCADE / SET NULL / RESTRICT.
// Errors come back as {data:null, error:{code,message,details,hint}} with Postgres/PostgREST codes.
import crypto from "node:crypto";

class PgError extends Error {
  constructor(code, message, details = null, hint = null) {
    super(message);
    this.code = code; this.details = details; this.hint = hint;
  }
  toJSON() { return { code: this.code, message: this.message, details: this.details, hint: this.hint }; }
}
const plainError = e => ({ code: e.code, message: e.message, details: e.details ?? null, hint: e.hint ?? null });

const clone = v => (v === undefined ? undefined : structuredClone(v));

// ── type handling ───────────────────────────────────────────────────────────
function parseUuid(v) {
  if (typeof v !== "string") return null;
  let s = v.trim();
  if (s.startsWith("{") && s.endsWith("}")) s = s.slice(1, -1);
  if (s.startsWith("-") || s.endsWith("-") || s.includes("--")) return null;
  const parts = s.split("-");
  if (parts.slice(0, -1).some(p => p.length % 4 !== 0)) return null;
  const hex = parts.join("");
  if (!/^[0-9a-f]{32}$/i.test(hex)) return null;
  const h = hex.toLowerCase();
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
const INT_RANGE = { smallint: [-32768, 32767], integer: [-2147483648, 2147483647], int: [-2147483648, 2147483647], bigint: [-(2 ** 63), 2 ** 63] };
export const pgTimestamp = d => new Date(d).toISOString().replace("Z", "+00:00");

function coerce(type, v, col) {
  if (v === null || v === undefined) return null;
  const bad = (t = type) => new PgError("22P02", `invalid input syntax for type ${t}: "${typeof v === "object" ? JSON.stringify(v) : v}"`);
  if (type.endsWith("[]")) {
    const base = type.slice(0, -2);
    let arr = v;
    if (typeof v === "string") {
      if (!/^\{.*\}$/s.test(v)) throw new PgError("22P02", `malformed array literal: "${v}"`);
      arr = v.slice(1, -1) === "" ? [] : v.slice(1, -1).split(",").map(x => x.replace(/^"|"$/g, ""));
    }
    if (!Array.isArray(arr)) throw new PgError("22P02", `malformed array literal: "${JSON.stringify(v)}"`);
    return arr.map(x => coerce(base, x, col));
  }
  switch (type) {
    case "uuid": { const u = parseUuid(v); if (!u) throw bad(); return u; }
    case "text": return typeof v === "object" ? JSON.stringify(v) : String(v);
    case "smallint": case "integer": case "int": case "bigint": {
      if (typeof v === "boolean") throw bad(type === "int" ? "integer" : type);
      const s = String(v).trim();
      if (!/^[+-]?\d+$/.test(s)) throw bad(type === "int" ? "integer" : type);
      const n = Number(s);
      const [lo, hi] = INT_RANGE[type];
      if (n < lo || n > hi) throw new PgError("22003", `value "${s}" is out of range for type ${type}`);
      return n;
    }
    case "boolean": case "bool": {
      if (typeof v === "boolean") return v;
      const s = String(v).trim().toLowerCase();
      if (["t", "true", "yes", "on", "1"].includes(s)) return true;
      if (["f", "false", "no", "off", "0"].includes(s)) return false;
      throw bad("boolean");
    }
    case "timestamptz": case "timestamp": {
      const t = v instanceof Date ? v.getTime() : Date.parse(String(v));
      if (!Number.isFinite(t)) throw new PgError("22007", `invalid input syntax for type timestamp with time zone: "${v}"`);
      return pgTimestamp(t);
    }
    case "jsonb": case "json": return clone(v);
    default: return v;
  }
}

function compare(type, a, b) {
  if (type === "timestamptz" || type === "timestamp") return Date.parse(a) - Date.parse(b);
  if (typeof a === "number" && typeof b === "number") return a - b;
  if (typeof a === "boolean" && typeof b === "boolean") return Number(a) - Number(b);
  if (Array.isArray(a) || Array.isArray(b)) { const x = JSON.stringify(a), y = JSON.stringify(b); return x < y ? -1 : x > y ? 1 : 0; }
  const x = String(a), y = String(b);
  return x < y ? -1 : x > y ? 1 : 0;
}
const equal = (type, a, b) => a !== null && b !== null && compare(type, a, b) === 0;
const likeRe = (pat, flags) => new RegExp("^" + String(pat).replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/[%*]/g, ".*").replace(/_/g, ".") + "$", flags + "s");

// ── select-string parsing ───────────────────────────────────────────────────
function splitTop(s, sep = ",") {
  const out = []; let depth = 0, quote = false, cur = "";
  for (const ch of s) {
    if (ch === '"') quote = !quote;
    if (!quote && ch === "(") depth++;
    if (!quote && ch === ")") depth--;
    if (!quote && depth === 0 && ch === sep) { out.push(cur); cur = ""; continue; }
    cur += ch;
  }
  if (cur !== "" || out.length) out.push(cur);
  return out;
}
function parseSelect(str) {
  const s = String(str ?? "*").replace(/\s+(?=(?:[^"]*"[^"]*")*[^"]*$)/g, "");
  if (s === "") return [{ kind: "star" }];
  return splitTop(s).filter(Boolean).map(part => {
    const m = /^(?:([A-Za-z0-9_]+):)?([A-Za-z0-9_]+)((?:![A-Za-z0-9_]+)*)\((.*)\)$/s.exec(part);
    if (m) {
      const bangs = m[3] ? m[3].split("!").filter(Boolean) : [];
      const inner = bangs.includes("inner"), left = bangs.includes("left");
      const hint = bangs.find(b => b !== "inner" && b !== "left") ?? null;
      return { kind: "embed", alias: m[1] ?? m[2], name: m[2], hint, inner, left, children: parseSelect(m[4]) };
    }
    if (part === "*") return { kind: "star" };
    const c = /^(?:([A-Za-z0-9_]+):)?([A-Za-z0-9_]+)(?:::[A-Za-z0-9_]+)?$/.exec(part);
    if (!c) throw new PgError("PGRST100", `fake-supabase: unsupported select item "${part}"`);
    return { kind: "col", alias: c[1] ?? c[2], name: c[2] };
  });
}

// ── logic-tree ("or" filter string) parsing ─────────────────────────────────
function unquote(v) { return /^".*"$/s.test(v) ? v.slice(1, -1).replace(/\\(.)/g, "$1") : v; }
function parseCond(part) {
  const g = /^(not\.)?(and|or)\((.*)\)$/s.exec(part);
  if (g) return { group: g[2], negate: !!g[1], conds: splitTop(g[3]).map(parseCond) };
  const i = part.indexOf(".");
  if (i < 0) throw new PgError("PGRST100", `failed to parse logic tree (${part})`);
  const col = part.slice(0, i); let rest = part.slice(i + 1), negate = false;
  if (rest.startsWith("not.")) { negate = true; rest = rest.slice(4); }
  const j = rest.indexOf(".");
  if (j < 0) throw new PgError("PGRST100", `failed to parse logic tree (${part})`);
  const op = rest.slice(0, j), raw = rest.slice(j + 1);
  let val = raw;
  if (op === "in") val = splitTop(raw.replace(/^\(|\)$/g, "")).map(unquote);
  else if (op === "is") val = raw === "null" ? null : raw === "true" ? true : raw === "false" ? false : raw;
  else if (op === "cs" || op === "cd" || op === "ov") val = raw.startsWith("{") ? raw : raw;
  else val = unquote(raw);
  return { col, op, val, negate };
}
const POSTGREST_OPS = { eq: "eq", neq: "neq", gt: "gt", gte: "gte", lt: "lt", lte: "lte", like: "like", ilike: "ilike", is: "is", in: "in", cs: "cs", cd: "cd", ov: "ov", contains: "cs", containedBy: "cd", overlaps: "ov" };

// ── the fake database ───────────────────────────────────────────────────────
export function createFakeSupabase(schema, { maxRows = 1000 } = {}) {
  let tables, identity;
  const failures = [];
  const log = [];
  const clients = [];

  for (const [t, def] of Object.entries(schema)) {
    def.foreignKeys = (def.foreignKeys ?? []).map(fk => ({ onDelete: "restrict", name: `${t}_${fk.columns.join("_")}_fkey`, ...fk }));
    def.unique = def.unique ?? [];
    def.checks = def.checks ?? [];
  }

  function reset() {
    tables = Object.fromEntries(Object.keys(schema).map(t => [t, []]));
    identity = {};
    failures.length = 0; log.length = 0;
  }
  reset();

  const tdef = name => {
    const d = schema[name];
    if (!d) throw new PgError("PGRST205", `Could not find the table 'public.${name}' in the schema cache`);
    return d;
  };
  const colDef = (t, c) => {
    const d = tdef(t).columns[c];
    if (!d) throw new PgError("42703", `column ${t}.${c} does not exist`);
    return d;
  };
  const keyOf = (row, cols) => JSON.stringify(cols.map(c => row[c]));

  // ---------- row validation ----------
  function defaultFor(t, c, d) {
    if (d.default === undefined) return null;
    if (d.default === "now") return pgTimestamp(Date.now());
    if (d.default === "uuid") return crypto.randomUUID();
    if (d.default === "identity") { identity[`${t}.${c}`] = (identity[`${t}.${c}`] ?? 0) + 1; return identity[`${t}.${c}`]; }
    return typeof d.default === "function" ? d.default() : clone(d.default);
  }
  function coerceRowInput(t, input, { forInsert }) {
    const def = tdef(t);
    if (!input || typeof input !== "object" || Array.isArray(input)) throw new PgError("PGRST102", "Empty or invalid json");
    const out = {};
    for (const [c, v] of Object.entries(input)) {
      const d = def.columns[c];
      if (!d) throw new PgError("PGRST204", `Could not find the '${c}' column of '${t}' in the schema cache`);
      if (d.default === "identity" && d.always && v !== undefined) {
        throw new PgError("428C9", `cannot insert a non-DEFAULT value into column "${c}"`, `Column "${c}" is an identity column defined as GENERATED ALWAYS.`);
      }
      if (v === undefined) continue;
      out[c] = coerce(d.type, v, c);
    }
    if (forInsert) for (const [c, d] of Object.entries(def.columns)) if (!(c in out)) out[c] = defaultFor(t, c, d);
    return out;
  }
  // Returns check(row): validates one candidate row against NOT NULL / CHECK / UNIQUE / FK,
  // treating `ignoreRows` (rows being replaced) as gone and previously checked rows as present.
  function checker(t, ignoreRows) {
    const def = tdef(t);
    const uniq = [def.primaryKey, ...def.unique].filter(Boolean).map(cols => ({
      cols, name: cols === def.primaryKey ? `${t}_pkey` : `${t}_${cols.join("_")}_key`,
      keys: new Set(tables[t].filter(r => !ignoreRows.has(r) && cols.every(c => r[c] !== null)).map(r => keyOf(r, cols))),
    }));
    const fks = def.foreignKeys.map(fk => ({ fk, keys: new Set(tables[fk.references.table].map(r => keyOf(r, fk.references.columns))) }));
    return row => {
      for (const [c, d] of Object.entries(def.columns)) {
        if (d.notNull && row[c] === null) throw new PgError("23502", `null value in column "${c}" of relation "${t}" violates not-null constraint`);
      }
      for (const ch of def.checks) {
        let ok;
        try { ok = ch.test(row); } catch { ok = true; }
        if (ok === false) throw new PgError("23514", `new row for relation "${t}" violates check constraint "${ch.name}"`);
      }
      for (const u of uniq) {
        if (u.cols.some(c => row[c] === null)) continue;
        const k = keyOf(row, u.cols);
        if (u.keys.has(k)) throw new PgError("23505", `duplicate key value violates unique constraint "${u.name}"`, `Key (${u.cols.join(", ")})=(${u.cols.map(c => row[c]).join(", ")}) already exists.`);
      }
      for (const { fk, keys } of fks) {
        if (fk.columns.some(c => row[c] === null)) continue;
        if (!keys.has(keyOf(row, fk.columns))) {
          throw new PgError("23503", `insert or update on table "${t}" violates foreign key constraint "${fk.name}"`,
            `Key (${fk.columns.join(", ")})=(${fk.columns.map(c => row[c]).join(", ")}) is not present in table "${fk.references.table}".`);
        }
      }
      for (const u of uniq) if (u.cols.every(c => row[c] !== null)) u.keys.add(keyOf(row, u.cols));
      for (const { fk, keys } of fks) if (fk.references.table === t) keys.add(keyOf(row, fk.references.columns));
    };
  }

  // ---------- filters ----------
  function compileCond(t, cond) {
    if (cond.group) {
      const parts = cond.conds.map(c => compileCond(t, c));
      const f = cond.group === "and" ? r => parts.every(p => p(r)) : r => parts.some(p => p(r));
      return cond.negate ? r => !f(r) : f;
    }
    if (cond.col.includes(".")) throw new PgError("PGRST100", `fake-supabase: filters on embedded resources ("${cond.col}") are not supported`);
    const d = colDef(t, cond.col);
    const op = POSTGREST_OPS[cond.op];
    if (!op) throw new PgError("PGRST100", `fake-supabase: unsupported operator "${cond.op}"`);
    const type = d.type, base = type.replace(/\[\]$/, "");
    let test;
    switch (op) {
      case "eq": case "neq": case "gt": case "gte": case "lt": case "lte": {
        if (cond.val === null) { test = () => false; break; }
        const v = coerce(type, cond.val);
        const cmp = { eq: x => x === 0, neq: x => x !== 0, gt: x => x > 0, gte: x => x >= 0, lt: x => x < 0, lte: x => x <= 0 }[op];
        test = r => r[cond.col] !== null && cmp(compare(type, r[cond.col], v));
        break;
      }
      case "like": case "ilike": { const re = likeRe(cond.val, op === "ilike" ? "i" : ""); test = r => r[cond.col] !== null && re.test(String(r[cond.col])); break; }
      case "is": test = r => (cond.val === null ? r[cond.col] === null : r[cond.col] === cond.val); break;
      case "in": {
        const vals = (Array.isArray(cond.val) ? cond.val : [cond.val]).map(v => coerce(type, v));
        test = r => vals.some(v => equal(type, r[cond.col], v));
        break;
      }
      case "cs": case "cd": case "ov": {
        if (!type.endsWith("[]")) throw new PgError("PGRST100", `fake-supabase: ${op} only supported on array columns`);
        const vals = coerce(type, cond.val);
        test = r => {
          const have = r[cond.col]; if (have === null) return false;
          const inn = (x, arr) => arr.some(y => equal(base, x, y));
          if (op === "cs") return vals.every(v => inn(v, have));
          if (op === "cd") return have.every(v => inn(v, vals));
          return vals.some(v => inn(v, have));
        };
        break;
      }
    }
    return cond.negate ? r => !test(r) : test;
  }

  // ---------- embedding / projection ----------
  function relation(parent, name, hint) {
    const cands = [];
    const pdef = tdef(parent);
    // many-to-one: parent has FK to `name` (or `name` is the FK column itself)
    for (const fk of pdef.foreignKeys) {
      const byTable = fk.references.table === name;
      const byCol = fk.columns.length === 1 && fk.columns[0] === name;
      if ((byTable || byCol) && (!hint || hint === fk.name || fk.columns.includes(hint) || hint === fk.references.table)) cands.push({ kind: "m2o", fk, target: fk.references.table });
    }
    // one-to-many: `name` has FK to parent
    if (schema[name]) for (const fk of tdef(name).foreignKeys) {
      if (fk.references.table === parent && (!hint || hint === fk.name || fk.columns.includes(hint))) cands.push({ kind: "o2m", fk, target: name });
    }
    if (!cands.length) throw new PgError("PGRST200", `Could not find a relationship between '${parent}' and '${name}' in the schema cache`);
    if (cands.length > 1) throw new PgError("PGRST201", `Could not embed because more than one relationship was found for '${parent}' and '${name}'`);
    return cands[0];
  }
  function validateTree(t, items) {
    for (const it of items) {
      if (it.kind === "col") colDef(t, it.name);
      if (it.kind === "embed") { const rel = relation(t, it.name, it.hint); it.rel = rel; validateTree(rel.target, it.children); }
    }
  }
  function embedValue(it, row) {
    const { rel } = it;
    if (rel.kind === "m2o") {
      const want = keyOf(row, rel.fk.columns);
      if (rel.fk.columns.some(c => row[c] === null)) return null;
      const hit = tables[rel.target].find(r => keyOf(r, rel.fk.references.columns) === want);
      return hit ? project(rel.target, hit, it.children) : null;
    }
    const want = keyOf(row, rel.fk.references.columns);
    return tables[rel.target].filter(r => keyOf(r, rel.fk.columns) === want).map(r => project(rel.target, r, it.children));
  }
  function project(t, row, items) {
    const out = {};
    for (const it of items) {
      if (it.kind === "star") for (const c of Object.keys(tdef(t).columns)) out[c] = clone(row[c]);
      else if (it.kind === "col") out[it.alias] = clone(row[it.name]);
      else out[it.alias] = embedValue(it, row);
    }
    return out;
  }
  const passesInner = (items, row) => items.every(it => {
    if (it.kind !== "embed" || !it.inner) return true;
    const v = embedValue(it, row);
    return Array.isArray(v) ? v.length > 0 : v !== null;
  });

  // ---------- delete cascade planning ----------
  function planDelete(t, victims, plan) {
    for (const r of victims) {
      if (plan.del.get(t)?.has(r)) continue;
      if (!plan.del.has(t)) plan.del.set(t, new Set());
      plan.del.get(t).add(r);
      for (const [ct, cdef] of Object.entries(schema)) {
        for (const fk of cdef.foreignKeys) {
          if (fk.references.table !== t) continue;
          const want = keyOf(r, fk.references.columns);
          const kids = tables[ct].filter(k => keyOf(k, fk.columns) === want && !plan.del.get(ct)?.has(k));
          if (!kids.length) continue;
          if (fk.onDelete === "cascade") planDelete(ct, kids, plan);
          else if (fk.onDelete === "set null") for (const k of kids) plan.setNull.push([k, fk.columns]);
          else throw new PgError("23503", `update or delete on table "${t}" violates foreign key constraint "${fk.name}" on table "${ct}"`);
        }
      }
    }
  }

  // ---------- execution ----------
  function exec(q) {
    log.push({ table: q.table, op: q.op, select: q.cols, filters: q.filters.length });
    const fi = failures.findIndex(f => (!f.table || f.table === q.table) && (!f.op || f.op === q.op));
    if (fi >= 0) { const f = failures[fi]; if (--f.times <= 0) failures.splice(fi, 1); throw new PgError(f.error.code ?? "XX000", f.error.message ?? "injected failure", f.error.details ?? null, f.error.hint ?? null); }

    const t = q.table; tdef(t);
    const tree = parseSelect(q.cols);
    validateTree(t, tree);
    const preds = q.filters.map(f => compileCond(t, f));
    const match = r => preds.every(p => p(r));
    let rows, status = 200, count = null;

    if (q.op === "select") {
      rows = tables[t].filter(r => match(r) && passesInner(tree, r));
    } else if (q.op === "insert" || q.op === "upsert") {
      const input = Array.isArray(q.payload) ? q.payload : [q.payload];
      const def = tdef(t);
      let conflictCols = null;
      if (q.op === "upsert") {
        conflictCols = q.opts.onConflict ? String(q.opts.onConflict).split(",").map(s => s.trim()) : def.primaryKey;
        const sets = [def.primaryKey, ...def.unique].filter(Boolean).map(c => [...c].sort().join(","));
        if (!sets.includes([...conflictCols].sort().join(","))) throw new PgError("42P10", "there is no unique or exclusion constraint matching the ON CONFLICT specification");
        conflictCols.forEach(c => colDef(t, c));
      }
      const newRows = [], updates = [], affected = [];
      for (const raw of input) {
        const given = coerceRowInput(t, raw, { forInsert: false });
        let existing = null;
        if (conflictCols && conflictCols.every(c => c in given)) {
          const k = keyOf(given, conflictCols);
          existing = tables[t].find(r => keyOf(r, conflictCols) === k) ?? null;
        }
        if (existing) {
          if (q.opts.ignoreDuplicates) continue;
          const merged = { ...existing, ...given };
          updates.push([existing, merged]);
          affected.push(merged);
        } else {
          const full = coerceRowInput(t, raw, { forInsert: true });
          newRows.push(full); affected.push(full);
        }
      }
      const check = checker(t, new Set(updates.map(u => u[0])));
      for (const [, merged] of updates) check(merged);
      for (const r of newRows) check(r);
      for (const [old, merged] of updates) Object.assign(old, merged);
      tables[t].push(...newRows);
      rows = affected; status = 201;
    } else if (q.op === "update") {
      const patch = coerceRowInput(t, q.payload, { forInsert: false });
      const def = tdef(t);
      for (const c of Object.keys(patch)) if (def.columns[c].default === "identity" && def.columns[c].always) throw new PgError("428C9", `column "${c}" can only be updated to DEFAULT`);
      const targets = tables[t].filter(match);
      const merged = targets.map(r => ({ ...r, ...patch }));
      const check = checker(t, new Set(targets));
      merged.forEach(check);
      targets.forEach((r, i) => Object.assign(r, merged[i]));
      rows = targets; status = q.returning ? 200 : 204;
    } else if (q.op === "delete") {
      const targets = tables[t].filter(match);
      const plan = { del: new Map(), setNull: [] };
      planDelete(t, targets, plan);
      for (const [k, cols] of plan.setNull) for (const c of cols) k[c] = null;
      for (const [tt, set] of plan.del) tables[tt] = tables[tt].filter(r => !set.has(r));
      rows = targets; status = q.returning ? 200 : 204;
    }

    // ordering, counting, paging (select) / returning (mutations)
    if (q.orders.length) {
      rows = [...rows].sort((a, b) => {
        for (const o of q.orders) {
          const type = colDef(t, o.col).type;
          const x = a[o.col], y = b[o.col];
          const nullsFirst = o.nullsFirst ?? !o.ascending;
          if (x === null || y === null) { if (x === y) continue; return (x === null) === nullsFirst ? -1 : 1; }
          const c = compare(type, x, y);
          if (c) return o.ascending ? c : -c;
        }
        return 0;
      });
    }
    if (q.countMode) count = rows.length;
    if (q.op === "select" || q.returning) {
      const limit = Math.min(q.lim ?? Infinity, maxRows);
      rows = rows.slice(q.off, q.off + limit);
    }
    let data = q.op === "select" || q.returning ? rows.map(r => project(t, r, tree)) : null;
    if (q.head) data = null;
    if (q.singleMode && (q.op === "select" || q.returning)) {
      if (data.length === 1) data = data[0];
      else if (data.length === 0 && q.singleMode === "maybe") data = null;
      else throw new PgError("PGRST116", "JSON object requested, multiple (or no) rows returned", `The result contains ${data.length} rows`, null, 406);
    }
    return { data, error: null, count, status, statusText: status === 201 ? "Created" : status === 204 ? "No Content" : "OK" };
  }

  class Query {
    constructor(table) {
      Object.assign(this, { table, op: "select", cols: "*", filters: [], orders: [], lim: null, off: 0, singleMode: null, countMode: null, head: false, returning: false, payload: null, opts: {}, throws: false });
    }
    select(cols = "*", { count, head } = {}) {
      if (this.op === "select") { this.cols = cols; this.countMode = count ?? null; this.head = !!head; }
      else { this.returning = true; this.cols = cols; }
      return this;
    }
    insert(values, { count } = {}) { this.op = "insert"; this.payload = values; this.countMode = count ?? null; this.cols = "*"; return this; }
    upsert(values, { onConflict, ignoreDuplicates = false, count } = {}) { this.op = "upsert"; this.payload = values; this.opts = { onConflict, ignoreDuplicates }; this.countMode = count ?? null; this.cols = "*"; return this; }
    update(values, { count } = {}) { this.op = "update"; this.payload = values; this.countMode = count ?? null; this.cols = "*"; return this; }
    delete({ count } = {}) { this.op = "delete"; this.countMode = count ?? null; this.cols = "*"; return this; }
    _f(col, op, val, negate = false) { this.filters.push({ col, op, val, negate }); return this; }
    eq(c, v) { return this._f(c, "eq", v); }
    neq(c, v) { return this._f(c, "neq", v); }
    gt(c, v) { return this._f(c, "gt", v); }
    gte(c, v) { return this._f(c, "gte", v); }
    lt(c, v) { return this._f(c, "lt", v); }
    lte(c, v) { return this._f(c, "lte", v); }
    like(c, v) { return this._f(c, "like", v); }
    ilike(c, v) { return this._f(c, "ilike", v); }
    is(c, v) { return this._f(c, "is", v); }
    in(c, v) { return this._f(c, "in", v); }
    contains(c, v) { return this._f(c, "cs", v); }
    containedBy(c, v) { return this._f(c, "cd", v); }
    overlaps(c, v) { return this._f(c, "ov", v); }
    match(obj) { for (const [k, v] of Object.entries(obj)) this.eq(k, v); return this; }
    not(c, op, v) {
      if (op === "in" && typeof v === "string") v = splitTop(v.replace(/^\(|\)$/g, "")).map(unquote);
      if (op === "is" && v === "null") v = null;
      return this._f(c, op, v, true);
    }
    filter(c, op, v) {
      if (op.startsWith("not.")) return this.not(c, op.slice(4), v);
      if (op === "in" && typeof v === "string") v = splitTop(v.replace(/^\(|\)$/g, "")).map(unquote);
      return this._f(c, op, v);
    }
    or(str, { foreignTable, referencedTable } = {}) {
      if (foreignTable || referencedTable) throw new Error("fake-supabase: or() on referenced tables is not supported");
      this.filters.push({ group: "or", negate: false, conds: splitTop(String(str).replace(/\s+(?=(?:[^"]*"[^"]*")*[^"]*$)/g, "")).map(parseCond) });
      return this;
    }
    order(col, { ascending = true, nullsFirst, foreignTable, referencedTable } = {}) {
      if (foreignTable || referencedTable) throw new Error("fake-supabase: ordering referenced tables is not supported");
      this.orders.push({ col, ascending, nullsFirst }); return this;
    }
    limit(n, { foreignTable, referencedTable } = {}) {
      if (foreignTable || referencedTable) throw new Error("fake-supabase: limit on referenced tables is not supported");
      this.lim = n; return this;
    }
    range(from, to) { this.off = from; this.lim = to - from + 1; return this; }
    single() { this.singleMode = "single"; return this; }
    maybeSingle() { this.singleMode = "maybe"; return this; }
    throwOnError() { this.throws = true; return this; }
    returns() { return this; }
    abortSignal() { return this; }
    then(resolve, reject) {
      const p = Promise.resolve().then(() => {
        try { return exec(this); }
        catch (e) {
          if (!(e instanceof PgError)) throw e;
          const res = { data: null, error: plainError(e), count: null, status: e.code === "PGRST116" ? 406 : 400, statusText: "Bad Request" };
          if (this.throws) throw Object.assign(new Error(e.message), plainError(e));
          return res;
        }
      });
      return p.then(resolve, reject);
    }
    catch(r) { return this.then(undefined, r); }
    finally(f) { return this.then(v => { f(); return v; }, e => { f(); throw e; }); }
  }

  function createClient(url, key, options) {
    const client = {
      url, key, options,
      from: table => new Query(table),
      schema() { return client; },
      rpc: async name => ({ data: null, error: { code: "PGRST202", message: `fake-supabase: rpc ${name} not supported`, details: null, hint: null } }),
      auth: { persistSession: false },
    };
    clients.push({ url, key, options });
    return client;
  }

  // direct (test-side) access — bypasses nothing: same validation as app writes
  function insertRaw(t, rows) {
    const q = new Query(t).insert(rows).select("*");
    return exec(q).data;
  }

  return {
    createClient,
    reset,
    clients,
    log,
    maxRows,
    /** deep copy of a table's rows (insertion order) */
    rows: t => { tdef(t); return clone(tables[t]); },
    /** live row objects; mutate only for test setup (e.g. back-dating timestamps) */
    raw: t => { tdef(t); return tables[t]; },
    insertRaw,
    /** make the next matching query fail with {error}. op: select|insert|upsert|update|delete */
    failNext({ table, op, error = { code: "XX000", message: "injected failure" }, times = 1 } = {}) { failures.push({ table, op, error, times }); },
  };
}

// ── schemas mirroring the apps' supabase/migrations ─────────────────────────
const between = (v, lo, hi) => v === null || (v >= lo && v <= hi);
const charLen = s => [...s].length;

export const SURVEY_SCHEMA = () => ({
  responses: {
    primaryKey: ["emp_no"],
    columns: {
      emp_no: { type: "text", notNull: true },
      name: { type: "text", notNull: true },
      dept: { type: "text", notNull: true },
      rank: { type: "text", notNull: true },
      areas: { type: "text[]", notNull: true },
      area_other: { type: "text", notNull: true, default: "" },
      priority_topic: { type: "text", notNull: true, default: "" },
      skill: { type: "smallint", notNull: true },
      methods: { type: "text[]", notNull: true },
      time_slot: { type: "text", notNull: true },
      duration: { type: "text", notNull: true },
      past_sat: { type: "smallint" },
      barriers: { type: "text[]", notNull: true, default: [] },
      barrier_other: { type: "text", notNull: true, default: "" },
      comment: { type: "text", notNull: true, default: "" },
      created_at: { type: "timestamptz", notNull: true, default: "now" },
      updated_at: { type: "timestamptz", notNull: true, default: "now" },
    },
    checks: [
      { name: "responses_emp_no_check", test: r => r.emp_no === null || /^[A-Za-z0-9-]{1,20}$/.test(r.emp_no) },
      { name: "responses_skill_check", test: r => between(r.skill, 1, 5) },
      { name: "responses_past_sat_check", test: r => between(r.past_sat, 0, 5) },
    ],
  },
});

export const COMFORT_SCHEMA = () => ({
  cb_users: {
    primaryKey: ["id"],
    unique: [["token_hash"]],
    columns: {
      id: { type: "uuid", notNull: true, default: "uuid" },
      token_hash: { type: "text", notNull: true },
      nickname: { type: "text", notNull: true },
      created_at: { type: "timestamptz", notNull: true, default: "now" },
      emoji: { type: "text", notNull: true, default: "" }, // 20261106000000_safety_and_prefs
    },
    checks: [
      { name: "cb_users_nickname_check", test: r => r.nickname === null || between(charLen(r.nickname), 1, 20) },
      { name: "cb_users_emoji_check", test: r => r.emoji === null || charLen(r.emoji) <= 16 },
    ],
  },
  cb_comforters: {
    primaryKey: ["user_id"],
    columns: {
      user_id: { type: "uuid", notNull: true },
      intro: { type: "text", notNull: true, default: "" },
      active: { type: "boolean", notNull: true, default: true },
      created_at: { type: "timestamptz", notNull: true, default: "now" },
    },
    foreignKeys: [{ columns: ["user_id"], references: { table: "cb_users", columns: ["id"] }, onDelete: "cascade" }],
    checks: [{ name: "cb_comforters_intro_check", test: r => r.intro === null || charLen(r.intro) <= 100 }],
  },
  cb_threads: {
    primaryKey: ["id"],
    columns: {
      id: { type: "uuid", notNull: true, default: "uuid" },
      seeker_id: { type: "uuid", notNull: true },
      comforter_id: { type: "uuid" }, // nullable since 20261105200000_broadcast_rooms (null = broadcast room)
      seeker_unread: { type: "boolean", notNull: true, default: false },
      comforter_unread: { type: "boolean", notNull: true, default: true },
      closed: { type: "boolean", notNull: true, default: false },
      created_at: { type: "timestamptz", notNull: true, default: "now" },
      updated_at: { type: "timestamptz", notNull: true, default: "now" },
      title: { type: "text", notNull: true, default: "" },
      last_id: { type: "bigint", notNull: true, default: 0 },
      last_body: { type: "text", notNull: true, default: "" },
      last_author: { type: "uuid" }, // no FK
      moderated: { type: "boolean", notNull: true, default: false }, // 20261106000000
    },
    foreignKeys: [
      { columns: ["seeker_id"], references: { table: "cb_users", columns: ["id"] }, onDelete: "cascade" },
      { columns: ["comforter_id"], references: { table: "cb_users", columns: ["id"] }, onDelete: "cascade" },
    ],
    checks: [{ name: "cb_threads_check", test: r => r.seeker_id !== r.comforter_id }],
  },
  cb_messages: {
    primaryKey: ["id"],
    columns: {
      id: { type: "bigint", notNull: true, default: "identity", always: true },
      thread_id: { type: "uuid", notNull: true },
      author_id: { type: "uuid", notNull: true },
      body: { type: "text", notNull: true },
      created_at: { type: "timestamptz", notNull: true, default: "now" },
      deleted_at: { type: "timestamptz" },                              // 20261106000000: recalled
      moderated: { type: "boolean", notNull: true, default: false },   // 20261106000000: hidden by reports
    },
    foreignKeys: [
      { columns: ["thread_id"], references: { table: "cb_threads", columns: ["id"] }, onDelete: "cascade" },
      { columns: ["author_id"], references: { table: "cb_users", columns: ["id"] }, onDelete: "cascade" },
    ],
    // relaxed in 20261106000000: a recalled message may have an empty body
    checks: [{ name: "cb_messages_body_check", test: r => r.body === null || r.deleted_at != null || between(charLen(r.body), 1, 2000) }],
  },
  cb_blocks: {
    primaryKey: ["blocker_id", "blocked_id"],
    columns: {
      blocker_id: { type: "uuid", notNull: true },
      blocked_id: { type: "uuid", notNull: true },
      created_at: { type: "timestamptz", notNull: true, default: "now" },
    },
    foreignKeys: [
      { columns: ["blocker_id"], references: { table: "cb_users", columns: ["id"] }, onDelete: "cascade" },
      { columns: ["blocked_id"], references: { table: "cb_users", columns: ["id"] }, onDelete: "cascade" },
    ],
    checks: [{ name: "cb_blocks_check", test: r => r.blocker_id !== r.blocked_id }],
  },
  cb_reports: {
    primaryKey: ["id"],
    columns: {
      id: { type: "bigint", notNull: true, default: "identity", always: true },
      reporter_id: { type: "uuid" },
      target_user_id: { type: "uuid" },
      thread_id: { type: "uuid" },
      message_id: { type: "bigint" },
      reason: { type: "text", notNull: true },
      detail: { type: "text", notNull: true, default: "" },
      created_at: { type: "timestamptz", notNull: true, default: "now" },
      reviewed_at: { type: "timestamptz" }, // 20261106200000_abuse_limits_admin
    },
    foreignKeys: [
      { columns: ["reporter_id"], references: { table: "cb_users", columns: ["id"] }, onDelete: "set null" },
      { columns: ["target_user_id"], references: { table: "cb_users", columns: ["id"] }, onDelete: "cascade" },
      { columns: ["thread_id"], references: { table: "cb_threads", columns: ["id"] }, onDelete: "cascade" },
      { columns: ["message_id"], references: { table: "cb_messages", columns: ["id"] }, onDelete: "cascade" },
    ],
    checks: [
      { name: "cb_reports_reason_check", test: r => r.reason === null || ["abuse", "spam", "privacy", "sexual", "other"].includes(r.reason) },
      { name: "cb_reports_detail_check", test: r => r.detail === null || charLen(r.detail) <= 300 },
    ],
  },
  cb_reactions: { // 20261106100000_reactions
    primaryKey: ["message_id", "user_id", "emoji"],
    columns: {
      message_id: { type: "bigint", notNull: true },
      thread_id: { type: "uuid", notNull: true },
      user_id: { type: "uuid", notNull: true },
      emoji: { type: "text", notNull: true },
      created_at: { type: "timestamptz", notNull: true, default: "now" },
    },
    foreignKeys: [
      { columns: ["message_id"], references: { table: "cb_messages", columns: ["id"] }, onDelete: "cascade" },
      { columns: ["thread_id"], references: { table: "cb_threads", columns: ["id"] }, onDelete: "cascade" },
      { columns: ["user_id"], references: { table: "cb_users", columns: ["id"] }, onDelete: "cascade" },
    ],
    checks: [{ name: "cb_reactions_emoji_check", test: r => r.emoji === null || charLen(r.emoji) <= 8 }],
  },
  cb_signup_log: { // 20261106200000_abuse_limits_admin
    primaryKey: ["id"],
    columns: {
      id: { type: "bigint", notNull: true, default: "identity", always: true },
      ip_hash: { type: "text", notNull: true },
      created_at: { type: "timestamptz", notNull: true, default: "now" },
    },
    checks: [{ name: "cb_signup_log_ip_hash_check", test: r => r.ip_hash === null || charLen(r.ip_hash) <= 64 }],
  },
  cb_room_prefs: {
    primaryKey: ["thread_id", "user_id"],
    columns: {
      thread_id: { type: "uuid", notNull: true },
      user_id: { type: "uuid", notNull: true },
      hidden_at: { type: "timestamptz" },
      stopped: { type: "boolean", notNull: true, default: false },
    },
    foreignKeys: [
      { columns: ["thread_id"], references: { table: "cb_threads", columns: ["id"] }, onDelete: "cascade" },
      { columns: ["user_id"], references: { table: "cb_users", columns: ["id"] }, onDelete: "cascade" },
    ],
  },
  cb_reads: {
    primaryKey: ["thread_id", "user_id"],
    columns: {
      thread_id: { type: "uuid", notNull: true },
      user_id: { type: "uuid", notNull: true },
      last_read_id: { type: "bigint", notNull: true, default: 0 },
    },
    foreignKeys: [
      { columns: ["thread_id"], references: { table: "cb_threads", columns: ["id"] }, onDelete: "cascade" },
      { columns: ["user_id"], references: { table: "cb_users", columns: ["id"] }, onDelete: "cascade" },
    ],
  },
});
