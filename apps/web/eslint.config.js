// Extends the shared config with Next.js and React Hooks rules.
//
// We use `@next/eslint-plugin-next` and `eslint-plugin-react-hooks` directly instead of
// `eslint-config-next`: the latter bundles eslint-plugin-react, -jsx-a11y and -import,
// whose peer ranges stop at ESLint 9, and this repo is on ESLint 10.
import base from '@whosfree/config/eslint';
import nextPlugin from '@next/eslint-plugin-next';
import reactHooks from 'eslint-plugin-react-hooks';

export default [
  { ignores: ['next-env.d.ts', '.screenshots/**'] },
  ...base,
  reactHooks.configs.flat['recommended-latest'],
  {
    plugins: { '@next/next': nextPlugin },
    rules: {
      ...nextPlugin.configs.recommended.rules,
      ...nextPlugin.configs['core-web-vitals'].rules,
    },
  },
];
