#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, extname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const GENERATOR_VERSION = 1;
const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const outputDir = join(root, 'docs', 'generated');
const mode = process.argv[2] ?? '--write';

if (!['--write', '--check'].includes(mode)) {
  console.error('Usage: node scripts/generate-codebase-index.mjs [--write|--check]');
  process.exit(2);
}

const CODE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);
// Terminal HTTP handlers. NOT `use` — middleware legitimately repeats on a path.
const TERMINAL_ROUTE_VERBS = new Set(['get', 'post', 'put', 'patch', 'delete']);
const EXCLUDED_DIRS = new Set([
  '.git', '.netlify', '.claude', '.Codex', 'coverage', 'dist', 'node_modules',
]);
const API_HELPERS = new Set([
  'api', 'apiGet', 'apiPatch', 'apiPost', 'authPost', 'request', 'requestJson',
]);
const MODULE_ORDER = [
  'hr', 'payroll', 'finance', 'hse', 'communications', 'workflow', 'security',
  'settings', 'widgets', 'platform', 'testing',
];

const slash = (value) => value.split(sep).join('/');
const rel = (path) => slash(relative(root, path));
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const cleanCell = (value) => String(value ?? '').replaceAll('|', '\\|').replaceAll('\n', ' ').trim();
const cleanTsv = (value) => String(value ?? '').replaceAll('\t', ' ').replaceAll('\r', ' ').replaceAll('\n', ' ').trim();
const unique = (values) => [...new Set(values)];
const byPathLineName = (a, b) =>
  a.file.localeCompare(b.file) || a.line - b.line || String(a.name ?? '').localeCompare(String(b.name ?? ''));

function walk(directory, predicate) {
  if (!existsSync(directory)) return [];
  const out = [];
  for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.isDirectory() && EXCLUDED_DIRS.has(entry.name)) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) out.push(...walk(path, predicate));
    else if (entry.isFile() && predicate(path)) out.push(path);
  }
  return out;
}

/**
 * The set of files Git knows about — tracked, plus anything newly staged.
 *
 * The generator walks the FILESYSTEM, so without this filter any untracked file under
 * src/, netlify/functions/, scripts/, types/ or the migration directories contaminates the
 * output. A developer with unrelated work in progress would generate an index describing
 * files that are not in the commit, and `repo:index:check` would then fail for anyone
 * checking that commit out. Returning null (git unavailable) degrades to the old
 * walk-everything behaviour rather than producing an empty index.
 *
 * `git ls-files` lists the index, so `git add <new file>` is what makes a new file
 * indexable. The intended order is: stage sources → repo:index → stage docs/generated →
 * commit.
 */
