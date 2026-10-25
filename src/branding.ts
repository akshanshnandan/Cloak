import { readFileSync } from 'node:fs';

// Embed the supplied artwork in the managed browser without making a third-party request.
export const cloakLogoDataUri = `data:image/png;base64,${readFileSync(new URL('../public/cloak-logo.png', import.meta.url)).toString('base64')}`;
