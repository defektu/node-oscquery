import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { deserializeMethodNode, parseTypeString } from '../lib/deserialize';
import { OSCNode } from '../lib/osc_node';
import { OSCQAccess, OSCTypeSimple } from '../lib/osc_types';
import type { SerializedNode } from '../lib/serialized_node';

function method(node: OSCNode, path: string) {
	return Array.from(node._methodGenerator()).find(m => m.full_path === path);
}

describe('parseTypeString', () => {
	it('parses plain and nested array types', () => {
		expect(parseTypeString('ff')).toEqual([OSCTypeSimple.FLOAT, OSCTypeSimple.FLOAT]);
		expect(parseTypeString('i[ff]s')).toEqual([
			OSCTypeSimple.INT,
			[OSCTypeSimple.FLOAT, OSCTypeSimple.FLOAT],
			OSCTypeSimple.STRING,
		]);
	});
});

describe('deserializeMethodNode', () => {
	it('round-trips what OSCNode.serialize() produces', () => {
		const root = new OSCNode('');
		const level = root.getOrCreateChild('mixer').getOrCreateChild('level');
		level.setOpts({
			description: 'Level',
			access: OSCQAccess.READWRITE,
			arguments: [
				{ type: OSCTypeSimple.FLOAT, range: { min: 0, max: 1 }, clipmode: 'both', unit: 'gain.linear', value: 0.5 },
				{ type: OSCTypeSimple.STRING, range: { vals: ['a', 'b'] }, value: 'a' },
			],
		});

		const parsed = deserializeMethodNode(JSON.parse(JSON.stringify(root.serialize())));

		expect(method(parsed, '/mixer/level')).toEqual({
			full_path: '/mixer/level',
			description: 'Level',
			access: OSCQAccess.READWRITE,
			arguments: [
				{ type: 'f', range: { min: 0, max: 1, vals: undefined }, clipmode: 'both', unit: 'gain.linear', value: 0.5 },
				{ type: 's', range: { min: undefined, max: undefined, vals: ['a', 'b'] }, value: 'a' },
			],
		});
	});

	it('applies single-value attribute shorthand to every argument (spec "Other notes on attributes")', () => {
		const wire: SerializedNode = {
			FULL_PATH: '/',
			CONTENTS: {
				xy: {
					FULL_PATH: '/xy',
					TYPE: 'ff',
					ACCESS: 3,
					RANGE: { MIN: 0, MAX: 1 },
					CLIPMODE: 'low',
					UNIT: 'distance.m',
					EXTENDED_TYPE: 'position',
					VALUE: [0.25, 0.75],
				},
			},
		};

		const args = method(deserializeMethodNode(wire), '/xy')!.arguments!;

		expect(args.map(a => a.range)).toEqual([
			{ min: 0, max: 1, vals: undefined },
			{ min: 0, max: 1, vals: undefined },
		]);
		expect(args.map(a => a.clipmode)).toEqual(['low', 'low']);
		expect(args.map(a => a.unit)).toEqual(['distance.m', 'distance.m']);
		expect(args.map(a => a.extendedType)).toEqual(['position', 'position']);
		expect(args.map(a => a.value)).toEqual([0.25, 0.75]);
	});

	it('accepts a bare VALUE for a single-argument method', () => {
		const wire: SerializedNode = { FULL_PATH: '/gain', TYPE: 'f', ACCESS: 3, VALUE: 0.3 as unknown };
		expect(deserializeMethodNode(wire).getValue(0)).toBe(0.3);
	});

	it('skips null and missing per-argument entries without throwing', () => {
		const wire: SerializedNode = {
			FULL_PATH: '/pair',
			TYPE: 'fi',
			RANGE: [null],
			CLIPMODE: [null, 'high'],
		};
		const args = method(deserializeMethodNode(wire), '/')!.arguments!;
		expect(args[0].range).toBeUndefined();
		expect(args[1].range).toBeUndefined();
		expect(args.map(a => a.clipmode)).toEqual([undefined, 'high']);
	});

	it('deserializes overloads with the same per-argument rules', () => {
		const wire: SerializedNode = {
			FULL_PATH: '/color',
			TYPE: 'r',
			OVERLOADS: [{ FULL_PATH: '/color', TYPE: 'fff', RANGE: { MIN: 0, MAX: 1 } }],
		};
		const [overload] = method(deserializeMethodNode(wire), '/')!.overloads!;
		expect(overload.arguments!.map(a => a.range)).toEqual([
			{ min: 0, max: 1, vals: undefined },
			{ min: 0, max: 1, vals: undefined },
			{ min: 0, max: 1, vals: undefined },
		]);
	});
});

describe('core entry point', () => {
	it('only pulls in modules without Node.js or network dependencies', () => {
		const libDir = join(__dirname, '..', 'lib');
		const seen = new Set<string>();
		const visit = (file: string) => {
			if (seen.has(file)) return;
			seen.add(file);
			const source = readFileSync(join(libDir, `${file}.ts`), 'utf8');
			for (const [, spec] of source.matchAll(/from\s+"([^"]+)"/g)) {
				expect(spec.startsWith('./'), `${file}.ts imports ${spec}`).toBe(true);
				visit(spec.slice(2));
			}
		};
		visit('core');
		expect(seen.has('osc_query_discovery')).toBe(false);
		expect(seen.has('osc_query_server')).toBe(false);
	});
});
