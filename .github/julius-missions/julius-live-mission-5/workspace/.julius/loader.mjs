/**
 * The one thing a slice mission's test command has to import.
 *
 * `node --import ./.julius/loader.mjs --test <files>` registers the resolver
 * above for the whole process, including the test workers `node --test` forks.
 * Registering from inside a test file would be too late for that file's own
 * imports, which are hoisted.
 */
import { register } from 'node:module';
register('./resolve.mjs', import.meta.url);
