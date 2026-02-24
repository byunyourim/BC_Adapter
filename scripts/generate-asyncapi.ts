import {
  Project,
  ClassDeclaration,
  MethodDeclaration,
  Type,
  InterfaceDeclaration,
  PropertySignature,
  ObjectLiteralExpression,
  SyntaxKind,
  Decorator,
  JSDoc,
} from 'ts-morph';
import * as path from 'path';
import * as fs from 'fs';

// ─── ts-morph project ───────────────────────────────────────────────

const project = new Project({
  tsConfigFilePath: path.resolve(__dirname, '../tsconfig.json'),
});

// ─── Decorator argument helpers ─────────────────────────────────────

function getObjectLiteralArg(decorator: Decorator): ObjectLiteralExpression {
  return decorator.getArguments()[0] as ObjectLiteralExpression;
}

function readStringProp(obj: ObjectLiteralExpression, name: string): string {
  const prop = obj.getProperty(name);
  if (!prop) return '';
  const init = prop.getChildAtIndex(2); // after name and colon
  return init.getText().replace(/^['"]|['"]$/g, '');
}

function readObjectProp(obj: ObjectLiteralExpression, name: string): ObjectLiteralExpression | undefined {
  const prop = obj.getProperty(name);
  if (!prop) return undefined;
  return prop.getDescendantsOfKind(SyntaxKind.ObjectLiteralExpression)[0];
}

// ─── JSDoc helpers ──────────────────────────────────────────────────

function getJsDocTag(jsDocs: JSDoc[], tagName: string): string | undefined {
  for (const doc of jsDocs) {
    for (const tag of doc.getTags()) {
      if (tag.getTagName() === tagName) {
        const comment = tag.getCommentText()?.trim();
        return comment || undefined;
      }
    }
  }
  return undefined;
}

function getJsDocTagFromProp(prop: PropertySignature, tagName: string): string | undefined {
  return getJsDocTag(prop.getJsDocs(), tagName);
}

// ─── Type → JSON Schema ─────────────────────────────────────────────

interface PropSchema {
  type: string;
  enum?: string[];
  description?: string;
  example?: string | number | boolean;
}

interface ObjectSchema {
  type: 'object';
  required?: string[];
  properties: Record<string, PropSchema>;
}

interface MessageSchema {
  name: string;
  title?: string;
  payload: ObjectSchema;
}

function resolveInterface(type: Type): InterfaceDeclaration | undefined {
  const symbol = type.getSymbol() || type.getAliasSymbol();
  if (!symbol) return undefined;
  const decl = symbol.getDeclarations()[0];
  if (decl && decl.getKind() === SyntaxKind.InterfaceDeclaration) {
    return decl as InterfaceDeclaration;
  }
  return undefined;
}

function propertyToSchema(prop: PropertySignature): PropSchema {
  const propType = prop.getType();
  const schema: PropSchema = { type: 'string' };

  // Determine base type
  if (propType.isString()) {
    schema.type = 'string';
  } else if (propType.isNumber()) {
    schema.type = 'number';
  } else if (propType.isBoolean()) {
    schema.type = 'boolean';
  } else if (propType.isUnion()) {
    const unionTypes = propType.getUnionTypes().filter(t => !t.isUndefined());

    if (unionTypes.every(t => t.isStringLiteral())) {
      schema.type = 'string';
      schema.enum = unionTypes.map(t => (t.getLiteralValue() as string));
    } else if (unionTypes.every(t => t.isBooleanLiteral())) {
      schema.type = 'boolean';
    } else {
      schema.type = 'string';
    }
  } else if (propType.isStringLiteral()) {
    schema.type = 'string';
    schema.enum = [propType.getLiteralValue() as string];
  }

  // Check for @enum JSDoc override (e.g. @enum confirmed,pending)
  const enumTag = getJsDocTagFromProp(prop, 'enum');
  if (enumTag) {
    schema.enum = enumTag.split(',').map(s => s.trim());
  }

  // Description
  const desc = getJsDocTagFromProp(prop, 'description');
  if (desc) {
    schema.description = desc;
  }

  // Example
  const example = getJsDocTagFromProp(prop, 'example');
  if (example !== undefined) {
    // Parse example value
    if (example === 'true') {
      schema.example = true;
    } else if (example === 'false') {
      schema.example = false;
    } else if (/^-?\d+(\.\d+)?$/.test(example)) {
      schema.example = Number(example);
    } else {
      // Strip surrounding quotes
      schema.example = example.replace(/^["']|["']$/g, '');
    }
  }

  return schema;
}

function interfaceToObjectSchema(iface: InterfaceDeclaration): ObjectSchema {
  const properties: Record<string, PropSchema> = {};
  const required: string[] = [];

  for (const prop of iface.getProperties()) {
    const name = prop.getName();
    if (!prop.hasQuestionToken()) {
      required.push(name);
    }
    properties[name] = propertyToSchema(prop);
  }

  const schema: ObjectSchema = { type: 'object', properties };
  if (required.length > 0) {
    schema.required = required;
  }
  return schema;
}

// ─── Method → Channel ───────────────────────────────────────────────

interface ChannelSpec {
  channelName: string;
  description: string;
  operationType: 'publish' | 'subscribe';
  operationId: string;
  summary: string;
  messages: MessageSchema[];
}

function processMethod(method: MethodDeclaration): ChannelSpec | undefined {
  const subscribeDec = method.getDecorator('Subscribe');
  const publishDec = method.getDecorator('Publish');
  const decorator = subscribeDec || publishDec;
  if (!decorator) return undefined;

  const obj = getObjectLiteralArg(decorator);
  const channelName = readStringProp(obj, 'channel');
  const operationId = readStringProp(obj, 'operationId');
  const summary = readStringProp(obj, 'summary');
  const description = readStringProp(obj, 'description');

  // AsyncAPI 2.6.0: @Subscribe (app consumes) → publish; @Publish (app produces) → subscribe
  const operationType = subscribeDec ? 'publish' : 'subscribe';

  // Get the parameter type(s)
  const params = method.getParameters();
  if (params.length === 0) return undefined;

  const paramType = params[0].getType();
  const messages: MessageSchema[] = [];

  if (paramType.isUnion()) {
    const unionTypes = paramType.getUnionTypes();
    for (const ut of unionTypes) {
      const iface = resolveInterface(ut);
      if (!iface) continue;
      const title = getJsDocTag(iface.getJsDocs(), 'title');
      messages.push({
        name: iface.getName(),
        title,
        payload: interfaceToObjectSchema(iface),
      });
    }
  } else {
    const iface = resolveInterface(paramType);
    if (iface) {
      messages.push({
        name: iface.getName(),
        payload: interfaceToObjectSchema(iface),
      });
    }
  }

  return { channelName, description, operationType, operationId, summary, messages };
}

// ─── YAML serializer ────────────────────────────────────────────────

function yamlValue(value: string | number | boolean): string {
  if (typeof value === 'boolean') return String(value);
  if (typeof value === 'number') return String(value);
  // String: quote it
  return `"${value}"`;
}

function serializePropertySchema(lines: string[], propName: string, prop: PropSchema, indent: number): void {
  const pad = ' '.repeat(indent);
  lines.push(`${pad}${propName}:`);

  const inner = pad + '  ';
  lines.push(`${inner}type: ${prop.type}`);

  if (prop.enum) {
    lines.push(`${inner}enum: [${prop.enum.join(', ')}]`);
  }

  if (prop.description !== undefined) {
    // Quote descriptions that contain special characters
    const desc = prop.description;
    if (desc.startsWith('"') && desc.endsWith('"')) {
      lines.push(`${inner}description: ${desc}`);
    } else {
      lines.push(`${inner}description: ${desc}`);
    }
  }

  if (prop.example !== undefined) {
    if (typeof prop.example === 'string') {
      lines.push(`${inner}example: "${prop.example}"`);
    } else {
      lines.push(`${inner}example: ${prop.example}`);
    }
  }
}

function serializeObjectSchema(lines: string[], schema: ObjectSchema, indent: number): void {
  const pad = ' '.repeat(indent);
  lines.push(`${pad}type: object`);

  if (schema.required && schema.required.length > 0) {
    lines.push(`${pad}required:`);
    for (const r of schema.required) {
      lines.push(`${pad}  - ${r}`);
    }
  }

  lines.push(`${pad}properties:`);
  for (const [propName, prop] of Object.entries(schema.properties)) {
    serializePropertySchema(lines, propName, prop, indent + 2);
  }
}

function buildYaml(
  info: { title: string; version: string; description: string },
  server: { name: string; url: string; protocol: string },
  channels: ChannelSpec[],
): string {
  const lines: string[] = [];

  // Header
  lines.push('asyncapi: 2.6.0');
  lines.push('');

  // Info
  lines.push('info:');
  lines.push(`  title: ${info.title}`);
  lines.push(`  version: ${info.version}`);
  lines.push('  description: |');
  for (const line of info.description.split('\n')) {
    lines.push(`    ${line}`);
  }
  lines.push('');

  // Servers
  lines.push('servers:');
  lines.push(`  ${server.name}:`);
  lines.push(`    url: ${server.url}`);
  lines.push(`    protocol: ${server.protocol}`);
  lines.push('');

  // Channels
  lines.push('channels:');
  for (let i = 0; i < channels.length; i++) {
    const ch = channels[i];
    lines.push(`  ${ch.channelName}:`);
    lines.push(`    description: ${ch.description}`);
    lines.push(`    ${ch.operationType}:`);
    lines.push(`      operationId: ${ch.operationId}`);
    lines.push(`      summary: ${ch.summary}`);
    lines.push('      message:');

    if (ch.messages.length === 1) {
      // Single message — inline payload
      lines.push('        payload:');
      serializeObjectSchema(lines, ch.messages[0].payload, 10);
    } else {
      // Multiple messages — oneOf
      lines.push('        oneOf:');
      for (const msg of ch.messages) {
        lines.push(`          - name: ${msg.name}`);
        lines.push(`            title: ${msg.title || msg.name}`);
        lines.push('            payload:');
        serializeObjectSchema(lines, msg.payload, 14);
      }
    }

    // Blank line between channels (but not after the last)
    if (i < channels.length - 1) {
      lines.push('');
    }
  }

  return lines.join('\n') + '\n';
}

// ─── Main ───────────────────────────────────────────────────────────

function main(): void {
  // Find the class with @AsyncApi decorator
  let targetClass: ClassDeclaration | undefined;
  for (const sf of project.getSourceFiles()) {
    for (const cls of sf.getClasses()) {
      if (cls.getDecorator('AsyncApi')) {
        targetClass = cls;
        break;
      }
    }
    if (targetClass) break;
  }

  if (!targetClass) {
    console.error('No class with @AsyncApi decorator found.');
    process.exit(1);
  }

  // Extract @AsyncApi metadata
  const asyncApiDec = targetClass.getDecorator('AsyncApi')!;
  const asyncApiObj = getObjectLiteralArg(asyncApiDec);

  const title = readStringProp(asyncApiObj, 'title');
  const version = readStringProp(asyncApiObj, 'version');

  // Description: read the raw string which may contain \n
  const descProp = asyncApiObj.getProperty('description');
  let description = '';
  if (descProp) {
    const init = descProp.getChildAtIndex(2);
    const raw = init.getText();
    // Evaluate the string literal to handle \n etc.
    description = eval(raw) as string;
  }

  const serverObj = readObjectProp(asyncApiObj, 'server')!;
  const server = {
    name: readStringProp(serverObj, 'name'),
    url: readStringProp(serverObj, 'url'),
    protocol: readStringProp(serverObj, 'protocol'),
  };

  // Process methods in declaration order
  const channels: ChannelSpec[] = [];
  for (const method of targetClass.getMethods()) {
    const ch = processMethod(method);
    if (ch) channels.push(ch);
  }

  // Build YAML
  const yaml = buildYaml({ title, version, description }, server, channels);

  // Write output
  const outPath = path.resolve(__dirname, '../asyncapi.yaml');
  fs.writeFileSync(outPath, yaml, 'utf-8');
  console.log(`AsyncAPI spec generated: ${outPath}`);
}

main();
