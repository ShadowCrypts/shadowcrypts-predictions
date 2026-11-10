import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';

// Next.js's recommended rules (React, hooks, accessibility, Core Web Vitals), as before the move to ESLint 9.
export default defineConfig([...nextVitals, globalIgnores(['.cache/**', '.next/**', 'node_modules/**', 'next-env.d.ts'])]);
