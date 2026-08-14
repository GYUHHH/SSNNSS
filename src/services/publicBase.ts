// Pages serves the repository as-is, so public/ keeps its folder there; the dev server flattens it into the root
export const publicBase = typeof location === 'undefined' ? '/'
  : location.hostname.endsWith('.github.io') ? `${import.meta.env.BASE_URL}public/` : import.meta.env.BASE_URL
