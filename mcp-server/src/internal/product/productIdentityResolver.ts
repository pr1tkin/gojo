import type { BuildMetadata, ProductIdentity } from '../../types.js';
import { PRODUCT_PACKAGING_MODEL } from './constants.js';
import { getBuildMetadata } from './buildMetadata.js';

export interface ResolvedProductIdentity {
  identity: ProductIdentity;
  buildMetadata: BuildMetadata;
}

export function resolveProductIdentity(
  env: NodeJS.ProcessEnv = process.env,
): ResolvedProductIdentity {
  const buildMetadata = getBuildMetadata(env);

  return {
    identity: {
      name: buildMetadata.productName,
      version: buildMetadata.version,
      packagingModel: PRODUCT_PACKAGING_MODEL,
    },
    buildMetadata,
  };
}
