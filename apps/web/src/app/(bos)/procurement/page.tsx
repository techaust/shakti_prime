// Procurement opens on its vendor list, the same page as `/procurement/vendors`. A page of its own
// rather than a redirect: a route that loads the shell and nothing else splits the shell's chunk
// for every page (js-budget, review H1).
export const dynamic = 'force-dynamic';
export { default, generateMetadata } from './vendors/page';
