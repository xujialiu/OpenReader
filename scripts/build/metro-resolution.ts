import path from 'node:path';
import type { Resolution } from 'metro-resolver';

import type { BuildVariant } from '../../build-variant';

const replacement: Record<string, string> = {
  'src/app/purchase.ts': 'src/app/purchase-free.ts',
  'src/app/purchase-setup.ts': 'src/app/purchase-setup-free.ts',
  'src/app/purchase-ui.tsx': 'src/app/purchase-ui-free.tsx',
};

export function isPurchaseSource(relative: string): boolean {
  return relative in replacement || relative.startsWith('src/purchase/') || relative.startsWith('modules/open-reader-store/') ||
    ['src/app/purchase-screen.tsx', 'src/app/purchase-alert.ts', 'src/app/use-purchases.ts'].includes(relative);
}

/** Select before dependency traversal: free/Debug cannot even import the paid graph. */
export function resolveVariantFile(root: string, variant: BuildVariant, resolution: Resolution): Resolution {
  if (resolution.type !== 'sourceFile') return resolution;
  const relative = path.relative(root, resolution.filePath).split(path.sep).join('/');
  if (relative === 'src/build/variant.ts') {
    return { type: 'sourceFile', filePath: path.join(root, 'src/build/variants', `${variant}.ts`) };
  }
  if (variant === 'formal') return resolution;
  if (replacement[relative]) return { type: 'sourceFile', filePath: path.join(root, replacement[relative]) };
  if (isPurchaseSource(relative)) {
    throw new Error(`Purchase code is excluded from the ${variant} copy: ${relative}`);
  }
  return resolution;
}
