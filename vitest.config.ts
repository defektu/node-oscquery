import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		globals: true,
		environment: 'node',
		include: ['test/**/*.test.ts', '**/*.test.ts'],
		exclude: ['node_modules/**', 'dist/**', 'example/**'],
		coverage: {
			provider: 'v8',
			reporter: ['text', 'json', 'html'],
			exclude: [
				'node_modules/**',
				'dist/**',
				'example/**',
				'**/*.spec.ts',
				'**/*.test.ts',
			],
		},
	},
});
