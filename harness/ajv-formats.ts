// ajv-formats is CommonJS; resolve its default export once here.
import type { Ajv2020 } from 'ajv/dist/2020.js';
import addFormatsModule from 'ajv-formats';

const addFormats = ((addFormatsModule as unknown as { default?: unknown }).default ?? addFormatsModule) as (ajv: Ajv2020) => void;

export function formatsPlugin(ajv: Ajv2020): void {
  addFormats(ajv);
}