function collectTrackedFiles() {
  try {
    const output = execFileSync('git', ['-C', root, 'ls-files', '-z'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    return new Set(output.split('\0').filter(Boolean).map(slash));
  }
  catch {
    return null;
  }
}

const trackedFiles = collectTrackedFiles();

function isTracked(path) {
  return trackedFiles === null || trackedFiles.has(rel(path));
}

function read(path) {
  return readFileSync(path, 'utf8').replaceAll('\r\n', '\n');
}

function inferModule(pathOrName) {
  const value = slash(pathOrName).toLowerCase();
  if (/payroll|payslip|paygroup|pay-group|backpay|back-pay/.test(value)) return 'payroll';
  if (/finance|remittance|disbursement|budget|expense|statutory-form|accounts-payable/.test(value)) return 'finance';
  if (/\bhse\b|riskjsa|risk-jsa|\bptw\b|incident|investigation|\bcapa\b|inspection/.test(value)) return 'hse';
  if (/communication|message|notification|ticket|realtime|typing|presence/.test(value)) return 'communications';
  if (/workflow|handoff|orchestration/.test(value)) return 'workflow';
  if (/auth|security|webauthn|trusted-device|trusteddevice|permission|\brbac\b|2fa|mfa/.test(value)) return 'security';
  if (/widget|layout|ui-prefs|uiprefs/.test(value)) return 'widgets';
  if (/setting|catalog|manifest/.test(value)) return 'settings';
  if (/\bhr\b|onboarding|offboarding|employee|attendance|leave|roster|overtime|compensation|department|organization|transfer|request/.test(value)) return 'hr';
  if (/scripts\/e2e|tests?\//.test(value)) return 'testing';
  return 'platform';
}

function fileRole(path) {
  const value = slash(path).toLowerCase();
  if (value.startsWith('src/components/sections/')) return 'frontend-page';
  if (value.startsWith('src/ui/widgets/registry.')) return 'widget-registry';
  if (value.startsWith('src/ui/widgets/')) return 'widget-platform';
  if (value.startsWith('src/api/')) return 'frontend-api';
  if (value.startsWith('src/')) return 'frontend';
  if (value.startsWith('netlify/functions/routes/')) return 'backend-route';
  if (value.startsWith('netlify/functions/lib/')) return 'backend-lib';
  if (value.startsWith('netlify/functions/')) return 'backend';
  if (value.startsWith('scripts/e2e/suites/')) return 'e2e-suite';
  if (value.startsWith('scripts/')) return 'tooling';
  if (value.startsWith('tests/')) return 'test';
  if (value.startsWith('types/')) return 'shared-types';
  if (value.endsWith('.sql')) return 'migration';
  return 'source';
}

function scriptKind(path) {
  switch (extname(path)) {
    case '.tsx': return ts.ScriptKind.TSX;
    case '.jsx': return ts.ScriptKind.JSX;
    case '.js':
    case '.mjs':
    case '.cjs': return ts.ScriptKind.JS;
    default: return ts.ScriptKind.TS;
  }
}

function lineOf(sourceFile, node) {
  return sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
}

function hasExport(node) {
  return Boolean(node.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword));
}

function nodeName(node, sourceFile) {
  if (!node) return '';
  if (ts.isIdentifier(node) || ts.isStringLiteralLike(node) || ts.isNumericLiteral(node)) return node.text;
  return node.getText(sourceFile);
}

function callName(expression, sourceFile) {
  if (ts.isIdentifier(expression)) return expression.text;
  if (ts.isPropertyAccessExpression(expression)) return expression.name.text;
  return expression.getText(sourceFile);
}

function enclosingName(node, sourceFile) {
  let current = node.parent;
  while (current) {
    if (
      (ts.isFunctionDeclaration(current) || ts.isMethodDeclaration(current) || ts.isClassDeclaration(current))
      && current.name
    ) return nodeName(current.name, sourceFile);
    if (ts.isVariableDeclaration(current) && ts.isIdentifier(current.name)) return current.name.text;
    current = current.parent;
  }
  return '';
}

function staticValue(node, constants = new Map()) {
  if (!node) return null;
  if (ts.isStringLiteralLike(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isNumericLiteral(node)) return Number(node.text);
  if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (node.kind === ts.SyntaxKind.FalseKeyword) return false;
  if (node.kind === ts.SyntaxKind.NullKeyword) return null;
  if (ts.isIdentifier(node)) return constants.get(node.text) ?? null;
  if (
    ts.isParenthesizedExpression(node)
    || ts.isAsExpression(node)
    || ts.isTypeAssertionExpression(node)
    || ts.isNonNullExpression(node)
    || ts.isSatisfiesExpression(node)
  ) return staticValue(node.expression, constants);
  if (ts.isPropertyAccessExpression(node)) {
    const owner = staticValue(node.expression, constants);
    return owner && typeof owner === 'object' && !Array.isArray(owner)
      ? owner[node.name.text] ?? null
      : null;
  }
  if (ts.isElementAccessExpression(node)) {
    const owner = staticValue(node.expression, constants);
    const key = staticValue(node.argumentExpression, constants);
    return owner && typeof owner === 'object' && key != null
      ? owner[String(key)] ?? null
      : null;
  }
  if (ts.isObjectLiteralExpression(node)) {
    const value = {};
    for (const property of node.properties) {
      if (!ts.isPropertyAssignment(property)) continue;
      const key = ts.isComputedPropertyName(property.name)
        ? staticValue(property.name.expression, constants)
        : ts.isIdentifier(property.name) || ts.isStringLiteralLike(property.name) || ts.isNumericLiteral(property.name)
          ? property.name.text
          : null;
      if (key == null) continue;
      value[String(key)] = staticValue(property.initializer, constants);
    }
    return value;
  }
  if (ts.isArrayLiteralExpression(node)) {
    return node.elements.map(element => staticValue(element, constants));
  }
  if (ts.isTemplateExpression(node)) {
    let value = node.head.text;
    for (const span of node.templateSpans) {
      const expression = staticValue(span.expression, constants);
      value += expression == null || typeof expression === 'object' ? '${...}' : String(expression);
      value += span.literal.text;
    }
    return value;
  }
  return null;
}

function staticString(node, constants = new Map()) {
  const value = staticValue(node, constants);
  return typeof value === 'string' ? value : null;
}

function propertyMap(object, sourceFile) {
  const map = new Map();
  for (const property of object.properties) {
    if (!('name' in property) || !property.name) continue;
    const name = nodeName(property.name, sourceFile).replace(/^['"]|['"]$/g, '');
    if (ts.isPropertyAssignment(property)) map.set(name, property.initializer);
    else if (ts.isShorthandPropertyAssignment(property)) map.set(name, property.name);
    else if (ts.isMethodDeclaration(property)) map.set(name, property);
  }
  return map;
}

function normalizeApiPath(path) {
  if (!path || /^https?:/i.test(path)) return null;
  const trimmed = path.replace(/^\/+/, '');
  return path.startsWith('/api/') || path === '/api' ? path : `/api/${trimmed}`;
}

function collectCode() {
  const roots = ['src', 'netlify/functions', 'types', 'scripts', 'tests'].map(path => join(root, path));
  const paths = roots.flatMap(directory => walk(directory, path => isTracked(path) && CODE_EXTENSIONS.has(extname(path))));
  const files = [];
  const symbols = [];
  const widgets = [];
  const apiCalls = [];

  for (const absolutePath of paths.sort()) {
    const file = rel(absolutePath);
    const content = read(absolutePath);
    const module = inferModule(file);
    const sourceFile = ts.createSourceFile(file, content, ts.ScriptTarget.Latest, true, scriptKind(file));
    const constants = new Map();

    files.push({
      path: file,
      module,
      role: fileRole(file),
      lines: content.split('\n').length,
      hash: sha256(content).slice(0, 16),
    });

    for (const statement of sourceFile.statements) {
      if (!ts.isVariableStatement(statement)) continue;
      for (const declaration of statement.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name)) continue;
        const value = staticValue(declaration.initializer, constants);
        if (value != null) constants.set(declaration.name.text, value);
      }
    }

    const addSymbol = (name, kind, node, exported = false) => {
      if (!name) return;
      const tags = [];
      if (file.endsWith('.tsx') && /^[A-Z]/.test(name) && ['function', 'class', 'variable'].includes(kind)) tags.push('component');
      if (/^use[A-Z0-9]/.test(name)) tags.push('hook');
      if (/widget|tile|kpi|card/i.test(name)) tags.push('ui-tile');
      if (/\.test\.|\.spec\.|scripts\/e2e\/suites\//.test(file)) tags.push('test');
      symbols.push({
        name,
        kind,
        file,
        line: lineOf(sourceFile, node),
        module,
        exported,
        container: enclosingName(node, sourceFile),
        tags,
      });
    };

    const visit = (node) => {
      if (ts.isFunctionDeclaration(node) && node.name) addSymbol(node.name.text, 'function', node, hasExport(node));
      else if (ts.isClassDeclaration(node) && node.name) addSymbol(node.name.text, 'class', node, hasExport(node));
      else if (ts.isInterfaceDeclaration(node)) addSymbol(node.name.text, 'interface', node, hasExport(node));
      else if (ts.isTypeAliasDeclaration(node)) addSymbol(node.name.text, 'type', node, hasExport(node));
      else if (ts.isEnumDeclaration(node)) addSymbol(node.name.text, 'enum', node, hasExport(node));
      else if (ts.isMethodDeclaration(node) && node.name) addSymbol(nodeName(node.name, sourceFile), 'method', node, false);
      else if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
        const statement = node.parent?.parent;
        const exported = Boolean(statement && ts.isVariableStatement(statement) && hasExport(statement));
        const isFunction = Boolean(node.initializer && (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer)));
        const isTopLevel = Boolean(statement?.parent && ts.isSourceFile(statement.parent));
        if (isFunction || isTopLevel || exported) {
          const kind = isFunction
            ? 'function'
            : node.initializer && ts.isObjectLiteralExpression(node.initializer)
              ? 'object'
              : node.initializer && ts.isArrayLiteralExpression(node.initializer)
                ? 'array'
                : 'variable';
          addSymbol(node.name.text, kind, node, exported);
        }

        const looksLocalWidgetMap = /localwidgets/i.test(node.name.text)
          || node.type?.getText(sourceFile).includes('LocalWidgetMap');
        if (looksLocalWidgetMap && node.initializer && ts.isObjectLiteralExpression(node.initializer)) {
          for (const property of node.initializer.properties) {
            if (!ts.isPropertyAssignment(property) || !ts.isObjectLiteralExpression(property.initializer)) continue;
            const rawKey = ts.isComputedPropertyName(property.name)
              ? staticString(property.name.expression, constants)
              : staticString(property.name, constants) ?? nodeName(property.name, sourceFile);
            if (!rawKey) continue;
            const props = propertyMap(property.initializer, sourceFile);
            widgets.push({
              id: rawKey,
              title: staticString(props.get('title'), constants) ?? '',
              module,
              area: '',
              kind: 'local',
              render: props.get('render')?.getText(sourceFile) ?? '',
              file,
              line: lineOf(sourceFile, property),
            });
          }
        }
      }

      if (ts.isObjectLiteralExpression(node)) {
        const props = propertyMap(node, sourceFile);
        const id = staticString(props.get('id'), constants);
        const title = staticString(props.get('title'), constants);
        if (id && title && (props.has('render') || props.has('dataSource') || props.has('supportedPages'))) {
          widgets.push({
            id,
            title,
            module: staticString(props.get('module'), constants) ?? inferModule(`${module}/${id}`),
            area: staticString(props.get('area'), constants) ?? '',
            kind: 'registry',
            render: props.get('render')?.getText(sourceFile) ?? '',
            file,
            line: lineOf(sourceFile, node),
          });
        }
      }

      if (ts.isCallExpression(node) && file.startsWith('src/')) {
        const helper = callName(node.expression, sourceFile);
        if (API_HELPERS.has(helper)) {
          const rawPath = staticString(node.arguments[0], constants);
          const path = normalizeApiPath(rawPath);
          if (path) {
            apiCalls.push({
              path,
              helper,
              caller: enclosingName(node, sourceFile),
              file,
              line: lineOf(sourceFile, node),
              module,
            });
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
  }

  return {
    files,
    symbols: dedupe(symbols, item => `${item.file}:${item.line}:${item.kind}:${item.name}`).sort(byPathLineName),
    widgets: dedupe(widgets, item => `${item.id}:${item.file}:${item.line}`).sort((a, b) => a.id.localeCompare(b.id) || byPathLineName(a, b)),
    apiCalls: dedupe(apiCalls, item => `${item.path}:${item.file}:${item.line}`).sort((a, b) => a.path.localeCompare(b.path) || byPathLineName(a, b)),
    inputPaths: paths,
  };
}

function dedupe(values, keyOf) {
  const map = new Map();
  for (const value of values) if (!map.has(keyOf(value))) map.set(keyOf(value), value);
  return [...map.values()];
}

function collectRouteMounts() {
  const apiPath = join(root, 'netlify', 'functions', 'api.ts');
  const content = read(apiPath);
  const sourceFile = ts.createSourceFile(rel(apiPath), content, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const imports = new Map();
  const mountByFileExport = new Map();

  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    const source = statement.moduleSpecifier.text;
    if (!source.startsWith('./routes/')) continue;
    const routeFile = `netlify/functions/${source.slice(2)}.ts`;
    const clause = statement.importClause;
    if (clause?.name) imports.set(clause.name.text, { file: routeFile, exported: 'default' });
    if (clause?.namedBindings && ts.isNamedImports(clause.namedBindings)) {
      for (const element of clause.namedBindings.elements) {
        imports.set(element.name.text, { file: routeFile, exported: element.propertyName?.text ?? element.name.text });
      }
    }
  }

  const visit = (node) => {
    if (
      ts.isCallExpression(node)
      && ts.isPropertyAccessExpression(node.expression)
      && node.expression.expression.getText(sourceFile) === 'app'
      && node.expression.name.text === 'route'
    ) {
      const prefix = staticString(node.arguments[0]);
      const router = node.arguments[1];
      if (prefix && router && ts.isIdentifier(router) && imports.has(router.text)) {
        const info = imports.get(router.text);
        const key = `${info.file}|${info.exported}`;
        mountByFileExport.set(key, [...(mountByFileExport.get(key) ?? []), prefix]);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return mountByFileExport;
}

function collectRoutes() {
  const mountByFileExport = collectRouteMounts();
  const routePaths = walk(join(root, 'netlify', 'functions', 'routes'), path => isTracked(path) && extname(path) === '.ts');
  const routes = [];

  for (const absolutePath of routePaths) {
    const file = rel(absolutePath);
    const content = read(absolutePath);
    const sourceFile = ts.createSourceFile(file, content, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    let defaultExportName = '';
    const exportedNames = new Map();
    const constants = new Map();

    for (const statement of sourceFile.statements) {
      if (ts.isExportAssignment(statement) && ts.isIdentifier(statement.expression)) defaultExportName = statement.expression.text;
      if (ts.isVariableStatement(statement) && hasExport(statement)) {
        for (const declaration of statement.declarationList.declarations) {
          if (ts.isIdentifier(declaration.name)) exportedNames.set(declaration.name.text, declaration.name.text);
        }
      }
      if (ts.isExportDeclaration(statement) && !statement.moduleSpecifier && statement.exportClause && ts.isNamedExports(statement.exportClause)) {
        for (const element of statement.exportClause.elements) {
          exportedNames.set(element.propertyName?.text ?? element.name.text, element.name.text);
        }
      }
      if (ts.isVariableStatement(statement)) {
        for (const declaration of statement.declarationList.declarations) {
          if (!ts.isIdentifier(declaration.name)) continue;
          const value = staticValue(declaration.initializer, constants);
          if (value != null) constants.set(declaration.name.text, value);
        }
      }
    }

    const bindIterationValue = (name, value, bindings) => {
      if (ts.isIdentifier(name)) {
        bindings.set(name.text, value);
        return;
      }
      if (ts.isObjectBindingPattern(name) && value && typeof value === 'object' && !Array.isArray(value)) {
        for (const element of name.elements) {
          if (!ts.isIdentifier(element.name)) continue;
          const key = element.propertyName && (ts.isIdentifier(element.propertyName) || ts.isStringLiteralLike(element.propertyName))
            ? element.propertyName.text
            : element.name.text;
          bindings.set(element.name.text, value[key] ?? null);
        }
      }
    };

    const routeBindings = (node) => {
      let current = node.parent;
      while (current && !ts.isSourceFile(current)) {
        if (ts.isForOfStatement(current)) {
          let values = null;
          if (
            ts.isCallExpression(current.expression)
            && ts.isPropertyAccessExpression(current.expression.expression)
            && current.expression.expression.expression.getText(sourceFile) === 'Object'
            && current.expression.expression.name.text === 'keys'
          ) {
            const target = staticValue(current.expression.arguments[0], constants);
            if (target && typeof target === 'object' && !Array.isArray(target)) values = Object.keys(target);
          }
          else {
            const target = staticValue(current.expression, constants);
            if (Array.isArray(target)) values = target;
          }
          if (!values) return [];
          const declaration = ts.isVariableDeclarationList(current.initializer)
            ? current.initializer.declarations[0]
            : null;
          if (!declaration) return [];
          return values.map(value => {
            const bindings = new Map(constants);
            bindIterationValue(declaration.name, value, bindings);
            return bindings;
          });
        }
        current = current.parent;
      }
      return [];
    };

    const visit = (node) => {
      // Terminal route handlers only. `use()` is deliberately excluded: middleware is
      // registered many times against the same path by design, so folding it in here would
      // make the duplicate-route gate below fire on correct code.
      if (
        ts.isCallExpression(node)
        && ts.isPropertyAccessExpression(node.expression)
        && TERMINAL_ROUTE_VERBS.has(node.expression.name.text)
      ) {
        const method = node.expression.name.text.toUpperCase();
        const bindings = routeBindings(node);
        const localPaths = bindings.length
          ? unique(bindings.map(binding => staticString(node.arguments[0], binding)).filter(Boolean))
          : [staticString(node.arguments[0], constants)].filter(Boolean);
        const owner = node.expression.expression;
        if (localPaths.length && ts.isIdentifier(owner)) {
          const exported = owner.text === defaultExportName
            ? 'default'
            : exportedNames.get(owner.text) ?? owner.text;
          const prefixes = mountByFileExport.get(`${file}|${exported}`) ?? [];

          const callback = [...node.arguments].reverse().find(argument => ts.isArrowFunction(argument) || ts.isFunctionExpression(argument));
          const permissions = new Set();
          const guards = new Set();
          const schemas = new Set();
          if (callback) {
            const inspect = (child) => {
              if (ts.isCallExpression(child)) {
                const name = callName(child.expression, sourceFile);
                if (name === 'requirePermission') permissions.add(staticString(child.arguments[1]) ?? child.arguments[1]?.getText(sourceFile) ?? 'dynamic');
                if (['requirePermission', 'requireRole', 'requireUser', 'userCan', 'assertInScope'].includes(name)) guards.add(name);
                if (name === 'zv' && child.arguments[1]) schemas.add(child.arguments[1].getText(sourceFile));
              }
              ts.forEachChild(child, inspect);
            };
            inspect(callback);
          }

          for (const localPath of localPaths) {
            for (const prefix of prefixes.length ? prefixes : ['UNMOUNTED']) {
              const fullPath = prefix === 'UNMOUNTED'
                ? `UNMOUNTED:${localPath}`
                : `${prefix}/${localPath}`.replace(/\/{2,}/g, '/');
              routes.push({
                method,
                path: fullPath,
                localPath,
                router: owner.text,
                permission: [...permissions].sort().join(', ') || '',
                guards: [...guards].sort(),
                schema: [...schemas].sort().join(', '),
                file,
                line: lineOf(sourceFile, node),
                module: inferModule(`${file}/${fullPath}`),
              });
            }
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
  }

  return dedupe(routes, item => `${item.path}:${item.file}:${item.line}`).sort((a, b) => a.path.localeCompare(b.path));
}

function collectDatabaseObjects() {
  const roots = ['supabase/migrations', 'database/migrations'].map(path => join(root, path));
  const paths = roots.flatMap(directory => walk(directory, path => isTracked(path) && extname(path) === '.sql'));
  const objects = [];
  const patterns = [
    ['table', /create\s+table\s+(?:if\s+not\s+exists\s+)?((?:"?[a-zA-Z_][\w$]*"?\.)?"?[a-zA-Z_][\w$]*"?)/gi],
    ['function', /create\s+(?:or\s+replace\s+)?function\s+((?:"?[a-zA-Z_][\w$]*"?\.)?"?[a-zA-Z_][\w$]*"?)/gi],
    ['procedure', /create\s+(?:or\s+replace\s+)?procedure\s+((?:"?[a-zA-Z_][\w$]*"?\.)?"?[a-zA-Z_][\w$]*"?)/gi],
    ['view', /create\s+(?:or\s+replace\s+)?view\s+((?:"?[a-zA-Z_][\w$]*"?\.)?"?[a-zA-Z_][\w$]*"?)/gi],
    ['index', /create\s+(?:unique\s+)?index\s+(?:concurrently\s+)?(?:if\s+not\s+exists\s+)?("?[a-zA-Z_][\w$]*"?)/gi],
    ['trigger', /create\s+(?:constraint\s+)?trigger\s+("?[a-zA-Z_][\w$]*"?)/gi],
    ['policy', /create\s+policy\s+("[^"]+"|[a-zA-Z_][\w$]*)/gi],
  ];

  for (const absolutePath of paths.sort()) {
    const file = rel(absolutePath);
    const content = read(absolutePath);
    const starts = [0];
    for (let index = 0; index < content.length; index += 1) if (content[index] === '\n') starts.push(index + 1);
    const lineForOffset = (offset) => {
      let low = 0;
      let high = starts.length;
      while (low < high) {
        const middle = Math.floor((low + high) / 2);
        if (starts[middle] <= offset) low = middle + 1;
        else high = middle;
      }
      return low;
    };

    for (const [kind, pattern] of patterns) {
      for (const match of content.matchAll(pattern)) {
        const name = match[1].replaceAll('"', '');
        objects.push({
          name,
          kind,
          file,
          line: lineForOffset(match.index ?? 0),
          module: inferModule(`${file}/${name}`),
        });
      }
    }
  }

  return {
    objects: dedupe(objects, item => `${item.kind}:${item.name}:${item.file}:${item.line}`).sort(byPathLineName),
    inputPaths: paths,
  };
}

function collectE2e() {
  const paths = walk(join(root, 'scripts', 'e2e', 'suites'), path => isTracked(path) && extname(path) === '.mjs');
  const suites = [];

  for (const absolutePath of paths.sort()) {
    const file = rel(absolutePath);
    const content = read(absolutePath);
    const sourceFile = ts.createSourceFile(file, content, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
    let title = file.split('/').at(-1).replace(/\.mjs$/, '');
    const tests = [];
    const apiPaths = [];

    for (const statement of sourceFile.statements) {
      if (!ts.isVariableStatement(statement)) continue;
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name) && declaration.name.text === 'title') {
          title = staticString(declaration.initializer) ?? title;
        }
      }
    }

    const visit = (node) => {
      if (ts.isCallExpression(node)) {
        const name = callName(node.expression, sourceFile);
        if (name === 'test') {
          const testName = staticString(node.arguments[0]);
          if (testName) tests.push({ name: testName, line: lineOf(sourceFile, node) });
        }
        if (name === 'api') {
          const rawPath = staticString(node.arguments[0]);
          const path = normalizeApiPath(rawPath);
          if (path) apiPaths.push(path);
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);

    suites.push({
      name: file.split('/').at(-1).replace(/\.mjs$/, ''),
      title,
      module: inferModule(file),
      file,
      tests: dedupe(tests, item => `${item.line}:${item.name}`),
      apiPaths: unique(apiPaths).sort(),
    });
  }
  return suites;
}

function moduleSort(a, b) {
  const ai = MODULE_ORDER.indexOf(a);
  const bi = MODULE_ORDER.indexOf(b);
  return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi) || a.localeCompare(b);
}

function renderIndex(index) {
  const lines = [
    '<!-- GENERATED by scripts/generate-codebase-index.mjs. DO NOT EDIT. -->',
    '',
    '# SIOMAC Codebase Index',
    '',
    `Source fingerprint: \`${index.source.fingerprint}\`  `,
    `Generator version: \`${index.formatVersion}\``,
    '',
    '## Use',
    '',
    '1. Open the relevant file under `docs/generated/modules/` before searching source.',
    '2. Search `SYMBOL_INDEX.tsv`, `ROUTE_INDEX.tsv`, or `WIDGET_INDEX.tsv` for exact locations.',
    '3. Use `CODEBASE_INDEX.json` for complete machine-readable relationships.',
    '4. Re-read source immediately before editing; this index is navigation, not implementation authority.',
    '',
    'Regenerate with `npm run repo:index`; verify with `npm run repo:index:check`.',
    '',
    '## Inventory',
    '',
    '| Files | Named symbols | Widgets/tiles | Unique mounted endpoints | Mounted definitions | Unmounted definitions | Frontend API calls | Database objects | E2E suites | E2E tests |',
    '|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|',
    `| ${index.summary.files} | ${index.summary.symbols} | ${index.summary.widgets} | ${index.summary.routes} | ${index.summary.routeDefinitions} | ${index.summary.unmountedRoutes} | ${index.summary.apiCalls} | ${index.summary.databaseObjects} | ${index.summary.e2eSuites} | ${index.summary.e2eTests} |`,
    '',
    '## Modules',
    '',
    '| Module | Files | Symbols | Widgets | Unique routes | Route definitions | API calls | DB objects | E2E suites | Map |',
    '|---|---:|---:|---:|---:|---:|---:|---:|---:|---|',
  ];
  for (const module of index.modules) {
    lines.push(`| ${module.id} | ${module.counts.files} | ${module.counts.symbols} | ${module.counts.widgets} | ${module.counts.routes} | ${module.counts.routeDefinitions} | ${module.counts.apiCalls} | ${module.counts.databaseObjects} | ${module.counts.e2eSuites} | [open](modules/${module.id}.md) |`);
  }

  lines.push('', '## Widget and Tile Directory', '', '| ID | Title | Kind | Module/area | Render | Location |', '|---|---|---|---|---|---|');
  for (const widget of index.widgets) {
    lines.push(`| \`${cleanCell(widget.id)}\` | ${cleanCell(widget.title)} | ${widget.kind} | ${cleanCell(widget.module)}${widget.area ? `/${cleanCell(widget.area)}` : ''} | \`${cleanCell(widget.render)}\` | \`${widget.file}:${widget.line}\` |`);
  }

  lines.push(
    '',
    '## Important limitation',
    '',
    'Relationships are derived from static syntax. Dynamic route construction, runtime widget packages,',
    'indirect database calls, and reflection may require source inspection. Missing a derived relationship',
    'does not prove that no relationship exists.',
    '',
  );
  return `${lines.join('\n')}\n`;
}

function renderModule(index, moduleId) {
  const files = index.files.filter(item => item.module === moduleId);
  const symbols = index.symbols.filter(item => item.module === moduleId);
  const widgets = index.widgets.filter(item => item.module === moduleId);
  const routes = index.routes.filter(item => item.module === moduleId);
  const apiCalls = index.apiCalls.filter(item => item.module === moduleId);
  const databaseObjects = index.databaseObjects.filter(item => item.module === moduleId);
  const suites = index.e2eSuites.filter(item => item.module === moduleId);
  const allKeySymbols = symbols.filter(symbol => symbol.exported && symbol.tags.some(tag => ['component', 'hook', 'ui-tile'].includes(tag)));
  const keySymbols = allKeySymbols.slice(0, 160);
  const navigationRoles = new Set([
    'frontend-page', 'frontend-api', 'widget-registry', 'widget-platform',
    'backend-route', 'e2e-suite', 'shared-types',
  ]);
  const navigationFiles = files.filter(file => navigationRoles.has(file.role));
  const mountedRoutes = routes.filter(route => !route.path.startsWith('UNMOUNTED:'));
  const uniqueMountedRoutes = new Set(mountedRoutes.map(route => route.path)).size;
  const lines = [
    '<!-- GENERATED by scripts/generate-codebase-index.mjs. DO NOT EDIT. -->',
    '',
    `# ${moduleId} Module Map`,
    '',
    `Source fingerprint: \`${index.source.fingerprint}\``,
    '',
    `Files: ${files.length} | Symbols: ${symbols.length} | Widgets: ${widgets.length} | Unique mounted endpoints: ${uniqueMountedRoutes} | Route definitions: ${mountedRoutes.length} mounted + ${routes.length - mountedRoutes.length} unmounted | API calls: ${apiCalls.length} | DB objects: ${databaseObjects.length} | E2E suites: ${suites.length}`,
    '',
  ];

  lines.push('## Widgets and Tiles', '', '| ID | Title | Kind | Render | Location |', '|---|---|---|---|---|');
  if (!widgets.length) lines.push('| - | - | - | - | - |');
  for (const widget of widgets) lines.push(`| \`${cleanCell(widget.id)}\` | ${cleanCell(widget.title)} | ${widget.kind} | \`${cleanCell(widget.render)}\` | \`${widget.file}:${widget.line}\` |`);

  lines.push('', '## Route Definitions', '', 'Includes intentionally unmounted source routes so retired or deferred surfaces are not mistaken for live endpoints.', '', '| Path | Permission | Guards | Schema | Location | Frontend callers | E2E suites |', '|---|---|---|---|---|---|---|');
  if (!routes.length) lines.push('| - | - | - | - | - | - | - |');
  for (const route of routes) {
    const callers = index.apiCalls.filter(call => call.path === route.path).map(call => `${call.caller || '(top-level)'} @ ${call.file}:${call.line}`);
    const testedBy = index.e2eSuites.filter(suite => suite.apiPaths.includes(route.path)).map(suite => suite.name);
    lines.push(`| \`${cleanCell(route.path)}\` | \`${cleanCell(route.permission || '-')}\` | ${cleanCell(route.guards.join(', ') || '-')} | \`${cleanCell(route.schema || '-')}\` | \`${route.file}:${route.line}\` | ${cleanCell(callers.join('<br>') || '-')} | ${cleanCell(testedBy.join(', ') || '-')} |`);
  }

  lines.push('', '## Frontend API Calls', '', '| Path | Helper | Caller | Location |', '|---|---|---|---|');
  if (!apiCalls.length) lines.push('| - | - | - | - |');
  for (const call of apiCalls) lines.push(`| \`${cleanCell(call.path)}\` | \`${call.helper}\` | \`${cleanCell(call.caller || '(top-level)')}\` | \`${call.file}:${call.line}\` |`);

  lines.push('', '## Key Components, Hooks, and UI Functions', '', '| Symbol | Kind/tags | Location | Container |', '|---|---|---|---|');
  if (!keySymbols.length) lines.push('| - | - | - | - |');
  for (const symbol of keySymbols) lines.push(`| \`${cleanCell(symbol.name)}\` | ${symbol.kind}${symbol.tags.length ? ` / ${symbol.tags.join(', ')}` : ''} | \`${symbol.file}:${symbol.line}\` | \`${cleanCell(symbol.container || '-')}\` |`);
  if (allKeySymbols.length > keySymbols.length) lines.push(`| ... | ${allKeySymbols.length - keySymbols.length} additional indexed symbols | Search \`../SYMBOL_INDEX.tsv\` | - |`);
  lines.push('', 'All named functions and private helpers are in `../SYMBOL_INDEX.tsv` and `../CODEBASE_INDEX.json`.', '');

  lines.push('## Database Objects', '', '| Kind | Name | Migration/location |', '|---|---|---|');
  const importantDb = databaseObjects.filter(object => ['table', 'function', 'procedure', 'view', 'trigger'].includes(object.kind));
  if (!importantDb.length) lines.push('| - | - | - |');
  for (const object of importantDb) lines.push(`| ${object.kind} | \`${cleanCell(object.name)}\` | \`${object.file}:${object.line}\` |`);

  lines.push('', '## E2E Suites', '', '| Suite | Tests | API paths | Location |', '|---|---:|---:|---|');
  if (!suites.length) lines.push('| - | - | - | - |');
  for (const suite of suites) lines.push(`| ${cleanCell(suite.title)} | ${suite.tests.length} | ${suite.apiPaths.length} | \`${suite.file}\` |`);

  lines.push('', '## Navigation Files', '', 'Entry surfaces only. Search `../SYMBOL_INDEX.tsv` or `../CODEBASE_INDEX.json` for backend helpers and private implementation files.', '', '| Role | Path | Lines |', '|---|---|---:|');
  for (const file of navigationFiles) lines.push(`| ${file.role} | \`${file.path}\` | ${file.lines} |`);
  lines.push('');
  return `${lines.join('\n')}\n`;
}

function makeTsv(headers, rows) {
  return `${[headers, ...rows].map(row => row.map(cleanTsv).join('\t')).join('\n')}\n`;
}

function buildIndex() {
  const code = collectCode();
  const routes = collectRoutes();
  const database = collectDatabaseObjects();
  const e2eSuites = collectE2e();
  const explicitInputs = [join(root, 'package.json'), join(root, '.husky', 'pre-commit')].filter(existsSync);
  const allInputPaths = unique([...code.inputPaths, ...database.inputPaths, ...explicitInputs]).sort();
  const fingerprint = sha256(allInputPaths.map(path => `${rel(path)}\0${read(path)}`).join('\0')).slice(0, 24);
  const moduleIds = unique([
    ...code.files.map(item => item.module),
    ...code.symbols.map(item => item.module),
    ...code.widgets.map(item => item.module),
    ...routes.map(item => item.module),
    ...code.apiCalls.map(item => item.module),
    ...database.objects.map(item => item.module),
    ...e2eSuites.map(item => item.module),
  ]).sort(moduleSort);

  const modules = moduleIds.map(id => ({
    id,
    counts: {
      files: code.files.filter(item => item.module === id).length,
      symbols: code.symbols.filter(item => item.module === id).length,
      widgets: code.widgets.filter(item => item.module === id).length,
      routes: new Set(routes.filter(item => item.module === id && !item.path.startsWith('UNMOUNTED:')).map(item => item.path)).size,
      routeDefinitions: routes.filter(item => item.module === id).length,
      apiCalls: code.apiCalls.filter(item => item.module === id).length,
      databaseObjects: database.objects.filter(item => item.module === id).length,
      e2eSuites: e2eSuites.filter(item => item.module === id).length,
    },
  }));

  return {
    formatVersion: GENERATOR_VERSION,
    source: {
      fingerprint,
      indexedFiles: allInputPaths.length,
    },
    summary: {
      files: code.files.length,
      symbols: code.symbols.length,
      widgets: code.widgets.length,
      routes: new Set(routes.filter(item => !item.path.startsWith('UNMOUNTED:')).map(item => item.path)).size,
      routeDefinitions: routes.filter(item => !item.path.startsWith('UNMOUNTED:')).length,
      unmountedRoutes: routes.filter(item => item.path.startsWith('UNMOUNTED:')).length,
      apiCalls: code.apiCalls.length,
      databaseObjects: database.objects.length,
      e2eSuites: e2eSuites.length,
      e2eTests: e2eSuites.reduce((total, suite) => total + suite.tests.length, 0),
    },
    modules,
    files: code.files,
    symbols: code.symbols,
    widgets: code.widgets,
    routes,
    apiCalls: code.apiCalls,
    databaseObjects: database.objects,
    e2eSuites,
  };
}

function expectedOutputs(index) {
  const outputs = new Map();
  outputs.set('CODEBASE_INDEX.md', renderIndex(index));
  outputs.set('CODEBASE_INDEX.json', `${JSON.stringify(index, null, 2)}\n`);
  outputs.set('SYMBOL_INDEX.tsv', makeTsv(
    ['symbol', 'kind', 'module', 'exported', 'tags', 'file', 'line', 'container'],
    index.symbols.map(item => [item.name, item.kind, item.module, item.exported, item.tags.join(','), item.file, item.line, item.container]),
  ));
  outputs.set('ROUTE_INDEX.tsv', makeTsv(
    ['path', 'module', 'permission', 'guards', 'schema', 'file', 'line'],
    index.routes.map(item => [item.path, item.module, item.permission, item.guards.join(','), item.schema, item.file, item.line]),
  ));
  outputs.set('WIDGET_INDEX.tsv', makeTsv(
    ['id', 'title', 'kind', 'module', 'area', 'render', 'file', 'line'],
    index.widgets.map(item => [item.id, item.title, item.kind, item.module, item.area, item.render, item.file, item.line]),
  ));
  for (const module of index.modules) outputs.set(`modules/${module.id}.md`, renderModule(index, module.id));
  return outputs;
}

function currentGeneratedFiles() {
  return walk(outputDir, path => statSync(path).isFile()).map(path => slash(relative(outputDir, path))).sort();
}

function writeOutputs(outputs) {
  mkdirSync(outputDir, { recursive: true });
  for (const [path, content] of outputs) {
    const absolutePath = join(outputDir, path);
    mkdirSync(dirname(absolutePath), { recursive: true });
    writeFileSync(absolutePath, content, 'utf8');
  }
  const expected = new Set(outputs.keys());
  for (const stale of currentGeneratedFiles()) {
    if (!expected.has(stale)) rmSync(join(outputDir, stale));
  }
}

function checkOutputs(outputs) {
  const problems = [];
  const expected = new Set(outputs.keys());
  for (const [path, content] of outputs) {
    const absolutePath = join(outputDir, path);
    if (!existsSync(absolutePath)) problems.push(`missing: ${path}`);
    else if (read(absolutePath) !== content) problems.push(`stale: ${path}`);
  }
  for (const path of currentGeneratedFiles()) if (!expected.has(path)) problems.push(`unexpected: ${path}`);
  if (problems.length) {
    console.error('Codebase index is stale:');
    for (const problem of problems) console.error(`  ${problem}`);
    console.error('\nRun: npm run repo:index');
    process.exit(1);
  }
}

/**
 * Two implementations must never own the same mounted endpoint.
 *
 * Hono dispatches in registration order and a handler that returns a Response ends
 * processing, so a second registration of the same method+path is unreachable — it looks
 * live in review, is never executed, and drifts from the handler that actually serves the
 * traffic. `/api/communications/messages/search` was registered twice for exactly this
 * reason: the shadowed copy had a different validation floor, no cursor support and a
 * different response shape, and the frontend had been typed against the wrong one.
 *
 * This fails the build in BOTH modes. Generating a "valid" index over a duplicated route
 * would just record the contradiction.
 */
function assertNoDuplicateRoutes(routes) {
  const byKey = new Map();
  for (const route of routes) {
    if (route.path.startsWith('UNMOUNTED:')) continue;   // not dispatchable; nothing to collide
    const key = `${route.method} ${route.path}`;
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(route);
  }
  const duplicates = [...byKey.entries()].filter(([, list]) => list.length > 1);
  if (!duplicates.length) return;

  console.error('Duplicate mounted route:');
  for (const [key, list] of duplicates) {
    console.error(`  ${key}`);
    for (const route of list) console.error(`    - ${route.file}:${route.line}`);
  }
  console.error('\nOnly the FIRST registration is reachable. Delete the others.');
  process.exit(1);
}

const index = buildIndex();
assertNoDuplicateRoutes(index.routes ?? []);
const outputs = expectedOutputs(index);
if (mode === '--write') writeOutputs(outputs);
else checkOutputs(outputs);

console.log(
  `${mode === '--write' ? 'Generated' : 'Verified'} codebase index: `
  + `${index.summary.files} files, ${index.summary.symbols} symbols, `
  + `${index.summary.widgets} widgets, ${index.summary.routes} unique mounted endpoints, `
  + `${index.summary.databaseObjects} DB objects, ${index.summary.e2eSuites} E2E suites.`,
);
