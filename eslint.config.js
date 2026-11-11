import js from '@eslint/js';
import jsdoc from 'eslint-plugin-jsdoc';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['node_modules/'] },
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    rules: {
      quotes: ['error', 'single', { avoidEscape: true, allowTemplateLiterals: true }],
    },
  },
  {
    // Every exported symbol in src/ needs a TSDoc comment; tests document themselves through
    // their describe/it names.
    files: ['src/**/*.ts'],
    extends: [jsdoc.configs['flat/recommended-typescript-error']],
    rules: {
      'jsdoc/require-jsdoc': [
        'error',
        {
          require: {
            FunctionDeclaration: false,
            ArrowFunctionExpression: false,
            ClassDeclaration: false,
            MethodDefinition: false,
          },
          contexts: ['ExportNamedDeclaration', 'MethodDefinition:not([accessibility="private"])'],
        },
      ],
      'jsdoc/require-file-overview': [
        'error',
        { tags: { file: { initialCommentsOnly: true, mustExist: true, preventDuplicates: true } } },
      ],
      'jsdoc/tag-lines': ['error', 'never', { startLines: 1 }],
      'jsdoc/require-description': 'error',
      'jsdoc/require-param': ['error', { checkDestructured: false }],
      'jsdoc/check-param-names': ['error', { checkDestructured: false }],
    },
  },
  {
    // The hand-written server shows the protocol with no library in between, so the MCP SDK is
    // off limits in its code and in the protocol layer it is built on.
    files: ['src/server-2026/**/*.ts', 'src/protocol/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@modelcontextprotocol/*'],
              message: 'The hand-written server must not import the MCP SDK.',
            },
          ],
        },
      ],
    },
  },
);
