import { describe, it, expect } from 'vitest';
import { OSCNode } from '../lib/osc_node';
import { OSCTypeSimple, OSCQAccess } from '../lib/osc_types';

describe('OSCNode', () => {
	describe('serialization', () => {
		it('should serialize a simple node with arguments', () => {
			const root = new OSCNode('root');
			const node = new OSCNode('test', root);
			
			node.setOpts({
				description: 'Test node',
				access: OSCQAccess.READWRITE,
				arguments: [
					{
						type: OSCTypeSimple.FLOAT,
						range: { min: 0, max: 100 },
						value: 50,
					},
				],
			});

			const serialized = node.serialize();

			expect(serialized.FULL_PATH).toBe('/test');
			expect(serialized.DESCRIPTION).toBe('Test node');
			expect(serialized.ACCESS).toBe(OSCQAccess.READWRITE);
			expect(serialized.TYPE).toBe('f');
			expect(serialized.VALUE).toEqual([50]);
			expect(serialized.RANGE).toEqual([{ MIN: 0, MAX: 100 }]);
		});

		it('should serialize a container node', () => {
			const root = new OSCNode('root');
			const container = new OSCNode('container', root);
			const child = new OSCNode('child', container);
			
			child.setOpts({
				arguments: [{ type: OSCTypeSimple.INT }],
			});
			
			container.addChild('child', child);

			const serialized = container.serialize();

			expect(serialized.FULL_PATH).toBe('/container');
			expect(serialized.ACCESS).toBe(OSCQAccess.NO_VALUE);
			expect(serialized.CONTENTS).toBeDefined();
			expect(serialized.CONTENTS?.child).toBeDefined();
		});

		it('should serialize EXTENDED_TYPE and UNIT', () => {
			const root = new OSCNode('root');
			const node = new OSCNode('test', root);
			
			node.setOpts({
				arguments: [
					{
						type: OSCTypeSimple.FLOAT,
						extendedType: 'position',
						unit: 'meter',
						value: 1.5,
					},
				],
			});

			const serialized = node.serialize();

			expect(serialized.EXTENDED_TYPE).toEqual(['position']);
			expect(serialized.UNIT).toEqual(['meter']);
		});
	});

	describe('value management', () => {
		it('should set and get values', () => {
			const node = new OSCNode('test');
			node.setOpts({
				arguments: [
					{ type: OSCTypeSimple.FLOAT },
					{ type: OSCTypeSimple.INT },
				],
			});

			node.setValue(0, 3.14);
			node.setValue(1, 42);

			expect(node.getValue(0)).toBe(3.14);
			expect(node.getValue(1)).toBe(42);
		});

		it('should unset values', () => {
			const node = new OSCNode('test');
			node.setOpts({
				arguments: [{ type: OSCTypeSimple.FLOAT, value: 1.0 }],
			});

			expect(node.getValue(0)).toBe(1.0);
			
			node.unsetValue(0);
			
			expect(node.getValue(0)).toBeUndefined();
		});

		it('should throw error for out of range index', () => {
			const node = new OSCNode('test');
			node.setOpts({
				arguments: [{ type: OSCTypeSimple.FLOAT }],
			});

			expect(() => node.setValue(5, 1.0)).toThrow();
		});
	});

	describe('hierarchy', () => {
		it('should manage children', () => {
			const parent = new OSCNode('parent');
			const child = new OSCNode('child', parent);

			expect(parent.hasChild('child')).toBe(false);
			
			parent.addChild('child', child);
			
			expect(parent.hasChild('child')).toBe(true);
			expect(parent.getChild('child')).toBe(child);
		});

		it('should remove children', () => {
			const parent = new OSCNode('parent');
			const child = new OSCNode('child', parent);
			
			parent.addChild('child', child);
			expect(parent.hasChild('child')).toBe(true);
			
			parent.removeChild('child');
			expect(parent.hasChild('child')).toBe(false);
		});

		it('should check if node is container', () => {
			const container = new OSCNode('container');
			const method = new OSCNode('method');

			container.addChild('child', new OSCNode('child', container));
			method.setOpts({ arguments: [{ type: OSCTypeSimple.FLOAT }] });

			expect(container.isContainer()).toBe(true);
			expect(method.isContainer()).toBe(false);
		});
	});
});
