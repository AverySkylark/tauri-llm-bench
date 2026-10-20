import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['node_modules', 'src-tauri', 'dist', '*.config.js', '*.config.ts'] },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  reactHooks.configs.flat.recommended,
  {
    languageOptions: {
      globals: globals.browser,
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
      // All IPC goes through the typed boundary in src/ipc.
      'no-restricted-imports': [
        'error',
        { paths: [{ name: '@tauri-apps/api/core', importNames: ['invoke'], message: 'Use the typed commands in src/ipc/commands.ts.' }] },
      ],
    },
  },
  {
    files: ['src/ipc/**'],
    rules: { 'no-restricted-imports': 'off' },
  },
);
